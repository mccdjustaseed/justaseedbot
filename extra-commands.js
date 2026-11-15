// extra-commands.js : các lệnh mở rộng cho bot Justaseed
// Cần: npm i @napi-rs/canvas   |   SUPABASE_KEY phải là service role key
// Tùy chọn: đặt font .ttf (có tiếng Việt, ví dụ Baloo2/Onest) vào thư mục ./fonts để ảnh đẹp hơn;
//           cài thêm font emoji (Noto Color Emoji) trên máy chủ nếu muốn hiện emoji trong ảnh.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const {
  SlashCommandBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize,
} = require('discord.js');

let Cv = null;
try { Cv = require('@napi-rs/canvas'); } catch (e) { console.error('[extra] thiếu @napi-rs/canvas, các lệnh ảnh sẽ không chạy'); }
const store = require('./save-store');
const engine = require('./engine'); // nhập hàng chạy thẳng phía bot khi web tắt
const headless = require('./headless'); // chạy đúng code game trong trình duyệt ẩn (mở bán, thuê nhân viên) khi web tắt // ghi save trực tiếp khi web tắt
const hub = require('./shop-hub'); // bảng điều khiển gian hàng (1 layout gom mọi tính năng)
const khoe = require('./khoe'); // ảnh khoe + nút "Khoe lên kênh"
const terms = require('./terms'); // bảng điều khoản sử dụng lần đầu (chặn người chưa đồng ý)
const R = require('./render')(Cv); // bộ vẽ ảnh theo giao diện game + màu chủ đề người chơi

// ---------------- cấu hình ----------------
const DAILY_BASE = Number(process.env.DAILY_BASE) || 150000;   // ngày đầu của chuỗi
const DAILY_STEP = Number(process.env.DAILY_STEP) || 25000;    // cộng thêm mỗi ngày liên tiếp
const DAILY_MAXDAYS = Number(process.env.DAILY_MAXDAYS) || 7;  // chuỗi tối đa tính thưởng
const MIN_T = 1000, MAX_T = 10000000;                          // khớp giới hạn chuyển khoản trong game
const WAIT_MS = 25000;                                         // chờ game xử lý lệnh
const E = 0;                              // 0 = trả lời công khai ngay tại kênh dùng lệnh (chỉ /qr trong index.js còn riêng tư)
const EPH = MessageFlags.Ephemeral;        // chỉ dùng cho thông báo "nút này của người khác" để không làm rối kênh

let supabase = null, client = null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const vnd = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;
const clip = (v, n) => String(v ?? '').slice(0, n);
const fmtCard = (n) => String(n || '').replace(/(\d{4})(?=\d)/g, '$1 ');
const NOT_LINKED = 'Chưa tìm thấy tài khoản game gắn với Discord này. Hãy vào game, đăng nhập bằng Discord rồi chơi một lúc để tiến trình được lưu lên đám mây.';
const NO_SAVE = 'Tài khoản này chưa có tiến trình lưu trên đám mây. Hãy mở game một lúc rồi thử lại.';

// ---------------- danh mục game ----------------
const FLOWERS = engine.F.map(f => [f.id, f.n]);
const PAPER = [...engine.PAPER, ...engine.GIFT].map(x => [x.id, x.n]);
const NAMES = Object.fromEntries([...FLOWERS, ...PAPER]);
const SUPPLIERS = engine.SP.map(x => ({ n: x.n, items: x.it }));
const WS_TYPES = {
  fa: ['💐', 'Cắm hoa'], br: ['📿', 'Vòng tay'], ca: ['🕯️', 'Nến thơm'], ar: ['🖼️', 'Tranh vẽ'],
  po: ['🏺', 'Đồ gốm'], sh: ['👕', 'Áo phông'], pf: ['🧴', 'Nước hoa'],
};
const GOLD_TYPES = {
  ring: 'Nhẫn', necklace: 'Dây chuyền', bracelet: 'Lắc tay', earrings: 'Bông tai',
  pendant: 'Mặt dây', bangle: 'Vòng tay', charm: 'Charm',
};
const TITLES = [[1, 'Hạt giống'], [3, 'Chồi non'], [5, 'Chủ tiệm hoa'], [8, 'Nghệ nhân'], [12, 'Bậc thầy'], [18, 'Huyền thoại']];
const lvOf = (x) => { let l = 1; while (30 * l * (l + 1) <= x) l++; return l; };
const cum = (l) => 30 * (l - 1) * l;
const titleOf = (lv) => TITLES.filter(t => lv >= t[0]).pop()[1];

// ---------------- liên kết Discord <-> tài khoản game ----------------
const linkCache = new Map();
const realLinked = new Set(); // Discord ID đã có tài khoản đăng nhập web thật
let linkAt = 0, linkLoading = null;
const identOf = (u) =>
  u.user_metadata?.provider_id ||
  (u.identities || []).find(i => i.provider === 'discord')?.id ||
  u.identities?.[0]?.id || u.user_metadata?.sub || null;

function refreshLinks() {
  if (linkLoading) return linkLoading;
  linkLoading = (async () => {
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const users = data?.users || [];
      users.forEach(u => {
        const d = identOf(u); if (!d) return;
        const k = String(d);
        // tài khoản do bot tạo (chưa từng đăng nhập web) nhường chỗ cho tài khoản đăng nhập Discord thật nếu cả hai cùng tồn tại
        const botMade = u.user_metadata?.created_via === 'bot' && !(u.identities || []).some(x => x.provider === 'discord');
        if (botMade) { if (!realLinked.has(k)) linkCache.set(k, u.id); }
        else { realLinked.add(k); linkCache.set(k, u.id); }
      });
      if (users.length < 1000) break;
    }
    linkAt = Date.now();
  })().finally(() => { linkLoading = null; });
  return linkLoading;
}
// ngược lại: từ id tài khoản game -> Discord ID (dựa trên bộ nhớ đệm liên kết)
function discordIdOf(uid) {
  for (const [d, u] of linkCache) if (u === uid) return d;
  return null;
}
// Trả lời ngay từ bộ nhớ đệm; danh sách tài khoản tự tải lại ở NỀN (trước đây lệnh nào gặp lúc đệm cũ >30 giây phải chờ tải lại TOÀN BỘ tài khoản Supabase).
// Chỉ khi chưa thấy người đó (vừa liên kết) mới chờ tải lại, tối đa 3 giây, và không tải lại quá 15 giây một lần.
async function userIdOf(discordId) {
  discordId = String(discordId);
  const hit = linkCache.get(discordId);
  if (hit) {
    if (Date.now() - linkAt > 120000 && !linkLoading) refreshLinks().catch(() => {});
    return hit;
  }
  if (Date.now() - linkAt > 15000 || linkLoading) {
    try { await Promise.race([refreshLinks().catch(() => {}), new Promise(r => setTimeout(r, 3000))]); } catch (e) { /* bỏ qua */ }
  }
  return linkCache.get(discordId) || null;
}
// Chỉ tra bộ nhớ đệm, không bao giờ chờ (dùng cho việc chạy ở mọi tin nhắn như cộng XP chat)
const userIdFast = (discordId) => linkCache.get(String(discordId)) || null;

// ---------------- đọc save đám mây ----------------
function decodeSave(code) {
  const tag = String(code).slice(0, 5);
  let buf = Buffer.from(String(code).slice(5).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (tag === 'JSA1:') buf = zlib.inflateRawSync(buf);
  else if (tag !== 'JSA0:') throw new Error('Sai định dạng save');
  return JSON.parse(buf.toString('utf8'));
}
// ---------------- nhận chuyển khoản gửi từ web khi người nhận KHÔNG mở web ----------------
// Web chuyển tiền bằng cách chèn tin "JSGIFT1:{bank...}" vào wall_messages; chỉ web của người nhận (đang mở, màn hình game) mới cộng tiền vào save.
// Người nhận tắt web thì tiền nằm chờ và bot (chỉ đọc save đám mây) không thấy. Ở đây bot cộng hộ, đúng cách web làm (seen/tx/sổ/thông báo) rồi xóa tin.
const BANK_LIKE = 'JSGIFT1:{"v":1,"bank":1,%', BANK_PFX = 'JSGIFT1:', BANK_MIN = 1000, BANK_MAX = 10000000;
const bankAt = new Map(); // uid -> lần kiểm tra gần nhất (không hỏi DB dồn dập)
async function claimBank(uid) {
  if (Date.now() - (bankAt.get(uid) || 0) < 8000) return 0;
  bankAt.set(uid, Date.now());
  if (bankAt.size > 3000) bankAt.delete(bankAt.keys().next().value);
  try {
    const { data: rows, error } = await supabase.from('wall_messages').select('id,message,from_user')
      .eq('to_user', uid).like('message', BANK_LIKE).order('created_at', { ascending: true }).limit(40);
    if (error || !rows || !rows.length) return 0;
    if (presReady ? webOpen(uid) : await gameOnline(uid)) return 0; // web đang mở: web tự nhận
    const from = [...new Set(rows.map(r => r.from_user).filter(Boolean))], nm = {};
    if (from.length) {
      const pr = await supabase.from('profiles').select('id,display_name,username').in('id', from).then(r => r.data || [], () => []);
      pr.forEach(x => { nm[x.id] = x.display_name || x.username || 'Người chơi'; });
    }
    let total = 0, drop = [];
    await store.edit(supabase, uid, (s2) => {
      total = 0; drop = [];
      const b = s2.bk2 = s2.bk2 || {}; b.tx = b.tx || []; b.seen = b.seen || [];
      s2.led = s2.led || []; s2.notifs = s2.notifs || [];
      for (const row of rows) {
        let p = null; try { p = JSON.parse(String(row.message).slice(BANK_PFX.length)); } catch (e) { /* bỏ qua */ }
        if (!p || !p.bank) continue;
        if (b.seen.includes(row.id)) { drop.push(row.id); continue; }
        const amt = Math.floor(+p.amt), t = 't:' + String(p.tid || '').slice(0, 40);
        b.seen.push(row.id);
        if (!(amt >= BANK_MIN && amt <= BANK_MAX) || t === 't:' || b.seen.includes(t)) { drop.push(row.id); continue; }
        b.seen.push(t);
        s2.money = (Number.isFinite(s2.money) ? s2.money : 0) + amt; total += amt;
        const who = nm[row.from_user] || 'Người chơi', note = String(p.note || '').slice(0, 60), d = s2.day || 1;
        b.tx.unshift({ k: 'in', amt, who, note, t: Date.now() });
        const le = s2.led.find(x => x.d == d && x.k == 'in' && x.cat == 'Chuyển khoản' && x.name == 'Nhận từ ' + who);
        if (le) { le.q += 1; le.amt += amt; } else s2.led.push({ d, k: 'in', cat: 'Chuyển khoản', name: 'Nhận từ ' + who, q: 1, amt });
        s2.notifs.unshift({ type: 'bank', id: 'bank' + Date.now() + Math.random(), text: '💳 ' + who + ' chuyển cho bạn ' + Math.round(amt).toLocaleString('vi-VN') + 'đ', time: new Date().toISOString(), read: false });
        drop.push(row.id);
      }
      if (b.seen.length > 400) b.seen = b.seen.slice(-300);
      b.tx = b.tx.slice(0, 50); s2.notifs = s2.notifs.slice(0, 50);
      return 'ok';
    });
    if (drop.length) await supabase.from('wall_messages').delete().in('id', drop).then(() => {}, () => {});
    if (total) console.log('[extra] đã nhận hộ chuyển khoản', total, 'cho', uid);
    return total;
  } catch (err) { console.error('[extra] nhận chuyển khoản lỗi:', err.message || err); return 0; }
}

async function loadSave(userId) {
  await claimBank(userId); // cộng tiền chuyển khoản đang chờ (nếu có) trước khi đọc số dư
  const { data, error } = await supabase.from('game_saves')
    .select('data,xp,day,money,updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data || !data.data) return null;
  const s = await store.decodeAsync(data.data);
  if (!/^#[0-9a-f]{6}$/i.test((s.pf && s.pf.col) || '')) s.pf = { ...(s.pf || {}), col: await colOf(userId) };
  return { s, money: Math.round(Number(data.money) || 0), at: new Date(data.updated_at).getTime() };
}

// Đọc save MỚI NHẤT: nhờ game đẩy save lên ngay (lệnh 'sync') thay vì đợi chu kỳ lưu định kỳ.
// Game đang tắt thì không chờ, dùng bản lưu gần nhất (và nhớ 60 giây để khỏi chờ lại).
const syncMiss = new Map();
// chờ game xử lý lệnh; nếu sau pickMs mà chưa ai nhận (game không online) thì thôi, không chờ hết totalMs
async function waitPickup(id, pickMs = 1500, totalMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < totalMs) {
    await sleep(150);
    const { data } = await supabase.from('bot_actions').select('status,result').eq('id', id).maybeSingle();
    if (data && (data.status === 'done' || data.status === 'failed')) return data;
    if (data && data.status === 'pending' && Date.now() - t0 >= pickMs) return null;
  }
  return null;
}
async function loadFresh(uid) {
  const cached = await loadSave(uid);
  if (cached && Date.now() - cached.at < 8000) return cached;
  const open = presReady && webOpen(uid); // presence xác nhận web đang mở (kể cả tab ẩn)
  if (presReady && !open) return cached; // web không mở: save đám mây chính là bản mới nhất
  if (!open && Date.now() - (syncMiss.get(uid) || 0) < 15000) return cached;
  try {
    const id = await enqueue(uid, 'sync', {});
    // web ĐANG mở thì chờ lâu hơn (tab ẩn / mạng chậm nhận lệnh trễ > 0,8 giây -> trước đây bot bỏ cuộc và hiện số dư cũ)
    const r = await waitPickup(id, open ? 4000 : 800, open ? 9000 : 6000);
    if (!r) {
      if (!open) syncMiss.set(uid, Date.now()); // web mở mà chưa kịp trả lời thì lần lệnh sau thử lại, không khóa 15 giây
      else console.log('[extra] web đang mở nhưng chưa phản hồi lệnh sync, dùng bản lưu gần nhất (user ' + uid + ')');
      supabase.from('bot_actions').update({ status: 'failed', result: 'bot: game không online' })
        .eq('id', id).eq('status', 'pending').then(() => {}, () => {});
      return cached;
    }
    if (r.status === 'done') return (await loadSave(uid)) || cached;
  } catch (e) { syncMiss.set(uid, Date.now()); console.error('[extra] sync lỗi:', e.message); } // lỗi (vd. ràng buộc kind trong DB): tạm dùng bản lưu gần nhất
  return cached;
}

// Màu chủ đề của người chơi (lấy từ hồ sơ công khai, cache 5 phút) để tô màu các tin nhắn không cần đọc save
const colCache = new Map();
async function colOf(uid) {
  const h = colCache.get(uid);
  if (h && Date.now() - h.at < 300000) return h.c;
  let c = null;
  try {
    const { data } = await supabase.from('shop_public').select('game_avatar').eq('user_id', uid).maybeSingle();
    const raw = String(data?.game_avatar || '');
    if (raw.startsWith('gav:')) c = JSON.parse(raw.slice(4)).col;
  } catch (e) { /* dùng màu mặc định */ }
  c = /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#4fb06f';
  colCache.set(uid, { at: Date.now(), c });
  return c;
}

// ---------------- tin nhắn dạng layout (Components V2) ----------------
const V2 = MessageFlags.IsComponentsV2;
// bộ emoji CỦA BOT (Application Emojis, tên js_*) — không dùng emoji của server.
// vai trò -> [tên emoji bot, emoji thường dự phòng nếu bot chưa có emoji đó]
const BOT_EMOJI = {
  title: ['js_blossom', '🌼'], a: ['js_sprout', '🌱'], b: ['js_leaf', '🌿'], deco: ['js_sparkle', '✨'],
  gift: ['js_gift', '🎁'], card: ['js_cardj', '💳'], money: ['js_money', '💸'], ws: ['js_scissors', '🧵'],
  ring: ['js_ring', '💍'], shop: ['js_cart', '🏪'], box: ['js_bag', '📦'],
  left: ['js_left', '◀️'], right: ['js_right', '▶️'],
  person: ['js_person', '🧑'], help: ['js_scroll', '📜'], tip: ['js_bulb', '💡'], star: ['js_star', '⭐'],
  ok: ['js_check', '✅'], no: ['js_x', '❌'], wait: ['js_hourglass', '⏳'], refresh: ['js_repeat', '🔄'],
  lock: ['js_lock', '🔒'], clock: ['js_clock', '🕘'], heart: ['js_heart', '💞'], cat: ['js_cat', '🐱'], dog: ['js_dog', '🐶'],
  chart: ['js_chart', '📈'], spend: ['js_spend', '💸'], flower: ['js_cherry', '🌸'],
};
// hình gốc (icon trong bộ icon của game) để bot tự tạo emoji nếu server bot chưa có
const EMOJI_SRC = {
  title: '🌼', a: '🌱', b: '🌿', deco: '✨', gift: '🎁', card: '🧾', money: '💰', ws: '✂', ring: '💍', shop: '🛒', box: '🎒',
  left: '←', right: '→', person: '🧑', help: '📜', tip: '💡', star: '⭐', ok: '✅', no: '❌', wait: '⏳', refresh: '↻',
  lock: '🔒', clock: '🕘', heart: '💖', cat: '🐱', dog: '🐶', chart: '📈', spend: '🪙', flower: '🌸',
};
// mặt hàng giấy / quà / đồ mưa nắng -> icon game (emoji tên js_item_<id>)
const ITEM_SRC = { S: '📜', M: '📜', L: '📜', keo: '🍭', thu: '📝', anh: '🖼', the: '💖', bong: '🎉', socola: '🌰', nen: '🕯', gau: '🤍', amua: '🌧', du: '☔' };
const EM = Object.fromEntries(Object.entries(BOT_EMOJI).map(([k, v]) => [k, v[1]]));
async function loadBotEmojis() {
  const list = await client.application.emojis.fetch();
  await ensureBotEmojis(list);
  for (const [k, [name]] of Object.entries(BOT_EMOJI)) {
    const e = list.find(x => x.name === name);
    if (e) EM[k] = e.toString(); else console.warn(`[extra] bot chưa có emoji ${name}, dùng tạm emoji thường`);
  }
  await ensureFlowerEmojis(list);
}
const H = (t, ico) => `### ${ico || EM.title} ${t} ${ico || EM.title}`; // tiêu đề layout
const stamp = (ms) => `<t:${Math.floor((ms || Date.now()) / 1000)}:R>`;
const GAME_URL = 'https://justaseed.xyz/';
const linkRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Chơi Justaseed').setEmoji(EM.a).setURL(GAME_URL));
// blocks: chuỗi = text | {sep:true} | {img:'attachment://x.png'} | {row: ActionRowBuilder}
// Tin nhắn của các lệnh KHÔNG dùng màu (không có accent color) — chỉ là khung layout trơn.
function box(blocks) {
  const c = new ContainerBuilder();
  for (const b of blocks.filter(Boolean)) {
    if (typeof b === 'string') c.addTextDisplayComponents(new TextDisplayBuilder().setContent(b.slice(0, 3900)));
    else if (b.sep) c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    else if (b.img) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(b.img)));
    else if (b.row) c.addActionRowComponents(b.row);
  }
  return c;
}
const layout = (blocks, extra = {}) =>
  ({ components: [box(blocks)], flags: V2, allowedMentions: { parse: [] }, ...extra });
