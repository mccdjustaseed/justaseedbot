// gamble.js : cá cược kiểu owo — CHỈ dùng trong server Discord (lệnh prefix, không có trong DM hay trên web).
//   j!cf <tiền|all|half> [ngửa|sấp]   tung đồng xu, thắng x2
//   j!slots <tiền|all|half>           quay hũ: 3 giống nhau x2–x20, 2 giống nhau x1,6
//   j!tx <tai|xiu> <tiền|all|half>    tài xỉu 3 xúc xắc, thắng x2, bộ ba thì nhà ăn
// Mỗi ván tối đa 250.000.000đ (đổi bằng GAMBLE_MAX), tối thiểu 1.000đ. Tiền thắng/thua ghi thẳng vào ví game.
const store = require('./save-store');

const MAX_BET = Number(process.env.GAMBLE_MAX) || 250000000;
const MIN_BET = 1000;
const COOLDOWN = 4000;
let client = null, supabase = null, X = null;
const lastPlay = new Map();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const inOurGuild = (g) => !process.env.GUILD_ID || (g && g.id === process.env.GUILD_ID);
const stripVN = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().trim();
const money = (n) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

// "all" / "half" / 50k / 2.5m / 1b / 1.500.000
function parseBet(tok, bal) {
  const t = stripVN(tok).replace(/\s+/g, '');
  if (['all', 'max', 'tatca', 'het'].includes(t)) return Math.min(bal, MAX_BET);
  if (['half', 'nua', '1/2'].includes(t)) return Math.min(Math.floor(bal / 2), MAX_BET);
  const m = /^(\d+(?:[.,]\d+)?)(k|m|tr|b|ty)$/.exec(t);
  if (m) return Math.floor(Number(m[1].replace(',', '.')) * ({ k: 1e3, m: 1e6, tr: 1e6, b: 1e9, ty: 1e9 })[m[2]]);
  if (/^\d[\d.,]*$/.test(t)) return Math.floor(Number(t.replace(/[.,]/g, '')));
  return NaN;
}

// ---------- luật các trò ----------
const SLOT = [['🍒', 30, 2], ['🍋', 25, 3], ['🍇', 20, 4], ['🔔', 12, 6], ['💎', 8, 10], ['7️⃣', 5, 20]]; // [biểu tượng, trọng số, hệ số 3 giống nhau]
const PAIR = 1.6;
function spinReel() {
  let r = Math.random() * 100;
  for (const x of SLOT) { if ((r -= x[1]) < 0) return x; }
  return SLOT[0];
}
function slots(bet) {
  const reels = [spinReel(), spinReel(), spinReel()], ic = reels.map(x => x[0]);
  let mult = 0, kind = 'none';
  if (ic[0] === ic[1] && ic[1] === ic[2]) { mult = reels[0][2]; kind = 'three'; }
  else if (ic[0] === ic[1] || ic[1] === ic[2] || ic[0] === ic[2]) { mult = PAIR; kind = 'pair'; }
  return { icons: ic, kind, payout: Math.round(bet * mult), mult };
}
function coin(bet, pick) {
  const side = Math.random() < 0.5 ? 'ngua' : 'sap';
  return { side, win: side === pick, payout: side === pick ? bet * 2 : 0 };
}
function taixiu(bet, pick) {
  const d = [1, 2, 3].map(() => 1 + Math.floor(Math.random() * 6)), sum = d[0] + d[1] + d[2];
  const triple = d[0] === d[1] && d[1] === d[2], res = sum >= 11 ? 'tai' : 'xiu';
  const win = !triple && res === pick;
  return { d, sum, triple, res, win, payout: win ? bet * 2 : 0 };
}

// ---------- ghi tiền ----------
// trả về số dư mới. Web mở: game tự kiểm tra và ghi (thao tác 'bet'); web tắt: bot ghi thẳng save đám mây.
async function settle(uid, online, bet, delta, label) {
  if (online) {
    const id = await X.enqueue(uid, 'op', { op: 'bet', args: { bet, delta, label } });
    let res = await X.waitAction(id, 12000);
    if (!res) {
      const c = await supabase.from('bot_actions').update({ status: 'failed', result: 'bot: hết thời gian chờ' }).eq('id', id).eq('status', 'pending').select('id');
      if (c.data && c.data.length) throw new Error('Game không phản hồi nên ván này đã bị hủy, tiền không đổi. Thử lại nhé.');
      res = await X.waitAction(id, 10000); // game đã nhận lệnh, đợi thêm
      if (!res) throw new Error('Game chưa báo kết quả, hãy kiểm tra số dư rồi thử lại.');
    }
    if (res.status !== 'done') throw new Error(String(res.result || 'Game từ chối ván này').slice(0, 200));
    return Number(res.result);
  }
  const r = await store.edit(supabase, uid, (s2) => {
    const m = Number.isFinite(s2.money) ? s2.money : 0;
    if (bet > m) throw new Error(`Không đủ tiền (còn ${money(m)})`);
    s2.money = m + delta;
    return String(Math.round(s2.money));
  });
  return Number(r);
}

