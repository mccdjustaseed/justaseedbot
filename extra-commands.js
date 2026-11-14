// extra-commands.js : các lệnh mở rộng cho bot Justaseed
// Cần: npm i @napi-rs/canvas   |   SUPABASE_KEY phải là service role key
// Tùy chọn: đặt font .ttf (có tiếng Việt, ví dụ Baloo2/Onest) vào thư mục ./fonts để ảnh đẹp hơn;
//           cài thêm font emoji (Noto Color Emoji) trên máy chủ nếu muốn hiện emoji trong ảnh.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');

let Cv = null;
try { Cv = require('@napi-rs/canvas'); } catch (e) { console.error('[extra] thiếu @napi-rs/canvas, các lệnh ảnh sẽ không chạy'); }
if (Cv) {
  try {
    const dir = path.join(__dirname, 'fonts');
    if (fs.existsSync(dir)) fs.readdirSync(dir).filter(f => /\.(ttf|otf)$/i.test(f))
      .forEach(f => Cv.GlobalFonts.registerFromPath(path.join(dir, f)));
  } catch (e) { console.error('[extra] lỗi nạp font:', e.message); }
}
const FONT = '"Baloo 2", "Onest", "DejaVu Sans", "Noto Sans", sans-serif';
const EMOJI_FONT = '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"';

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
const FRAMES = ['#bfe8c6', '#4fb06f', '#5aa9e6', '#b39ddb', '#ffc83d', '#ff6fa0'];
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
  return { s: decodeSave(data.data), money: Math.round(Number(data.money) || 0), at: new Date(data.updated_at).getTime() };
}

// ---------------- hàng đợi lệnh bot -> game ----------------
async function enqueue(userId, kind, payload) {
  const { data, error } = await supabase.from('bot_actions')
    .insert({ user_id: userId, kind, payload }).select('id').single();
  if (error) throw error;
  return data.id;
}
async function waitAction(id, ms = WAIT_MS) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(1500);
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

const busyUsers = new Set();
async function withLock(userId, i, fn) {
  if (busyUsers.has(userId)) return i.editReply('Bạn đang có một lệnh khác đang xử lý, đợi một chút nhé.');
  busyUsers.add(userId);
  try { return await fn(); } finally { busyUsers.delete(userId); }
}

// ---------------- vẽ ảnh ----------------
function rr(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
}
function txt(ctx, t, x, y, size, color, weight = 600, align = 'left', maxW) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if (maxW) ctx.fillText(String(t), x, y, maxW); else ctx.fillText(String(t), x, y);
}
function bar(ctx, x, y, w, h, pct, c1 = '#4fb06f', c2 = '#8ad7a4', bg = 'rgba(30,70,45,.15)') {
  pct = Math.max(0, Math.min(1, pct));
  rr(ctx, x, y, w, h, h / 2, bg);
  if (pct > 0) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, c1); g.addColorStop(1, c2);
    rr(ctx, x, y, Math.max(h, w * pct), h, h / 2, g);
  }
}
async function imgFrom(src) {
  if (!src || !Cv) return null;
  try {
    if (Buffer.isBuffer(src)) return await Cv.loadImage(src);
    const s = String(src);
    if (s.startsWith('data:')) return await Cv.loadImage(Buffer.from(s.split(',')[1], 'base64'));
    if (/^https?:\/\//.test(s)) {
      const r = await fetch(s); if (!r.ok) return null;
      return await Cv.loadImage(Buffer.from(await r.arrayBuffer()));
    }
  } catch (e) { /* bỏ qua ảnh lỗi */ }
  return null;
}