const say = (i, text) => i.editReply(layout([String(text)]));
// báo lỗi riêng tư (chỉ người dùng lệnh thấy) cho lệnh đang trả lời công khai: xóa tin "đang xử lý" rồi gửi tin ẩn
async function sayPrivate(i, text) {
  try { await i.deleteReply(); } catch (e) { /* bỏ qua */ }
  return i.followUp({ ...layout([String(text)]), flags: V2 | E });
}

// Web game báo "đang online" qua Supabase Presence (kênh jas-online, key = id tài khoản), kể cả khi tab bị ẩn/chuyển tab.
// Bot nghe kênh này để biết CHÍNH XÁC web có đang mở không, thay vì đoán qua lệnh 'sync' (tab ẩn trả lời chậm -> bot tưởng web tắt -> ghi đè save -> web quay lại thấy save đám mây mới hơn -> tự khôi phục và ĐÓNG QUẦY).
let presCh = null, presReady = false, presOn = new Set();
function startPresence() {
  try {
    presCh = supabase.channel('jas-online', { config: { presence: { key: 'bot-' + process.pid } } });
    presCh.on('presence', { event: 'sync' }, () => { try { presOn = new Set(Object.keys(presCh.presenceState())); } catch (e) {} });
    presCh.subscribe((st) => {
      presReady = st === 'SUBSCRIBED';
      if (st === 'SUBSCRIBED') console.log('[extra] đã nghe trạng thái online của web game');
      else if (st === 'CLOSED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') console.log('[extra] kênh online:', st);
    });
  } catch (err) { presReady = false; console.error('[extra] không nghe được presence:', err.message || err); }
}
const webOpen = (uid) => presOn.has(String(uid));

// game có đang mở không? gửi lệnh 'sync' chờ 3 giây; không ai nhận thì coi như web đang tắt
async function gameOnline(uid) {
  if (presReady) return webOpen(uid); // có presence: web mở (kể cả tab ẩn) = true, không mở = false ngay, khỏi chờ thăm dò
  if (Date.now() - (syncMiss.get(uid) || 0) < 20000) return false; // vừa thử không thấy game online
  try {
    const id = await enqueue(uid, 'sync', {});
    const r = await waitAction(id, 800, 100);
    if (r && r.status === 'done') return true;
    syncMiss.set(uid, Date.now()); // nhớ lần này để các lệnh liền sau khỏi chờ lại
    await supabase.from('bot_actions').update({ status: 'failed', result: 'bot: game không online' }).eq('id', id).eq('status', 'pending');
  } catch (e) { console.error('[extra] kiểm tra online lỗi:', e.message); }
  return false;
}

// ---------------- hàng đợi lệnh bot -> game ----------------
async function enqueue(userId, kind, payload) {
  const { data, error } = await supabase.from('bot_actions')
    .insert({ user_id: userId, kind, payload }).select('id').single();
  if (error) throw error;
  return data.id;
}
async function waitAction(id, ms = WAIT_MS, step = 350) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(step); // hỏi dồn 0,35s/lần (trước là 1,5s) vì game nhận lệnh gần như tức thì qua realtime
    const { data } = await supabase.from('bot_actions').select('status,result').eq('id', id).maybeSingle();
    if (data && (data.status === 'done' || data.status === 'failed')) return data;
  }
  return null;
}
async function pendingOut(userId) {
  const { data } = await supabase.from('bot_actions').select('payload')
    .eq('user_id', userId).eq('kind', 'transfer').in('status', ['pending', 'working']);
  return (data || []).reduce((a, r) => a + (Number(r.payload?.amt) || 0), 0);
}
const QUEUED = (id, mins) =>
  `Đã ghi nhận lệnh #${id} nhưng game chưa phản hồi. Lệnh sẽ chạy khi bạn mở game${mins ? ` (hết hạn sau ${mins} phút)` : ''}.`;