// khung chung: kiểm tra, tung kết quả, ghi tiền, hiện hoạt ảnh rồi kết quả
async function play(i, game, firstArg, build) {
  await i.deferReply();
  if (!i.guild || !inOurGuild(i.guild)) return X.say(i, 'Cá cược chỉ dùng được trong server của bot.');
  const E = X.EM, uid = await X.userIdOf(i.user.id);
  if (!uid) return X.say(i, X.NOT_LINKED);
  if (Date.now() - (lastPlay.get(uid) || 0) < COOLDOWN) return X.say(i, `${E.wait} Từ từ thôi, đợi vài giây rồi cược tiếp nhé.`);
  const sh = X.shopApi;
  if (sh.daySessions.has(uid)) return X.say(i, 'Gian hàng đang bán, hãy đợi hết ngày rồi cược nhé.');
  if (sh.busyUsers.has(uid)) return X.say(i, 'Bạn đang có một lệnh khác đang xử lý, đợi một chút nhé.');
  sh.busyUsers.add(uid);
  try {
    const online = await X.gameOnline(uid); // hỏi một lần: web tắt thì dùng save sẵn có, khỏi chờ đồng bộ
    const sv = online ? await X.loadFresh(uid) : await X.loadSave(uid);
    if (!sv) return X.say(i, X.NO_SAVE);
    const bal = sv.money, bet = parseBet(firstArg, bal);
    if (!Number.isFinite(bet)) return X.say(i, `${E.no} Số tiền không hợp lệ. Ví dụ: \`50k\`, \`2.5m\`, \`all\`, \`half\`.`);
    if (bet < MIN_BET) return X.say(i, `${E.no} Cược tối thiểu **${money(MIN_BET)}**${bal < MIN_BET ? ` (bạn chỉ còn ${money(bal)})` : ''}.`);
    if (bet > MAX_BET) return X.say(i, `${E.no} Mỗi ván cược tối đa **${money(MAX_BET)}**.`);
    if (bet > bal) return X.say(i, `${E.no} Không đủ tiền: bạn chỉ có **${money(bal)}**.`);

    const g = build(bet);                       // { title, spin, lines[], payout }
    const delta = g.payout - bet;
    lastPlay.set(uid, Date.now());
    let newBal;
    try { newBal = await settle(uid, online, bet, delta, `${game}: ${delta >= 0 ? 'thắng' : 'thua'} ${money(Math.abs(delta))}`); }
    catch (e) { return X.say(i, `${E.no} ${String(e.message || e).slice(0, 300)}`); }

    const hide = await X.hideBalOf(uid, sv.s);
    const name = X.clip(sv.s.pf?.nm || i.user.displayName || i.user.username, 30);
    const head = `${E.person} **${name}** cược **${money(bet)}**`;
    await i.editReply(X.layout([X.H(g.title, E.money), head, g.spin])); // hoạt ảnh
    await sleep(700);
    const res = delta > 0 ? `${E.ok} **Thắng +${money(delta)}**` : delta === 0 ? `${E.wait} **Hòa vốn**` : `${E.no} **Thua -${money(-delta)}**`;
    return i.editReply(X.layout([
      X.H(g.title, E.money), head, g.lines.join('\n'), { sep: true }, res,
      `${E.money} **Số dư:** ${hide ? '••••••' : money(newBal)}`,
      `-# ${E.a} Justaseed • cược tối đa ${money(MAX_BET)}/ván`,
    ]));
  } finally { sh.busyUsers.delete(uid); }
}

const usage = (i, t) => i.reply(X.layout([`${X.EM.no} ${t}`]));