async function renderProfile(p) {
  const W = 960, H = 560, c = Cv.createCanvas(W, H), ctx = c.getContext('2d');
  const s = p.s, xp = s.xp || 0, lv = lvOf(xp), a = cum(lv), b = cum(lv + 1);
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#f3fbf5'); bg.addColorStop(1, '#d9f0e2');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const hd = ctx.createLinearGradient(0, 0, W, 0); hd.addColorStop(0, '#2e7d57'); hd.addColorStop(.6, '#4fb06f'); hd.addColorStop(1, '#7fd0f5');
  ctx.fillStyle = hd; ctx.fillRect(0, 0, W, 190);

  const cx = 130, cy = 175, R = 88;
  ctx.beginPath(); ctx.arc(cx, cy, R + 8, 0, Math.PI * 2); ctx.fillStyle = FRAMES[(s.pf && s.pf.fr) || 0] || '#fff'; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  if (p.avatar) ctx.drawImage(p.avatar, cx - R, cy - R, R * 2, R * 2);
  else { ctx.fillStyle = '#bfe8c6'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); txt(ctx, '🌱', cx, cy + 22, 70, '#2e7d57', 400, 'center'); }
  ctx.restore();

  const name = clip((s.pf && s.pf.nm) || s.name || p.discordName || 'Chủ tiệm', 22);
  txt(ctx, name, 250, 82, 48, '#ffffff', 800, 'left', 660);
  txt(ctx, clip(s.name || 'Tiệm hoa', 30), 250, 122, 28, 'rgba(255,255,255,.92)', 600, 'left', 660);
  txt(ctx, `Cấp ${lv} · ${titleOf(lv)}`, 250, 160, 26, 'rgba(255,255,255,.85)', 600);
  txt(ctx, `@${clip(p.discordName, 24)}`, W - 40, 50, 22, 'rgba(255,255,255,.8)', 600, 'right');

  txt(ctx, `Kinh nghiệm ${Math.round(xp - a).toLocaleString('vi-VN')} / ${Math.round(b - a).toLocaleString('vi-VN')}`, 40, 292, 24, '#35604a', 600);
  txt(ctx, `Cấp ${lv + 1}`, W - 40, 292, 24, '#35604a', 600, 'right');
  bar(ctx, 40, 304, W - 80, 22, (xp - a) / Math.max(1, b - a));

  const wsLv = Object.values(s.ws || {}).reduce((t, w) => t + (1 + Math.floor(Math.sqrt(((w && w.xp) || 0) / 25))), 0);
  const stats = [
    ['Ngày', `${s.day || 1}`], ['Số dư', vnd(p.money)], ['Khách đã phục vụ', (s.sv || 0).toLocaleString('vi-VN')],
    ['Doanh thu', vnd(s.rev)], ['Uy tín', `${(Number(s.rep) || 0).toFixed(1)} ★`], ['Đánh giá 5 sao', `${s.five || 0}`],
  ];
  const tw = 288, th = 92, gx = 40, gy = 350;
  stats.forEach((st, i) => {
    const x = gx + (i % 3) * (tw + 20), y = gy + Math.floor(i / 3) * (th + 16);
    rr(ctx, x, y, tw, th, 18, 'rgba(255,255,255,.85)');
    txt(ctx, st[0], x + 18, y + 34, 21, '#5f8a73', 600);
    txt(ctx, st[1], x + 18, y + 72, 32, '#1f4a35', 800, 'left', tw - 30);
  });
  txt(ctx, `Workshop tổng cấp ${wsLv} · Justaseed · justaseed.xyz`, W / 2, H - 14, 18, '#6c9a82', 600, 'center');
  return c.toBuffer('image/png');
}

