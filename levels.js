// levels.js : XP khi chat trong server + ảnh ngang dài tiến trình thăng cấp + lệnh j!rank
// Chỉ chạy trong server Discord (tin nhắn trong server; DM bị bỏ qua). Nếu đặt GUILD_ID thì chỉ tính trong server đó.
// XP cộng vào ĐÚNG XP của game (cấp độ trong profile). Lên cấp nhờ chat được thưởng 100.000đ × cấp.
// Chỉnh bằng biến môi trường: CHAT_XP_MIN (8), CHAT_XP_MAX (15), CHAT_XP_COOLDOWN giây (60), CHAT_XP_DAILY_CAP (1500 XP/ngày/người), CHAT_LEVEL_REWARD (100000)
const { AttachmentBuilder } = require('discord.js');
const store = require('./save-store');

const CFG = {
  min: Number(process.env.CHAT_XP_MIN) || 8,
  max: Number(process.env.CHAT_XP_MAX) || 15,
  cooldown: (Number(process.env.CHAT_XP_COOLDOWN) || 60) * 1000,
  dailyCap: Number(process.env.CHAT_XP_DAILY_CAP) || 1500,
  minLen: 4,
  reward: Number(process.env.CHAT_LEVEL_REWARD) || 100000, // thưởng mỗi cấp = reward × cấp
};
let client = null, supabase = null, X = null;
const lastAt = new Map();   // uid discord -> lần cuối nhận XP (chống spam)
const daily = new Map();    // uid game -> { d: ngày VN, n: XP chat hôm nay }
const xpLocal = new Map();  // uid game -> XP đã biết (khi web mở, save đám mây có thể chậm hơn game)

const vnDay = () => Math.floor((Date.now() + 7 * 3600e3) / 86400e3);
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const inOurGuild = (g) => !process.env.GUILD_ID || (g && g.id === process.env.GUILD_ID);
const derivedXp = (s) => (s.sv || 0) * 25 + Math.max(0, (s.day || 1) - 1) * 20; // như game khi save chưa có xp

async function readXp(uid) {
  const { data } = await supabase.from('game_saves').select('xp').eq('user_id', uid).maybeSingle();
  return data ? (Number(data.xp) || 0) : null;
}

// ảnh ngang dài tiến trình cấp (cùng giao diện/màu chủ đề với profile)
async function levelImage(uid, user, xp, opt = {}) {
  const R = X.R;
  if (!R || !R.renderLevel) return null;
  const sv = await X.loadSave(uid);
  if (!sv) return null;
  const s = sv.s, pf = s.pf || {};
  const pub = await supabase.from('shop_public').select('game_avatar').eq('user_id', uid).maybeSingle().then(r => r.data, () => null);
  const gav = X.parseGav(pub && pub.game_avatar);
  const avatar = await R.imgFrom(gav.av, gav.av ? `av:${uid}:${gav.av.length}` : null)
    .then(a => a || R.imgFrom(user.displayAvatarURL({ extension: 'png', size: 256 })));
  const lv = X.lvOf(xp), a = X.cum(lv), b = X.cum(lv + 1);
  return R.renderLevel({
    s, avatar, name: X.clip(pf.nm || s.name || user.displayName || user.username, 24), lv,
    xpIn: xp - a, xpNeed: b - a, title: X.titleOf(lv), fr: pf.fr ?? gav.fr, afr: pf.afr ?? gav.afr, ...opt,
  });
}

async function announce(msg, uid, xp, gain, lvA, lvB) {
  let reward = 0;
  for (let l = lvA + 1; l <= lvB; l++) reward += CFG.reward * l;
  let png = null;
  try { png = await levelImage(uid, msg.author, xp, { up: true, gain }); }
  catch (e) { console.error('[levels] không vẽ được ảnh lên cấp:', e.message || e); }
  const E = X.EM;
  await msg.reply({
    ...X.layout([
      X.H('Chúc mừng lên cấp!', E.star),
      `${E.deco} Chúc mừng <@${msg.author.id}> đã đạt **cấp ${lvB}** · ${X.titleOf(lvB)}! Chăm chat là lên cấp nhanh thôi.\n${E.gift} **Thưởng lên cấp:** +${X.vnd(reward)} (đã cộng vào ví game)`,
      png ? { sep: true } : null,
      png ? { img: 'attachment://levelup.png' } : null,
      `-# ${E.a} Justaseed • chat trong server để nhận XP`,
    ], { files: png ? [new AttachmentBuilder(png, { name: 'levelup.png' })] : [], attachments: [] }),
    failIfNotExists: false,
  }).catch(e => console.warn('[levels] không gửi được chúc mừng:', e.message || e));
}