// Hình vật phẩm workshop (áo/tranh có ảnh người chơi tải lên) nằm trên storage 'feed' -> tải về nhúng thẳng vào SVG
const FEED_PFX = `${process.env.SUPABASE_URL || ''}/storage/v1/object/public/feed/`;
const feedCache = new Map();
async function withItemImage(it) {
  if (!it || it.im || !it.u || !(it.t === 'sh' || it.t === 'ar') || !/^[\w:/.%-]+$/.test(it.u)) return it;
  if (!feedCache.has(it.u)) {
    feedCache.set(it.u, (async () => {
      try {
        const r = await fetch(FEED_PFX + it.u, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return null;
        const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
        return `${mime};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
      } catch (e) { return null; }
    })());
    if (feedCache.size > 60) feedCache.delete(feedCache.keys().next().value);
  }
  const im = await feedCache.get(it.u);
  return im ? { ...it, im } : it;
}

// Chạy một thao tác của game (window.BOTOPS): web đang mở -> gửi lệnh 'op' cho game; web tắt -> bot chạy code game trong trình duyệt ẩn rồi ghi save đám mây
async function gameOp(uid, op, args = {}) {
  if (await gameOnline(uid)) {
    let id;
    try { id = await enqueue(uid, 'op', { op, args }); }
    catch (e) {
      if (/check|constraint|kind/i.test(String(e && e.message))) throw new Error('Chưa chạy file bot_actions_ops.sql trong Supabase (bảng bot_actions chưa nhận loại lệnh mới).');
      throw e;
    }
    const res = await waitAction(id);
    if (res && res.status === 'done') return { msg: res.result || 'Xong.', via: 'game' };
    if (res) throw new Error(clip(res.result, 300));
    return { queued: true, id, msg: QUEUED(id, 15), via: 'game' };
  }
  if (!headless.available()) {
    const id = await enqueue(uid, 'op', { op, args });
    return { queued: true, id, msg: QUEUED(id, 15), via: 'game' };
  }
  const msg = await store.edit(supabase, uid, async (s2) => { const r = await headless.run(s2, op, args); return { save: r.save, out: r.out }; });
  return { msg, via: 'bot' };
}

const busyUsers = new Set();
const daySessions = new Map(); // uid -> { close: bool }  (ngày bán đang chạy thời gian thật)
const daySnaps = new Map();    // uid -> snapshot mới nhất của ngày bán do bot chạy (gồm tiến trình từng chi nhánh)
const onlineDays = new Map();  // uid -> { t0, len, ip } ngày bán do web tự chạy (bot chỉ theo dõi): giờ mở quầy + % hàng đã bán mới nhất
async function withLock(userId, i, fn) {
  if (daySessions.has(userId)) return say(i, 'Gian hàng đang bán, hãy đợi hết ngày (hoặc bấm **Đóng quầy sớm** ở tin tiến độ) rồi dùng lệnh này.');
  if (busyUsers.has(userId)) return say(i, 'Bạn đang có một lệnh khác đang xử lý, đợi một chút nhé.');
  busyUsers.add(userId);
  try { return await fn(); } finally { busyUsers.delete(userId); }
}

// ---------------- ẩn / hiện số dư theo cài đặt trong game ----------------
// Game lưu cờ "Ẩn số dư" ở s.pf.hb (hoặc trong game_avatar công khai: gav.hb)
async function hideBalOf(uid, s) {
  const pf = (s && s.pf) || {};
  if (pf.hb !== undefined) return !!pf.hb;
  try {
    const { data } = await supabase.from('shop_public').select('game_avatar').eq('user_id', uid).maybeSingle();
    return !!parseGav(data?.game_avatar).hb;
  } catch (e) { return false; }
}

// ---------------- /profile ----------------
const parseGav = (raw) => { try { raw = String(raw || ''); return raw.startsWith('gav:') ? JSON.parse(raw.slice(4)) : {}; } catch (e) { return {}; } };
async function cmdProfile(i) {
  await i.deferReply();
  if (!R) return say(i, 'Máy chủ bot chưa cài @napi-rs/canvas nên chưa vẽ được ảnh.');
  const target = i.options.getUser('nguoi') || i.user;
  const self = target.id === i.user.id;
  const uid = await userIdOf(target.id);
  if (!uid) return say(i, self ? NOT_LINKED : `${target.username} chưa liên kết tài khoản game.`);

  // đọc save (mới nhất nếu là mình) và ảnh đại diện công khai cùng lúc
  const [sv, pub] = await Promise.all([
    self ? loadFresh(uid) : loadSave(uid),
    supabase.from('shop_public').select('game_avatar').eq('user_id', uid).maybeSingle().then(r => r.data, () => null),
  ]);
  if (!sv) return say(i, self ? NO_SAVE : `${target.username} chưa có tiến trình lưu trên đám mây.`);

  const s = sv.s, pf = s.pf || {}, gav = parseGav(pub?.game_avatar);
  const [avatar, cover] = await Promise.all([
    R.imgFrom(gav.av, gav.av ? `av:${uid}:${gav.av.length}` : null)
      .then(a => a || R.imgFrom(target.displayAvatarURL({ extension: 'png', size: 256 }))),
    gav.cv ? R.imgFrom(gav.cv, `cv:${uid}:${gav.cv.length}`) : null,
  ]);

  const hideBal = pf.hb !== undefined ? !!pf.hb : !!gav.hb; // người chơi bật "Ẩn số dư" trong hồ sơ game
  const xp = s.xp || 0, lv = lvOf(xp), a = cum(lv), b = cum(lv + 1);
  const wsLv = Object.values(s.ws || {}).reduce((t, w) => t + (1 + Math.floor(Math.sqrt(((w && w.xp) || 0) / 25))), 0);
  const name = clip(pf.nm || s.name || target.displayName || 'Chủ tiệm', 26);
  const png = await R.renderProfile({
    s, avatar, cover, name, lv, xpIn: xp - a, xpNeed: b - a, fr: pf.fr ?? gav.fr, afr: pf.afr ?? gav.afr,
    title: titleOf(lv), discordName: target.username,
    subtitle: `${titleOf(lv)}${pf.bio || gav.bio ? ' · ' + clip(pf.bio || gav.bio, 60) : ''}`,
    stats: [
      { icon: '📅', label: 'Ngày', value: String(s.day || 1) },
      hideBal ? { icon: '🔒', label: 'Số dư (đã ẩn)', value: '••••••' } : { icon: '💰', label: 'Số dư', value: vnd(sv.money), accent: true },
      { icon: '🧑', label: 'Khách đã phục vụ', value: (s.sv || 0).toLocaleString('vi-VN') },
      { icon: '📈', label: 'Doanh thu', value: vnd(s.rev) },
      { icon: '⭐', label: 'Uy tín', value: (Number(s.rep) || 0).toFixed(1) },
      { icon: '🏅', label: 'Đánh giá 5 sao', value: String(s.five || 0) },
    ],
    footer: `${clip(s.name || 'Tiệm hoa', 30)} · Workshop tổng cấp ${wsLv} · justaseed.xyz`,
  });
  const T = R.themeOf(s);
  return i.editReply(layout([
    H(`Profile của ${clip(target.displayName || target.username, 40)}`),
    { img: 'attachment://profile.png' },
    { sep: true },
    { row: linkRow() },
    `-# ${EM.a} Justaseed • dữ liệu ${stamp(sv.at)}`,
  ], { files: [new AttachmentBuilder(png, { name: 'profile.png' })] }));
}

// ---------------- /daily ----------------
const vnDate = (off = 0) => new Date(Date.now() + 7 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
async function cmdDaily(i) {
  await i.deferReply({ flags: E });
  const uid = await userIdOf(i.user.id);
  if (!uid) return say(i, NOT_LINKED);
  return withLock(uid, i, async () => {
    const sv = await supabase.from('game_saves').select('user_id').eq('user_id', uid).maybeSingle();
    if (!sv.data) return say(i, NO_SAVE);

    const today = vnDate(0), yest = vnDate(-1);
    const { data: row } = await supabase.from('bot_daily').select('*').eq('user_id', uid).maybeSingle();
    const nextMid = Math.floor(((Math.floor((Date.now() + 7 * 3600e3) / 86400e3) + 1) * 86400e3 - 7 * 3600e3) / 1000);
    if (row && row.last_day === today) {
      return say(i, `${H('Daily Justaseed', EM.gift)}\n${EM.deco} Hôm nay bạn đã nhận rồi. Lần tới: <t:${nextMid}:R> (0 giờ sáng giờ Việt Nam).\nChuỗi hiện tại: **${row.streak}** ngày.`);
    }
    const streak = row && row.last_day === yest ? row.streak + 1 : 1;
    const amt = DAILY_BASE + (Math.min(streak, DAILY_MAXDAYS) - 1) * DAILY_STEP;

    // giữ chỗ trước (nguyên tử) để bấm hai lần không nhận hai lần
    let claimed = false;
    if (!row) {
      const r = await supabase.from('bot_daily').insert({ user_id: uid, last_day: today, streak, total: amt });
      claimed = !r.error;
    } else {
      const r = await supabase.from('bot_daily')
        .update({ last_day: today, streak, total: Number(row.total || 0) + amt, updated_at: new Date().toISOString() })
        .eq('user_id', uid).neq('last_day', today).select('user_id');
      claimed = !r.error && (r.data || []).length > 0;
    }
    if (!claimed) return say(i, 'Hôm nay bạn đã nhận daily rồi.');

    const undo = () => supabase.from('bot_daily').update(row
      ? { last_day: row.last_day, streak: row.streak, total: row.total }
      : { last_day: '2000-01-01', streak: 0, total: 0 }).eq('user_id', uid);
    const label = `Thưởng daily (chuỗi ${streak} ngày)`;
    let direct = false;
    if (!(await gameOnline(uid))) { // web đang tắt: bot cộng thẳng vào save đám mây
      try {
        await store.edit(supabase, uid, (s) => {
          s.money = (Number.isFinite(s.money) ? s.money : 0) + amt;
          s.notifs = s.notifs || [];
          s.notifs.unshift({ type: 'bot', id: 'bot' + Date.now() + Math.random(), text: `🎁 ${label}: +${vnd(amt)}`, time: new Date().toISOString(), read: false });
          s.notifs = s.notifs.slice(0, 50);
        });
        direct = true;
      } catch (e) {
        await undo();
        console.error('[extra] daily ghi save lỗi:', e.message || e);
        return say(i, `${EM.no} Không cộng được tiền khi web đang tắt: ${clip(e.message || e, 150)}`);
      }
    }
    let id, res;
    if (direct) res = { status: 'done' };
    else {
      try { id = await enqueue(uid, 'credit', { amt, label }); }
      catch (e) { await undo(); throw e; }
      res = await waitAction(id);
    }
    const status = res && res.status === 'done' ? `${EM.ok} Đã cộng vào ví trong game.`
      : res ? `${EM.no} Game báo lỗi: ${clip(res.result, 200)}` : `${EM.wait} Tiền sẽ được cộng ngay khi bạn mở game.`;
    const max = DAILY_BASE + (DAILY_MAXDAYS - 1) * DAILY_STEP;
    return i.editReply(layout([
      H('Daily Justaseed', EM.gift),
      `## +${vnd(amt)}`,
      `Chuỗi **${streak}** ngày${streak >= DAILY_MAXDAYS ? ' (tối đa)' : ''}`,
      { sep: true },
      status,
      `-# Ngày mai nhận tiếp để tăng thưởng · tối đa ${vnd(max)}`,
    ]));
  });
}

// ---------------- /tien ----------------
async function cmdMoney(i) {
  await i.deferReply({ flags: E });
  const uid = await userIdOf(i.user.id);
  if (!uid) return say(i, NOT_LINKED);
  const [sv, cardRes, out] = await Promise.all([
    loadFresh(uid),
    supabase.from('bank_cards').select('card_no').eq('user_id', uid).maybeSingle(),
    pendingOut(uid),
  ]);
  if (!sv) return say(i, NO_SAVE);
  const card = cardRes.data;
  const blocks = [H('Ví Justaseed', EM.card)];
  const files = [];
  if (R) {
    const png = await R.renderBankCard(sv.s, { name: (sv.s.pf && sv.s.pf.nm) || sv.s.name || i.user.username, cardNo: card?.card_no, money: sv.money });
    files.push(new AttachmentBuilder(png, { name: 'card.png' }));
    blocks.push({ img: 'attachment://card.png' });
  }
  blocks.push(`${EM.a} **Số dư:** ${vnd(sv.money)}\n${EM.b} **Số thẻ:** ${card ? `\`${fmtCard(card.card_no)}\`` : 'Chưa có (mở tab Thẻ NH trong game)'}`);
  if (out > 0) blocks.push(`${EM.wait} **Đang chờ trừ:** ${vnd(out)}`);
  blocks.push({ sep: true }, `-# Dữ liệu ${stamp(sv.at)}`);
  return i.editReply(layout(blocks, { files }));
}

// ---------------- /chuyentien ----------------
// Lệnh trả lời CÔNG KHAI (không ẩn). Lỗi nhập liệu vẫn báo riêng cho người dùng lệnh để khỏi lộ số dư / làm rối kênh.
const pendingTf = new Map();
async function cmdTransfer(i) {
  await i.deferReply(); // công khai
  const fail = (t) => sayPrivate(i, t);
  const uid = await userIdOf(i.user.id);
  if (!uid) return fail(NOT_LINKED);
  const amt = i.options.getInteger('sotien');
  const target = i.options.getUser('nguoi');
  const cardNo = (i.options.getString('sothe') || '').replace(/\D/g, '');
  const note = clip((i.options.getString('loinhan') || '').trim(), 60);

  if (!!target === !!cardNo) return fail('Hãy chọn **một** trong hai: `nguoi` (ping người nhận) hoặc `sothe` (số thẻ 16 số).');
  if (!(amt >= MIN_T && amt <= MAX_T)) return fail(`Số tiền mỗi lần từ ${vnd(MIN_T)} đến ${vnd(MAX_T)}.`);

  let recv = null;
  if (target) {
    if (target.bot) return fail('Không thể chuyển tiền cho bot.');
    recv = await userIdOf(target.id);
    if (!recv) return fail(`${target.username} chưa liên kết tài khoản game.`);
  } else {
    if (cardNo.length !== 16) return fail('Số thẻ gồm 16 chữ số.');
    const { data } = await supabase.from('bank_cards').select('user_id').eq('card_no', cardNo).maybeSingle();
    if (!data) return fail('Không tìm thấy thẻ này.');
    recv = data.user_id;
  }
  if (recv === uid) return fail('Không thể tự chuyển cho chính mình.');

  const [sv, out, prRes] = await Promise.all([
    loadFresh(uid), pendingOut(uid),
    supabase.from('profiles').select('display_name,username').eq('id', recv).maybeSingle(),
  ]);
  if (!sv) return fail(NO_SAVE);
  const hide = await hideBalOf(uid, sv.s);
  const avail = sv.money - out;
  if (amt > avail) return fail(hide ? 'Không đủ tiền để chuyển.' : `Không đủ tiền. Số dư khả dụng: **${vnd(Math.max(0, avail))}**.`);

  const pr = prRes.data;
  const name = clip(pr?.display_name || pr?.username || 'Người chơi', 40);
  const tok = randomUUID().slice(0, 8);
  pendingTf.set(tok, { from: i.user.id, uid, recv, name, amt, note, exp: Date.now() + 60000 });
  setTimeout(() => { // hết hạn: gỡ nút để không ai bấm nhầm
    if (!pendingTf.delete(tok)) return;
    i.editReply(layout(['Yêu cầu chuyển tiền đã hết hạn.'])).catch(() => {});
  }, 61000);

  return i.editReply(layout([
    H('Xác nhận chuyển tiền', EM.money),
    `Chuyển **${vnd(amt)}** cho **${name}**${note ? `\nLời nhắn: *${note}*` : ''}`,
    hide ? null : `Số dư sau khi chuyển: **${vnd(avail - amt)}**`,
    { sep: true },
    { row: new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tf:ok:${tok}`).setLabel('Xác nhận').setEmoji(EM.ok).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tf:no:${tok}`).setLabel('Hủy').setEmoji(EM.no).setStyle(ButtonStyle.Secondary),
    ) },
    '-# Tiền chuyển đi không thể thu hồi · yêu cầu hết hạn sau 60 giây',
  ]));
}
async function btnTransfer(i) {
  const [, act, tok] = i.customId.split(':');
  const tf = pendingTf.get(tok);
  // tin nhắn công khai: người khác bấm hoặc nút đã hết hạn thì chỉ báo riêng, không sửa tin chung
  if (!tf || Date.now() > tf.exp) return i.reply({ ...layout(['Yêu cầu đã hết hạn.']), flags: V2 | E });
  if (tf.from !== i.user.id) return i.reply({ ...layout(['Nút này của người dùng lệnh.']), flags: V2 | EPH });
  pendingTf.delete(tok);
  if (act === 'no') return i.update(layout(['Đã hủy chuyển tiền.']));

  await i.update(layout([`${EM.wait} Đang xử lý...`]));
  return withLock(tf.uid, i, async () => {
    const sv = await loadSave(tf.uid);
    const before = sv?.money || 0;
    const avail = before - await pendingOut(tf.uid);
    if (tf.amt > avail) return say(i, 'Không đủ tiền để chuyển.');
    const id = await enqueue(tf.uid, 'transfer', {
      to_user: tf.recv, to_name: tf.name, amt: tf.amt, note: tf.note, tid: randomUUID().replace(/-/g, '').slice(0, 20),
    });
    const res = await waitAction(id);
    if (res && res.status === 'done') {
      // ảnh thẻ ngân hàng của người chuyển: số dư sau khi chuyển, ẩn/hiện theo cài đặt trong game
      const files = [], card = [];
      try {
        if (R) {
          let s = sv.s, after = Math.max(0, before - tf.amt);
          try { // lấy save mới nhất; nếu game chưa kịp lưu thì dùng số dư tính sẵn
            const fr = await loadFresh(tf.uid);
            if (fr) { s = fr.s; if (fr.money < before) after = fr.money; }
          } catch (e) { /* dùng số tính sẵn */ }
          const [hide, cardRes] = await Promise.all([
            hideBalOf(tf.uid, s),
            supabase.from('bank_cards').select('card_no').eq('user_id', tf.uid).maybeSingle(),
          ]);
          const png = await R.renderBankCard(s, {
            name: (s.pf && s.pf.nm) || s.name || i.user.username,
            cardNo: cardRes.data?.card_no, money: after, hide,
          });
          files.push(new AttachmentBuilder(png, { name: 'card.png' }));
          card.push({ img: 'attachment://card.png' });
        }
      } catch (e) { console.error('[extra] không vẽ được thẻ ngân hàng:', e.message); }
      return i.editReply(layout([
        H('Chuyển tiền thành công', EM.ok),
        `<@${i.user.id}> đã chuyển **${vnd(tf.amt)}** cho **${tf.name}**.${res.result ? '\n' + clip(res.result, 150) : ''}`,
        tf.note ? `Lời nhắn: *${tf.note}*` : null,
        ...card,
        { sep: true },
        `-# ${EM.a} Justaseed • ${stamp()}`,
      ], { files, attachments: [] }));
    }
    if (res) return say(i, `${EM.no} Không chuyển được: ${clip(res.result, 200)}`);
    return say(i, `${EM.wait} ${QUEUED(id, 360)} Tiền chỉ bị trừ khi game xử lý lệnh.`);
  });
}

// ---------------- /workshop, /vang ----------------
const PER_PAGE = 6; // số mẻ / đơn mỗi trang
const pageOf = (total, page) => { const pages = Math.max(1, Math.ceil(total / PER_PAGE)); return { pages, page: Math.min(Math.max(0, Number(page) || 0), pages - 1) }; };
// hàng nút: ◀ [trang/tổng] ▶ Làm mới. customId: pg:<kind>:<owner>:<trang>:<g=đi tới trang | r=làm mới>
const navRow = (kind, owner, page, pages) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`pg:${kind}:${owner}:${page - 1}:g`).setEmoji(EM.left).setLabel('Trước').setStyle(ButtonStyle.Primary).setDisabled(page <= 0),
  new ButtonBuilder().setCustomId('pg:noop').setLabel(`${page + 1}/${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
  new ButtonBuilder().setCustomId(`pg:${kind}:${owner}:${page + 1}:g`).setEmoji(EM.right).setLabel('Sau').setStyle(ButtonStyle.Primary).setDisabled(page >= pages - 1),
  new ButtonBuilder().setCustomId(`pg:${kind}:${owner}:${page}:r`).setLabel('Làm mới').setEmoji(EM.refresh).setStyle(ButtonStyle.Secondary));
const leftText = (ms) => {
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} phút`;
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
};

async function buildWorkshop(uid, fresh = true, pageReq = 0) {
  const sv = await (fresh ? loadFresh(uid) : loadSave(uid));
  if (!sv) return { error: NO_SAVE };
  const jobs = sv.s.wq || [], now = Date.now();
  console.log(`[progress] workshop: ${jobs.length} mẻ trong save (user ${uid}, save cập nhật ${new Date(sv.at).toISOString()})`);
  if (!jobs.length) return { error: `Hiện không có mẻ workshop nào đang làm trong dữ liệu đã lưu (cập nhật ${stamp(sv.at)}). Nếu game đang có mẻ, hãy mở game vài giây để lưu lên đám mây rồi dùng lại lệnh.`, s: sv.s, at: sv.at };
  const { pages, page } = pageOf(jobs.length, pageReq);
  const rows = await Promise.all(jobs.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map(async j => {
    const ty = WS_TYPES[j.t] || ['🎁', 'Workshop'], tot = Math.max(1, j.en - j.st), left = Math.max(0, j.en - now);
    const q = Number(j.it?.q);
    const item = await withItemImage({ ...(j.it || {}), t: (j.it && j.it.t) || j.t }); // hình vật phẩm đúng như trong game
    return {
      icon: ty[0], svg: R.wsItemSvg(item), name: clip(j.it?.n || ty[1], 40),
      sub: `${ty[1]}${Number.isFinite(q) ? ` · chất lượng ${q}/100` : ''}`,
      pct: 1 - left / tot, right: left > 0 ? `còn ${leftText(left)}` : 'Xong rồi!',
    };
  }));
  const pngs = await Promise.all(rows.map(r => R.renderRow(sv.s, r)));
  return { pngs, head: `${H('Tiến độ Workshop', EM.ws)}\n-# ${EM.a} ${clip((sv.s.pf && sv.s.pf.nm) || sv.s.name || 'Tiệm hoa', 40)} · ${jobs.length} mẻ · Trang ${page + 1}/${pages}`, s: sv.s, at: sv.at, page, pages };
}
async function buildGold(uid, fresh = true, pageReq = 0) {
  const sv = await (fresh ? loadFresh(uid) : loadSave(uid));
  if (!sv) return { error: NO_SAVE };
  const day = sv.s.day || 1;
  const orders = (sv.s.gd?.orders || []).filter(o => o.st === 'making');
  console.log(`[progress] vàng: ${(sv.s.gd?.orders || []).length} đơn (${orders.length} đang làm) trong save (user ${uid}, save cập nhật ${new Date(sv.at).toISOString()})`);
  if (!orders.length) return { error: `Hiện không có đơn gia công vàng nào đang làm trong dữ liệu đã lưu (cập nhật ${stamp(sv.at)}). Đơn phải đã đặt cọc (đang gia công) mới hiện ở đây.`, s: sv.s, at: sv.at };
  const { pages, page } = pageOf(orders.length, pageReq);
  const rows = orders.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map(o => {
    const acc = o.acc ?? o.day ?? day, due = o.due ?? day, total = Math.max(1, due - acc), left = Math.max(0, due - day);
    return {
      icon: '💍', name: clip(o.br?.name || 'Đơn gia công', 40),
      svg: R.goldSvg({ type: o.req?.type, tone: o.req?.tone, gem: o.req?.gem }), // hình trang sức đúng như trong game
      sub: `${GOLD_TYPES[o.req?.type] || 'Trang sức'} vàng ${o.req?.k || '?'}K · ngày game ${day}/${due}`,
      pct: 1 - left / total, right: left > 0 ? `còn ${left} ngày` : 'Sẵn sàng nhận',
    };
  });
  const pngs = await Promise.all(rows.map(r => R.renderRow(sv.s, r)));
  return { pngs, head: `${H('Tiến độ gia công vàng', EM.ring)}\n-# ${EM.a} Tiệm vàng Kim Ngân · ngày game ${day} · ${orders.length} đơn · Trang ${page + 1}/${pages}`, s: sv.s, at: sv.at, page, pages };
}
// ---------------- /chinhanh: tổng quan + nút từng chi nhánh ----------------
const BR_GAP = (l) => Math.max(4, Math.round((19 - 1.5 * l) * 10) / 10); // giây/đơn của nhân viên
const BR_WAGE = (l) => 20000 + 10000 * l;
const BR_SHARE = (l) => 0.22 + 0.07 * (l - 1);
const BR_MAXL = 5, BR_MAXS = 4;
function brInfo(s, b) {
  const st = b.st || {}, stf = b.stf || [], dp = Math.max(0, Math.min(1, Number(s.x2?.dp) || 0)), open = s.ph === 'open';
  const fl = FLOWERS.reduce((a, f) => a + (st[f[0]] || 0), 0), pp = ['S', 'M', 'L'].reduce((a, k) => a + (st[k] || 0), 0);
  const why = [];
  if (!stf.length) why.push('chưa có nhân viên');
  if (!fl || !pp) why.push('chưa nhập hàng');
  const r = b.plan?.r, selling = open && !b.pause && !!r;
  let state, right, pct = 0;
  if (b.pause) { state = 'Tạm nghỉ'; right = 'Tạm nghỉ'; }
  else if (selling) { state = 'Đang bán hàng'; pct = dp; right = `Đang bán hàng · ${Math.floor(r.n * dp)}/${r.n} đơn`; }
  else if (why.length) { state = 'Chưa sẵn sàng'; right = 'Chưa sẵn sàng'; }
  else { state = 'Sẵn sàng'; right = 'Sẵn sàng'; }
  return { b, st, stf, fl, pp, why, r, selling, dp, state, right, pct, wage: stf.reduce((a, t) => a + BR_WAGE(t.l || 1), 0) };
}
const brRowSpec = (x) => ({
  icon: '🛒', name: clip(`CN ${x.b.n}`, 40),
  sub: `cấp ${x.b.l}/${BR_MAXL} · ${x.stf.length}/${BR_MAXS} nhân viên · kho ${x.fl} hoa, ${x.pp} giấy`,
  pct: x.pct, right: x.right,
});
const brStockText = (st) => {
  const f = FLOWERS.filter(([k]) => (st[k] || 0) > 0).map(([k, n]) => `${n} **${st[k]}**`);
  const p = ['S', 'M', 'L'].filter(k => (st[k] || 0) > 0).map(k => `${NAMES[k]} **${st[k]}**`);
  return { f, p };
};
const brButtons = (owner, brs, cur) => {
  const row = new ActionRowBuilder();
  brs.slice(0, 5).forEach((b, k) => row.addComponents(new ButtonBuilder()
    .setCustomId(`br:${owner}:${k}:g`).setLabel(clip(`CN ${k + 1} · ${b.n}`, 40))
    .setStyle(cur === k ? ButtonStyle.Primary : ButtonStyle.Secondary)));
  return row;
};
const brCtl = (owner, view) => new ActionRowBuilder().addComponents(
  ...(view === 'all' ? [] : [new ButtonBuilder().setCustomId(`br:${owner}:all:g`).setLabel('Tổng quan').setEmoji(EM.left).setStyle(ButtonStyle.Secondary)]),
  new ButtonBuilder().setCustomId(`br:${owner}:${view}:r`).setLabel('Làm mới').setEmoji(EM.refresh).setStyle(ButtonStyle.Secondary));
// Bot đang bán thay (web tắt): save đám mây chưa đổi trong lúc bán, nên phủ tiến trình thật của phiên bán lên bản đọc được
function overlayLive(s, uid) {
  const sn = daySnaps.get(uid);
  if (!sn || !sn.br || !daySessions.has(uid)) {
    // web đang bán: dp trong save đám mây hay bị kẹt/chậm, nên tính theo giờ thật và dùng cùng % với tin tiến độ trong kênh
    const od = onlineDays.get(uid);
    if (!od || s.ph !== 'open') return s;
    const c = JSON.parse(JSON.stringify(s));
    c.x2 = c.x2 || {}; c.x2.dp = Number.isFinite(od.ip) ? od.ip / 100 : Math.max(0, Math.min(1, (Date.now() - od.t0) / 1000 / od.len));
    return c;
  }
  const c = JSON.parse(JSON.stringify(s));
  // cùng % với tin tiến độ trong kênh (theo số hàng đã bán), thiếu thì theo thời gian game
  c.ph = 'open'; c.x2 = c.x2 || {}; c.x2.dp = Number.isFinite(sn.ip) ? sn.ip / 100 : Number(sn.dp) || 0;
  (c.x2.br || []).forEach((b, k) => { const x = sn.br[k]; if (!x) return; b.pause = x.pause ? 1 : 0; b.plan = x.sell ? { r: { n: x.dn, lost: x.lost, rev: x.rev } } : null; });
  return c;
}
async function branchPayload(uid, owner, view, fresh) {
  const sv = await (fresh && !daySessions.has(uid) ? loadFresh(uid) : loadSave(uid)); // bot đang bán: không chờ game đồng bộ
  if (!sv) return { error: NO_SAVE };
  const s = overlayLive(sv.s, uid), brs = s.x2?.br || [];
  console.log(`[progress] chi nhánh: ${brs.length} chi nhánh trong save (user ${uid}, save cập nhật ${new Date(sv.at).toISOString()})`);
  if (!brs.length) return { error: `Bạn chưa mở chi nhánh nào (dữ liệu cập nhật ${stamp(sv.at)}). Vào tab Chi nhánh trong game để mở chi nhánh đầu tiên.` };
  const open = s.ph === 'open', shop = clip(s.pf?.nm || s.name || 'Tiệm hoa', 40);
  const infos = brs.slice(0, 5).map(b => brInfo(s, b));
  const idx = view === 'all' ? -1 : Math.min(Math.max(0, Number(view) || 0), infos.length - 1);

  if (idx < 0) { // ---- tổng quan ----
    const pngs = await Promise.all(infos.map(x => R.renderRow(s, brRowSpec(x))));
    const sell = infos.filter(x => x.selling).length, tot = infos.reduce((a, x) => a + x.fl, 0), wg = infos.filter(x => !x.b.pause).reduce((a, x) => a + x.wage, 0);
    return { payload: layout([
      `${H('Chi nhánh', EM.shop)}\n-# ${EM.a} ${shop} · ${infos.length} chi nhánh · ${open ? 'đang mở bán' : 'chưa mở bán'}`,
      `${EM.ok} **Đang bán:** ${sell}/${infos.length} chi nhánh\n${EM.box} **Tổng hoa trong kho:** ${tot}\n${EM.a} **Lương chi nhánh/ngày:** ${vnd(wg)}`,
      { sep: true },
      ...pngs.map((_, k) => ({ img: `attachment://progress${k}.png` })),
      { sep: true },
      `-# ${EM.tip} Bấm nút CN bên dưới để xem đủ thông tin từng chi nhánh.`,
      { row: brButtons(owner, brs, -1) },
      { row: brCtl(owner, 'all') },
      `-# ${EM.a} Justaseed • dữ liệu ${stamp(sv.at)}`,
    ], { files: pngs.map((bf, k) => new AttachmentBuilder(bf, { name: `progress${k}.png` })), attachments: [] }) };
  }

  // ---- chi tiết một chi nhánh ----
  const x = infos[idx], b = x.b;
  const png = await R.renderRow(s, brRowSpec(x));
  const { f, p } = brStockText(x.st);
  const info = [
    `${EM.a} **Tình trạng:** ${x.state}${!b.pause && x.why.length ? ` (${x.why.join(', ')})` : ''}`,
    `${EM.b} **Cấp:** ${b.l}/${BR_MAXL} · **Thị phần:** ${Math.round(BR_SHARE(b.l || 1) * 100)}%`,
    `${EM.a} **Lương nhân viên:** ${vnd(x.wage)}/ngày${b.last != null ? `\n${EM.b} **Hôm qua:** ${b.last >= 0 ? '+' : '-'}${vnd(Math.abs(b.last))}` : ''}`,
  ].join('\n');
  const prog = x.selling
    ? `${EM.ok} **Tiến trình hôm nay** — ${Math.round(x.dp * 100)}%\nĐã bán **${Math.floor(x.r.n * x.dp)}/${x.r.n}** đơn · doanh thu **${vnd(Math.round(x.r.rev * x.dp))}**${x.r.lost ? `\nKhách chưa được phục vụ: **${Math.floor(x.r.lost * x.dp)}/${x.r.lost}**` : ''}`
    : null;
  const staff = `${EM.person} **Nhân viên (${x.stf.length}/${BR_MAXS})**\n` + (x.stf.length
    ? x.stf.map(t => `• ${clip(t.n, 20)} · cấp ${t.l || 1}/10 · ${BR_GAP(t.l || 1)} giây/đơn · ${vnd(BR_WAGE(t.l || 1))}/ngày`).join('\n')
    : 'Chưa có nhân viên.');
  const stock = `${EM.box} **Kho**\n` + (f.length || p.length
    ? [f.length ? `Hoa: ${f.join(' · ')}` : null, p.length ? `Giấy gói: ${p.join(' · ')}` : null].filter(Boolean).join('\n')
    : 'Trống.') + (x.selling ? '\n-# Kho được trừ khi kết thúc ngày.' : '');
  return { payload: layout([
    `${H(`CN ${clip(b.n, 30)}`, EM.shop)}\n-# ${EM.a} ${shop} · chi nhánh ${idx + 1}/${infos.length}`,
    { img: 'attachment://progress0.png' },
    info,
    prog,
    { sep: true },
    staff,
    { sep: true },
    stock,
    { sep: true },
    { row: brButtons(owner, brs, idx) },
    { row: brCtl(owner, String(idx)) },
    `-# ${EM.a} Justaseed • dữ liệu ${stamp(sv.at)}`,
  ], { files: [new AttachmentBuilder(png, { name: 'progress0.png' })], attachments: [] }) };
}
async function btnBranch(i) {
  const [, owner, view, act] = i.customId.split(':');
  if (!owner) return;
  if (i.user.id !== owner) return i.reply({ content: 'Nút này của người dùng lệnh.', flags: EPH });
  await i.deferUpdate();
  const uid = await userIdOf(owner);
  if (!uid) return;
  const r = await branchPayload(uid, owner, view, act !== 'g'); // chuyển chi nhánh dùng dữ liệu đã lưu (nhanh), Làm mới mới tải mới
  if (r.error) return i.editReply({ ...layout([r.error]), attachments: [] });
  return i.editReply(r.payload);
}
const progressLayout = (r, kind, owner) => {
  return layout([
    r.head,
    ...r.pngs.map((_, k) => ({ img: `attachment://progress${k}.png` })), // mỗi tiến độ một ảnh riêng
    { sep: true },
    { row: navRow(kind, owner, r.page, r.pages) },
    `-# ${EM.a} Justaseed • dữ liệu ${stamp(r.at)}`,
  ], { files: r.pngs.map((b, k) => new AttachmentBuilder(b, { name: `progress${k}.png` })), attachments: [] });
};
async function cmdProgress(i, kind) {
  await i.deferReply();
  if (!R) return say(i, 'Máy chủ bot chưa cài @napi-rs/canvas nên chưa vẽ được ảnh.');
  const uid = await userIdOf(i.user.id);
  if (!uid) return say(i, NOT_LINKED);
  if (kind === 'br') { const bp = await branchPayload(uid, i.user.id, 'all', true); if (bp.error) return say(i, bp.error); return i.editReply(bp.payload); }
  const r = kind === 'ws' ? await buildWorkshop(uid) : await buildGold(uid);
  if (r.error) return say(i, r.error);
  return i.editReply(progressLayout(r, kind, i.user.id));
}
async function btnProgress(i) {
  const [, kind, owner, pageStr, act] = i.customId.split(':');
  if (!owner || (kind !== 'ws' && kind !== 'gd')) return;
  if (i.user.id !== owner) return i.reply({ content: 'Nút này của người dùng lệnh.', flags: EPH });
  await i.deferUpdate();
  const uid = await userIdOf(owner);
  if (!uid) return;
  const page = Number(pageStr) || 0;
  const fresh = act !== 'g'; // chuyển trang dùng dữ liệu đã lưu (nhanh), Làm mới mới tải mới
  const r = kind === 'ws' ? await buildWorkshop(uid, fresh, page) : await buildGold(uid, fresh, page);
  if (r.error) return i.editReply({ ...layout([r.error]), attachments: [] });
  return i.editReply(progressLayout(r, kind, owner));
}

// ---------------- ngày bán chạy THỜI GIAN THẬT + tiến độ trên Discord ----------------
// Tiến trình theo SỐ LƯỢNG vật phẩm đã bán (không theo thời gian): 1 - còn lại / ban đầu, chỉ tăng, 100 khi xong ngày
const stockUnits = (s) => { const st = (s && s.st) || {}; return [...engine.F.map(f => f.id), ...engine.PAPER.map(x => x.id)].reduce((a, id) => a + (Number(st[id]) || 0), 0); };
const itemPct = (done, base, cur, prev = 0) => {
  if (done) return 100;
  if (!(base > 0) || !Number.isFinite(cur)) return undefined;
  return Math.max(prev, Math.min(100, Math.max(0, Math.round((1 - cur / base) * 100))));
};
const dayBar = (p, w = 14) => '█'.repeat(Math.round(p / 100 * w)) + '░'.repeat(w - Math.round(p / 100 * w));
const durText = (sec) => { const m = Math.ceil(Math.max(0, sec) / 60); return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${Math.max(1, m)} phút`; };
// tiến trình từng chi nhánh đọc từ save đám mây (web đang bán): cùng dạng với snapshot của trình duyệt ẩn
const brFromSave = (s) => (s.x2?.br || []).slice(0, 5).map(b => { const r = b.plan?.r; return { n: b.n, pause: !!b.pause, sell: s.ph === 'open' && !b.pause && !!r, dn: r?.n || 0, lost: r?.lost || 0, rev: r?.rev || 0 }; });
function dayLayout(sn, owner, shop, opt = {}) {
  const live = !sn.done;
  const pct = Number.isFinite(sn.ip) ? sn.ip : sn.pct; // ưu tiên tiến độ theo số lượng hàng đã bán
  const blocks = [H(live ? 'Đang bán hàng' : 'Kết thúc ngày bán', live ? EM.shop : EM.ok),
    `-# ${EM.a} ${clip(shop, 40)} · ngày bán ${lenName(sn.len)}`,
    `${dayBar(pct)} **${pct}%** hàng đã bán · ${EM.clock} **${sn.clock}**/22:00${live ? ` · còn khoảng ${durText(sn.len - sn.t)}` : ''}`];
  if (sn.n != null) blocks.push(`${EM.person} **Đã phục vụ:** ${sn.n} khách · **bỏ đi:** ${sn.lost}\n${EM.money} **Doanh thu:** ${vnd(sn.rev)}${live && sn.left != null ? `\n${EM.box} **Còn bán được:** ${sn.left} bó` : ''}`);
  if (live && sn.br && sn.br.length) { // thanh tiến trình từng chi nhánh (bán song song với quầy chính, tính theo tiến độ khách)
    const p = Number.isFinite(sn.ip) ? sn.ip : Math.round(Math.max(0, Math.min(1, sn.len ? (Number(sn.t) || 0) / sn.len : Number(sn.dp) || 0)) * 100);
    blocks.push(`${EM.shop} **Chi nhánh**\n` + sn.br.map(b => {
      const nm = `**CN ${clip(b.n, 20)}**`;
      if (b.pause) return `${nm} · tạm nghỉ`;
      if (!b.sell) return `${nm} · không bán (thiếu nhân viên hoặc hàng)`;
      return `${dayBar(p, 10)} ${nm} · ${p}% · ${Math.floor(b.dn * p / 100)}/${b.dn} đơn · ${vnd(Math.round(b.rev * p / 100))}`;
    }).join('\n'));
  }
  if (!live && sn.brLast && sn.brLast.lines.length) {
    const net = sn.brLast.rev - sn.brLast.cost;
    blocks.push(`${EM.shop} **Chi nhánh:** doanh thu ${vnd(sn.brLast.rev)} · chi phí ${vnd(sn.brLast.cost)} · ${net >= 0 ? 'lãi' : 'lỗ'} ${vnd(Math.abs(net))}\n${sn.brLast.lines.join('\n')}`);
  }
  if (!live && opt.final) blocks.push(opt.final);
  if (!live && opt.png) blocks.push({ img: 'attachment://summary.png' }); // ảnh tổng kết ngày giống hệt ảnh trên web
  if (live && opt.hint) blocks.push(opt.hint);
  blocks.push({ sep: true });
  if (live && opt.button !== false) blocks.push({ row: new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ds:close:${owner}`).setLabel('Đóng quầy sớm').setEmoji(EM.no).setStyle(ButtonStyle.Danger)) });
  if (!live) blocks.push({ row: new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ds:next:${owner}`).setLabel('Sang ngày mới').setEmoji(EM.shop).setStyle(ButtonStyle.Success)) });
  if (!live && opt.png) blocks.push({ row: khoe.shareRow(owner, 'd') });
  blocks.push(`-# ${EM.a} Justaseed • ${live ? 'cập nhật mỗi 15 giây' : stamp()}`);
  return layout(blocks, { attachments: [], ...(!live && opt.png ? { files: [new AttachmentBuilder(opt.png, { name: 'summary.png' })] } : {}) });
}
// tin nhắn riêng báo chủ tiệm: ngày bán đã kết thúc (hết hàng / hết giờ / đóng quầy sớm). DM đóng thì bỏ qua.
async function dmDayEnd(owner, shop, day, why, rev, pf, n, lost, png) {
  try {
    const u = await client.users.fetch(owner);
    const head = why === 'stock' ? 'Đã bán hết hàng' : why === 'closed' ? 'Đã đóng quầy' : why === 'early' ? 'Ngày bán kết thúc sớm' : 'Đã hết ngày bán';
    const line = why === 'early' ? 'Ngày bán **kết thúc sớm** (hết hàng hoặc đóng quầy).' : why === 'stock' ? 'Gian hàng **hết hàng** nên ngày bán kết thúc sớm.' : why === 'closed' ? 'Quầy đã **đóng sớm** theo yêu cầu.' : 'Ngày bán đã **hết giờ**.';
    await u.send(layout([H(head, EM.ok),
      `-# ${EM.a} ${clip(shop, 40)} · ngày ${day}`,
      `${line}\n${EM.person} **Đã phục vụ:** ${n || 0} khách · **bỏ đi:** ${lost || 0}\n${EM.money} **Doanh thu:** ${vnd(rev || 0)}${pf == null ? '' : ` · **lợi nhuận:** ${pf >= 0 ? '' : '-'}${vnd(Math.abs(pf))}`}`,
      png ? { img: 'attachment://summary.png' } : null, // ảnh tổng kết ngày giống ảnh trong kênh
      { sep: true },
      { row: new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ds:next:${owner}`).setLabel('Sang ngày mới').setEmoji(EM.shop).setStyle(ButtonStyle.Success)) },
      `-# ${EM.a} Justaseed • ${stamp()}`], png ? { files: [new AttachmentBuilder(png, { name: 'summary.png' })] } : {}));
  } catch (e) { console.warn('[extra] không nhắn riêng được cho chủ tiệm:', e.message || e); }
}
async function channelOf(i) { return i.channel || (i.channelId ? await client.channels.fetch(i.channelId).catch(() => null) : null); }
const whyText = (sn) => (sn.why === 'stock' ? `Dừng lúc ${sn.clock} (giờ game) vì **hết hàng**.` : sn.why === 'closed' ? `Bạn đã **đóng quầy sớm** lúc ${sn.clock}.` : `Bán đủ ${lenName(sn.len)}, **hết giờ** lúc 22:00.`);

// Web tắt: bot giữ một trình duyệt ẩn, mỗi giây thật game chạy 1 giây (như web), bán đến khi hết giờ hoặc hết hàng.
async function runDaySession(i, uid, s0, len) {
  const shop = (s0.pf && s0.pf.nm) || s0.name || 'Tiệm hoa';
  const sess = await headless.startDay(s0, len ? { len } : {});
  const ctl = { close: false };
  const left0 = Number(sess.first.snap.left); let ipPrev = 0; // số bó bán được lúc mở quầy
  const ipOf = (sn) => { const v = itemPct(sn.done, left0, Number(sn.left), ipPrev); if (v != null) ipPrev = v; return v; };
  daySessions.set(uid, ctl);
  sess.first.snap.ip = ipOf(sess.first.snap);
  daySnaps.set(uid, sess.first.snap);
  const owner = i.user.id;
  let msg = null;
  const ch = await channelOf(i);
  const first = dayLayout({ ...sess.first.snap, ip: ipOf(sess.first.snap) }, owner, shop, { hint: `${EM.tip} Web đang tắt nên bot bán thay bạn. Đừng mở web trong lúc này.` });
  const hub = i.hub && i.hub.msg ? i.hub : null; // mở từ bảng gian hàng: chính bảng đó chuyển thành tin tiến độ
  if (hub) { hub.taken = true; try { await hub.msg.edit(first); msg = hub.msg; } catch (e) { msg = null; } }
  if (!msg) { try { msg = ch ? await ch.send(first) : null; } catch (e) { msg = null; } }
  // bảng điều khiển (kèm lời báo đã mở) được gửi mới bên dưới tin tiến độ
  await i.editReply(layout([H('Đã mở gian hàng', EM.ok), `${sess.first.msg}\nTiến độ cập nhật ở tin nhắn ${hub && msg === hub.msg ? 'phía trên' : 'tiếp theo trong kênh'}.`, `-# ${EM.a} Justaseed`])).catch(() => {});
  const edit = (p) => (msg ? msg.edit(p).catch(() => {}) : i.editReply(p).catch(() => {}));

  (async () => {
    const t0 = Date.now();
    let ticks = 0, snap = sess.first.snap, lastEdit = Date.now(), failed = null;
    try {
      while (!snap.done) {
        await sleep(2000);
        if (ctl.close) snap = await sess.close();
        else {
          const due = Math.floor((Date.now() - t0) / 1000) - ticks;
          if (due > 0) { snap = await sess.step(due); ticks += due; }
        }
        snap.ip = ipOf(snap);
        daySnaps.set(uid, snap);
        if (!snap.done && Date.now() - lastEdit >= 15000) { lastEdit = Date.now(); await edit(dayLayout({ ...snap, ip: ipOf(snap) }, owner, shop, { hint: `${EM.tip} Web đang tắt nên bot bán thay bạn. Đừng mở web trong lúc này.` })); }
      }
      const save = await sess.finish();
      const rep = `${EM.a} **Ngày ${snap.day}:** ${snap.n} khách phục vụ, ${snap.lost} bỏ đi${snap.dec ? `, ${snap.dec} được từ chối khéo vì hết hàng` : ''}\n${EM.money} **Doanh thu** ${vnd(snap.rev)} · **lợi nhuận** ${snap.pf >= 0 ? '' : '-'}${vnd(Math.abs(snap.pf))}\n${whyText(snap)}\n${EM.tip} Dùng \`${PREFIX}gianhang ngaymoi\` để sang ngày mới.`;
      await store.edit(supabase, uid, (cur) => {
        if ((cur.day || 1) !== (s0.day || 1) || cur.ph !== 'prep' || Math.round(cur.money) !== Math.round(s0.money)) throw new Error('Save trên đám mây đã thay đổi trong lúc bot bán (có thể bạn đã mở web), kết quả ngày này bị hủy');
        return { save, out: rep };
      });
      let png = null;
      try { png = await sess.image(); } catch (e) { console.error('[extra] không vẽ được ảnh tổng kết:', e.message || e); }
      const sent = await edit(dayLayout({ ...snap, ip: ipOf(snap) }, owner, shop, { final: rep, png }));
      dmDayEnd(owner, shop, snap.day, snap.why, snap.rev, snap.pf, snap.n, snap.lost, png).catch(() => {});
      if (png && sent) khoe.remember(sent.id, { kind: 'd', png, day: snap.day, shop, theme: /^#[0-9a-f]{6}$/i.test((save.pf && save.pf.col) || '') ? save.pf.col : '#4fb06f' });
    } catch (e) {
      failed = e;
      console.error('[extra] ngày bán thời gian thật lỗi:', e.message || e);
      await edit(layout([H('Ngày bán bị dừng', EM.no), clip(e.message || e, 400), 'Dữ liệu trên đám mây chưa bị đổi.'], { attachments: [] }));
    } finally {
      daySessions.delete(uid);
      daySnaps.delete(uid);
      await sess.dispose();
    }
  })();
}

// Web đang mở: game tự bán thời gian thật; bot chỉ theo dõi qua bản lưu đám mây và báo tiến độ.
async function watchOnlineDay(i, uid, s0, len) {
  const hub = i.hub && i.hub.msg ? i.hub : null;
  if (hub) hub.taken = true; // đặt ngay (trước mọi await) để tin 'Thành công' của lệnh được gửi mới, không đè lên tin tiến độ
  const shop = (s0.pf && s0.pf.nm) || s0.name || 'Tiệm hoa';
  const ch = await channelOf(i);
  if (!ch) return;
  const owner = i.user.id, t0 = Date.now(), day0 = s0.day || 1;
  const units0 = stockUnits(s0); let ipPrev = 0; // tổng hoa + giấy lúc mở quầy
  onlineDays.set(uid, { t0, len, ip: undefined });
  const mk = (pct, done, extra) => dayLayout({ done, len, t: Math.round(len * pct / 100), pct, clock: (() => { const m = Math.floor(pct / 100 * 780); return `${String(9 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; })(), n: extra && extra.n, lost: extra && extra.lost, rev: extra && extra.rev, br: extra && extra.br, dp: extra && extra.dp, ip: extra && extra.ip }, owner, shop, { button: false, final: extra && extra.final, png: extra && extra.png, hint: `${EM.tip} Web đang bán, giữ tab game mở nhé.` });
  let msg = null;
  if (hub) msg = await hub.msg.edit(mk(0, false)).then(() => hub.msg).catch(() => null); // bảng gian hàng chuyển thành tin tiến độ
  if (!msg) msg = await ch.send(mk(0, false)).catch(() => null);
  if (!msg) { onlineDays.delete(uid); return; }
  (async () => { try {
    while (Date.now() - t0 < (len + 180) * 1000) {
      await sleep(20000);
      let sv = null; try { sv = await loadFresh(uid); } catch (e) { continue; }
      if (!sv) continue;
      const s = sv.s;
      if ((s.day || 1) > day0 || s.ph === 'end') {
        const r = s.rpt || {};
        const end = Math.round((Date.now() - t0) / 1000) < len - 5 ? 'Ngày kết thúc sớm (hết hàng hoặc đóng quầy).' : 'Hết giờ.';
        let png = null;
        if (headless.available() && s.rpt) { try { png = await headless.shot(s, 'day'); } catch (e) { console.error('[extra] không vẽ được ảnh tổng kết:', e.message || e); } }
        const sent = await msg.edit(mk(100, true, { png, n: r.n || 0, lost: r.lost || 0, rev: r.rev || 0, final: `${EM.a} **Ngày ${day0}:** ${r.n || 0} khách, ${r.lost || 0} bỏ đi · doanh thu ${vnd(r.rev || 0)}\n${end}` })).catch(() => {});
        if (png && sent) khoe.remember(sent.id, { kind: 'd', png, day: day0, shop, theme: /^#[0-9a-f]{6}$/i.test((s.pf && s.pf.col) || '') ? s.pf.col : '#4fb06f' });
        dmDayEnd(owner, shop, day0, end.startsWith('Hết giờ') ? 'time' : 'early', r.rev, r.fin ?? r.pf, r.n, r.lost, png).catch(() => {});
        return;
      }
      const dp = Math.max(0, Math.min(1, (Date.now() - t0) / 1000 / len)); // theo thời gian thật (dp trong save cũ có thể kẹt ở 1%)
      const ip = itemPct(false, units0, stockUnits(s), ipPrev); if (ip != null) ipPrev = ip;
      { const od = onlineDays.get(uid); if (od) od.ip = ip; }
      await msg.edit(mk(Math.round(dp * 100), false, { n: undefined, br: brFromSave(s), dp, ip })).catch(() => {});
    }
  } finally { onlineDays.delete(uid); } })();
}
async function btnDay(i) {
  const [, act, owner] = i.customId.split(':');
  if (i.user.id !== owner) return i.reply({ ...layout(['Nút này của chủ tiệm.']), flags: V2 | EPH });
  if (act === 'next') { // nút "Sang ngày mới" dưới tin tổng kết: kết quả báo riêng cho chủ tiệm, tin tổng kết giữ nguyên
    await i.deferReply({ flags: EPH });
    const uid0 = await userIdOf(owner);
    if (!uid0) return i.editReply(layout([NOT_LINKED]));
    if (daySessions.has(uid0)) return i.editReply(layout(['Gian hàng đang bán, đợi hết ngày đã nhé.']));
    if (busyUsers.has(uid0)) return i.editReply(layout(['Bạn đang có một lệnh khác đang xử lý, đợi một chút nhé.']));
    busyUsers.add(uid0);
    try {
      const sv = await loadFresh(uid0);
      if (!sv) return i.editReply(layout([NO_SAVE]));
      if (sv.s.ph !== 'end') return i.editReply(layout([sv.s.ph === 'open' ? 'Gian hàng đang mở bán, đợi hết ngày đã.' : 'Bạn đã sang ngày mới rồi (tiệm đang ở giai đoạn chuẩn bị).']));
      const r = await gameOp(uid0, 'next_day', {}).catch(e => ({ err: e }));
      if (r.err) return i.editReply(layout([`${EM.no} ${clip(r.err.message || r.err, 300)}`]));
      return i.editReply(layout([H('Thành công', EM.ok), clip(r.msg, 300), `-# ${clip(sv.s.name || 'Tiệm hoa', 40)}${r.via === 'bot' ? ` · ${EM.wait} web đang tắt, bot làm thẳng trên save đám mây` : ''}`]));
    } finally { busyUsers.delete(uid0); }
  }
  const uid = await userIdOf(owner);
  const c = uid && daySessions.get(uid);
  if (!c) return i.reply({ ...layout(['Ngày bán này đã kết thúc.']), flags: V2 | EPH });
  c.close = true;
  return i.deferUpdate();
}

// ---------------- /gianhang ----------------
const lenName = (l) => ({ 240: '4 phút', 480: '8 phút', 900: '15 phút', 1800: '30 phút', 3600: '1 giờ' }[l] || '4 phút');
function progOpen(s) {
  const dp = Math.max(0, Math.min(1, Number(s.x2 && s.x2.dp) || 0)), m = Math.floor(dp * 780);
  return ` · ${Math.round(dp * 100)}% · ${String(9 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}/22:00`;
}
const PHASE = { prep: 'Chuẩn bị (nhập hàng, đặt giá)', open: 'Đang mở bán', end: 'Đang tổng kết ngày' };
async function cmdShop(i) {
  const sub = i.options.getSubcommand();
  await i.deferReply({ flags: E });
  const uid = await userIdOf(i.user.id);
  if (!uid) return say(i, NOT_LINKED);

  if (sub === 'trangthai') {
    return hub.show(i, uid, 'home'); // bảng điều khiển gian hàng: gom mọi tính năng trong một layout
  }

  const sv = await loadFresh(uid);
  if (!sv) return say(i, NO_SAVE);
  const s = sv.s;
  return withLock(uid, i, async () => {
    let kind, payload = {}, okMsg;
    if (sub === 'mo') {
      if (s.ph && s.ph !== 'prep') return say(i, `Không mở được: tiệm đang ở giai đoạn "${PHASE[s.ph] || s.ph}".`);
      const len = Number(i.options.getString('thoigian')) || 0; // giây: 240/480/900/1800/3600; bỏ trống = giữ thời gian đã chọn trong game
      const lv = lvOf(s.xp || 0);
      if (len === 1800 && lv < 20) return say(i, `Ngày bán 30 phút cần cấp 20 (bạn đang cấp ${lv}).`);
      if (len === 3600 && lv < 50) return say(i, `Ngày bán 1 giờ cần cấp 50 (bạn đang cấp ${lv}).`);
      kind = 'open_day'; payload = len ? { len } : {};
      const L0 = len || ([240, 480, 900, 1800, 3600].includes(s.len) ? s.len : 240);
      okMsg = `Đã mở gian hàng ${L0 >= 3600 ? '1 giờ' : L0 / 60 + ' phút'}, khách đang vào! Ngày tự kết thúc khi hết giờ hoặc hết hàng (dự kiến lúc <t:${Math.floor(Date.now() / 1000) + L0}:t> nếu bán đủ giờ). Giữ tab game mở nhé.`;
    } else if (sub === 'ngaymoi') {
      if (s.ph !== 'end') return say(i, s.ph === 'open' ? 'Gian hàng đang mở bán, đợi hết ngày đã.' : 'Chưa có ngày nào cần sang (tiệm đang ở giai đoạn chuẩn bị).');
      const r = await gameOp(uid, 'next_day', {}).catch(e => ({ err: e }));
      if (r.err) return say(i, `${EM.no} ${clip(r.err.message || r.err, 300)}`);
      return i.editReply(layout([H('Thành công', EM.ok), clip(r.msg, 300), `-# ${clip(s.name || 'Tiệm hoa', 40)}${r.via === 'bot' ? ` · ${EM.wait} web đang tắt, bot làm thẳng trên save đám mây` : ''}`]));
    } else if (sub === 'thuenv') {
      const loai = i.options.getString('loai');
      kind = loai === 'thang' ? 'hire_month' : 'hire_day';
      okMsg = loai === 'thang' ? 'Đã thuê nhân viên theo tháng (30 ngày game).' : 'Đã thuê nhân viên cho hôm nay.';
    } else if (sub === 'nhaphang') {
      return await nhOpen(i, uid, sv);
    } else return say(i, 'Lệnh không hợp lệ.');

    if (kind === 'open_day' && headless.available() && !(await gameOnline(uid))) {
      try { return await runDaySession(i, uid, s, payload.len); }
      catch (e) { return say(i, `${EM.no} ${clip(e.message || e, 300)}`); }
    }
    // web tắt: bot tự làm trên save đám mây (nhập hàng tính trực tiếp; mở bán / thuê nhân viên chạy đúng code game trong trình duyệt ẩn)
    if ((kind === 'restock' || headless.available()) && !(await gameOnline(uid))) {
      try {
        const msg = await store.edit(supabase, uid, kind === 'restock'
          ? (s2) => engine.restock(s2, payload.si, payload.id, payload.q)
          : async (s2) => { const r = await headless.run(s2, kind, payload); return { save: r.save, out: r.out }; });
        return i.editReply(layout([H('Thành công', EM.ok), clip(msg, 700), `-# ${clip(s.name || 'Tiệm hoa', 40)} · ${EM.wait} web đang tắt, bot làm thẳng trên save đám mây`]));
      } catch (e) { return say(i, `${EM.no} ${clip(e.message || e, 300)}`); }
    }
    const id = await enqueue(uid, kind, payload);
    const res = await waitAction(id);
    if (res && res.status === 'done' && kind === 'open_day') watchOnlineDay(i, uid, s, payload.len || ([240, 480, 900, 1800, 3600].includes(s.len) ? s.len : 240)).catch(e => console.error('[extra] theo dõi ngày bán:', e.message));
    if (res && res.status === 'done') return i.editReply(layout([H('Thành công', EM.ok), clip(res.result, 400) || okMsg, `-# ${clip(s.name || 'Tiệm hoa', 40)}`]));
    if (res) return say(i, `${EM.no} ${clip(res.result, 300)}`);
    return say(i, `${EM.wait} ${QUEUED(id, 15)}`);
  });
}
async function autoShop(i) {
  const f = i.options.getFocused(true);
  if (f.name !== 'mathang') return i.respond([]);
  const si = i.options.getInteger('nhacungcap');
  const ids = SUPPLIERS[si]?.items || Object.keys(NAMES);
  const q = String(f.value || '').toLowerCase();
  return i.respond(ids.map(id => ({ name: NAMES[id], value: id }))
    .filter(x => !q || x.name.toLowerCase().includes(q)).slice(0, 25));
}

// ---------------- /gianhang nhaphang: bảng chọn hoa -> form số lượng -> ảnh menu ----------------
// customId: nh:<chủ>:<hành động>:<đích>:<nhà cung cấp>   (đích: m = quầy chính, 0..4 = chi nhánh) · form: nhm:<chủ>:<đích>:<ncc>:<id hoa>
const NH_EMO = {};                         // id hoa -> emoji CỦA BOT (nạp từ Application Emojis)
const NH_SUP = engine.SP.map((x, n) => n); // cả 4 nhà cung cấp: hoa, giấy & quà, đồ mưa nắng
const itemEmoji = (id) => (engine.F.some(f => f.id === id) ? flowerEmoji(id) : (NH_EMO['i:' + id] || EM.box));
const supHasFlower = (S) => S.it.some(id => engine.F.some(f => f.id === id));
const slugOf = (t) => stripVN(t).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const flowerEmoji = (id) => NH_EMO[id] || EM.flower;
function mapFlowerEmojis(list) {
  // tên emoji hợp lệ: <tiền tố>_<id hoa> hoặc <tiền tố>_<tên hoa không dấu>, vd js_hong, js_fw_hong, js_cuc_hoa_mi
  const norm = (n) => String(n).toLowerCase().replace(/^(js_|fw_|flower_|hoa_)+/, '');
  const by = new Map(list.map(e => [norm(e.name), e]));
  const miss = [];
  for (const f of engine.F) {
    const nm = slugOf(f.n);
    const e = by.get(f.id) || by.get(nm) || by.get(nm.replace(/^hoa_/, ''));
    if (e) NH_EMO[f.id] = e.toString(); else miss.push(f.id);
  }
  if (miss.length) console.warn(`[extra] bot chưa có emoji hoa: ${miss.join(', ')} (dùng tạm 🌸). Đặt tên emoji theo mẫu js_<id> hoặc js_<tên-không-dấu>.`);
}
// Tự tạo các emoji còn thiếu của bot từ icon game: emoji chung (js_*), mặt hàng (js_item_<id>)
async function mkEmoji(list, name, png) {
  try {
    const e = await client.application.emojis.create({ attachment: png, name });
    if (list.set) list.set(e.id, e); else list.push(e);
    console.log('[extra] đã tạo emoji ' + name);
  } catch (err) { console.warn('[extra] không tạo được emoji ' + name + ':', err.message); }
}
async function ensureBotEmojis(list) {
  try {
    if (!(R && R.iconPng)) return;
    const have = new Set(list.map(e => e.name));
    for (const [k, [name]] of Object.entries(BOT_EMOJI)) {
      if (have.has(name) || !EMOJI_SRC[k]) continue;
      const png = await R.iconPng(EMOJI_SRC[k]);
      if (png) await mkEmoji(list, name, png);
    }
    for (const [id, ch] of Object.entries(ITEM_SRC)) {
      const name = 'js_item_' + id;
      if (!have.has(name)) { const png = await R.iconPng(ch); if (png) await mkEmoji(list, name, png); }
    }
  } catch (err) { console.warn('[extra] lỗi tạo emoji bot:', err.message); }
  for (const id of Object.keys(ITEM_SRC)) {
    const e = list.find(x => x.name === 'js_item_' + id);
    if (e) NH_EMO['i:' + id] = e.toString();
  }
}
// Tự tạo emoji hoa cho bot (Application Emojis, tên js_<id>) từ hình hoa trong game nếu chưa có, rồi nạp vào NH_EMO
async function ensureFlowerEmojis(list) {
  try {
    if (R && R.flowerPng) {
      const norm = (n) => String(n).toLowerCase().replace(/^(js_|fw_|flower_|hoa_)+/, '');
      const have = new Set(list.map(e => norm(e.name)));
      const slugHave = (f) => have.has(f.id) || have.has(slugOf(f.n)) || have.has(slugOf(f.n).replace(/^hoa_/, ''));
      for (const f of engine.F) {
        if (slugHave(f)) continue;
        try {
          const png = await R.flowerPng(f.id);
          if (!png) continue;
          const e = await client.application.emojis.create({ attachment: png, name: 'js_' + f.id });
          list.set ? list.set(e.id, e) : list.push(e);
          console.log('[extra] đã tạo emoji hoa js_' + f.id);
        } catch (err) { console.warn('[extra] không tạo được emoji hoa ' + f.id + ':', err.message); }
      }
    }
  } catch (err) { console.warn('[extra] lỗi tạo emoji hoa:', err.message); }
  mapFlowerEmojis(list);
}
const encT = (t) => (t < 0 ? 'm' : String(t));
const parseT = (v) => (v === 'm' ? -1 : Math.max(0, parseInt(v, 10) || 0));
const nhId = (owner, act, t, sp) => `nh:${owner}:${act}:${encT(t)}:${sp}`;
const brsOf = (s) => (s.x2?.br || []).slice(0, 5);
const tName = (s, t) => (t < 0 ? 'Cửa hàng chính' : `CN ${clip((brsOf(s)[t] || {}).n || t + 1, 24)}`);
const tStock = (s, t) => (t < 0 ? (s.st || {}) : ((brsOf(s)[t] || {}).st || {}));
const tBought = (s, t) => (t < 0 ? (s.bought || {}) : ((brsOf(s)[t] || {}).bought || {}));
const isPaperId = (id) => id === 'S' || id === 'M' || id === 'L';
const okSup = (sp) => (NH_SUP.includes(sp) ? sp : NH_SUP[0]);
const okT = (s, t) => (t >= 0 && t < brsOf(s).length ? t : -1);

// bảng chính: select chọn hoa + chọn nhà cung cấp + chọn chi nhánh + nhập tất cả
async function nhLayout(owner, uid, sv, t, sp, note) {
  const s = sv.s;
  sp = okSup(sp); t = okT(s, t);
  const S = engine.SP[sp], st = tStock(s, t), rows = engine.menuRows(s, st);
  const hide = await hideBalOf(uid, s);
  // hoa: chỉ loại đã mở khóa và đúng mùa; giấy, quà, đồ mưa nắng: luôn nhập được
  const items = S.it.map(id => engine.byId[id]).filter(x => x && (!engine.F.some(f => f.id === x.id) || engine.unlocked(s, x))).slice(0, 25);
  const hasFl = supHasFlower(S);
  const blocks = [
    `${H('Nhập hàng', EM.shop)}\n-# ${EM.a} ${clip(s.pf?.nm || s.name || 'Tiệm hoa', 40)} · ngày ${s.day || 1}`,
    note || null,
    [
      `${EM.shop} **Nhập cho:** ${tName(s, t)}`,
      `${EM.a} **Nhà cung cấp:** ${S.n} · ${S.m > 1 ? `giá +${Math.round((S.m - 1) * 100)}%` : 'giá gốc'} · ${hasFl || !S.it.some(isPaperId) ? `tối đa ${S.cap}/loại` : 'giấy gói không giới hạn suất'}`,
      `${EM.money} **Số dư:** ${hide ? '••••••' : vnd(sv.money)}`,
      hasFl ? null : `${EM.box} **Kho:** ${S.it.map(id => `${engine.byId[id].n} ${st[id] || 0}`).join(' · ')}`,
    ].filter(Boolean).join('\n'),
    { sep: true },
  ];
  if (items.length) {
    const sel = new StringSelectMenuBuilder().setCustomId(nhId(owner, 'sel', t, sp)).setPlaceholder(hasFl ? 'Chọn loại hoa cần nhập' : 'Chọn mặt hàng cần nhập')
      .addOptions(items.map(f => new StringSelectMenuOptionBuilder().setValue(f.id).setLabel(clip(f.n, 100))
        .setEmoji(itemEmoji(f.id)).setDescription(engine.F.some(x => x.id === f.id)
          ? `Đang bán: ${engine.sellable(rows, f.id)} phần · Kho: ${st[f.id] || 0}`
          : `Giá ${vnd(engine.price(s, f.id, S.m))} · Kho: ${st[f.id] || 0}`)));
    blocks.push({ row: new ActionRowBuilder().addComponents(sel) });
  } else blocks.push('Nhà cung cấp này chưa có mặt hàng nào bạn nhập được (chưa mở khóa hoặc chưa đúng mùa).');
  blocks.push({ row: new ActionRowBuilder().addComponents(...NH_SUP.map(n => new ButtonBuilder()
    .setCustomId(nhId(owner, 'sup', t, n)).setLabel(clip(engine.SP[n].n, 40)).setStyle(n === sp ? ButtonStyle.Primary : ButtonStyle.Secondary))) });
  blocks.push({ row: new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(nhId(owner, 'br', t, sp)).setLabel('Chọn chi nhánh').setEmoji(EM.shop).setStyle(t >= 0 ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(nhId(owner, 'all', t, sp)).setLabel(hasFl ? 'Nhập tất cả' : S.it.some(isPaperId) ? 'Nhập tất cả quà (không giấy)' : 'Nhập tất cả đồ mưa nắng').setEmoji(EM.box).setStyle(ButtonStyle.Success),
    ...(brsOf(s).length ? [new ButtonBuilder().setCustomId(nhId(owner, 'allbr', t, sp)).setLabel('Nhập cả quầy & CN').setEmoji(EM.shop).setStyle(ButtonStyle.Success)] : []),
    new ButtonBuilder().setCustomId(nhId(owner, 'ref', t, sp)).setLabel('Làm mới').setEmoji(EM.refresh).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`hb:${owner}:nhap:go:home`).setLabel('Gian hàng').setEmoji(EM.shop).setStyle(ButtonStyle.Secondary)) });
  blocks.push(`-# ${EM.a} Justaseed • dữ liệu ${stamp(sv.at)}`);
  return layout(blocks, { files: [], attachments: [] });
}

async function nhOpen(i, uid, sv) {
  const s = sv.s;
  if ((s.ph || 'prep') !== 'prep') return say(i, `Chỉ nhập hàng được ở giai đoạn chuẩn bị (hiện: ${PHASE[s.ph] || s.ph}).`);
  return i.editReply(await nhLayout(i.user.id, uid, sv, -1, NH_SUP[0]));
}

// kiểm tra đúng chủ bảng + đã liên kết tài khoản; trả về uid hoặc null (đã phản hồi riêng tư)
async function nhGuard(i, owner) {
  if (i.user.id !== owner) { await i.reply({ ...layout(['Bảng nhập hàng này của người dùng lệnh. Hãy gõ lệnh nhập hàng của bạn nhé.']), flags: V2 | EPH }); return null; }
  const uid = await userIdOf(owner);
  if (!uid) { await i.reply({ ...layout([NOT_LINKED]), flags: V2 | EPH }); return null; }
  return uid;
}
const nhWarn = (i, text) => i.followUp({ ...layout([text]), flags: V2 | EPH });

// chạy lệnh nhập: web đang mở -> gửi cho game; web tắt -> bot sửa thẳng save đám mây. list: [{ si, id, q }]
async function nhExec(uid, t, list) {
  const bulk = list.length > 1;
  if (!(await gameOnline(uid))) {
    return store.edit(supabase, uid, (s2) => {
      if ((s2.ph || 'prep') !== 'prep') throw new Error('Chỉ nhập hàng được ở giai đoạn chuẩn bị');
      const m0 = s2.money, done = []; let err = null;
      for (const x of list) {
        try { done.push(engine.restockTo(s2, t, x.si, x.id, x.q)); } catch (e) { err = err || e; if (!bulk) throw e; }
      }
      if (!done.length) throw err || new Error('Không nhập được món nào');
      return bulk ? `Đã nhập ${done.length} ${bulk && !engine.F.some(f => f.id === list[0].id) ? 'mặt hàng' : 'loại hoa'} · -${vnd(m0 - s2.money)}` : done[0];
    });
  }
  const msgs = []; let err = null;
  for (const x of list) {
    try {
      if (t < 0) {
        const id = await enqueue(uid, 'restock', { si: x.si, id: x.id, q: x.q });
        const res = await waitAction(id);
        if (!res) throw new Error(QUEUED(id, 15));
        if (res.status !== 'done') throw new Error(clip(res.result, 300));
        msgs.push(clip(res.result, 300));
      } else {
        const r = await gameOp(uid, 'restock_br', { br: t + 1, si: x.si, id: x.id, q: x.q });
        if (r.queued) throw new Error(r.msg);
        msgs.push(r.msg);
      }
    } catch (e) { err = err || e; if (!bulk) throw e; }
  }
  if (!msgs.length) throw err || new Error('Không nhập được món nào');
  return bulk ? `Đã nhập ${msgs.length}/${list.length} ${engine.F.some(f => f.id === list[0].id) ? 'loại hoa' : 'mặt hàng'}` : msgs[0];
}

// Kế hoạch "nhập tất cả" cho cửa hàng chính + MỌI chi nhánh: tính tuần tự trên bản nháp để tiền trừ dần qua từng chi nhánh (không đụng save thật)
function planBranches(s, sp) {
  const c = JSON.parse(JSON.stringify(s));
  const list = []; let total = 0;
  [-1, ...brsOf(s).map((b, k) => k)].forEach((k) => { // -1 = cửa hàng chính, rồi lần lượt các chi nhánh
    let plan = null;
    try { plan = engine.planAll(c, k, sp); } catch (err) { plan = null; }
    if (!plan || !plan.items.length) return;
    list.push({ k, plan }); total += plan.total;
    c.money = Number.isFinite(plan.left) ? plan.left : (Number(c.money) || 0) - plan.total;
  });
  return { list, total, left: c.money };
}
// chạy nhập cho nhiều chi nhánh. list: [{ k, items: [{ id, q }] }]. Web tắt: một lần ghi save duy nhất; web mở: lần lượt từng chi nhánh qua game
async function nhExecBranches(uid, sp, list) {
  if (!(await gameOnline(uid))) {
    return store.edit(supabase, uid, (s2) => {
      if ((s2.ph || 'prep') !== 'prep') throw new Error('Chỉ nhập hàng được ở giai đoạn chuẩn bị');
      const m0 = s2.money, parts = []; let err = null;
      for (const { k, items } of list) {
        let n = 0;
        for (const x of items) { try { engine.restockTo(s2, k, sp, x.id, x.q); n++; } catch (er) { err = err || er; } }
        if (n) parts.push(`${EM.ok} ${tName(s2, k)}: ${n} ${supHasFlower(engine.SP[sp]) ? 'loại hoa' : 'mặt hàng'}`);
      }
      if (!parts.length) throw err || new Error('Không nhập được món nào');
      return `Đã nhập cho ${parts.length}/${list.length} nơi · -${vnd(m0 - s2.money)}\n${parts.join('\n')}`;
    });
  }
  const parts = []; let err = null;
  for (const { k, items } of list) {
    try { const m = await nhExec(uid, k, items.map(x => ({ si: sp, id: x.id, q: x.q }))); parts.push(`${EM.ok} ${k < 0 ? 'Cửa hàng chính' : 'CN ' + (k + 1)}: ${clip(m, 120)}`); }
    catch (er) { err = err || er; parts.push(`${EM.no} ${k < 0 ? 'Cửa hàng chính' : 'CN ' + (k + 1)}: ${clip(er.message || er, 120)}`); }
  }
  if (!parts.some(p => p.startsWith(EM.ok))) throw err || new Error('Không nhập được món nào');
  return `Đã chạy nhập cho ${list.length} nơi\n${parts.join('\n')}`;
}

// sau khi nhập xong: báo kết quả + gửi ảnh "Menu hôm nay" giống trang web
async function nhDone(i, uid, owner, t, sp, msg) {
  const sv = await loadFresh(uid);
  const s = sv.s; t = okT(s, t);
  let png = null;
  if (R) {
    try { png = await R.renderMenu(s, engine.menuRows(s, tStock(s, t)), { tag: t >= 0 ? tName(s, t) : '' }); }
    catch (e) { console.error('[extra] không vẽ được ảnh menu:', e.message); }
  }
  const hide = await hideBalOf(uid, s);
  return i.editReply(layout([
    H('Nhập hàng thành công', EM.ok),
    `${clip(msg, 700)}\n${EM.shop} **Kho của:** ${tName(s, t)}\n${EM.money} **Số dư:** ${hide ? '••••••' : vnd(sv.money)}`,
    png ? { sep: true } : null,
    png ? { img: 'attachment://menu.png' } : null,
    { row: new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(nhId(owner, 'back', t, sp)).setLabel('Nhập tiếp').setEmoji(EM.box).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`hb:${owner}:nhap:go:home`).setLabel('Gian hàng').setEmoji(EM.shop).setStyle(ButtonStyle.Secondary)) },
    `-# ${EM.a} ${clip(s.pf?.nm || s.name || 'Tiệm hoa', 40)} • dữ liệu ${stamp(sv.at)}`,
  ], { files: png ? [new AttachmentBuilder(png, { name: 'menu.png' })] : [], attachments: [] }));
}

// chọn hoa -> mở form nhập số lượng · chọn đích -> quay lại bảng chính
async function nhSelect(i) {
  const [, owner, act, tS, spS] = i.customId.split(':');
  const uid = await nhGuard(i, owner);
  if (!uid) return;
  const sp = okSup(parseInt(spS, 10));
  if (act === 'sel') {
    const id = i.values[0], f = engine.byId[id], S = engine.SP[sp];
    if (!f || !S.it.includes(id)) return i.reply({ ...layout(['Mặt hàng không hợp lệ.']), flags: V2 | EPH });
    let t = parseT(tS), hint = 'Nhập số lượng, hoặc gõ max để nhập tối đa';
    try {
      const sv = await loadSave(uid);
      if (sv) {
        t = okT(sv.s, t);
        if ((sv.s.ph || 'prep') !== 'prep') return i.reply({ ...layout([`Chỉ nhập hàng được ở giai đoạn chuẩn bị (hiện: ${PHASE[sv.s.ph] || sv.s.ph}).`]), flags: V2 | EPH });
        const rem = Math.max(0, S.cap - (tBought(sv.s, t)[String(sp) + id] || 0));
        hint = isPaperId(id) ? `Giá ${vnd(engine.price(sv.s, id, S.m))} · không giới hạn suất · gõ "max" để nhập tối đa`
          : `Giá ${vnd(engine.price(sv.s, id, S.m))} · còn ${rem} suất · gõ "max" để nhập tối đa`;
      }
    } catch (e) { /* vẫn mở form, chỉ thiếu gợi ý */ }
    const modal = new ModalBuilder().setCustomId(`nhm:${owner}:${encT(t)}:${sp}:${id}`).setTitle(clip(`Nhập ${f.n}`, 45))
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q').setLabel('Số lượng (1–200)')
        .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(8).setPlaceholder(clip(hint, 100))));
    return i.showModal(modal);
  }
  if (act === 'tsel') {
    await i.deferUpdate();
    const sv = await loadSave(uid);
    if (!sv) return i.editReply({ ...layout([NO_SAVE]), attachments: [] });
    return i.editReply(await nhLayout(owner, uid, sv, parseT(i.values[0]), sp));
  }
}

// gửi form số lượng -> nhập hàng
async function nhModal(i) {
  const [, owner, tS, spS, id] = i.customId.split(':');
  const uid = await nhGuard(i, owner);
  if (!uid) return;
  const sp = okSup(parseInt(spS, 10)), t = parseT(tS);
  const raw = String(i.fields.getTextInputValue('q') || '').trim();
  const w = stripVN(raw).replace(/\s+/g, '');
  const q = ['max', 'all', 'het', 'toida', 'tatca'].includes(w) ? 200 : parseInt(raw.replace(/[.,\s]/g, ''), 10);
  await i.deferUpdate();
  if (!(q >= 1 && q <= 200)) return nhWarn(i, `${EM.no} Số lượng phải từ 1 đến 200 (hoặc gõ \`max\`).`);
  if (daySessions.has(uid)) return nhWarn(i, 'Gian hàng đang bán, hãy đợi hết ngày rồi nhập hàng nhé.');
  if (busyUsers.has(uid)) return nhWarn(i, 'Bạn đang có một lệnh khác đang xử lý, đợi một chút nhé.');
  busyUsers.add(uid);
  try {
    const msg = await nhExec(uid, t, [{ si: sp, id, q }]);
    return await nhDone(i, uid, owner, t, sp, msg);
  } catch (e) { return nhWarn(i, `${EM.no} ${clip(e.message || e, 300)}`); }
  finally { busyUsers.delete(uid); }
}

// các nút: nhà cung cấp · chọn chi nhánh · nhập tất cả (+ xác nhận) · làm mới · quay lại
async function nhButton(i) {
  const [, owner, act, tS, spS] = i.customId.split(':');
  const uid = await nhGuard(i, owner);
  if (!uid) return;
  let sp = okSup(parseInt(spS, 10)), t = parseT(tS);

  if (act === 'br') {
    const sv0 = await loadSave(uid);
    if (sv0 && !brsOf(sv0.s).length) return i.reply({ ...layout(['Bạn chưa mở chi nhánh nào. Vào tab Chi nhánh trong game để mở chi nhánh đầu tiên.']), flags: V2 | EPH });
  }
  await i.deferUpdate();
  const fresh = act === 'ref' || act === 'allok' || act === 'allbrok';
  const sv = await (fresh ? loadFresh(uid) : loadSave(uid));
  if (!sv) return i.editReply({ ...layout([NO_SAVE]), attachments: [] });
  const s = sv.s;
  t = okT(s, t);
  if ((s.ph || 'prep') !== 'prep') return i.editReply({ ...layout([`Chỉ nhập hàng được ở giai đoạn chuẩn bị (hiện: ${PHASE[s.ph] || s.ph}).`]), attachments: [], files: [] });

  if (act === 'sup') return i.editReply(await nhLayout(owner, uid, sv, t, sp));
  if (act === 'ref' || act === 'back') return i.editReply(await nhLayout(owner, uid, sv, t, sp));

  if (act === 'br') { // chọn nơi nhập: quầy chính hoặc một chi nhánh
    const cnt = (st) => `Kho: ${engine.F.reduce((a, f) => a + (st[f.id] || 0), 0)} hoa · ${['S', 'M', 'L'].reduce((a, k) => a + (st[k] || 0), 0)} giấy`;
    const opts = [new StringSelectMenuOptionBuilder().setValue('m').setLabel('Cửa hàng chính').setDescription(cnt(s.st || {})).setEmoji(EM.shop).setDefault(t < 0)];
    brsOf(s).forEach((b, k) => opts.push(new StringSelectMenuOptionBuilder().setValue(String(k)).setLabel(clip(`CN ${k + 1} · ${b.n}`, 100)).setDescription(cnt(b.st || {})).setEmoji(EM.box).setDefault(t === k)));
    return i.editReply(layout([
      `${H('Chọn chi nhánh', EM.shop)}\n-# ${EM.a} Chọn nơi sẽ nhận hàng nhập`,
      { row: new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(nhId(owner, 'tsel', t, sp)).setPlaceholder('Chọn nơi nhập hàng').addOptions(opts)) },
      { row: new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(nhId(owner, 'back', t, sp)).setLabel('Quay lại').setEmoji(EM.left).setStyle(ButtonStyle.Secondary)) },
    ], { files: [], attachments: [] }));
  }

  if (act === 'all') { // xem trước rồi xác nhận, tránh lỡ tay tiêu hết tiền
    const plan = engine.planAll(s, t, sp);
    if (!plan.items.length) return nhWarn(i, `${EM.no} Không nhập thêm được: đã hết suất hoặc không đủ tiền.`);
    const hide = await hideBalOf(uid, s);
    return i.editReply(layout([
      `${H('Nhập tất cả', EM.box)}\n-# ${EM.a} ${tName(s, t)} · ${engine.SP[sp].n}`,
      plan.items.map(x => `${itemEmoji(x.id)} ${engine.byId[x.id].n} × **${x.q}** · ${vnd(x.q * x.pr)}`).join('\n'),
      { sep: true },
      `${EM.money} **Tổng:** ${vnd(plan.total)}${hide ? '' : ` · còn lại ${vnd(plan.left)}`}\n-# Nhập tối đa theo suất còn lại và số tiền hiện có, lần lượt từng mặt hàng.${engine.SP[sp].it.some(isPaperId) && !supHasFlower(engine.SP[sp]) ? ' Không mua giấy gói.' : ''}`,
      { row: new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(nhId(owner, 'allok', t, sp)).setLabel('Xác nhận nhập').setEmoji(EM.ok).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(nhId(owner, 'back', t, sp)).setLabel('Hủy').setEmoji(EM.no).setStyle(ButtonStyle.Secondary)) },
    ], { files: [], attachments: [] }));
  }

  if (act === 'allbr') { // xem trước kế hoạch cho tất cả chi nhánh rồi xác nhận
    if (!brsOf(s).length) return nhWarn(i, 'Bạn chưa mở chi nhánh nào.');
    const pb = planBranches(s, sp);
    if (!pb.list.length) return nhWarn(i, `${EM.no} Không nhập thêm được cho chi nhánh nào: đã hết suất hoặc không đủ tiền.`);
    const hide = await hideBalOf(uid, s);
    const skipped = brsOf(s).length + 1 - pb.list.length;
    return i.editReply(layout([
      `${H('Nhập tất cả quầy & chi nhánh', EM.box)}\n-# ${EM.a} ${engine.SP[sp].n} · ${pb.list.length}/${brsOf(s).length + 1} nơi nhập được`,
      pb.list.map(({ k, plan }) => `${EM.shop} **${tName(s, k)}** · ${plan.items.length} loại · ${plan.items.reduce((a, x) => a + x.q, 0)} ${supHasFlower(engine.SP[sp]) ? 'hoa' : 'món'} · ${vnd(plan.total)}`).join('\n'),
      { sep: true },
      `${EM.money} **Tổng:** ${vnd(pb.total)}${hide ? '' : ` · còn lại ${vnd(pb.left)}`}\n-# Mỗi chi nhánh nhập như nút **Nhập tất cả** (tối đa theo suất còn lại), lần lượt từ cửa hàng chính rồi chi nhánh 1, 2…; tiền hết thì các nơi sau nhập ít hơn hoặc bỏ qua.${skipped ? ` ${skipped} nơi đã hết suất hoặc không đủ tiền nên bị bỏ qua.` : ''}`,
      { row: new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(nhId(owner, 'allbrok', t, sp)).setLabel('Xác nhận nhập tất cả').setEmoji(EM.ok).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(nhId(owner, 'back', t, sp)).setLabel('Hủy').setEmoji(EM.no).setStyle(ButtonStyle.Secondary)) },
    ], { files: [], attachments: [] }));
  }

  if (act === 'allbrok') {
    if (daySessions.has(uid)) return nhWarn(i, 'Gian hàng đang bán, hãy đợi hết ngày rồi nhập hàng nhé.');
    if (busyUsers.has(uid)) return nhWarn(i, 'Bạn đang có một lệnh khác đang xử lý, đợi một chút nhé.');
    const pb = planBranches(s, sp);
    if (!pb.list.length) return nhWarn(i, `${EM.no} Không nhập thêm được: đã hết suất hoặc không đủ tiền.`);
    busyUsers.add(uid);
    try {
      const msg = await nhExecBranches(uid, sp, pb.list.map(({ k, plan }) => ({ k, items: plan.items.map(x => ({ id: x.id, q: x.q })) })));
      const sv2 = await loadFresh(uid), hide = await hideBalOf(uid, sv2.s);
      return await i.editReply(layout([
        H('Nhập hàng thành công', EM.ok),
        `${clip(msg, 1800)}\n${EM.money} **Số dư:** ${hide ? '••••••' : vnd(sv2.money)}`,
        { row: new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(nhId(owner, 'back', t, sp)).setLabel('Nhập tiếp').setEmoji(EM.box).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`hb:${owner}:nhap:go:home`).setLabel('Gian hàng').setEmoji(EM.shop).setStyle(ButtonStyle.Secondary)) },
        `-# ${EM.a} ${clip(sv2.s.pf?.nm || sv2.s.name || 'Tiệm hoa', 40)} • dữ liệu ${stamp(sv2.at)}`,
      ], { files: [], attachments: [] }));
    } catch (er) { return nhWarn(i, `${EM.no} ${clip(er.message || er, 300)}`); }
    finally { busyUsers.delete(uid); }
  }

  if (act === 'allok') {
    if (daySessions.has(uid)) return nhWarn(i, 'Gian hàng đang bán, hãy đợi hết ngày rồi nhập hàng nhé.');
    if (busyUsers.has(uid)) return nhWarn(i, 'Bạn đang có một lệnh khác đang xử lý, đợi một chút nhé.');
    const plan = engine.planAll(s, t, sp);
    if (!plan.items.length) return nhWarn(i, `${EM.no} Không nhập thêm được: đã hết suất hoặc không đủ tiền.`);
    busyUsers.add(uid);
    try {
      const msg = await nhExec(uid, t, plan.items.map(x => ({ si: sp, id: x.id, q: x.q })));
      return await nhDone(i, uid, owner, t, sp, msg);
    } catch (e) { return nhWarn(i, `${EM.no} ${clip(e.message || e, 300)}`); }
    finally { busyUsers.delete(uid); }
  }
}

