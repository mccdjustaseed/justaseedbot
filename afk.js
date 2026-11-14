// afk.js : tính năng AFK cho bot Justaseed
//
//  /afk [loinhan]   hoặc   j!afk [lời nhắn]
//   - Type 1 (không có lời nhắn): khi có người mention, bot báo chủ tiệm đang vắng mặt.
//   - Type 2 (có lời nhắn)      : như trên nhưng kèm nội dung lời nhắn.
//  Khi AFK: xoá tin nhắn trigger, thêm "[ AFK ]" trước tên hiển thị (nickname), gửi thông báo (không reply).
//  Ai mention -> bot reply (ping người mention, KHÔNG ping chủ tiệm). Người đó reply tin bot = để lại lời nhắn.
//  Chủ tiệm gửi tin nhắn bất kỳ -> bot reply báo cáo ai đã mention + link + lời nhắn, rồi gỡ "[ AFK ]".
//
// Quyền bot cần: Manage Messages (xoá tin trigger), Manage Nicknames (đổi tên), Read Message History.
// Bot không đổi được nickname của chủ server / người có role cao hơn bot (khi đó chỉ bỏ qua bước đổi tên).
// Dữ liệu AFK lưu ở file afk-data.json (đổi bằng biến môi trường AFK_FILE) để không mất khi bot khởi động lại.
const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder } = require('discord.js');

const FILE = process.env.AFK_FILE || path.join(__dirname, 'afk-data.json');
const TAIL = '!*!*';            // phần đuôi câu chúc, đổi ở đây nếu muốn
const TAG = '[ AFK ] ';         // tiền tố thêm vào tên
const NOTICE_COOLDOWN = 30000;  // cùng một người mention liên tục: chỉ reply lại sau 30 giây (vẫn ghi nhận để báo cáo)
const MAX_MENTIONS = 50, MAX_NOTES = 30, MAX_NOTICES = 200;

let client = null, h = null, EM = {};
const store = new Map();        // "guildId:userId" -> entry
const lastNotice = new Map();   // "guildId:afkId:authorId" -> thời điểm reply gần nhất

// ---------------- tiện ích ----------------
const clip = (v, n) => String(v ?? '').slice(0, n);
const oneLine = (t, n) => clip(String(t || '').replace(/\s+/g, ' ').trim(), n);
const keyOf = (g, u) => `${g}:${u}`;
const msgUrl = (g, c, m) => `https://discord.com/channels/${g}/${c}/${m}`;
const reactOf = (e) => { const m = /^<a?:(\w+:\d+)>$/.exec(e); return m ? m[1] : e; };
const bodyOf = (msg) => oneLine(msg.content, 200) || (msg.attachments?.size ? '(tệp đính kèm)' : '(không có nội dung chữ)');

function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'vài giây';
  if (m < 60) return `${m} phút`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr} giờ${m % 60 ? ` ${m % 60} phút` : ''}`;
  const d = Math.floor(hr / 24);
  return `${d} ngày${hr % 24 ? ` ${hr % 24} giờ` : ''}`;
}
// cắt danh sách dòng cho vừa ngân sách ký tự (tin nhắn layout giới hạn 4000 ký tự chữ cho cả tin)
function fit(lines, budget) {
  const out = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    if (used + lines[i].length + 1 > budget) { out.push(`-# …và ${lines.length - i} mục khác`); break; }
    out.push(lines[i]); used += lines[i].length + 1;
  }
  return out.join('\n');
}
const isAfkCmd = (content) => {
  const c = String(content || '').toLowerCase(), p = (h.PREFIX + 'afk').toLowerCase();
  return c.startsWith(p) && (c.length === p.length || /\s/.test(c[p.length]));
};

// ---------------- lưu trữ ----------------
function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [k, v] of Object.entries(j)) store.set(k, v);
    console.log(`[afk] đã nạp ${store.size} người đang AFK`);
  } catch (e) { if (e.code !== 'ENOENT') console.error('[afk] không đọc được file lưu:', e.message); }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(Object.fromEntries(store)));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (e) { console.error('[afk] không lưu được:', e.message); }
  }, 500);
}

// ---------------- đổi tên [ AFK ] ----------------
async function addTag(guild, entry) {
  try {
    const m = await guild.members.fetch(entry.userId);
    const nick = m.nickname && m.nickname.startsWith(TAG) ? m.nickname.slice(TAG.length) : m.nickname;
    if (entry.origNick === undefined) entry.origNick = nick ?? null; // lần đầu AFK mới nhớ tên gốc
    const base = m.displayName.startsWith(TAG) ? m.displayName.slice(TAG.length) : m.displayName;
    await m.setNickname(TAG + clip(base, 32 - TAG.length), 'Justaseed: AFK');
  } catch (e) { console.warn('[afk] không đổi được nickname:', e.message); }
}
async function removeTag(guild, entry) {
  try {
    const m = await guild.members.fetch(entry.userId);
    // chỉ trả lại tên gốc nếu người dùng chưa tự đổi sang tên khác
    if (m.nickname && m.nickname.startsWith(TAG)) await m.setNickname(entry.origNick ?? null, 'Justaseed: hết AFK');
  } catch (e) { console.warn('[afk] không gỡ được nickname:', e.message); }
}