async function renderProgress(title, subtitle, rows) {
  const W = 960, RH = 132, H = 150 + rows.length * RH + 20, c = Cv.createCanvas(W, H), ctx = c.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#f3fbf5'); bg.addColorStop(1, '#d9f0e2');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const hd = ctx.createLinearGradient(0, 0, W, 0); hd.addColorStop(0, '#2e7d57'); hd.addColorStop(1, '#7fd0f5');
  ctx.fillStyle = hd; ctx.fillRect(0, 0, W, 112);
  txt(ctx, title, 40, 56, 40, '#fff', 800, 'left', 880);
  txt(ctx, subtitle, 40, 94, 22, 'rgba(255,255,255,.9)', 600, 'left', 880);
  const hasEmoji = Cv.GlobalFonts.has && Cv.GlobalFonts.has('Noto Color Emoji');
  rows.forEach((r, i) => {
    const y = 132 + i * RH;
    rr(ctx, 30, y, W - 60, RH - 14, 22, 'rgba(255,255,255,.9)');
    const done = r.pct >= 1;
    rr(ctx, 48, y + 16, 84, 84, 20, done ? '#ffe9a8' : '#dff3e6');
    if (hasEmoji) { ctx.font = `52px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000'; ctx.fillText(r.icon, 90, y + 60); }
    else txt(ctx, String(r.name).trim().charAt(0).toUpperCase(), 90, y + 76, 52, '#2e7d57', 800, 'center');
    txt(ctx, r.name, 150, y + 44, 30, '#1f4a35', 800, 'left', 560);
    txt(ctx, r.sub, 150, y + 74, 21, '#5f8a73', 600, 'left', 560);
    txt(ctx, r.right, W - 52, y + 44, 28, done ? '#b8860b' : '#2e7d57', 800, 'right', 280);
    bar(ctx, 150, y + 86, W - 220, 16, r.pct, done ? '#e0b43c' : '#4fb06f', done ? '#ffe38a' : '#8ad7a4');
    txt(ctx, `${Math.round(Math.min(1, r.pct) * 100)}%`, W - 52, y + 102, 20, '#35604a', 700, 'right');
  });
  return c.toBuffer('image/png');
}

// ---------------- /profile ----------------
async function cmdProfile(i) {
  await i.deferReply();
  if (!Cv) return i.editReply('Máy chủ bot chưa cài @napi-rs/canvas nên chưa vẽ được ảnh.');
  const target = i.options.getUser('nguoi') || i.user;
  const uid = await userIdOf(target.id);
  if (!uid) return i.editReply(target.id === i.user.id ? NOT_LINKED : `${target.username} chưa liên kết tài khoản game.`);
  const sv = await loadSave(uid);
  if (!sv) return i.editReply(target.id === i.user.id ? NO_SAVE : `${target.username} chưa có tiến trình lưu trên đám mây.`);

  let avatar = null;
  try {
    const { data } = await supabase.from('shop_public').select('game_avatar').eq('user_id', uid).maybeSingle();
    const raw = String(data?.game_avatar || '');
    if (raw.startsWith('gav:')) avatar = await imgFrom(JSON.parse(raw.slice(4)).av);
    else if (raw) avatar = await imgFrom(raw);
  } catch (e) { /* dùng avatar Discord */ }
  if (!avatar) avatar = await imgFrom(target.displayAvatarURL({ extension: 'png', size: 256 }));

  const png = await renderProfile({ s: sv.s, money: sv.money, avatar, discordName: target.username });
  await i.editReply({
    content: `Profile của **${clip(target.displayName || target.username, 40)}**`,
    files: [new AttachmentBuilder(png, { name: 'profile.png' })],
    allowedMentions: { parse: [] },
  });
}

// ---------------- /daily ----------------
const vnDate = (off = 0) => new Date(Date.now() + 7 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
async function cmdDaily(i) {
  await i.deferReply({ flags: E });
  const uid = await userIdOf(i.user.id);
  if (!uid) return i.editReply(NOT_LINKED);
  return withLock(uid, i, async () => {
    const sv = await supabase.from('game_saves').select('user_id').eq('user_id', uid).maybeSingle();
    if (!sv.data) return i.editReply(NO_SAVE);

    const today = vnDate(0), yest = vnDate(-1);
    const { data: row } = await supabase.from('bot_daily').select('*').eq('user_id', uid).maybeSingle();
    const nextMid = Math.floor(((Math.floor((Date.now() + 7 * 3600e3) / 86400e3) + 1) * 86400e3 - 7 * 3600e3) / 1000);
    if (row && row.last_day === today) {
      return i.editReply(`Hôm nay bạn đã nhận daily rồi. Lần tới: <t:${nextMid}:R> (0 giờ sáng giờ Việt Nam). Chuỗi hiện tại: **${row.streak}** ngày.`);
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
    if (!claimed) return i.editReply('Hôm nay bạn đã nhận daily rồi.');

    let id;
    try { id = await enqueue(uid, 'credit', { amt, label: `Thưởng daily (chuỗi ${streak} ngày)` }); }
    catch (e) {
      await supabase.from('bot_daily').update(row
        ? { last_day: row.last_day, streak: row.streak, total: row.total }
        : { last_day: '2000-01-01', streak: 0, total: 0 }).eq('user_id', uid);
      throw e;
    }
    const res = await waitAction(id);
    const embed = new EmbedBuilder().setColor(0x4fb06f).setTitle('🎁 Daily Justaseed')
      .setDescription(`**+${vnd(amt)}** · chuỗi **${streak}** ngày${streak >= DAILY_MAXDAYS ? ' (tối đa)' : ''}`)
      .setFooter({ text: `Ngày mai nhận tiếp để tăng thưởng · tối đa ${vnd(DAILY_BASE + (DAILY_MAXDAYS - 1) * DAILY_STEP)}` });
    if (res && res.status === 'done') embed.addFields({ name: 'Trạng thái', value: 'Đã cộng vào ví trong game.' });
    else if (res) embed.addFields({ name: 'Trạng thái', value: `Game báo lỗi: ${clip(res.result, 200)}` });
    else embed.addFields({ name: 'Trạng thái', value: 'Tiền sẽ được cộng ngay khi bạn mở game.' });
    return i.editReply({ embeds: [embed] });
  });
}

// ---------------- /tien ----------------
async function cmdMoney(i) {
  await i.deferReply({ flags: E });
  const uid = await userIdOf(i.user.id);
  if (!uid) return i.editReply(NOT_LINKED);
  const sv = await loadSave(uid);
  if (!sv) return i.editReply(NO_SAVE);
  const [{ data: card }, out] = await Promise.all([
    supabase.from('bank_cards').select('card_no').eq('user_id', uid).maybeSingle(),
    pendingOut(uid),
  ]);
  const embed = new EmbedBuilder().setColor(0x4fb06f).setTitle('💳 Ví Justaseed')
    .addFields(
      { name: 'Số dư', value: `**${vnd(sv.money)}**`, inline: true },
      { name: 'Số thẻ', value: card ? `\`${fmtCard(card.card_no)}\`` : 'Chưa có (mở tab Thẻ NH trong game)', inline: true },
    )
    .setFooter({ text: 'Số dư theo lần lưu gần nhất lên đám mây' }).setTimestamp(sv.at);
  if (out > 0) embed.addFields({ name: 'Đang chờ trừ', value: vnd(out) });
  return i.editReply({ embeds: [embed] });
}

// ---------------- /chuyentien ----------------
const pendingTf = new Map();
async function cmdTransfer(i) {
  await i.deferReply({ flags: E });
  const uid = await userIdOf(i.user.id);
  if (!uid) return i.editReply(NOT_LINKED);
  const amt = i.options.getInteger('sotien');
  const target = i.options.getUser('nguoi');
  const cardNo = (i.options.getString('sothe') || '').replace(/\D/g, '');
  const note = clip((i.options.getString('loinhan') || '').trim(), 60);

  if (!!target === !!cardNo) return i.editReply('Hãy chọn **một** trong hai: `nguoi` (ping người nhận) hoặc `sothe` (số thẻ 16 số).');
  if (!(amt >= MIN_T && amt <= MAX_T)) return i.editReply(`Số tiền mỗi lần từ ${vnd(MIN_T)} đến ${vnd(MAX_T)}.`);

  let recv = null;
  if (target) {
    if (target.bot) return i.editReply('Không thể chuyển tiền cho bot.');
    recv = await userIdOf(target.id);
    if (!recv) return i.editReply(`${target.username} chưa liên kết tài khoản game.`);
  } else {
    if (cardNo.length !== 16) return i.editReply('Số thẻ gồm 16 chữ số.');
    const { data } = await supabase.from('bank_cards').select('user_id').eq('card_no', cardNo).maybeSingle();
    if (!data) return i.editReply('Không tìm thấy thẻ này.');
    recv = data.user_id;
  }
  if (recv === uid) return i.editReply('Không thể tự chuyển cho chính mình.');

  const sv = await loadSave(uid);
  if (!sv) return i.editReply(NO_SAVE);
  const avail = sv.money - await pendingOut(uid);
  if (amt > avail) return i.editReply(`Không đủ tiền. Số dư khả dụng: **${vnd(Math.max(0, avail))}**.`);

  const { data: pr } = await supabase.from('profiles').select('display_name,username').eq('id', recv).maybeSingle();
  const name = clip(pr?.display_name || pr?.username || 'Người chơi', 40);
  const tok = randomUUID().slice(0, 8);
  pendingTf.set(tok, { from: i.user.id, uid, recv, name, amt, note, exp: Date.now() + 60000 });
  setTimeout(() => pendingTf.delete(tok), 61000);

  const embed = new EmbedBuilder().setColor(0xffc83d).setTitle('Xác nhận chuyển tiền')
    .setDescription(`Chuyển **${vnd(amt)}** cho **${name}**${note ? `\nLời nhắn: ${note}` : ''}\n\nTiền chuyển đi không thể thu hồi.`);
  return i.editReply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tf:ok:${tok}`).setLabel('Xác nhận').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tf:no:${tok}`).setLabel('Hủy').setStyle(ButtonStyle.Secondary),
    )],
  });
}
async function btnTransfer(i) {
  const [, act, tok] = i.customId.split(':');
  const tf = pendingTf.get(tok);
  if (!tf || tf.from !== i.user.id || Date.now() > tf.exp) {
    return i.update({ content: 'Yêu cầu đã hết hạn hoặc không phải của bạn.', embeds: [], components: [] });
  }
  pendingTf.delete(tok);
  if (act === 'no') return i.update({ content: 'Đã hủy chuyển tiền.', embeds: [], components: [] });

  await i.update({ content: 'Đang xử lý...', embeds: [], components: [] });
  return withLock(tf.uid, i, async () => {
    const sv = await loadSave(tf.uid);
    const avail = (sv?.money || 0) - await pendingOut(tf.uid);
    if (tf.amt > avail) return i.editReply(`Không đủ tiền. Số dư khả dụng: **${vnd(Math.max(0, avail))}**.`);
    const id = await enqueue(tf.uid, 'transfer', {
      to_user: tf.recv, to_name: tf.name, amt: tf.amt, note: tf.note, tid: randomUUID().replace(/-/g, '').slice(0, 20),
    });
    const res = await waitAction(id);
    if (res && res.status === 'done') return i.editReply(`✅ Đã chuyển **${vnd(tf.amt)}** cho **${tf.name}**. ${res.result ? clip(res.result, 150) : ''}`);
    if (res) return i.editReply(`❌ Không chuyển được: ${clip(res.result, 200)}`);
    return i.editReply(`⏳ ${QUEUED(id, 360)} Tiền chỉ bị trừ khi game xử lý lệnh.`);
  });
}