// ---------------- đăng ký ----------------
const commands = [
  new SlashCommandBuilder().setName('profile').setDescription('Xem profile Justaseed (ping người khác để xem của họ)')
    .addUserOption(o => o.setName('nguoi').setDescription('Người chơi muốn xem, bỏ trống là của bạn')),
  new SlashCommandBuilder().setName('daily').setDescription('Nhận tiền thưởng hằng ngày trong game'),
  new SlashCommandBuilder().setName('tien').setDescription('Xem số dư và số thẻ ngân hàng trong game'),
  new SlashCommandBuilder().setName('chuyentien').setDescription('Chuyển tiền trong game cho người chơi khác')
    .addIntegerOption(o => o.setName('sotien').setDescription(`Từ ${MIN_T} đến ${MAX_T}`).setRequired(true).setMinValue(MIN_T).setMaxValue(MAX_T))
    .addUserOption(o => o.setName('nguoi').setDescription('Người nhận (ping)'))
    .addStringOption(o => o.setName('sothe').setDescription('Hoặc số thẻ ngân hàng 16 số của người nhận').setMaxLength(24))
    .addStringOption(o => o.setName('loinhan').setDescription('Lời nhắn (tùy chọn)').setMaxLength(60)),
  new SlashCommandBuilder().setName('workshop').setDescription('Xem tiến độ các mẻ workshop đang làm'),
  new SlashCommandBuilder().setName('vang').setDescription('Xem tiến độ gia công vàng ở Tiệm vàng'),
  new SlashCommandBuilder().setName('chinhanh').setDescription('Xem tiến trình và kho của các chi nhánh'),
  new SlashCommandBuilder().setName('gianhang').setDescription('Quản lý gian hàng ngay trên Discord')
    .addSubcommand(c => c.setName('trangthai').setDescription('Xem trạng thái gian hàng'))
    .addSubcommand(c => c.setName('mo').setDescription('Mở gian hàng bán hàng, bán đến khi hết giờ hoặc hết hàng')
      .addStringOption(o => o.setName('thoigian').setDescription('Thời gian bán (bỏ trống = như đang chọn trong game)')
        .addChoices({ name: '4 phút', value: '240' }, { name: '8 phút', value: '480' }, { name: '15 phút', value: '900' },
          { name: '30 phút (cấp 20)', value: '1800' }, { name: '1 giờ (cấp 50)', value: '3600' })))
    .addSubcommand(c => c.setName('ngaymoi').setDescription('Sang ngày mới sau khi xem tổng kết'))
    .addSubcommand(c => c.setName('nhaphang').setDescription('Nhập hàng: chọn loại hoa, chi nhánh và số lượng'))
    .addSubcommand(c => c.setName('thuenv').setDescription('Thuê nhân viên')
      .addStringOption(o => o.setName('loai').setDescription('Gói thuê').setRequired(true)
        .addChoices({ name: 'Theo ngày (500.000đ)', value: 'ngay' }, { name: 'Theo tháng (10.000.000đ, cần cấp 20)', value: 'thang' }))),
  new SlashCommandBuilder().setName('help').setDescription('Hướng dẫn sử dụng bot Justaseed'),
].map(c => c.toJSON());