async function cmdCf(i) {
  const a = i.args || [];
  if (!a[0]) return usage(i, `Cú pháp: \`${X.PREFIX}cf <tiền|all|half> [ngửa|sấp]\` — vd \`${X.PREFIX}cf 100k sấp\``);
  const w = stripVN(a[1] || 'ngua');
  const pick = ['n', 'ngua', 'h', 'head', 'heads'].includes(w) ? 'ngua' : ['s', 'sap', 't', 'tail', 'tails'].includes(w) ? 'sap' : null;
  if (!pick) return usage(i, 'Chọn **ngửa** hoặc **sấp**.');
  return play(i, 'Tung đồng xu', a[0], (bet) => {
    const r = coin(bet, pick), nm = (s) => (s === 'ngua' ? 'Ngửa' : 'Sấp');
    return {
      title: 'Tung đồng xu', payout: r.payout,
      spin: `🪙 Đồng xu đang xoay... (bạn chọn **${nm(pick)}**)`,
      lines: [`🪙 Ra **${nm(r.side)}** · bạn chọn **${nm(pick)}**`],
    };
  });
}
async function cmdSlots(i) {
  const a = i.args || [];
  if (!a[0]) return usage(i, `Cú pháp: \`${X.PREFIX}slots <tiền|all|half>\``);
  return play(i, 'Quay hũ', a[0], (bet) => {
    const r = slots(bet);
    const note = r.kind === 'three' ? `Trúng 3 biểu tượng giống nhau: **x${r.mult}**` : r.kind === 'pair' ? `Trúng 2 biểu tượng giống nhau: **x${PAIR}**` : 'Không trúng gì cả';
    return {
      title: 'Quay hũ', payout: r.payout,
      spin: '🎰 | ❓ | ❓ | ❓ |',
      lines: [`🎰 | ${r.icons.join(' | ')} |`, note],
    };
  });
}
async function cmdTx(i) {
  const a = i.args || [];
  const pickOf = (t) => { const w = stripVN(t); return ['tai', 't'].includes(w) ? 'tai' : ['xiu', 'x'].includes(w) ? 'xiu' : null; };
  let pick = pickOf(a[0]), amt = a[1];
  if (!pick) { pick = pickOf(a[1]); amt = a[0]; }
  if (!pick || !amt) return usage(i, `Cú pháp: \`${X.PREFIX}tx <tai|xiu> <tiền|all|half>\` — vd \`${X.PREFIX}tx tai 200k\``);
  return play(i, 'Tài xỉu', amt, (bet) => {
    const r = taixiu(bet, pick), nm = (s) => (s === 'tai' ? 'Tài' : 'Xỉu');
    const dice = r.d.map(n => ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][n - 1]).join(' ');
    return {
      title: 'Tài xỉu', payout: r.payout,
      spin: `🎲 Đang lắc xúc xắc... (bạn chọn **${nm(pick)}**)`,
      lines: [`🎲 ${dice} = **${r.sum}** → ${r.triple ? '**Bộ ba, nhà ăn!**' : `**${nm(r.res)}**`} · bạn chọn **${nm(pick)}**`],
    };
  });
}

function init(discordClient, sb, helpers) { client = discordClient; supabase = sb; X = helpers; }
function registerPrefix(prefixCommands) {
  for (const k of ['cf', 'coinflip', 'flip']) prefixCommands[k] = cmdCf;
  for (const k of ['slots', 'slot', 'sl']) prefixCommands[k] = cmdSlots;
  for (const k of ['tx', 'taixiu']) prefixCommands[k] = cmdTx;
  if (X.addHelpPage) {
    X.addHelpPage('gamble', {
      label: 'Cá cược', desc: 'Tung xu, quay hũ, tài xỉu (chỉ trong server)', emoji: () => X.EM.money,
      title: 'Cá cược (chỉ dùng trong server)', ico: () => X.EM.money,
      body: () => `${X.EM.a} \`${X.PREFIX}cf <tiền|all|half> [ngửa|sấp]\` — tung đồng xu, thắng **x2**.\n${X.EM.b} \`${X.PREFIX}slots <tiền|all|half>\` — quay hũ: 3 giống nhau **x2 → x20**, 2 giống nhau **x1,6**.\n${X.EM.a} \`${X.PREFIX}tx <tai|xiu> <tiền|all|half>\` — tài xỉu 3 xúc xắc, thắng **x2**, bộ ba thì nhà ăn.\n${X.EM.tip} Tiền cược từ **${money(MIN_BET)}** đến **${money(MAX_BET)}** mỗi ván. Viết \`50k\`, \`2.5m\`, \`1b\`, \`all\` (cược hết, tối đa ${money(MAX_BET)}) hoặc \`half\`. Tiền thắng/thua ghi thẳng vào ví game. Chờ vài giây giữa hai ván.`,
    });
  }
}
module.exports = { init, registerPrefix, _t: { parseBet, slots, coin, taixiu, SLOT, PAIR } };