// Mỗi tin nhắn chat chỉ cộng vào bộ nhớ (tức thì, không gọi DB). Cứ 30 giây mới ghi gộp một lần cho mỗi người,
// nên không còn cảnh mỗi tin nhắn đọc+giải nén+nén+ghi cả save làm nghẽn bot và khóa lệnh của người chơi.
const pending = new Map(); // uid game -> { msg, n }
let flushing = false;
function award(msg, uid) {
  const d = vnDay(), cur = daily.get(uid);
  const used = cur && cur.d === d ? cur.n : 0;
  if (used >= CFG.dailyCap) return;
  const n = Math.min(rand(CFG.min, CFG.max), CFG.dailyCap - used);
  daily.set(uid, { d, n: used + n });
  const p = pending.get(uid);
  pending.set(uid, { msg, n: (p ? p.n : 0) + n });
}
async function flushAll() {
  if (flushing) return; flushing = true;
  try {
    const sh = X.shopApi;
    for (const [uid, p] of [...pending]) {
      if (sh.daySessions.has(uid) || sh.busyUsers.has(uid)) continue; // đang bán / đang xử lý: để lượt sau, không ghi chen vào save
      pending.delete(uid);
      try { await flushXp(p.msg, uid, p.n); }
      catch (e) { console.error('[levels] lỗi cộng XP chat:', e.message || e); const q = pending.get(uid); pending.set(uid, { msg: p.msg, n: p.n + (q ? q.n : 0) }); }
    }
  } finally { flushing = false; }
}
async function flushXp(msg, uid, n) {
  const sh = X.shopApi;
  const dbXp = await readXp(uid);
  if (dbXp == null) return; // chưa có tiến trình game
  let lvA, lvB, total;
  sh.busyUsers.add(uid);
  try {
    if (await X.gameOnline(uid)) { // web đang mở: game tự cộng XP (kèm thưởng lên cấp, thông báo trong game)
      const before = Math.max(dbXp, xpLocal.get(uid) || 0);
      await X.enqueue(uid, 'op', { op: 'chat_xp', args: { n, rw: CFG.reward } });
      lvA = X.lvOf(before); total = before + n; lvB = X.lvOf(total);
    } else { // web tắt: bot cộng thẳng vào save đám mây
      await store.edit(supabase, uid, (s2) => {
        const x0 = s2.xp == null ? derivedXp(s2) : s2.xp;
        lvA = X.lvOf(x0); s2.xp = x0 + n; total = s2.xp; lvB = X.lvOf(total);
        if (lvB > lvA) {
          let r = 0; for (let l = lvA + 1; l <= lvB; l++) r += CFG.reward * l;
          s2.money = (Number.isFinite(s2.money) ? s2.money : 0) + r;
          s2.notifs = s2.notifs || [];
          s2.notifs.unshift({ type: 'bot', id: 'bot' + Date.now() + Math.random(), text: `⭐ Lên cấp ${lvB} nhờ chat trong server: +${X.vnd(r)}`, time: new Date().toISOString(), read: false });
          s2.notifs = s2.notifs.slice(0, 50);
        }
      });
    }
  } finally { sh.busyUsers.delete(uid); }
  xpLocal.set(uid, total);
  if (xpLocal.size > 2000) xpLocal.delete(xpLocal.keys().next().value);
  if (lvB > lvA) await announce(msg, uid, total, n, lvA, lvB);
}