async function handle(i) {
  try {
    if (i.isAutocomplete() && i.commandName === 'gianhang') return await autoShop(i);
    if (i.isStringSelectMenu() && i.customId.startsWith('hp:')) return await selHelp(i);
    if (i.isStringSelectMenu() && i.customId.startsWith('hb:')) return await hub.handle(i);
    if (i.isModalSubmit() && i.customId.startsWith('hbm:')) return await hub.handle(i);
    if (i.isStringSelectMenu() && i.customId.startsWith('nh:')) return await nhSelect(i);
    if (i.isModalSubmit() && i.customId.startsWith('nhm:')) return await nhModal(i);
    if (i.isButton()) {
      if (i.customId.startsWith('hb:')) return await hub.handle(i);
      if (i.customId.startsWith('nh:')) return await nhButton(i);
      if (i.customId.startsWith('tf:')) return await btnTransfer(i);
      if (i.customId.startsWith('pg:')) return await btnProgress(i);
      if (i.customId.startsWith('br:')) return await btnBranch(i);
      if (i.customId.startsWith('ds:')) return await btnDay(i);
      return;
    }
    if (!i.isChatInputCommand()) return;
    switch (i.commandName) {
      case 'help': return await i.reply(helpLayout('home', i.user.id));
      case 'profile': return await cmdProfile(i);
      case 'daily': return await cmdDaily(i);
      case 'tien': return await cmdMoney(i);
      case 'chuyentien': return await cmdTransfer(i);
      case 'workshop': return await cmdProgress(i, 'ws');
      case 'vang': return await cmdProgress(i, 'gd');
      case 'chinhanh': return await cmdProgress(i, 'br');
      case 'gianhang': return await cmdShop(i);
    }
  } catch (err) {
    console.error('[extra] lỗi lệnh', i.commandName || i.customId, err);
    try {
      const msg = 'Có lỗi xảy ra, thử lại sau nhé.';
      if (i.deferred || i.replied) await i.editReply({ ...layout([msg]), attachments: [] });
      else if (i.isRepliable()) await i.reply({ ...layout([msg]), flags: V2 | E });
    } catch (e) { /* bỏ qua */ }
  }
}

