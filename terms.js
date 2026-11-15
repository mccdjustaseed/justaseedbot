// terms.js : bảng ĐIỀU KHOẢN SỬ DỤNG hiện ra khi người chơi dùng bot lần đầu hoặc chưa có tài khoản game.
// - Chưa có tài khoản  -> bấm "Đồng ý" bot sẽ tự tạo tài khoản + bản lưu mới, chơi được ngay, không cần vào web.
// - Đã có tài khoản    -> chỉ cần đồng ý một lần.
// Cần: chạy bot_terms.sql trong Supabase. Nếu chưa có bảng, bot tự tắt phần này (không chặn ai) và báo lỗi trong log.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('./save-store');
const headless = require('./headless');

const TERMS_VERSION = Number(process.env.TERMS_VERSION) || 1;           // tăng số này để bắt mọi người đồng ý lại khi đổi điều khoản
const TERMS_URL = process.env.TERMS_URL || '';                          // (tùy chọn) link trang điều khoản đầy đủ
const EMAIL_DOMAIN = process.env.BOT_EMAIL_DOMAIN || 'bot.justaseed.xyz'; // email giả cho tài khoản do bot tạo (không gửi thư)
const BYPASS = new Set(['help']);                                       // lệnh slash luôn dùng được kể cả chưa đồng ý

let sb = null, X = null, ready = false, disabled = false;
const accepted = new Set();   // Discord ID đã đồng ý đúng phiên bản
const busy = new Set();       // đang xử lý nút đồng ý (chống bấm đúp)
const lastPrompt = new Map(); // chống spam bảng khi gõ lệnh prefix liên tục

// bản dự phòng của def() trong game, chỉ dùng khi máy chủ bot không chạy được trình duyệt ẩn
const DEF_SAVE = () => ({ name: 'Justaseed', day: 1, money: 500000, rep: 4, st: {}, bought: {}, spent: 0, pr: {}, un: {}, up: 0, sv: 0, rev: 0, five: 0, rv: [], cl: {}, prev: {}, rpt: null, ph: 'prep', dark: 0, snd: 1, mus: 0, tut: 0, led: [], dog: { n: 'tró Gun', fur: '#d9a066', own: [], eq: {}, bond: 0 }, fo: {}, vl: 0, cat: { n: 'Mướp', g: 'm', fur: '#f2b366', own: [], eq: {}, bond: 0 }, bg: {}, len: 240, dead: {} });