// ---------------- đặt AFK ----------------
async function cmdAfk(i) {
  const isMsg = !!i.msg; // dạng prefix (j!afk) có i.msg, dạng slash thì không
  const guild = i.guild;
  if (!guild) return isMsg ? undefined : i.reply({ ...h.layout(['Lệnh này chỉ dùng trong server.']), flags: h.V2 | h.EPH });

  const text = oneLine(isMsg ? (i.args || []).join(' ') : i.options.getString('loinhan'), 200);
  const k = keyOf(guild.id, i.user.id);
  const old = store.get(k);
  const entry = {
    guildId: guild.id, userId: i.user.id, text, since: Date.now(),
    origNick: old?.origNick,                // giữ tên gốc nếu đặt AFK lại
    triggerId: isMsg ? i.msg.id : null,
    notices: old?.notices || {}, mentions: old?.mentions || [], notes: old?.notes || [],
  };
  store.set(k, entry);
  save();

  if (isMsg) i.msg.delete().catch(() => {});            // xoá tin nhắn trigger
  else await i.deferReply({ flags: h.EPH });            // slash: không có tin trigger, lát nữa xoá tin "đang xử lý"

  await addTag(guild, entry);
  save();

  const channel = i.channel || await guild.channels.fetch(i.channelId).catch(() => null);
  try {
    // thông báo thường (không reply), mention chỉ hiển thị tên, không ping
    await channel.send(h.layout([
      `${EM.wait} Chủ tiệm <@${i.user.id}> hiện đã vắng mặt ${TAIL}`,
      `-# ${EM.a} Justaseed • AFK`,
    ]));
  } catch (e) {
    console.error('[afk] không gửi được thông báo:', e.message);
    if (!isMsg) return i.editReply(h.layout([`${EM.no} Mình không gửi được tin nhắn ở kênh này (thiếu quyền?).`]));
  }
  if (!isMsg) await i.deleteReply().catch(() => {});
}

// ---------------- có người mention người đang AFK ----------------
async function notify(msg, entry) {
  entry.mentions.push({ id: msg.id, channelId: msg.channel.id, authorId: msg.author.id, content: bodyOf(msg), at: Date.now() });
  if (entry.mentions.length > MAX_MENTIONS) entry.mentions.splice(0, entry.mentions.length - MAX_MENTIONS);
  save();

  const ck = `${entry.guildId}:${entry.userId}:${msg.author.id}`;
  if (Date.now() - (lastNotice.get(ck) || 0) < NOTICE_COOLDOWN) return;
  lastNotice.set(ck, Date.now());

  const lines = [
    `${EM.person} <@${msg.author.id}> chủ tiệm <@${entry.userId}> hiện đang vắng mặt${entry.text ? ' và có để lại lời nhắn:' : '.'}`,
  ];
  if (entry.text) lines.push(`${EM.deco} **${entry.text}**`);
  const sent = await msg.reply({
    ...h.layout([
      `### ${EM.title} Chủ tiệm đang vắng mặt ${EM.title}`,
      lines.join('\n'),
      { sep: true },
      `${EM.tip} Bạn có thể để lại lời nhắn bằng cách **reply tin nhắn này**! Chúc bạn một ngày an ${TAIL}`,
      `-# ${EM.a} Justaseed • AFK từ <t:${Math.floor(entry.since / 1000)}:R>`,
    ]),
    allowedMentions: { users: [msg.author.id], repliedUser: true }, // chỉ ping người mention, không ping chủ tiệm
    failIfNotExists: false,
  });
  entry.notices[sent.id] = msg.author.id;
  const ids = Object.keys(entry.notices);
  if (ids.length > MAX_NOTICES) ids.slice(0, ids.length - MAX_NOTICES).forEach(x => delete entry.notices[x]);
  save();
}