// ---------------- lệnh dùng PREFIX (vd: j!daily) ----------------
// Cần bật Message Content Intent trong Developer Portal. Đổi prefix bằng biến môi trường PREFIX (mặc định "j!").
// Mọi lệnh trả lời công khai tại kênh dùng lệnh. Riêng /qr là riêng tư: dạng prefix thì bot gửi qua tin nhắn riêng (DM).
const PREFIX = process.env.PREFIX || 'j!';
const prefixCommands = {}; // file khác có thể thêm lệnh: prefixCommands.qr = async (i) => {...}
const stripVN = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const reactOf = (e) => { const m = /^<a?:(\w+:\d+)>$/.exec(e); return m ? m[1] : e; };

// giả lập "interaction" từ một tin nhắn để dùng lại toàn bộ lệnh slash
function prefixCtx(msg, commandName, o = {}) {
  let sent = null, priv = false, dmFail = false, notified = false, ack = null;
  const unack = () => { if (ack) { const a = ack; ack = null; a.then(r => r && r.users.remove(client.user.id)).catch(() => {}); } };
  const clean = (p) => { const d = { ...p }; if (d.flags !== undefined) d.flags = Number(d.flags) & ~Number(E); return d; };
  const send = async (p, toPriv) => {
    const d = clean(p);
    if (toPriv) {
      if (dmFail) return null;
      try {
        const m = await msg.author.send(d);
        if (!notified) { notified = true; msg.react(reactOf(EM.ok)).catch(() => {}); }
        return m;
      } catch (e) {
        dmFail = true;
        await msg.reply({ ...layout([`${EM.no} Mình không nhắn riêng được cho bạn. Hãy bật nhận tin nhắn riêng từ thành viên server, hoặc dùng lệnh slash \`/${commandName}\`.`]), failIfNotExists: false }).catch(() => {});
        return null;
      }
    }
    try { return await msg.reply({ ...d, failIfNotExists: false }); } finally { unack(); }
  };
  const ctx = {
    commandName, user: msg.author, member: msg.member, guild: msg.guild, channel: msg.channel,
    msg, args: o.args || [],
    deferred: false, replied: false,
    options: {
      getUser: (n) => (o.users || {})[n] || null,
      getString: (n) => (o.strings || {})[n] ?? null,
      getInteger: (n) => (o.ints || {})[n] ?? null,
      getSubcommand: () => o.sub || null,
    },
    isChatInputCommand: () => true, isButton: () => false, isAutocomplete: () => false, isRepliable: () => true,
    async deferReply(p = {}) {
      priv = !!((Number(p.flags) & Number(E)) || p.ephemeral);
      ctx.deferred = true;
      if (process.env.PREFIX_ACK !== '0' && !ack) ack = msg.react('⏳').catch(() => null); // báo đã nhận lệnh ngay lập tức
      // không gọi sendTyping(): không hiện dòng "đang soạn tin nhắn"
    },
    async reply(p) { ctx.replied = true; sent = await send(p, !!(Number(p.flags) & Number(E))); return sent; },
    async editReply(p) {
      if (sent) return sent.edit(clean(p));
      ctx.replied = true; sent = await send(p, priv); return sent;
    },
    async followUp(p) { return send(p, !!(Number(p.flags) & Number(E))); },
    async deleteReply() { if (sent) { await sent.delete().catch(() => {}); sent = null; } },
  };
  return ctx;
}

