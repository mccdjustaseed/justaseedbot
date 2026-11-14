// bot-profile.js : đổi trạng thái / avatar / bìa (banner) của bot ngay trong server
// Chỉ người có quyền "Quản lý máy chủ" (Manage Server) mới dùng được.
//   Slash : /bot trangthai | /bot avatar | /bot bia
//   Prefix: j!bot trangthai [tinhtrang] [kieu] <nội dung>   (đính kèm ảnh cho avatar / bia)
const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits, ActivityType, Routes } = require('discord.js');

let client = null, H = null; // H = helpers từ extra-commands (layout, EM, H, clip, PREFIX)
const SAVE_FILE = path.join(__dirname, 'bot-profile.json'); // nhớ trạng thái để áp lại khi bot khởi động lại
const MAX_IMG = 10 * 1024 * 1024; // Discord cho tối đa 10MB
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const stripVN = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();

// ---------------- danh mục ----------------
const KINDS = {
  playing:   { type: ActivityType.Playing,   label: 'Đang chơi',   alias: ['playing', 'choi', 'dangchoi'] },
  watching:  { type: ActivityType.Watching,  label: 'Đang xem',    alias: ['watching', 'xem', 'dangxem'] },
  listening: { type: ActivityType.Listening, label: 'Đang nghe',   alias: ['listening', 'nghe', 'dangnghe'] },
  competing: { type: ActivityType.Competing, label: 'Thi đấu',     alias: ['competing', 'thidau'] },
  custom:    { type: ActivityType.Custom,    label: 'Tùy chỉnh',   alias: ['custom', 'tuychinh'] },
};
const STATUSES = {
  online:    { label: 'Trực tuyến',            alias: ['online', 'tructuyen'] },
  idle:      { label: 'Vắng mặt',              alias: ['idle', 'vangmat'] },
  dnd:       { label: 'Đừng làm phiền',        alias: ['dnd', 'dunglamphien'] },
  invisible: { label: 'Ẩn',                    alias: ['invisible', 'an', 'offline'] },
};
const findKey = (map, word) => Object.keys(map).find(k => map[k].alias.includes(stripVN(word)));

// ---------------- lưu / áp trạng thái ----------------
function applyPresence({ status = 'online', kind = 'playing', text = '' }) {
  const k = KINDS[kind] || KINDS.playing;
  const activities = text
    ? [k.type === ActivityType.Custom
        ? { name: 'Custom Status', type: ActivityType.Custom, state: text }
        : { name: text, type: k.type }]
    : [];
  client.user.setPresence({ status, activities });
}
function savePresence(p) {
  try { fs.writeFileSync(SAVE_FILE, JSON.stringify(p)); } catch (e) { console.error('[bot-profile] không lưu được trạng thái:', e.message); }
}
function loadPresence() {
  try { return JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); } catch { return null; }
}

// ---------------- tiện ích ----------------
const canManage = (i) => {
  const perms = i.memberPermissions || i.member?.permissions; // slash | prefix
  return !!perms?.has(PermissionFlagsBits.ManageGuild);
};
const ok = (t) => `${H.EM.ok} ${t}`;
const no = (t) => `${H.EM.no} ${t}`;