// ---------------- chủ tiệm quay lại ----------------
async function comeBack(msg, entry) {
  store.delete(keyOf(entry.guildId, entry.userId));
  save();
  removeTag(msg.guild, entry); // chạy nền, không chặn việc báo cáo

  const g = entry.guildId;
  const blocks = [
    `### ${EM.title} Chào mừng trở lại ${EM.title}`,
    `${EM.person} Chủ tiệm <@${entry.userId}> đã quay lại sau **${fmtDur(Date.now() - entry.since)}** vắng mặt.` +
      (entry.text ? `\n${EM.deco} Lời nhắn bạn đã để lại: *${entry.text}*` : ''),
    { sep: true },
  ];

  if (!entry.mentions.length) {
    blocks.push(`${EM.ok} Không ai nhắc đến bạn trong lúc bạn vắng mặt.`);
  } else {
    const ml = entry.mentions.map((m, n) =>
      `${n % 2 ? EM.b : EM.a} <@${m.authorId}> trong <#${m.channelId}> · <t:${Math.floor(m.at / 1000)}:R> · [Xem tin nhắn](${msgUrl(g, m.channelId, m.id)})\n> ${m.content}`);
    blocks.push(`${EM.star} **Có ${entry.mentions.length} lần bạn được nhắc đến**\n` + fit(ml, 1700));
  }

  if (entry.notes.length) {
    const nl = entry.notes.map(n =>
      `${EM.gift} <@${n.authorId}> · <t:${Math.floor(n.at / 1000)}:R> · [Xem tin nhắn](${msgUrl(g, n.channelId, n.id)})\n> ${n.content}`);
    blocks.push({ sep: true }, `${EM.card} **Lời nhắn người khác để lại cho bạn**\n` + fit(nl, 1500));
  }
  blocks.push(`-# ${EM.a} Justaseed • đã gỡ trạng thái AFK`);

  await msg.reply({
    ...h.layout(blocks),
    allowedMentions: { parse: [], repliedUser: false }, // báo cáo không ping ai
    failIfNotExists: false,
  });
}

// ---------------- xử lý tin nhắn ----------------
async function onMessage(msg) {
  try {
    if (msg.author.bot || !msg.inGuild() || !store.size) return;
    const gid = msg.guild.id;
    if (isAfkCmd(msg.content)) return; // chính lệnh j!afk: không tính là "quay lại" / "mention"

    // 1. chủ tiệm gửi tin nhắn bất kỳ -> quay lại
    const self = store.get(keyOf(gid, msg.author.id));
    if (self && msg.id !== self.triggerId) await comeBack(msg, self);

    // 2. reply vào tin nhắn báo AFK của bot -> lưu lời nhắn
    let noted = null;
    const refId = msg.reference?.messageId;
    if (refId) {
      for (const e of store.values()) {
        if (e.guildId !== gid || !e.notices[refId]) continue;
        e.notes.push({ id: msg.id, channelId: msg.channel.id, authorId: msg.author.id, content: bodyOf(msg), at: Date.now() });
        if (e.notes.length > MAX_NOTES) e.notes.splice(0, e.notes.length - MAX_NOTES);
        save();
        msg.react(reactOf(EM.ok)).catch(() => {}); // báo đã lưu lời nhắn
        noted = e.userId;
        break;
      }
    }

    // 3. mention người đang AFK -> reply báo vắng mặt (tối đa 3 người mỗi tin để khỏi spam)
    const hits = [...msg.mentions.users.values()]
      .filter(u => !u.bot && u.id !== msg.author.id && u.id !== noted)
      .map(u => store.get(keyOf(gid, u.id))).filter(Boolean).slice(0, 3);
    for (const e of hits) await notify(msg, e);
  } catch (err) { console.error('[afk] lỗi xử lý tin nhắn:', err); }
}

// ---------------- đăng ký ----------------
const commands = [
  new SlashCommandBuilder().setName('afk')
    .setDescription('Báo vắng mặt, bot sẽ trả lời giúp khi có người nhắc đến bạn')
    .addStringOption(o => o.setName('loinhan').setDescription('Lời nhắn gửi người tìm bạn (bỏ trống nếu không cần)').setMaxLength(200))
    .setDMPermission(false)
    .toJSON(),
];

function init(discordClient, helpers) {
  client = discordClient; h = helpers; EM = helpers.EM; // EM do extra-commands nạp emoji bot, dùng chung tham chiếu
  load();
  client.on('messageCreate', onMessage);
  client.on('interactionCreate', (i) => {
    if (!i.isChatInputCommand() || i.commandName !== 'afk') return;
    cmdAfk(i).catch(async (e) => {
      console.error('[afk] lỗi lệnh:', e);
      const m = { ...h.layout(['Có lỗi xảy ra, thử lại sau nhé.']) };
      try { if (i.deferred || i.replied) await i.editReply(m); else await i.reply({ ...m, flags: h.V2 | h.EPH }); } catch (_) { /* bỏ qua */ }
    });
  });
  client.on('guildMemberRemove', (m) => { if (store.delete(keyOf(m.guild.id, m.id))) save(); });
}
function registerPrefix(prefixCommands) { prefixCommands.afk = cmdAfk; } // j!afk [lời nhắn]

module.exports = { commands, init, registerPrefix };