// ---------------- nội dung điều khoản ----------------
function termsLayout(owner, hasAccount) {
  const E = X.EM;
  const intro = hasAccount
    ? `${E.tip} Bạn cần đọc và đồng ý điều khoản **một lần** trước khi dùng bot.`
    : `${E.tip} Bạn **chưa có tài khoản Justaseed**. Đồng ý điều khoản bên dưới, bot sẽ tạo tài khoản gắn với Discord của bạn để **chơi ngay**, không cần vào web.`;
  const body = [
    `${E.a} **Dữ liệu:** bot lưu ID Discord, tên hiển thị, ảnh đại diện và tiến trình game (tiền, ngày, kho, tiệm…). Tên và ảnh được dùng cho hồ sơ, bảng xếp hạng trong game.`,
    `${E.b} **Tài khoản:** gắn với Discord của bạn. Sau này vào web, đăng nhập bằng đúng Discord này thì tiến trình từ bot được chuyển sang.`,
    `${E.a} **Vật phẩm ảo:** tiền và vật phẩm chỉ có giá trị trong game, không quy đổi ra tiền thật và không hoàn lại.`,
    `${E.b} **Cách chơi công bằng:** không lợi dụng lỗi, không spam lệnh hay dùng công cụ tự động, không chuyển tiền gian lận. Quản trị viên có thể khóa hoặc đặt lại tài khoản vi phạm.`,
    `${E.a} **Dịch vụ:** bot và game cung cấp theo hiện trạng, có thể bảo trì hoặc thay đổi; dữ liệu có thể bị ảnh hưởng khi có lỗi.`,
    `${E.b} **Discord:** bạn vẫn phải tuân thủ Điều khoản của Discord (độ tuổi tối thiểu theo quy định của Discord).`,
    `${E.a} **Xóa dữ liệu:** muốn xóa tài khoản hoặc dữ liệu, hãy liên hệ quản trị viên server.`,
  ].join('\n');
  const btns = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tos:ok:${owner}`).setStyle(ButtonStyle.Success)
      .setLabel(hasAccount ? 'Đồng ý' : 'Đồng ý & tạo tài khoản'),
    new ButtonBuilder().setCustomId(`tos:no:${owner}`).setStyle(ButtonStyle.Secondary).setLabel('Không đồng ý'),
  );
  if (TERMS_URL) btns.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Điều khoản đầy đủ').setURL(TERMS_URL));
  return X.layout([
    X.H('Điều khoản sử dụng', E.help),
    intro,
    { sep: true },
    body,
    { sep: true },
    '-# Bấm **Đồng ý** nghĩa là bạn đã đọc và chấp nhận các điều khoản trên.',
    { row: btns },
  ]);
}

// ---------------- kiểm tra ----------------
const needs = (id) => ready && !disabled && !accepted.has(String(id));

async function loadAccepted() {
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('bot_terms').select('discord_id,version').range(from, from + 999);
    if (error) throw error;
    (data || []).forEach(r => { if (Number(r.version) >= TERMS_VERSION) accepted.add(String(r.discord_id)); });
    if (!data || data.length < 1000) break;
  }
}

// ---------------- tạo tài khoản + bản lưu mới ----------------
async function freshSave() {
  try { if (headless.available()) return await headless.newSave(); }
  catch (e) { console.error('[terms] không lấy được save mới từ game, dùng bản dự phòng:', e.message); }
  return DEF_SAVE();
}

async function createAccount(user) {
  const did = String(user.id);
  const display = user.globalName || user.username;
  const username = String(user.username || 'player').toLowerCase();
  const avatar = user.displayAvatarURL({ extension: 'png', size: 256 });

  let uid = null;
  const { data, error } = await sb.auth.admin.createUser({
    email: `discord.${did}@${EMAIL_DOMAIN}`, email_confirm: true,
    user_metadata: { provider_id: did, preferred_username: username, full_name: display, global_name: display, avatar_url: avatar, created_via: 'bot' },
  });
  if (error) {
    if (!/already|registered|exists/i.test(error.message || '')) throw error;
    // lần trước tạo dở dang: tìm lại tài khoản cũ thay vì tạo trùng
    await X.refreshLinks();
    uid = await X.userIdOf(did);
    if (!uid) throw error;
  } else uid = data.user.id;

  const sv = await freshSave();
  const row = { user_id: uid, data: store.encode(sv), xp: Math.round(sv.xp || 0), day: sv.day || 1, money: Math.round(sv.money || 0), updated_at: new Date().toISOString() };
  const { data: old } = await sb.from('game_saves').select('data').eq('user_id', uid).maybeSingle();
  if (!old || !old.data) { // không đè bản lưu đã có
    let r = await sb.from('game_saves').upsert({ ...row, rev: 1 }, { onConflict: 'user_id' });
    if (r.error && /\brev\b/.test(r.error.message || '')) r = await sb.from('game_saves').upsert(row, { onConflict: 'user_id' });
    if (r.error) throw r.error;
  }
  // hồ sơ công khai (web cũng tự ghi lại khi đăng nhập), lỗi ở đây không làm hỏng việc tạo tài khoản
  await sb.from('profiles').upsert({ id: uid, username, display_name: display, avatar_url: avatar }, { onConflict: 'id' }).then(r => r.error && console.error('[terms] profiles:', r.error.message));
  await sb.from('shop_public').upsert({ user_id: uid, shop_name: sv.name || 'Tiệm hoa', day: sv.day || 1, money: sv.money || 0, level: 1, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).then(r => r.error && console.error('[terms] shop_public:', r.error.message));

  X.setLink(did, uid);
  return { uid, money: Math.round(sv.money || 0) };
}

async function record(did, uid, created) {
  const { error } = await sb.from('bot_terms').upsert({
    discord_id: String(did), user_id: uid, version: TERMS_VERSION, created_account: created, accepted_at: new Date().toISOString(),
  }, { onConflict: 'discord_id' });
  if (error) throw error;
  accepted.add(String(did));
}

// ---------------- hiển thị bảng ----------------
async function promptInteraction(i) {
  const hasAccount = !!(await X.userIdOf(i.user.id));
  return i.reply({ ...termsLayout(i.user.id, hasAccount), flags: X.V2 | X.EPH });
}
async function promptMessage(msg) { // lệnh prefix: không có tin nhắn ẩn nên trả lời ngay tại kênh
  const now = Date.now();
  if (now - (lastPrompt.get(msg.author.id) || 0) < 4000) return;
  lastPrompt.set(msg.author.id, now);
  const hasAccount = !!(await X.userIdOf(msg.author.id));
  return msg.reply({ ...termsLayout(msg.author.id, hasAccount), failIfNotExists: false }).catch(() => {});
}

// ---------------- xử lý nút ----------------
async function onButton(i) {
  const [, act, owner] = i.customId.split(':');
  if (i.user.id !== owner) return i.reply({ ...X.layout(['Bảng này của người khác. Hãy dùng một lệnh bất kỳ để mở bảng điều khoản của bạn.']), flags: X.V2 | X.EPH });
  const E = X.EM;

  if (act === 'no') {
    return i.update(X.layout([
      X.H('Điều khoản sử dụng', E.help),
      `${E.no} Bạn chưa đồng ý nên bot chưa thể dùng được và **chưa tạo tài khoản**. Dùng một lệnh bất kỳ để xem lại điều khoản khi sẵn sàng.`,
    ]));
  }
  if (accepted.has(owner)) {
    return i.update(X.layout([X.H('Điều khoản sử dụng', E.help), `${E.ok} Bạn đã đồng ý rồi, cứ dùng lệnh như bình thường nhé.`, { row: X.linkRow() }]));
  }
  if (busy.has(owner)) return i.deferUpdate().catch(() => {});
  busy.add(owner);
  try {
    await i.update(X.layout([X.H('Điều khoản sử dụng', E.help), `${E.wait} Đang xử lý, vài giây thôi…`]));
    let uid = await X.userIdOf(owner), created = false, money = 0;
    if (!uid) { ({ uid, money } = await createAccount(i.user)); created = true; }
    await record(owner, uid, created);
    const p = X.PREFIX;
    await i.editReply(X.layout(created ? [
      X.H('Chào mừng đến Justaseed', E.title),
      `${E.ok} Đã tạo tài khoản cho **${X.clip(i.user.globalName || i.user.username, 40)}**. Vốn khởi đầu: **${X.vnd(money)}**.`,
      { sep: true },
      `${E.a} Nhập hàng: \`/gianhang nhaphang\`\n${E.b} Mở bán: \`/gianhang mo\`\n${E.a} Xem tất cả lệnh: \`/help\` hoặc \`${p}help\``,
      `-# ${E.tip} Muốn chơi trên web, hãy đăng nhập bằng đúng tài khoản Discord này, tiến trình sẽ được chuyển sang.`,
      { row: X.linkRow() },
    ] : [
      X.H('Điều khoản sử dụng', E.help),
      `${E.ok} Cảm ơn bạn đã đồng ý. Giờ bạn có thể dùng bot, hãy gõ lại lệnh vừa rồi nhé.`,
      { row: X.linkRow() },
    ]));
  } catch (e) {
    console.error('[terms] lỗi tạo tài khoản:', e);
    busy.delete(owner);
    const retry = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tos:ok:${owner}`).setStyle(ButtonStyle.Primary).setLabel('Thử lại'));
    return i.editReply(X.layout([X.H('Điều khoản sử dụng', E.help), `${E.no} Chưa tạo được tài khoản (${X.clip(e.message, 120)}). Bạn thử lại sau ít phút nhé.`, { row: retry }])).catch(() => {});
  } finally { busy.delete(owner); }
}

// ---------------- gắn vào bot ----------------
// Chặn mọi tương tác của người chưa đồng ý TRƯỚC khi tới các module lệnh (extra, game-cmds, rel, afk...),
// nên không phải sửa từng lệnh một.
function install(client) {
  const orig = client.emit.bind(client);
  client.emit = function (ev, ...a) {
    if (ev === 'interactionCreate' && intercept(a[0])) return true;
    return orig(ev, ...a);
  };
}
function intercept(i) {
  try {
    if (!i || !i.user || i.user.bot) return false;
    if (i.isButton() && i.customId.startsWith('tos:')) { onButton(i).catch(e => console.error('[terms]', e)); return true; }
    if (!needs(i.user.id)) return false;
    if (i.isChatInputCommand() && BYPASS.has(i.commandName)) return false;
    if (i.isAutocomplete()) { i.respond([]).catch(() => {}); return true; }
    promptInteraction(i).catch(e => console.error('[terms] không hiện được bảng:', e.message));
    return true;
  } catch (e) { console.error('[terms]', e); return false; } // lỗi bất ngờ: không chặn người chơi
}

function init(client, supabase, helpers) {
  sb = supabase; X = helpers;
  const boot = () => loadAccepted().then(() => {
    ready = true;
    console.log(`[terms] đã nạp ${accepted.size} người dùng đã đồng ý điều khoản (phiên bản ${TERMS_VERSION})`);
  }).catch(e => {
    disabled = true; ready = true;
    console.error('[terms] KHÔNG đọc được bảng bot_terms, tạm TẮT bảng điều khoản. Hãy chạy bot_terms.sql trong Supabase.', e.message);
  });
  if (client.isReady()) boot(); else client.once('ready', boot);
}

module.exports = { init, install, needs, promptMessage, termsLayout: (o, h) => termsLayout(o, h) };