// ---------------- /workshop, /vang ----------------
const refreshRow = (kind, owner) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`pg:${kind}:${owner}`).setLabel('Làm mới').setEmoji('🔄').setStyle(ButtonStyle.Secondary));
const leftText = (ms) => {
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} phút`;
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
};

async function buildWorkshop(uid) {
  const sv = await loadSave(uid);
  if (!sv) return { error: NO_SAVE };
  const jobs = sv.s.wq || [], now = Date.now();
  if (!jobs.length) return { error: 'Hiện không có mẻ workshop nào đang làm.' };
  const rows = jobs.slice(0, 6).map(j => {
    const ty = WS_TYPES[j.t] || ['🎁', 'Workshop'], tot = Math.max(1, j.en - j.st), left = Math.max(0, j.en - now);
    const q = Number(j.it?.q);
    return {
      icon: ty[0], name: clip(j.it?.n || ty[1], 40),
      sub: `${ty[1]}${Number.isFinite(q) ? ` · chất lượng ${q}/100` : ''}`,
      pct: 1 - left / tot, right: left > 0 ? `còn ${leftText(left)}` : 'Xong rồi!',
    };
  });
  const png = await renderProgress('Tiến độ Workshop', `${clip(sv.s.name || 'Tiệm hoa', 40)} · ${jobs.length} mẻ`, rows);
  return { png, extra: jobs.length > 6 ? `+${jobs.length - 6} mẻ nữa` : '' };
}
async function buildGold(uid) {
  const sv = await loadSave(uid);
  if (!sv) return { error: NO_SAVE };
  const day = sv.s.day || 1;
  const orders = (sv.s.gd?.orders || []).filter(o => o.st === 'making');
  if (!orders.length) return { error: 'Hiện không có đơn gia công vàng nào đang làm.' };
  const rows = orders.slice(0, 6).map(o => {
    const acc = o.acc ?? o.day ?? day, due = o.due ?? day, total = Math.max(1, due - acc), left = Math.max(0, due - day);
    return {
      icon: '💍', name: clip(o.br?.name || 'Đơn gia công', 40),
      sub: `${GOLD_TYPES[o.req?.type] || 'Trang sức'} vàng ${o.req?.k || '?'}K · ngày game ${day}/${due}`,
      pct: 1 - left / total, right: left > 0 ? `còn ${left} ngày` : 'Sẵn sàng nhận',
    };
  });
  const png = await renderProgress('Tiến độ gia công vàng', `Tiệm vàng Kim Ngân · ngày game ${day}`, rows);
  return { png, extra: orders.length > 6 ? `+${orders.length - 6} đơn nữa` : '' };
}
async function cmdProgress(i, kind) {
  await i.deferReply();
  if (!Cv) return i.editReply('Máy chủ bot chưa cài @napi-rs/canvas nên chưa vẽ được ảnh.');
  const uid = await userIdOf(i.user.id);
  if (!uid) return i.editReply(NOT_LINKED);
  const r = kind === 'ws' ? await buildWorkshop(uid) : await buildGold(uid);
  if (r.error) return i.editReply(r.error);
  return i.editReply({
    content: r.extra || '', files: [new AttachmentBuilder(r.png, { name: 'progress.png' })],
    components: [refreshRow(kind, i.user.id)], allowedMentions: { parse: [] },
  });
}
async function btnProgress(i) {
  const [, kind, owner] = i.customId.split(':');
  if (i.user.id !== owner) return i.reply({ content: 'Nút này của người dùng lệnh.', flags: E });
  await i.deferUpdate();
  const uid = await userIdOf(owner);
  if (!uid) return;
  const r = kind === 'ws' ? await buildWorkshop(uid) : await buildGold(uid);
  if (r.error) return i.editReply({ content: r.error, files: [], components: [] });
  return i.editReply({ content: r.extra || '', files: [new AttachmentBuilder(r.png, { name: 'progress.png' })], components: [refreshRow(kind, owner)] });
}

// ---------------- /gianhang ----------------
const PHASE = { prep: 'Chuẩn bị (nhập hàng, đặt giá)', open: 'Đang mở bán', end: 'Đang tổng kết ngày' };
async function cmdShop(i) {
  const sub = i.options.getSubcommand();
  await i.deferReply({ flags: E });
  const uid = await userIdOf(i.user.id);
  if (!uid) return i.editReply(NOT_LINKED);
  const sv = await loadSave(uid);
  if (!sv) return i.editReply(NO_SAVE);
  const s = sv.s;

  if (sub === 'trangthai') {
    const stock = [...FLOWERS, ...PAPER].map(([id, n]) => [n, s.st?.[id] || 0]).filter(x => x[1] > 0);
    const monthly = s.hm && typeof s.hm.e === 'number' && (s.hm.p || (s.day || 1) < s.hm.e);
    const staff = monthly ? `Nhân viên tháng (${s.hm.p ? 'đang nghỉ phép' : `còn ${s.hm.e - s.day} ngày`})` : s.hire ? 'Nhân viên theo ngày' : 'Chưa thuê';
    const embed = new EmbedBuilder().setColor(0x4fb06f).setTitle(`🏪 ${clip(s.name || 'Tiệm hoa', 40)}`)
      .addFields(
        { name: 'Giai đoạn', value: PHASE[s.ph] || 'Không rõ', inline: true },
        { name: 'Ngày', value: String(s.day || 1), inline: true },
        { name: 'Số dư', value: vnd(sv.money), inline: true },
        { name: 'Nhân viên', value: staff },
        { name: 'Kho', value: stock.length ? stock.map(x => `${x[0]}: ${x[1]}`).join(' · ').slice(0, 1000) : 'Trống' },
      ).setFooter({ text: 'Theo lần lưu gần nhất lên đám mây' }).setTimestamp(sv.at);
    return i.editReply({ embeds: [embed] });
  }

  return withLock(uid, i, async () => {
    let kind, payload = {}, ttl = 15, okMsg;
    if (sub === 'mo') {
      if (s.ph && s.ph !== 'prep') return i.editReply(`Không mở được: tiệm đang ở giai đoạn "${PHASE[s.ph] || s.ph}".`);
      kind = 'open_day'; okMsg = 'Đã mở gian hàng, khách đang vào!';
    } else if (sub === 'thuenv') {
      const loai = i.options.getString('loai');
      kind = loai === 'thang' ? 'hire_month' : 'hire_day';
      okMsg = loai === 'thang' ? 'Đã thuê nhân viên theo tháng (30 ngày game).' : 'Đã thuê nhân viên cho hôm nay.';
    } else if (sub === 'nhaphang') {
      const si = i.options.getInteger('nhacungcap'), id = i.options.getString('mathang'), q = i.options.getInteger('soluong');
      const sup = SUPPLIERS[si];
      if (!sup || !sup.items.includes(id)) return i.editReply('Mặt hàng này không bán ở nhà cung cấp đã chọn.');
      if (s.ph && s.ph !== 'prep') return i.editReply(`Chỉ nhập hàng được ở giai đoạn chuẩn bị (hiện: ${PHASE[s.ph] || s.ph}).`);
      kind = 'restock'; payload = { si, id, q }; okMsg = `Đã gửi lệnh nhập ${q} ${NAMES[id]}.`;
    } else return i.editReply('Lệnh không hợp lệ.');

    const id = await enqueue(uid, kind, payload);
    const res = await waitAction(id);
    if (res && res.status === 'done') return i.editReply(`✅ ${clip(res.result, 300) || okMsg}`);
    if (res) return i.editReply(`❌ ${clip(res.result, 300)}`);
    return i.editReply(`⏳ ${QUEUED(id, 15)}`);
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
      if (i.deferred || i.replied) await i.editReply({ content: msg, embeds: [], components: [] });
      else if (i.isRepliable()) await i.reply({ content: msg, flags: E });
    } catch (e) { /* bỏ qua */ }
  }
}

function init(discordClient, sb) {
  client = discordClient; supabase = sb;
  client.on('interactionCreate', handle);
  client.once('ready', () => refreshLinks().then(() => console.log(`[extra] đã nạp ${linkCache.size} tài khoản liên kết`)).catch(e => console.error('[extra]', e.message)));
}

module.exports = { commands, init };