async function onChat(msg) {
  try {
    if (msg.author.bot || !msg.inGuild() || !inOurGuild(msg.guild)) return;
    const text = String(msg.content || '');
    if (text.slice(0, X.PREFIX.length).toLowerCase() === X.PREFIX.toLowerCase()) return; // lệnh không tính XP
    if (text.replace(/<[^>]+>|https?:\/\/\S+/g, '').trim().length < CFG.minLen) return;
    const now = Date.now();
    if (now - (lastAt.get(msg.author.id) || 0) < CFG.cooldown) return;
    lastAt.set(msg.author.id, now);
    if (lastAt.size > 5000) lastAt.delete(lastAt.keys().next().value);
    const uid = X.userIdFast ? X.userIdFast(msg.author.id) : await X.userIdOf(msg.author.id); // chỉ tra bộ nhớ đệm, không chờ
    if (!uid) return;
    award(msg, uid);
  } catch (e) { console.error('[levels] lỗi cộng XP chat:', e.message || e); }
}

// j!rank [@người]: ảnh ngang dài tiến trình cấp
async function cmdRank(i) {
  await i.deferReply();
  if (!i.guild || !inOurGuild(i.guild)) return X.say(i, 'Lệnh này chỉ dùng được trong server của bot.');
  if (!X.R || !X.R.renderLevel) return X.say(i, 'Máy chủ bot chưa cài @napi-rs/canvas nên chưa vẽ được ảnh.');
  const target = (i.msg && i.msg.mentions.users.first()) || i.user, self = target.id === i.user.id;
  const uid = await X.userIdOf(target.id);
  if (!uid) return X.say(i, self ? X.NOT_LINKED : `${target.username} chưa liên kết tài khoản game.`);
  const sv = self ? await X.loadFresh(uid) : await X.loadSave(uid);
  if (!sv) return X.say(i, self ? X.NO_SAVE : `${target.username} chưa có tiến trình lưu trên đám mây.`);
  const xp = sv.s.xp == null ? derivedXp(sv.s) : sv.s.xp, lv = X.lvOf(xp);
  const cur = daily.get(uid), today = cur && cur.d === vnDay() ? cur.n : 0;
  const png = await levelImage(uid, target, xp, { up: false, sub: today ? `Hôm nay +${today} XP từ chat` : 'Tiến trình cấp độ' });
  if (!png) return X.say(i, 'Không vẽ được ảnh lúc này, thử lại sau nhé.');
  const need = X.cum(lv + 1) - xp;
  return i.editReply({
    ...X.layout([
      X.H(`Cấp độ của ${X.clip(target.displayName || target.username, 40)}`, X.EM.star),
      { img: 'attachment://rank.png' },
      `${X.EM.tip} Còn **${need.toLocaleString('vi-VN')} XP** nữa để lên **cấp ${lv + 1}**. Chat trong server để nhận XP.`,
    ], { files: [new AttachmentBuilder(png, { name: 'rank.png' })], attachments: [] }),
  });
}

function init(discordClient, sb, helpers) {
  client = discordClient; supabase = sb; X = helpers;
  client.on('messageCreate', onChat);
  setInterval(() => flushAll().catch(() => {}), 30000).unref();
}
function registerPrefix(prefixCommands) {
  for (const k of ['rank', 'xp', 'level', 'lv', 'capdo']) prefixCommands[k] = cmdRank;
  if (X.addHelpPage) {
    X.addHelpPage('levels', {
      label: 'XP & cấp độ', desc: 'Chat trong server để nhận XP, lên cấp có thưởng', emoji: () => X.EM.star,
      title: 'XP & cấp độ', ico: () => X.EM.star,
      body: () => `${X.EM.a} Chat trong server nhận **${CFG.min}–${CFG.max} XP** mỗi ${CFG.cooldown / 1000} giây (tối đa ${CFG.dailyCap.toLocaleString('vi-VN')} XP/ngày). XP này chính là XP trong game.\n${X.EM.b} Lên cấp: bot đăng **ảnh chúc mừng** và cộng thưởng **${CFG.reward.toLocaleString('vi-VN')}đ × cấp** vào ví game.\n${X.EM.a} \`${X.PREFIX}rank [@người]\` — xem ảnh tiến trình cấp (cũng gọi: \`xp\`, \`level\`, \`lv\`).`,
    });
  }
}
module.exports = { init, registerPrefix, CFG };