// tải ảnh từ Discord CDN rồi đổi sang data URI để gửi lên API
async function toDataUri(att) {
  if (!att) throw new Error('Chưa có ảnh.');
  const type = String(att.contentType || '').split(';')[0];
  if (!IMG_TYPES.includes(type)) throw new Error('Ảnh phải là PNG, JPG, GIF hoặc WEBP.');
  if (att.size > MAX_IMG) throw new Error('Ảnh quá lớn (tối đa 10MB).');
  const res = await fetch(att.url);
  if (!res.ok) throw new Error('Không tải được ảnh về.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMG) throw new Error('Ảnh quá lớn (tối đa 10MB).');
  return `data:${type};base64,${buf.toString('base64')}`;
}

// ---------------- xử lý chung (slash + prefix) ----------------
async function doPresence(i, { status, kind, text }) {
  const prev = loadPresence() || {};
  const next = {
    status: status || prev.status || 'online',
    kind: kind || prev.kind || 'playing',
    text: text === undefined ? (prev.text || '') : text,
  };
  applyPresence(next);
  savePresence(next);
  const lines = [
    H.H('Đã đổi trạng thái bot', H.EM.a),
    `${H.EM.star} Tình trạng: **${STATUSES[next.status].label}**`,
    next.text
      ? `${H.EM.b} Hoạt động: **${KINDS[next.kind].label}** ${H.clip(next.text, 128)}`
      : `${H.EM.b} Hoạt động: *(không có)*`,
  ];
  return i.reply(H.layout(lines));
}

async function doImage(i, field, att) {
  const label = field === 'avatar' ? 'avatar' : 'ảnh bìa';
  const respond = (p) => (i.deferred ? i.editReply(p) : i.reply(p)); // slash đã defer | prefix
  try {
    const data = await toDataUri(att);
    await client.rest.patch(Routes.user(), { body: { [field]: data } });
  } catch (e) {
    console.error('[bot-profile]', field, e.message);
    return respond(H.layout([no(`Không đổi được ${label}: ${H.clip(e.message, 300)}`)]));
  }
  const blocks = [ok(`Đã đổi ${label} của bot.`)];
  try {
    await client.user.fetch(true);
    const url = field === 'avatar' ? client.user.displayAvatarURL({ size: 512 }) : client.user.bannerURL({ size: 1024 });
    if (url) blocks.push({ img: url });
  } catch { /* không có xem trước thì thôi */ }
  return respond(H.layout(blocks));
}

// ---------------- slash ----------------
const commands = [
  new SlashCommandBuilder().setName('bot').setDescription('Chỉnh hồ sơ của bot (cần quyền Quản lý máy chủ)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(c => c.setName('trangthai').setDescription('Đổi trạng thái hoạt động của bot')
      .addStringOption(o => o.setName('noidung').setDescription('Nội dung trạng thái (bỏ trống để xóa)').setMaxLength(128))
      .addStringOption(o => o.setName('kieu').setDescription('Kiểu hoạt động (mặc định: giữ như cũ)')
        .addChoices(...Object.entries(KINDS).map(([value, v]) => ({ name: v.label, value }))))
      .addStringOption(o => o.setName('tinhtrang').setDescription('Chấm trạng thái (mặc định: giữ như cũ)')
        .addChoices(...Object.entries(STATUSES).map(([value, v]) => ({ name: v.label, value })))))
    .addSubcommand(c => c.setName('avatar').setDescription('Đổi avatar của bot')
      .addAttachmentOption(o => o.setName('anh').setDescription('Ảnh PNG/JPG/GIF/WEBP, tối đa 10MB').setRequired(true)))
    .addSubcommand(c => c.setName('bia').setDescription('Đổi ảnh bìa (banner) của bot')
      .addAttachmentOption(o => o.setName('anh').setDescription('Ảnh PNG/JPG/GIF/WEBP, tối đa 10MB').setRequired(true))),
].map(c => c.toJSON());

async function onInteraction(i) {
  if (!i.isChatInputCommand() || i.commandName !== 'bot') return;
  try {
    if (!canManage(i)) return await i.reply({ ...H.layout([no('Chỉ người có quyền **Quản lý máy chủ** mới dùng được lệnh này.')]), flags: H.V2 | H.EPH });
    const sub = i.options.getSubcommand();
    if (sub === 'trangthai') {
      const text = i.options.getString('noidung');
      return await doPresence(i, {
        status: i.options.getString('tinhtrang') || undefined,
        kind: i.options.getString('kieu') || undefined,
        text: text === null ? undefined : text.trim(),
      });
    }
    if (sub === 'avatar') { await i.deferReply(); return await doImage(i, 'avatar', i.options.getAttachment('anh')); }
    if (sub === 'bia') { await i.deferReply(); return await doImage(i, 'banner', i.options.getAttachment('anh')); }
  } catch (err) {
    console.error('[bot-profile] lỗi lệnh', err);
    const m = H.layout(['Có lỗi xảy ra, thử lại sau nhé.']);
    try { (i.deferred || i.replied) ? await i.editReply(m) : await i.reply(m); } catch { /* bỏ qua */ }
  }
}

// ---------------- prefix: j!bot ... ----------------
async function prefixBot(i) {
  if (!canManage(i)) return i.reply(H.layout([no('Chỉ người có quyền **Quản lý máy chủ** mới dùng được lệnh này.')]));
  const P = H.PREFIX, args = [...(i.args || [])];
  const sub = stripVN(args.shift() || '');

  if (['trangthai', 'tt', 'status'].includes(sub)) {
    let status, kind;
    for (let n = 0; n < 2 && args.length; n++) { // tối đa 2 từ khóa đầu: tình trạng và/hoặc kiểu
      const s = findKey(STATUSES, args[0]), k = findKey(KINDS, args[0]);
      if (s && !status) { status = s; args.shift(); }
      else if (k && !kind) { kind = k; args.shift(); }
      else break;
    }
    const text = args.join(' ').trim().slice(0, 128);
    if (!status && !kind && !text) {
      return i.reply(H.layout([no(
        `Cú pháp: \`${P}bot trangthai [tình trạng] [kiểu] <nội dung>\`\n` +
        `Tình trạng: ${Object.keys(STATUSES).join(', ')}\nKiểu: ${Object.keys(KINDS).join(', ')}\n` +
        `Ví dụ: \`${P}bot trangthai dnd watching đang tưới hoa\``)]));
    }
    return doPresence(i, { status, kind, text: text || (status && !kind ? undefined : '') });
  }

  if (['avatar', 'bia', 'banner'].includes(sub)) {
    const msg = i.msg;
    let att = msg.attachments.first();
    if (!att && msg.reference?.messageId) { // hoặc trả lời một tin nhắn có ảnh
      const ref = await msg.channel.messages.fetch(msg.reference.messageId).catch(() => null);
      att = ref?.attachments.first();
    }
    if (!att) return i.reply(H.layout([no(`Hãy đính kèm ảnh (hoặc trả lời một tin có ảnh) cùng lệnh: \`${P}bot ${sub} [ảnh]\``)]));
    return doImage(i, sub === 'avatar' ? 'avatar' : 'banner', att);
  }

  return i.reply(H.layout([no(`Lệnh con: \`trangthai\`, \`avatar\`, \`bia\`. Ví dụ: \`${P}bot trangthai idle playing Justaseed\``)]));
}

// ---------------- đăng ký ----------------
function init(discordClient, helpers) {
  client = discordClient; H = helpers;
  client.on('interactionCreate', onInteraction);
  client.once('ready', () => {
    const p = loadPresence();
    if (p) { try { applyPresence(p); console.log('[bot-profile] đã áp lại trạng thái đã lưu'); } catch (e) { console.error('[bot-profile]', e.message); } }
  });
}
function registerPrefix(prefixCommands) { prefixCommands.bot = prefixBot; }

module.exports = { commands, init, registerPrefix };
