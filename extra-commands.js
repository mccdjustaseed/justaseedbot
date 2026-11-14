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
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize,
} = require('discord.js');

let Cv = null;
try { Cv = require('@napi-rs/canvas'); } catch (e) { console.error('[extra] thiếu @napi-rs/canvas, các lệnh ảnh sẽ không chạy'); }
const R = require('./render')(Cv); // bộ vẽ ảnh theo giao diện game + màu chủ đề người chơi

// ---------------- cấu hình ----------------
const DAILY_BASE = Number(process.env.DAILY_BASE) || 150000;   // ngày đầu của chuỗi
const DAILY_STEP = Number(process.env.DAILY_STEP) || 25000;    // cộng thêm mỗi ngày liên tiếp
const DAILY_MAXDAYS = Number(process.env.DAILY_MAXDAYS) || 7;  // chuỗi tối đa tính thưởng
const MIN_T = 1000, MAX_T = 10000000;                          // khớp giới hạn chuyển khoản trong game
const WAIT_MS = 25000;                                         // chờ game xử lý lệnh
const E = MessageFlags.Ephemeral;

let supabase = null, client = null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const vnd = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;
const clip = (v, n) => String(v ?? '').slice(0, n);
const fmtCard = (n) => String(n || '').replace(/(\d{4})(?=\d)/g, '$1 ');
const NOT_LINKED = 'Chưa tìm thấy tài khoản game gắn với Discord này. Hãy vào game, đăng nhập bằng Discord rồi chơi một lúc để tiến trình được lưu lên đám mây.';
const NO_SAVE = 'Tài khoản này chưa có tiến trình lưu trên đám mây. Hãy mở game một lúc rồi thử lại.';

// ---------------- danh mục game ----------------
const FLOWERS = [
  ['cuc', 'Cúc họa mi'], ['hong', 'Hồng'], ['hd', 'Hướng dương'], ['tul', 'Tulip'], ['oai', 'Oải hương'],
  ['cc', 'Cẩm chướng'], ['dt', 'Đồng tiền'], ['cth', 'Cẩm tú cầu'], ['lily', 'Ly ly'], ['sen', 'Sen hồng'],
  ['mdon', 'Mẫu đơn'], ['lan', 'Lan hồ điệp'],
];
const PAPER = [['S', 'Giấy S'], ['M', 'Giấy M'], ['L', 'Giấy L'], ['keo', 'Kẹo'], ['thu', 'Thư tay'], ['anh', 'Ảnh in']];
const NAMES = Object.fromEntries([...FLOWERS, ...PAPER]);
const SUPPLIERS = [
  { n: 'Vườn Đà Lạt', items: ['cuc', 'hong', 'hd', 'cc', 'tul', 'dt', 'cth'] },
  { n: 'Chợ hoa Quảng Bá', items: FLOWERS.map(f => f[0]) },
  { n: 'Tiệm giấy & quà', items: PAPER.map(p => p[0]) },
];
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
      users.forEach(u => { const d = identOf(u); if (d) linkCache.set(String(d), u.id); });
      if (users.length < 1000) break;
    }
    linkAt = Date.now();
  })().finally(() => { linkLoading = null; });
  return linkLoading;
}
async function userIdOf(discordId) {
  discordId = String(discordId);
  if (linkCache.has(discordId)) return linkCache.get(discordId);
  if (Date.now() - linkAt > 30000) {
    try { await refreshLinks(); } catch (e) { console.error('[extra] không đọc được danh sách tài khoản:', e.message); }
  }
  return linkCache.get(discordId) || null;
}