const parseMoney = (t) => {
  const m = /^(\d[\d.,]*)([kKmM]?)$/.exec(String(t || ''));
  if (!m) return null;
  const n = Number(m[1].replace(/[.,]/g, ''));
  return Math.round(n * (/k/i.test(m[2]) ? 1e3 : /m/i.test(m[2]) ? 1e6 : 1));
};

// ---------------- /help (layout + select chọn danh mục) ----------------
const money0 = (n) => Math.round(n).toLocaleString('vi-VN');
const EXTRA_HELP = {};
function helpPages() {
  const pages = helpPagesBase();
  for (const [k, v] of Object.entries(EXTRA_HELP)) {
    pages[k] = { label: v.label, desc: v.desc, emoji: v.emoji(), title: v.title, ico: v.ico(), body: v.body() };
    pages.home.body += `\n${v.emoji()} **${v.label}** — ${v.desc}`;
  }
  return pages;
}
function helpPagesBase() {
  const p = PREFIX, a = EM.a, b = EM.b;
  return {
    home: {
      label: 'Tổng quan', desc: 'Giới thiệu và danh sách mục', emoji: EM.help,
      title: 'Hướng dẫn Justaseed', ico: EM.help,
      body: [
        `${EM.deco} Dùng lệnh dạng **\`${p}lệnh\`** hoặc **\`/lệnh\`**, kết quả giống nhau.`,
        `${EM.tip} Chọn một mục trong menu bên dưới để xem chi tiết.`,
        '',
        `${EM.person} **Tài khoản** — profile, daily, QR khôi phục`,
        `${EM.card} **Tiền & chuyển khoản** — số dư, chuyển tiền`,
        `${EM.star} **Một ngày chơi** — làm gì theo thứ tự, từ nhập hàng đến sang ngày mới`,
        `${EM.shop} **Gian hàng** — mở bán, nhập hàng, thuê nhân viên`,
        `${EM.wait} **Lúc đang bán** — web mở hay tắt thì bot làm gì, lệnh nào bị chặn`,
        `${EM.money} **Kiếm thêm & phát triển** — thưởng, nâng cấp, chi nhánh, ngân hàng, trang trí`,
        `${EM.ws} **Tiến độ** — workshop, gia công vàng, chi nhánh`,
        `${EM.heart} **Relationship** — card, sơ đồ, điểm danh cùng nhau, nhiệm vụ`,
        `${EM.tip} **Lưu ý** — hoa hỏng qua đêm, liên kết tài khoản, tin nhắn riêng`,
      ].join('\n'),
    },
    day: {
      label: 'Một ngày chơi', desc: 'Các bước theo thứ tự trong một ngày', emoji: EM.star,
      title: 'Một ngày chơi', ico: EM.star,
      body: [
        `${a} **1. Xem tình hình** — \`${p}gianhang\` mở bảng điều khiển: giai đoạn, số dư, nhân viên, kho, kèm nút Nhập hàng, Mở bán, Thuê nhân viên, Sang ngày mới. \`${p}tuido\` xem kho chi tiết.`,
        `${b} **2. Nhập hàng** (chỉ làm được ở giai đoạn chuẩn bị) — \`${p}gianhang nhaphang\` mở bảng nhập: chọn nhà cung cấp, loại hoa rồi điền số lượng, hoặc bấm **Nhập tất cả**.\n` +
          `• Mỗi bó cần **hoa + giấy gói**. Giấy S, M, L ở nhà cung cấp số 3, hoa ở số 1 hoặc 2.\n` +
          `• Mỗi mặt hàng có **giới hạn suất nhập mỗi ngày**. Hoa theo mùa; hoa hiếm phải mở khóa bằng \`${p}nangcap mokhoa <hoa>\`.`,
        `${a} **3. Chỉnh giá** (tùy chọn) — \`${p}giaban\` để xem. Đặt một món: \`${p}giaban dat hồng M 120k\`. Đặt lãi chung: \`${p}giaban loinhuan 30\`. Về mặc định: \`${p}giaban macdinh\`.\n` +
          `Giá thấp nhất bằng giá vốn, cao nhất +30% so với giá gợi ý.`,
        `${b} **4. Nhân viên** (tùy chọn) — \`${p}gianhang thuenv ngay\` (500.000đ, cần cấp 10) hoặc \`${p}gianhang thuenv thang\` (10 triệu, cần cấp 20). Nhân viên phục vụ nhanh hơn nên ít khách bỏ đi hơn.`,
        `${a} **5. Mở bán** — \`${p}gianhang mo 8\` (hoặc 4, 15, 30, 60). 30 phút cần cấp 20, 1 giờ cần cấp 50. Ngày bán dừng khi hết giờ, hết hàng hoặc bạn bấm **Đóng quầy sớm**.`,
        `${b} **6. Sang ngày mới** — bán xong thì gõ \`${p}gianhang ngaymoi\`, rồi quay lại bước 2.`,
        `${EM.tip} Cần có **đủ cả hoa và giấy** thì mới mở bán được.`,
      ].join('\n\n'),
    },
    acc: {
      label: 'Tài khoản', desc: 'Profile, daily, QR khôi phục', emoji: EM.person,
      title: 'Tài khoản', ico: EM.person,
      body: [
        `${a} **\`${p}profile [@người]\`** · \`/profile\`\nXem ảnh profile của bạn hoặc của người được ping.`,
        `${b} **\`${p}daily\`** · \`/daily\`\nNhận thưởng mỗi ngày (0 giờ sáng giờ Việt Nam). Ngày đầu **${vnd(DAILY_BASE)}**, mỗi ngày liên tiếp cộng thêm **${vnd(DAILY_STEP)}**, tối đa ${DAILY_MAXDAYS} ngày.`,
        `${a} **\`${p}qr\`** · \`/qr\`\nNhận mã QR khôi phục tiến trình (tạo QR trong game rồi bấm "Gửi qua Discord" trước).`,
      ].join('\n\n'),
    },
    money: {
      label: 'Tiền & chuyển khoản', desc: 'Số dư, số thẻ, chuyển tiền', emoji: EM.card,
      title: 'Tiền & chuyển khoản', ico: EM.card,
      body: [
        `${a} **\`${p}tien\`** · \`/tien\`\nXem số dư và số thẻ ngân hàng trong game.`,
        `${b} **\`${p}chuyentien <số tiền> <@người | số thẻ> [lời nhắn]\`**\nVí dụ: \`${p}chuyentien 100k @ten cảm ơn nhé\` hoặc \`${p}chuyentien 500000 1234 5678 9012 3456\`.\nSố tiền mỗi lần từ **${vnd(MIN_T)}** đến **${vnd(MAX_T)}**, nhập được dạng \`100k\`, \`2m\`, \`1.500.000\`. Bot sẽ hỏi xác nhận bằng nút trước khi chuyển.`,
      ].join('\n\n'),
    },
    shop: {
      label: 'Gian hàng', desc: 'Mở bán, nhập hàng, thuê nhân viên', emoji: EM.shop,
      title: 'Gian hàng', ico: EM.shop,
      body: [
        `${a} **\`${p}gianhang\`** — mở **bảng điều khiển gian hàng**: một tin nhắn gom tất cả tính năng. Chọn mục ở menu trên cùng (Tổng quan, Nhập hàng, Giá bán, Nhân viên, Nâng cấp, Nhiệm vụ, Thành tích, Thú cưng, Nội thất, Ngân hàng, Túi đồ, Thống kê), mỗi mục có nút thao tác ngay bên dưới. Các lệnh riêng bên dưới vẫn dùng được.`,
        `${b} **\`${p}gianhang mo [4|8|15|30|60]\`** — mở bán đúng thời gian như trên web (4, 8, 15 phút; 30 phút cấp 20; 1 giờ cấp 50). Bán đến khi hết giờ hoặc hết hàng. Web tắt thì bot bán thay bạn theo thời gian thật, báo tiến độ trong kênh và có nút Đóng quầy sớm.\n${a} **\`${p}gianhang ngaymoi\`** — sang ngày mới sau tổng kết.`,
        `${a} **\`${p}gianhang thuenv ngay\`** — thuê nhân viên theo ngày (500.000đ).\n${a} **\`${p}gianhang thuenv thang\`** — thuê theo tháng (10.000.000đ, cần cấp 20).`,
        `${b} **\`${p}gianhang nhaphang\`**\nMở bảng nhập hàng: chọn loại hoa (có icon, số đang bán, số trong kho) rồi điền số lượng. Chọn nhà cung cấp 1-4 bằng nút (số 3 bán giấy gói và quà, số 4 bán áo mưa và dù). Có nút **Nhập tất cả** (chỉ ở nhà cung cấp hoa), nút **Chọn chi nhánh** để nhập cho một chi nhánh, nút **Nhập cả quầy & CN** để nhập cho cửa hàng chính và mọi chi nhánh cùng lúc (có bước xem trước và xác nhận), và sau khi nhập bot gửi ảnh menu như trên web (chỉ nhập được ở giai đoạn chuẩn bị).`,
        `${EM.tip} Xem kho: \`${p}tuido\` · Chỉnh giá bán: \`${p}giaban\` · Mở khóa hoa: \`${p}nangcap mokhoa <hoa>\`. Chi tiết từng bước ở mục **Một ngày chơi**.`,
        `**Nhà cung cấp** (số 1-4):\n` + SUPPLIERS.map((x, n) => `-# ${n + 1}. ${x.n}: ${x.items.map(k => NAMES[k]).join(', ')}`).join('\n'),
      ].join('\n\n'),
    },
    sell: {
      label: 'Lúc đang bán', desc: 'Web mở/tắt, lệnh bị chặn', emoji: EM.wait,
      title: 'Lúc đang bán', ico: EM.wait,
      body: [
        `${a} **Web đang mở** — game tự bán, bạn giữ tab mở. Bot chỉ đăng tin tiến độ trong kênh.`,
        `${b} **Web tắt** — bot bán thay bạn theo thời gian thật và cập nhật tiến độ mỗi 15 giây. **Đừng mở web trong lúc này**, vì kết quả ngày đó có thể bị hủy.`,
        `${a} **Lệnh bị chặn** — khi đang bán, các lệnh đổi dữ liệu (nhập hàng, giá, nâng cấp...) bị chặn cho đến khi hết ngày. Lệnh xem (\`${p}gianhang\`, \`${p}tuido\`, \`${p}giaban\`, \`${p}thongke\`...) vẫn dùng được.`,
        `${b} **Đóng quầy sớm** — bấm nút dưới tin nhắn tiến độ nếu muốn dừng trước khi hết giờ.`,
        `${EM.tip} Bán xong, gõ \`${p}gianhang ngaymoi\` để sang ngày mới.`,
      ].join('\n\n'),
    },
    grow: {
      label: 'Kiếm thêm & phát triển', desc: 'Thưởng, nâng cấp, chi nhánh, ngân hàng', emoji: EM.money,
      title: 'Kiếm thêm & phát triển', ico: EM.money,
      body: [
        `${a} **Thưởng** — \`${p}daily\` mỗi ngày · \`${p}nhiemvu nhan\` (nhận hết nhiệm vụ đã xong) · \`${p}nhiemvu nhanh\` (nhiệm vụ nhanh) · \`${p}nhiemvu lammoi\` (làm mới nhiệm vụ nhanh, miễn phí 1 lần mỗi ngày game) · \`${p}thanhtuu nhan\`.`,
        `${b} **Nâng cấp** — \`${p}nangcap quay\` (quầy xịn, cấp quầy tối đa = cấp độ ÷ 2) · \`${p}nangcap vip\` (+4% khách VIP mỗi cấp) · \`${p}nangcap mokhoa <hoa>\` (mở khóa hoa hiếm). Xem giá bằng \`${p}nangcap\`.`,
        `${a} **Mở rộng** — \`${p}nhanvien tuyen\` tuyển nhân viên cố định (tối đa 6), \`${p}nhanvien nangcap <số>\` nâng cấp nhân viên. \`${p}quanlycn mo\` mở chi nhánh, \`${p}quanlycn nangcap <số>\` nâng cấp chi nhánh. Xem tiến trình chi nhánh bằng \`${p}chinhanh\`.`,
        `${b} **Tiết kiệm** — gửi: \`${p}nganhang gui vietcombank 12 5m\` (ngân hàng, kỳ hạn tháng, số tiền; tối thiểu 100.000đ) · rút: \`${p}nganhang rut <số>\`. Rút trước hạn chỉ nhận lãi 0,1%/năm, thêm \`rutsom\` để đồng ý. Xem lãi suất bằng \`${p}nganhang\`.`,
        `${a} **Trang trí** — \`${p}thucung nhannuoi <mèo|chó>\` (200.000đ), \`${p}thucung cham <mèo|chó> <vuốt ve|chơi|cho ăn>\` · \`${p}noithat mua <món>\`, \`${p}noithat bay <món>\`. Nội thất tăng tỉ lệ khách VIP.`,
        `${a} **Khoe ảnh** — \`${p}khoe ngay\` (ảnh tổng kết ngày) · \`${p}khoe workshop\` (ảnh món workshop), bấm **Khoe lên kênh** để đăng cho cả server.`,
        `${b} **Theo dõi** — \`${p}thongke\` (doanh thu và chi tiêu) · \`${p}workshop\` · \`${p}vang\` · \`${p}tien\` · \`${p}help\`.`,
        `${EM.tip} Muốn xem nhanh cú pháp từng lệnh thì vào mục **Quản lý tiệm**.`,
      ].join('\n\n'),
    },
    prog: {
      label: 'Tiến độ', desc: 'Workshop, vàng và chi nhánh', emoji: EM.ws,
      title: 'Tiến độ', ico: EM.ws,
      body: [
        `${a} **\`${p}workshop\`** · \`/workshop\`\nXem tiến độ các mẻ workshop đang làm.`,
        `${b} **\`${p}vang\`** · \`/vang\`\nXem tiến độ gia công vàng ở Tiệm vàng.`,
        `${a} **\`${p}chinhanh\`** · \`/chinhanh\` (\`${p}cn\`)\nXem tiến trình bán hàng và kho của từng chi nhánh.`,
        `${EM.refresh} Bấm nút **Làm mới** dưới tin nhắn để cập nhật tiến độ.`,
      ].join('\n\n'),
    },
    rel: {
      label: 'Relationship', desc: 'Card, sơ đồ, điểm danh, nhiệm vụ', emoji: EM.heart,
      title: 'Relationship', ico: EM.heart,
      body: [
        `${a} Tạo relationship trong game: **Cộng đồng → Bạn bè**, bấm nút ${EM.heart} cạnh một người bạn, chọn loại (bạn thân, anh em, chị em, iu dấu, lốp xe tăng...) rồi chờ bạn ấy chấp nhận.`,
        `${b} **\`${p}rel card [@người]\`** · \`/relationship card\`\nXem card relationship: ảnh hai người, biểu tượng + tên loại, số ngày bên nhau, cấp và thanh XP.`,
        `${a} **\`${p}rel sodo\`** · \`/relationship sodo\`\nXem sơ đồ các relationship của bạn.`,
        `${b} **\`${p}rel daily [@người]\`** · \`/relationship daily\`\nĐiểm danh cùng nhau. Hai người cùng điểm danh trong ngày sẽ nhận thêm XP và giữ chuỗi.`,
        `${a} **\`${p}rel nhiemvu [@người]\`** · \`/relationship nhiemvu\`\nXem nhiệm vụ ngày/tuần của relationship và nhận thưởng XP.`,
        `${b} **\`${p}rel ds\`** — danh sách relationship của bạn.`,
        `${EM.tip} XP còn tăng khi **tặng quà**, **mua đồ ở sạp của nhau**, **ký tường**, **thăm nhà** (làm trong game). Bấm **Khoe lên kênh** để đăng card hoặc sơ đồ lên kênh chung.`,
      ].join('\n\n'),
    },
    tips: {
      label: 'Lưu ý', desc: 'Hoa hỏng, liên kết tài khoản, tin nhắn riêng', emoji: EM.tip,
      title: 'Lưu ý', ico: EM.tip,
      body: [
        `${b} **Hoa dư hỏng khoảng 60% qua đêm**, còn giấy và quà thì giữ được. Đừng nhập quá nhiều hoa.`,
        `${a} Phải có **đủ cả hoa và giấy** thì mới mở bán được.`,
        `${a} Cần vào game, **đăng nhập bằng Discord** và chơi một lúc để tiến trình được lưu lên đám mây, bot mới đọc được dữ liệu của bạn.`,
        `${b} Với lệnh dạng \`${p}\`, bot trả lời ngay tại kênh bạn dùng lệnh. Riêng **qr** được gửi qua **tin nhắn riêng**, hãy bật nhận tin nhắn riêng từ thành viên server.`,
        `${a} Mỗi lúc chỉ chạy một lệnh gian hàng, hãy đợi lệnh trước xong rồi dùng tiếp.`,
        `${b} Nhiều lệnh cần game đang mở để xử lý; nếu chưa kịp, lệnh sẽ chạy ngay khi bạn mở game.`,
      ].join('\n\n'),
    },
  };
}
function helpLayout(cat = 'home', owner = '0') {
  const pages = helpPages();
  const pg = pages[cat] || pages.home;
  const select = new StringSelectMenuBuilder()
    .setCustomId(`hp:${owner}`)
    .setPlaceholder('Chọn danh mục để xem lệnh')
    .addOptions(Object.entries(pages).map(([k, v]) =>
      new StringSelectMenuOptionBuilder().setValue(k).setLabel(v.label).setDescription(v.desc).setEmoji(v.emoji).setDefault(k === cat)));
  return layout([
    H(pg.title, pg.ico),
    { sep: true },
    pg.body,
    { sep: true },
    { row: new ActionRowBuilder().addComponents(select) },
    { row: linkRow() },
    `-# ${EM.a} Justaseed • prefix \`${PREFIX}\``,
  ]);
}
async function selHelp(i) {
  const owner = i.customId.split(':')[1];
  if (owner !== '0' && i.user.id !== owner) return i.reply({ ...layout(['Menu này của người dùng lệnh. Hãy gõ lệnh help để mở menu riêng của bạn.']), flags: V2 | EPH });
  return i.update(helpLayout(i.values[0], owner));
}