// ---------------- đọc save đám mây ----------------
function decodeSave(code) {
  const tag = String(code).slice(0, 5);
  let buf = Buffer.from(String(code).slice(5).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (tag === 'JSA1:') buf = zlib.inflateRawSync(buf);
  else if (tag !== 'JSA0:') throw new Error('Sai định dạng save');
  return JSON.parse(buf.toString('utf8'));
}
async function loadSave(userId) {
  const { data, error } = await supabase.from('game_saves')
    .select('data,xp,day,money,updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data || !data.data) return null;
  const s = decodeSave(data.data);
  if (!/^#[0-9a-f]{6}$/i.test((s.pf && s.pf.col) || '')) s.pf = { ...(s.pf || {}), col: await colOf(userId) };
  return { s, money: Math.round(Number(data.money) || 0), at: new Date(data.updated_at).getTime() };
}

// Đọc save MỚI NHẤT: nhờ game đẩy save lên ngay (lệnh 'sync') thay vì đợi chu kỳ lưu định kỳ.
// Game đang tắt thì không chờ, dùng bản lưu gần nhất (và nhớ 60 giây để khỏi chờ lại).
const syncMiss = new Map();
async function loadFresh(uid) {
  const cached = await loadSave(uid);
  if (cached && Date.now() - cached.at < 8000) return cached;
  if (Date.now() - (syncMiss.get(uid) || 0) < 15000) return cached;
  try {
    const id = await enqueue(uid, 'sync', {});
    const r = await waitAction(id, 6000, 250);
    if (!r) {
      syncMiss.set(uid, Date.now());
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
  ok: ['js_check', '✅'], no: ['js_x', '❌'], wait: ['js_hourglass', '⏳'], refresh: ['js_repeat', '🔄'],
};
const EM = Object.fromEntries(Object.entries(BOT_EMOJI).map(([k, v]) => [k, v[1]]));
async function loadBotEmojis() {
  const list = await client.application.emojis.fetch();
  for (const [k, [name]] of Object.entries(BOT_EMOJI)) {
    const e = list.find(x => x.name === name);
    if (e) EM[k] = e.toString(); else console.warn(`[extra] bot chưa có emoji ${name}, dùng tạm emoji thường`);
  }
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

const busyUsers = new Set();
async function withLock(userId, i, fn) {
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

    let id;
    try { id = await enqueue(uid, 'credit', { amt, label: `Thưởng daily (chuỗi ${streak} ngày)` }); }
    catch (e) {
      await supabase.from('bot_daily').update(row
        ? { last_day: row.last_day, streak: row.streak, total: row.total }
        : { last_day: '2000-01-01', streak: 0, total: 0 }).eq('user_id', uid);
      throw e;
    }
    const res = await waitAction(id);
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
  if (tf.from !== i.user.id) return i.reply({ ...layout(['Nút này của người dùng lệnh.']), flags: V2 | E });
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
const refreshRow = (kind, owner) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`pg:${kind}:${owner}`).setLabel('Làm mới').setEmoji(EM.refresh).setStyle(ButtonStyle.Secondary));
const leftText = (ms) => {
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} phút`;
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
};

async function buildWorkshop(uid, fresh = true) {
  const sv = await (fresh ? loadFresh(uid) : loadSave(uid));
  if (!sv) return { error: NO_SAVE };
  const jobs = sv.s.wq || [], now = Date.now();
  console.log(`[progress] workshop: ${jobs.length} mẻ trong save (user ${uid}, save cập nhật ${new Date(sv.at).toISOString()})`);
  if (!jobs.length) return { error: `Hiện không có mẻ workshop nào đang làm trong dữ liệu đã lưu (cập nhật ${stamp(sv.at)}). Nếu game đang có mẻ, hãy mở game vài giây để lưu lên đám mây rồi dùng lại lệnh.`, s: sv.s, at: sv.at };
  const rows = await Promise.all(jobs.slice(0, 6).map(async j => {
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
  return { pngs, head: `${H('Tiến độ Workshop', EM.ws)}\n-# ${EM.a} ${clip((sv.s.pf && sv.s.pf.nm) || sv.s.name || 'Tiệm hoa', 40)} · ${jobs.length} mẻ`, s: sv.s, at: sv.at, extra: jobs.length > 6 ? `+${jobs.length - 6} mẻ nữa` : '' };
}
async function buildGold(uid, fresh = true) {
  const sv = await (fresh ? loadFresh(uid) : loadSave(uid));
  if (!sv) return { error: NO_SAVE };
  const day = sv.s.day || 1;
  const orders = (sv.s.gd?.orders || []).filter(o => o.st === 'making');
  console.log(`[progress] vàng: ${(sv.s.gd?.orders || []).length} đơn (${orders.length} đang làm) trong save (user ${uid}, save cập nhật ${new Date(sv.at).toISOString()})`);
  if (!orders.length) return { error: `Hiện không có đơn gia công vàng nào đang làm trong dữ liệu đã lưu (cập nhật ${stamp(sv.at)}). Đơn phải đã đặt cọc (đang gia công) mới hiện ở đây.`, s: sv.s, at: sv.at };
  const rows = orders.slice(0, 6).map(o => {
    const acc = o.acc ?? o.day ?? day, due = o.due ?? day, total = Math.max(1, due - acc), left = Math.max(0, due - day);
    return {
      icon: '💍', name: clip(o.br?.name || 'Đơn gia công', 40),
      svg: R.goldSvg({ type: o.req?.type, tone: o.req?.tone, gem: o.req?.gem }), // hình trang sức đúng như trong game
      sub: `${GOLD_TYPES[o.req?.type] || 'Trang sức'} vàng ${o.req?.k || '?'}K · ngày game ${day}/${due}`,
      pct: 1 - left / total, right: left > 0 ? `còn ${left} ngày` : 'Sẵn sàng nhận',
    };
  });
  const pngs = await Promise.all(rows.map(r => R.renderRow(sv.s, r)));
  return { pngs, head: `${H('Tiến độ gia công vàng', EM.ring)}\n-# ${EM.a} Tiệm vàng Kim Ngân · ngày game ${day}`, s: sv.s, at: sv.at, extra: orders.length > 6 ? `+${orders.length - 6} đơn nữa` : '' };
}
const progressLayout = (r, kind, owner) => {
  return layout([
    r.head,
    ...r.pngs.map((_, k) => ({ img: `attachment://progress${k}.png` })), // mỗi tiến độ một ảnh riêng
    r.extra || null,
    { sep: true },
    { row: refreshRow(kind, owner) },
    `-# ${EM.a} Justaseed • dữ liệu ${stamp(r.at)}`,
  ], { files: r.pngs.map((b, k) => new AttachmentBuilder(b, { name: `progress${k}.png` })), attachments: [] });
};
async function cmdProgress(i, kind) {
  await i.deferReply();
  if (!R) return say(i, 'Máy chủ bot chưa cài @napi-rs/canvas nên chưa vẽ được ảnh.');
  const uid = await userIdOf(i.user.id);
  if (!uid) return say(i, NOT_LINKED);
  const r = kind === 'ws' ? await buildWorkshop(uid) : await buildGold(uid);
  if (r.error) return say(i, r.error);
  return i.editReply(progressLayout(r, kind, i.user.id));
}
async function btnProgress(i) {
  const [, kind, owner] = i.customId.split(':');
  if (i.user.id !== owner) return i.reply({ content: 'Nút này của người dùng lệnh.', flags: E });
  await i.deferUpdate();
  const uid = await userIdOf(owner);
  if (!uid) return;
  const r = kind === 'ws' ? await buildWorkshop(uid) : await buildGold(uid);
  if (r.error) return i.editReply({ ...layout([r.error]), attachments: [] });
  return i.editReply(progressLayout(r, kind, owner));
}

// ---------------- /gianhang ----------------
const PHASE = { prep: 'Chuẩn bị (nhập hàng, đặt giá)', open: 'Đang mở bán', end: 'Đang tổng kết ngày' };
async function cmdShop(i) {
  const sub = i.options.getSubcommand();
  await i.deferReply({ flags: E });
  const uid = await userIdOf(i.user.id);
  if (!uid) return say(i, NOT_LINKED);

  if (sub === 'trangthai') {
    const sv = await loadFresh(uid);
    if (!sv) return say(i, NO_SAVE);
    const s = sv.s;
    const stock = [...FLOWERS, ...PAPER].map(([id, n]) => [n, s.st?.[id] || 0]).filter(x => x[1] > 0);
    const monthly = s.hm && typeof s.hm.e === 'number' && (s.hm.p || (s.day || 1) < s.hm.e);
    const staff = monthly ? `Nhân viên tháng (${s.hm.p ? 'đang nghỉ phép' : `còn ${s.hm.e - s.day} ngày`})` : s.hire ? 'Nhân viên theo ngày' : 'Chưa thuê';
    return i.editReply(layout([
      H(clip(s.name || 'Tiệm hoa', 40), EM.shop),
      `${EM.a} **Giai đoạn:** ${PHASE[s.ph] || 'Không rõ'}\n${EM.b} **Ngày:** ${s.day || 1}\n${EM.a} **Số dư:** ${vnd(sv.money)}\n${EM.b} **Nhân viên:** ${staff}`,
      { sep: true },
      `${EM.box} **Kho**\n${stock.length ? stock.map(x => `${x[0]}: **${x[1]}**`).join(' · ').slice(0, 1000) : 'Trống'}`,
      { sep: true },
      `-# ${EM.a} Justaseed • dữ liệu ${stamp(sv.at)}`,
    ]));
  }

  const sv = await loadFresh(uid);
  if (!sv) return say(i, NO_SAVE);
  const s = sv.s;
  return withLock(uid, i, async () => {
    let kind, payload = {}, okMsg;
    if (sub === 'mo') {
      if (s.ph && s.ph !== 'prep') return say(i, `Không mở được: tiệm đang ở giai đoạn "${PHASE[s.ph] || s.ph}".`);
      kind = 'open_day'; okMsg = 'Đã mở gian hàng, khách đang vào!';
    } else if (sub === 'thuenv') {
      const loai = i.options.getString('loai');
      kind = loai === 'thang' ? 'hire_month' : 'hire_day';
      okMsg = loai === 'thang' ? 'Đã thuê nhân viên theo tháng (30 ngày game).' : 'Đã thuê nhân viên cho hôm nay.';
    } else if (sub === 'nhaphang') {
      const si = i.options.getInteger('nhacungcap'), id = i.options.getString('mathang'), q = i.options.getInteger('soluong');
      const sup = SUPPLIERS[si];
      if (!sup || !sup.items.includes(id)) return say(i, 'Mặt hàng này không bán ở nhà cung cấp đã chọn.');
      if (s.ph && s.ph !== 'prep') return say(i, `Chỉ nhập hàng được ở giai đoạn chuẩn bị (hiện: ${PHASE[s.ph] || s.ph}).`);
      kind = 'restock'; payload = { si, id, q }; okMsg = `Đã gửi lệnh nhập ${q} ${NAMES[id]}.`;
    } else return say(i, 'Lệnh không hợp lệ.');

    const id = await enqueue(uid, kind, payload);
    const res = await waitAction(id);
    if (res && res.status === 'done') return i.editReply(layout([H('Thành công', EM.ok), clip(res.result, 300) || okMsg, `-# ${clip(s.name || 'Tiệm hoa', 40)}`]));
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
  new SlashCommandBuilder().setName('gianhang').setDescription('Quản lý gian hàng ngay trên Discord')
    .addSubcommand(c => c.setName('trangthai').setDescription('Xem trạng thái gian hàng'))
    .addSubcommand(c => c.setName('mo').setDescription('Mở gian hàng bán hàng'))
    .addSubcommand(c => c.setName('nhaphang').setDescription('Nhập hàng từ nhà cung cấp')
      .addIntegerOption(o => o.setName('nhacungcap').setDescription('Nhà cung cấp').setRequired(true)
        .addChoices(...SUPPLIERS.map((s, n) => ({ name: s.n, value: n }))))
      .addStringOption(o => o.setName('mathang').setDescription('Mặt hàng').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('soluong').setDescription('Số lượng').setRequired(true).setMinValue(1).setMaxValue(200)))
    .addSubcommand(c => c.setName('thuenv').setDescription('Thuê nhân viên')
      .addStringOption(o => o.setName('loai').setDescription('Gói thuê').setRequired(true)
        .addChoices({ name: 'Theo ngày (500.000đ)', value: 'ngay' }, { name: 'Theo tháng (10.000.000đ, cần cấp 20)', value: 'thang' }))),
].map(c => c.toJSON());

async function handle(i) {
  try {
    if (i.isAutocomplete() && i.commandName === 'gianhang') return await autoShop(i);
    if (i.isButton()) {
      if (i.customId.startsWith('tf:')) return await btnTransfer(i);
      if (i.customId.startsWith('pg:')) return await btnProgress(i);
      return;
    }
    if (!i.isChatInputCommand()) return;
    switch (i.commandName) {
      case 'profile': return await cmdProfile(i);
      case 'daily': return await cmdDaily(i);
      case 'tien': return await cmdMoney(i);
      case 'chuyentien': return await cmdTransfer(i);
      case 'workshop': return await cmdProgress(i, 'ws');
      case 'vang': return await cmdProgress(i, 'gd');
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

function init(discordClient, sb) {
  client = discordClient; supabase = sb;
  client.on('interactionCreate', handle);
  client.once('ready', () => loadBotEmojis().catch(e => console.error('[extra] không nạp được emoji bot:', e.message)));
  client.once('ready', () => refreshLinks().then(() => console.log(`[extra] đã nạp ${linkCache.size} tài khoản liên kết`)).catch(e => console.error('[extra]', e.message)));
}

module.exports = { commands, init };