async function userFrom(msg, token) {
  const id = (/^<@!?(\d{17,20})>$/.exec(token || '') || /^(\d{17,20})$/.exec(token || '') || [])[1];
  if (!id) return null;
  return msg.mentions.users.get(id) || (await client.users.fetch(id).catch(() => null));
}

async function onMessage(msg) {
  if (msg.author.bot || !msg.inGuild() || msg.content.slice(0, PREFIX.length).toLowerCase() !== PREFIX.toLowerCase()) return;
  const parts = msg.content.slice(PREFIX.length).trim().split(/\s+/).filter(Boolean);
  const cmd = stripVN(parts.shift() || '');
  if (!cmd) return;
  const args = parts;
  let name = null, o = {}, run = null;
  const usage = (t) => msg.reply({ ...layout([`${EM.no} ${t}`]), failIfNotExists: false }).catch(() => {});

  try {
    if (['help', 'lenh', 'h'].includes(cmd)) return void msg.reply({ ...helpLayout('home', msg.author.id), failIfNotExists: false });
    if (['profile', 'p', 'hoso'].includes(cmd)) {
      name = 'profile'; run = cmdProfile;
      if (args[0]) { const u = await userFrom(msg, args[0]); if (!u) return usage(`Cú pháp: \`${PREFIX}profile [@người]\``); o.users = { nguoi: u }; }
    } else if (['daily', 'diemdanh'].includes(cmd)) { name = 'daily'; run = cmdDaily; }
    else if (['tien', 'vi', 'money', 'bal'].includes(cmd)) { name = 'tien'; run = cmdMoney; }
    else if (['workshop', 'ws'].includes(cmd)) { name = 'workshop'; run = (i) => cmdProgress(i, 'ws'); }
    else if (['vang', 'gold'].includes(cmd)) { name = 'vang'; run = (i) => cmdProgress(i, 'gd'); }
    else if (['chinhanh', 'cn', 'branch'].includes(cmd)) { name = 'chinhanh'; run = (i) => cmdProgress(i, 'br'); }
    else if (['chuyentien', 'ck', 'pay', 'transfer'].includes(cmd)) {
      name = 'chuyentien'; run = cmdTransfer;
      const mention = msg.mentions.users.first();
      let rest = args.join(' ').replace(/<@!?\d+>/g, ' ').replace(/\s+/g, ' ').trim();
      const tok = rest.split(' ')[0];
      const amt = parseMoney(tok);
      if (!amt) return usage(`Cú pháp: \`${PREFIX}chuyentien <số tiền> <@người | số thẻ 16 số> [lời nhắn]\` — vd \`${PREFIX}chuyentien 100k @ten\``);
      rest = rest.slice(tok.length).trim();
      o.ints = { sotien: amt }; o.strings = {}; o.users = {};
      if (mention) { o.users.nguoi = mention; o.strings.loinhan = rest; }
      else {
        const c = /^((?:\d{4}[ -]?){3}\d{4})\b\s*(.*)$/.exec(rest);
        const idUser = !c ? await userFrom(msg, rest.split(' ')[0]) : null;
        if (c) { o.strings.sothe = c[1]; o.strings.loinhan = c[2]; }
        else if (idUser) { o.users.nguoi = idUser; o.strings.loinhan = rest.split(' ').slice(1).join(' '); }
        else return usage('Hãy ping người nhận hoặc nhập số thẻ 16 số.');
      }
    } else if (['gianhang', 'shop', 'gh'].includes(cmd)) {
      name = 'gianhang'; run = cmdShop;
      const sub = stripVN(args[0] || 'trangthai');
      if (['trangthai', 'tt', 'status', 'menu', 'bang', 'panel'].includes(sub)) o.sub = 'trangthai';
      else if (['mo', 'open'].includes(sub)) {
        o.sub = 'mo';
        if (args[1]) { // 4 | 8 | 15 | 30 | 60 | 30p | 1h
          const m = /^(\d+)\s*(p|ph|phut|m|min|h|gio)?$/.exec(stripVN(args[1]));
          let mins = m ? Number(m[1]) * (/^(h|gio)$/.test(m[2] || '') ? 60 : 1) : 0;
          if (![4, 8, 15, 30, 60].includes(mins)) return usage(`Thời gian bán: 4, 8, 15, 30 phút hoặc 1 giờ — vd \`${PREFIX}gianhang mo 30\` hoặc \`${PREFIX}gianhang mo 1h\`.`);
          o.strings = { thoigian: String(mins * 60) };
        }
      } else if (['ngaymoi', 'sangngay', 'next'].includes(sub)) o.sub = 'ngaymoi';
      else if (['thuenv', 'thue', 'hire'].includes(sub)) {
        o.sub = 'thuenv';
        const l = stripVN(args[1]);
        if (!['ngay', 'thang'].includes(l)) return usage(`Cú pháp: \`${PREFIX}gianhang thuenv ngay\` hoặc \`${PREFIX}gianhang thuenv thang\``);
        o.strings = { loai: l };
      } else if (['nhaphang', 'nhap', 'restock'].includes(sub)) {
        o.sub = 'nhaphang'; // mở bảng chọn hoa, không cần thêm tham số
      } else return usage(`Lệnh con: \`trangthai\`, \`mo\`, \`ngaymoi\`, \`nhaphang\`, \`thuenv\`. Xem \`${PREFIX}help\`.`);
    } else if (prefixCommands[cmd]) { name = cmd; run = prefixCommands[cmd]; o.args = args; }
    else return;

    if (terms.needs(msg.author.id)) return void terms.promptMessage(msg); // chưa đồng ý điều khoản -> hiện bảng, không chạy lệnh
    const ctx = prefixCtx(msg, name, o);
    try { await run(ctx); }
    catch (err) {
      console.error('[extra] lỗi lệnh prefix', name, err);
      const m = layout(['Có lỗi xảy ra, thử lại sau nhé.']);
      if (ctx.deferred || ctx.replied) await ctx.editReply({ ...m, attachments: [] }).catch(() => {});
      else await msg.reply({ ...m, failIfNotExists: false }).catch(() => {});
    }
  } catch (err) { console.error('[extra] lỗi prefix', err); }
}

// ---------------- nhắn riêng (DM) người nhận khi có người chuyển tiền ----------------
// Mọi cách chuyển (web, /chuyentien, thẻ ngân hàng) đều chèn tin "JSGIFT1:{bank...}" vào wall_messages,
// nên bot nghe INSERT của bảng này (realtime) rồi nhắn riêng cho người nhận. Tắt bằng DM_TRANSFER=0.
const dmSeen = new Set();
async function notifyTransferDm(row) {
  try {
    if (!row || row.id == null || dmSeen.has(row.id)) return;
    const msg = String(row.message || '');
    if (!msg.startsWith(BANK_PFX)) return;
    let p = null; try { p = JSON.parse(msg.slice(BANK_PFX.length)); } catch (e) { return; }
    const amt = Math.floor(+(p && p.amt));
    if (!p || !p.bank || !(amt >= BANK_MIN && amt <= BANK_MAX) || !row.to_user || row.to_user === row.from_user) return;
    dmSeen.add(row.id); if (dmSeen.size > 2000) dmSeen.delete(dmSeen.values().next().value);
    let did = discordIdOf(row.to_user);
    if (!did) { await refreshLinks().catch(() => {}); did = discordIdOf(row.to_user); }
    if (!did) return; // người nhận chưa liên kết Discord
    let who = 'Một người chơi';
    if (row.from_user) {
      const { data } = await supabase.from('profiles').select('display_name,username').eq('id', row.from_user).maybeSingle();
      who = clip(data?.display_name || data?.username || who, 40);
    }
    const note = clip(String(p.note || '').trim(), 60);
    const user = await client.users.fetch(did);
    await user.send(layout([
      H('Bạn vừa nhận tiền', EM.card),
      `${EM.money} **${who}** đã chuyển cho bạn **${vnd(amt)}**.${note ? `\nLời nhắn: *${note}*` : ''}`,
      { sep: true },
      `-# Tiền sẽ vào ví khi bạn mở game hoặc dùng \`${PREFIX}tien\` · ${stamp()}`,
      { row: linkRow() },
    ]));
  } catch (err) { if (err && err.code !== 50007) console.error('[extra] DM chuyển khoản lỗi:', err.message || err); } // 50007 = người nhận đóng DM
}
function startTransferDm() {
  if (process.env.DM_TRANSFER === '0') return;
  try {
    supabase.channel('bank-dm-' + process.pid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wall_messages' }, (pl) => { notifyTransferDm(pl && pl.new); })
      .subscribe((st) => { if (st === 'SUBSCRIBED') console.log('[extra] đang nghe chuyển khoản để nhắn riêng'); else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') console.log('[extra] kênh DM chuyển khoản:', st); });
  } catch (err) { console.error('[extra] không bật được DM chuyển khoản:', err.message || err); }
}

function init(discordClient, sb) {
  client = discordClient; supabase = sb;
  startPresence();
  startTransferDm();
  client.on('interactionCreate', handle);
  client.on('messageCreate', onMessage);
  client.once('ready', () => loadBotEmojis().catch(e => console.error('[extra] không nạp được emoji bot:', e.message)));
  client.once('ready', () => refreshLinks().then(() => console.log(`[extra] đã nạp ${linkCache.size} tài khoản liên kết`)).catch(e => console.error('[extra]', e.message)));
  setInterval(() => refreshLinks().catch(() => {}), 5 * 60 * 1000).unref(); // nhận ra người vừa đăng nhập web (tài khoản bot -> tài khoản web)
}

// hàm dùng chung cho các module mở rộng khác (relationship.js)
const helpers = {
  userIdOf, userIdFast, discordIdOf, layout, H, EM, linkRow, stamp, say, clip, V2, E, NOT_LINKED, parseGav, PREFIX, EPH,
  setLink: (d, u) => linkCache.set(String(d), u), refreshLinks, itemEmoji,
  loadFresh, loadSave, withLock, gameOp, hideBalOf, vnd, NO_SAVE, addHelpPage: (k, v) => { EXTRA_HELP[k] = v; },
};
Object.assign(helpers, { gameOnline, enqueue, waitAction, R, lvOf, cum, titleOf, getSupabase: () => supabase });
helpers.shopApi = { cmdShop, nhLayout, daySessions, busyUsers, PHASE, lenName, progOpen };
hub.init(helpers);
module.exports = { commands, init, prefixCommands, PREFIX, helpers };
