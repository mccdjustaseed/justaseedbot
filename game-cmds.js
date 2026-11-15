// game-cmds.js : lệnh quản lý tiệm cho bot Justaseed (giá bán, nâng cấp, nhiệm vụ, thành tích, thú cưng, nội thất,
// ngân hàng, nhân viên, chi nhánh, túi đồ, thống kê).
// - Lệnh GHI (đổi giá, nâng cấp, nhận thưởng...) chạy bằng chính code game: web đang mở thì gửi lệnh 'op' cho game,
//   web tắt thì bot chạy code game trong trình duyệt ẩn (headless.js) rồi ghi lại save đám mây. Luật nằm trong game (window.BOTOPS).
// - Lệnh XEM chỉ đọc save đám mây.
// Mọi lệnh dùng được cả dạng slash (/giaban dat ...) lẫn prefix (j!giaban dat ...).
const { SlashCommandBuilder } = require('discord.js');
const engine = require('./engine');

let client = null, X = null; // X = helpers của extra-commands
const PREFIX_ALIAS = {};

// ---------------- danh mục (khớp game) ----------------
const FL = engine.F.map(f => [f.id, f.n]);
const UNL = engine.F.filter(f => f.u).map(f => [f.id, f.n]);
const SIZE = [['S', 'Giấy S'], ['M', 'Giấy M'], ['L', 'Giấy L']];
const PETS = [['cat', 'Mèo'], ['dog', 'Chó']];
const PET_ACT = [['pet', 'Vuốt ve'], ['play', 'Chơi cùng'], ['feed', 'Cho ăn (2.000đ)']];
const FURN = [['den', 'Dây đèn', 40000], ['tham', 'Thảm đỏ', 60000], ['tranh', 'Tranh treo', 50000], ['dh', 'Đồng hồ', 70000],
  ['neon', 'Biển neon OPEN', 90000], ['chau', 'Chậu cây', 45000], ['ghe', 'Ghế dài', 55000], ['long', 'Đèn lồng', 55000],
  ['ban', 'Bàn trà', 65000], ['phun', 'Đài phun nước', 120000], ['tho', 'Tượng thỏ', 45000], ['guong', 'Gương treo', 60000],
  ['bien', 'Bảng giá nhỏ', 35000], ['chim', 'Chuồng chim', 55000]];
const BANKS = [
  ['Vietcombank', [2.1, 2.4, 3.0, 5.4, 5.4, 5.5]], ['VietinBank', [4.8, 4.8, 6.6, 6.8, 5.4, 5.5]],
  ['Agribank', [4.75, 4.75, 6.6, 6.8, 6.8, 6.8]], ['BIDV', [4.8, 4.8, 6.6, 6.8, 6.6, 6.8]],
  ['Techcombank', [4.15, 4.45, 5.15, 5.35, 5.85, 5.85]], ['VPBank', [4.75, 4.75, 6.6, 6.7, 7.4, 7.1]],
  ['MBBank', [4.5, 4.65, 5.2, 5.8, 6.3, 7.0]], ['ACB', [4.5, 4.5, 4.5, 5.3, 5.3, 5.3]],
  ['TPBank', [4.75, 4.75, 5.5, 5.7, 5.7, 5.8]], ['VIB', [4.4, 4.5, 5.7, 7.0, 5.9, 6.0]]];
const TERMS = [1, 3, 6, 12, 18, 24];
const TERM_CH = [[0, 'Không kỳ hạn'], ...TERMS.map(t => [t, `${t} tháng`])];
const rateOf = (b, t) => (t === 0 ? 0.1 : BANKS[b][1][TERMS.indexOf(t)]);
const ACH = [
  ['a1', 'Bán đơn đầu tiên', s => s.sv >= 1, 'XP 20'],
  ['a2', 'Phục vụ 25 khách', s => s.sv >= 25, '30.000đ'],
  ['a3', 'Phục vụ 100 khách', s => s.sv >= 100, 'XP 150 · 20 hồng'],
  ['a4', '10 đánh giá 5 sao', s => s.five >= 10, '50.000đ'],
  ['a5', '50 đánh giá 5 sao', s => s.five >= 50, 'XP 200 · 100.000đ'],
  ['a6', 'Sống sót 7 ngày', s => s.day >= 8, 'XP 80'],
  ['a7', 'Sống sót 30 ngày', s => s.day >= 31, '200.000đ · 30 cúc họa mi'],
  ['a8', 'Doanh thu 1.000.000đ', s => s.rev >= 1e6, '100.000đ'],
  ['a9', 'Doanh thu 10.000.000đ', s => s.rev >= 1e7, 'XP 400 · 500.000đ'],
  ['a10', 'Đạt cấp 5', s => lvOf(s.xp || 0) >= 5, '100.000đ'],
  ['a11', 'Nhận nuôi thú cưng', s => !!(s.po && (s.po.cat || s.po.dog)), 'XP 60'],
  ['a12', 'Có 25 hóa đơn', s => Math.max(s.bt || 0, (s.bills || []).length) >= 25, 'XP 100'],
  ['d100', 'Hoàn thành 100 ngày', s => s.day >= 101, 'XP 1000 · 1.000.000đ · khung avatar động'],
];
const lvOf = (x) => { let l = 1; while (30 * l * (l + 1) <= x) l++; return l; };

// ---------------- tiện ích ----------------
const stripVN = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const parseMoney = (t) => {
  const m = /^(\d[\d.,]*)([kKmM]?)$/.exec(String(t || ''));
  if (!m) return null;
  const n = Number(m[1].replace(/[.,]/g, ''));
  return Math.round(n * (/k/i.test(m[2]) ? 1e3 : /m/i.test(m[2]) ? 1e6 : 1));
};
const short = (n) => (n >= 1e6 && n % 1e5 === 0 ? `${n / 1e6}tr` : n % 1000 === 0 ? `${n / 1000}k` : String(n));
const bar = (a, b, w = 10) => { const p = b > 0 ? Math.max(0, Math.min(1, a / b)) : 0; return '█'.repeat(Math.round(p * w)) + '░'.repeat(w - Math.round(p * w)); };

function pickChoice(list, text) {
  const t = stripVN(text);
  if (!t) return null;
  let hit = list.find(c => stripVN(String(c[0])) === t) || list.find(c => stripVN(c[1]) === t);
  if (hit) return String(hit[0]);
  const part = list.filter(c => stripVN(c[1]).includes(t));
  return part.length === 1 ? String(part[0][0]) : null;
}

// ---------------- mô tả lệnh (một nơi, sinh cả slash lẫn prefix) ----------------
// a: tham số theo thứ tự (bắt buộc đứng trước tùy chọn). t: choice | money | int | bool | str
const SPEC = {
  giaban: {
    d: 'Xem và chỉnh giá bán các bó hoa', al: ['gb', 'price'], subs: {
      xem: { d: 'Xem giá bán hiện tại của các loại hoa đang bán', al: ['ls'] },
      dat: { d: 'Đặt giá bán cho một loại hoa và size giấy', al: ['set'], a: [
        { n: 'hoa', d: 'Loại hoa', t: 'choice', c: FL }, { n: 'giay', d: 'Size giấy', t: 'choice', c: SIZE },
        { n: 'gia', d: 'Giá bán, vd 90000 hoặc 90k', t: 'money', min: 1000, max: 100000000 }] },
      macdinh: { d: 'Đặt lại toàn bộ giá về mặc định', al: ['reset'] },
      loinhuan: { d: 'Đặt lãi chung cho mọi món (so với giá vốn)', al: ['lai'], a: [
        { n: 'phantram', d: 'Lãi % so với vốn (0-200)', t: 'int', min: 0, max: 200 }] },
    },
  },
  nangcap: {
    d: 'Nâng cấp quầy, quảng bá VIP, mở khóa hoa hiếm', al: ['nc', 'up'], subs: {
      xem: { d: 'Xem các nâng cấp và giá' },
      quay: { d: 'Nâng cấp quầy xịn lên một cấp' },
      vip: { d: 'Nâng cấp quảng bá khách VIP lên một cấp' },
      mokhoa: { d: 'Mở khóa một loại hoa hiếm', a: [{ n: 'hoa', d: 'Loại hoa cần mở khóa', t: 'choice', c: UNL }] },
    },
  },
  nhiemvu: {
    d: 'Nhiệm vụ của tiệm (vòng nhiệm vụ và nhiệm vụ nhanh)', al: ['nvu', 'quest'], subs: {
      xem: { d: 'Xem nhiệm vụ và tiến độ' },
      nhan: { d: 'Nhận thưởng nhiệm vụ đã xong (bỏ trống là nhận hết)', a: [
        { n: 'so', d: 'Số nhiệm vụ (1-5)', t: 'int', min: 1, max: 5, opt: true }] },
      nhanh: { d: 'Nhận thưởng nhiệm vụ nhanh đã xong (bỏ trống là nhận hết)', a: [
        { n: 'so', d: 'Số nhiệm vụ nhanh (1-3)', t: 'int', min: 1, max: 3, opt: true }] },
      lammoi: { d: 'Làm mới nhiệm vụ nhanh (miễn phí 1 lần mỗi ngày game)' },
    },
  },
  thanhtuu: {
    d: 'Thành tích của tiệm', al: ['tt', 'ach'], subs: {
      xem: { d: 'Xem thành tích' },
      nhan: { d: 'Nhận thưởng thành tích đã xong (bỏ trống là nhận hết)', a: [
        { n: 'ma', d: 'Thành tích muốn nhận', t: 'choice', c: ACH.map(a => [a[0], a[1]]), opt: true }] },
    },
  },
  thucung: {
    d: 'Mèo và chó của tiệm', al: ['pet', 'tc'], subs: {
      xem: { d: 'Xem thú cưng' },
      nhannuoi: { d: 'Nhận nuôi thú cưng (200.000đ)', al: ['nhan', 'mua'], a: [{ n: 'loai', d: 'Mèo hay chó', t: 'choice', c: PETS }] },
      cham: { d: 'Chăm sóc thú cưng', al: ['choi'], a: [
        { n: 'loai', d: 'Mèo hay chó', t: 'choice', c: PETS }, { n: 'viec', d: 'Làm gì', t: 'choice', c: PET_ACT }] },
    },
  },
  noithat: {
    d: 'Nội thất cho quầy (tăng tỉ lệ khách VIP)', al: ['nt', 'furn'], subs: {
      xem: { d: 'Xem nội thất' },
      mua: { d: 'Mua một món nội thất', a: [{ n: 'mon', d: 'Món nội thất', t: 'choice', c: FURN.map(f => [f[0], f[1]]) }] },
      bay: { d: 'Bày hoặc cất một món nội thất đã mua', al: ['cat'], a: [{ n: 'mon', d: 'Món nội thất', t: 'choice', c: FURN.map(f => [f[0], f[1]]) }] },
    },
  },
  nganhang: {
    d: 'Gửi tiết kiệm trong game', al: ['nh', 'bank'], subs: {
      xem: { d: 'Xem các khoản gửi và lãi suất' },
      gui: { d: 'Gửi tiết kiệm', a: [
        { n: 'nganhang', d: 'Ngân hàng', t: 'choice', c: BANKS.map((b, n) => [n, b[0]]) },
        { n: 'kyhan', d: 'Kỳ hạn', t: 'choice', c: TERM_CH },
        { n: 'sotien', d: 'Số tiền, từ 100.000đ (vd 1m)', t: 'money', min: 100000, max: 2000000000 }] },
      rut: { d: 'Rút một khoản gửi', a: [
        { n: 'so', d: 'Số thứ tự khoản gửi (xem ở /nganhang xem)', t: 'int', min: 1, max: 50 },
        { n: 'rutsom', d: 'Đồng ý rút trước hạn (chỉ nhận lãi không kỳ hạn)', t: 'bool', opt: true }] },
    },
  },
  nhanvien: {
    d: 'Nhân viên cố định của tiệm', al: ['nvien', 'staff'], subs: {
      xem: { d: 'Xem nhân viên và các gói thuê' },
      tuyen: { d: 'Tuyển thêm một nhân viên cố định' },
      nangcap: { d: 'Nâng cấp một nhân viên', a: [{ n: 'so', d: 'Số thứ tự nhân viên (xem ở /nhanvien xem)', t: 'int', min: 1, max: 6 }] },
    },
  },
  quanlycn: {
    d: 'Mở và nâng cấp chi nhánh (xem tiến trình bằng /chinhanh)', al: ['qlcn'], subs: {
      mo: { d: 'Mở thêm một chi nhánh' },
      nangcap: { d: 'Nâng cấp một chi nhánh', a: [{ n: 'so', d: 'Số thứ tự chi nhánh (1-5)', t: 'int', min: 1, max: 5 }] },
    },
  },
  tuido: { d: 'Xem kho hoa, giấy gói và quà tặng', al: ['kho', 'bag'], flat: true },
  thongke: { d: 'Thống kê doanh thu, lợi nhuận và chi tiêu', al: ['tk', 'stat'], flat: true },
};

function addOpt(c, a) {
  const req = !a.opt;
  if (a.t === 'int' || a.t === 'money') c.addIntegerOption(o => o.setName(a.n).setDescription(a.d).setRequired(req).setMinValue(a.min ?? 1).setMaxValue(a.max ?? 2000000000));
  else if (a.t === 'bool') c.addBooleanOption(o => o.setName(a.n).setDescription(a.d).setRequired(req));
  else c.addStringOption(o => { o.setName(a.n).setDescription(a.d).setRequired(req); if (a.c) o.addChoices(...a.c.map(([v, n]) => ({ name: n, value: String(v) }))); return o; });
}
function buildSlash(name, sp) {
  const b = new SlashCommandBuilder().setName(name).setDescription(sp.d);
  if (sp.flat) return b.toJSON();
  for (const [sub, ss] of Object.entries(sp.subs)) {
    b.addSubcommand(c => { c.setName(sub).setDescription(ss.d); (ss.a || []).forEach(a => addOpt(c, a)); return c; });
  }
  return b.toJSON();
}
const commands = Object.entries(SPEC).map(([n, sp]) => buildSlash(n, sp));

// ---------------- đọc tham số: slash và prefix ----------------
function argsFromSlash(i, ss) {
  const o = {};
  for (const a of (ss.a || [])) {
    if (a.t === 'int' || a.t === 'money') o[a.n] = i.options.getInteger(a.n);
    else if (a.t === 'bool') o[a.n] = i.options.getBoolean ? i.options.getBoolean(a.n) : null;
    else o[a.n] = i.options.getString(a.n);
  }
  return o;
}
function usageOf(name, sub, ss, prefix) {
  const parts = (ss.a || []).map(a => (a.opt ? `[${a.n}]` : `<${a.n}>`));
  return `\`${prefix}${name}${sub ? ' ' + sub : ''}${parts.length ? ' ' + parts.join(' ') : ''}\``;
}
function argsFromPrefix(name, sub, ss, toks, prefix) {
  const o = {}, bad = (t) => { const e = new Error(`${t}\nCú pháp: ${usageOf(name, sub, ss, prefix)}`); e.usage = true; throw e; };
  let k = 0;
  for (const a of (ss.a || [])) {
    if (k >= toks.length) { if (a.opt) continue; bad(`Thiếu tham số **${a.n}**.`); }
    if (a.t === 'choice') {
      let found = null;
      for (let len = Math.min(toks.length - k, 4); len >= 1 && found == null; len--) {
        const v = pickChoice(a.c, toks.slice(k, k + len).join(' '));
        if (v != null) { found = v; k += len; }
      }
      if (found == null) { if (a.opt) continue; bad(`Không hiểu "${toks.slice(k).join(' ')}" cho **${a.n}**. Gõ tên đầy đủ hơn.`); }
      o[a.n] = found;
    } else if (a.t === 'money') {
      const v = parseMoney(toks[k]);
      if (!v || v < (a.min ?? 1) || v > (a.max ?? 2e9)) bad(`**${a.n}** không hợp lệ (nhập kiểu 90000, 90k hoặc 1m).`);
      o[a.n] = v; k++;
    } else if (a.t === 'int') {
      const v = parseInt(toks[k], 10);
      if (!(v >= (a.min ?? 1) && v <= (a.max ?? 2e9))) bad(`**${a.n}** phải là số từ ${a.min ?? 1} đến ${a.max ?? 2e9}.`);
      o[a.n] = v; k++;
    } else if (a.t === 'bool') {
      o[a.n] = /^(rutsom|som|co|yes|y|true|1|dongy|ok)$/.test(stripVN(toks[k])); k++;
    } else { o[a.n] = toks.slice(k).join(' '); k = toks.length; }
  }
  return o;
}
function resolveSub(sp, tok) {
  if (sp.flat) return null;
  const t = stripVN(tok || '');
  if (!t) return 'xem';
  for (const [n, ss] of Object.entries(sp.subs)) if (n === t || (ss.al || []).includes(t)) return n;
  return undefined;
}

// ---------------- hiển thị ----------------
const H = (...a) => X.H(...a);
const EM = () => X.EM;
const layout = (...a) => X.layout(...a);
const clip = (v, n) => X.clip(v, n);
const vnd = (n) => X.vnd(n);
const footer = (sv, via) => `-# ${EM().a} Justaseed • dữ liệu ${X.stamp(sv && sv.at)}${via === 'bot' ? ` · ${EM().wait} web đang tắt, bot làm thẳng trên save đám mây` : ''}`;

async function doOp(i, uid, title, op, args) {
  return X.withLock(uid, i, async () => {
    try {
      const r = await X.gameOp(uid, op, args);
      if (r.queued) return X.say(i, `${EM().wait} ${r.msg}`);
      return i.editReply(layout([H(title, EM().ok), clip(r.msg, 900),
        `-# ${EM().a} Justaseed${r.via === 'bot' ? ` · ${EM().wait} web đang tắt, bot làm thẳng trên save đám mây` : ''}`]));
    } catch (e) {
      return X.say(i, `${EM().no} ${clip(e && e.message || e, 400)}`);
    }
  });
}
async function readSave(i, uid) {
  const sv = await X.loadFresh(uid);
  if (!sv) { await X.say(i, X.NO_SAVE); return null; }
  return sv;
}

// ---------------- giá / công thức giống game ----------------
const KSZ = { S: 3, M: 5, L: 10 };
const baseC = (id) => engine.byId[id].c;
const costOf = (f, z) => KSZ[z] * baseC(f) + baseC(z);
const sugOf = (f, z) => Math.round(costOf(f, z) * 2.1 / 1000) * 1000; // vốn + 110% (MARK = 1.1 trong game)
const maxOf = (f, z) => Math.round(sugOf(f, z) * 1.3 / 1000) * 1000;
const priceOf = (s, f, z) => (Number.isFinite(s.pr && s.pr[f + z]) ? s.pr[f + z] : sugOf(f, z));
const openFlowers = (s) => engine.F.filter(f => engine.unlocked(s, f));
const nameOf = (id) => (engine.byId[id] ? engine.byId[id].n : id);

// ---------------- các lệnh XEM ----------------
const HANDLERS = {
  giaban: {
    async xem(i, uid) {
      const sv = await readSave(i, uid); if (!sv) return;
      const s = sv.s, fs = openFlowers(s);
      if (!fs.length) return X.say(i, 'Bạn chưa mở khóa hoa nào để bán.');
      const rows = fs.map(f => `**${f.n}** · ${SIZE.map(([z]) => { const p = priceOf(s, f.id, z); return `${z} ${short(p)}${s.pr && Number.isFinite(s.pr[f.id + z]) ? '*' : ''}`; }).join(' · ')}`);
      return i.editReply(layout([H('Giá bán', EM().shop),
        rows.join('\n').slice(0, 3500),
        { sep: true },
        `-# * = giá bạn tự đặt · mặc định = vốn +110% · tối đa +30% so với giá gợi ý · thấp nhất bằng vốn`,
        `-# Đổi giá: \`/giaban dat\`, \`/giaban loinhuan\`, \`/giaban macdinh\``,
        footer(sv)]));
    },
    dat: (i, uid, a) => doOp(i, uid, 'Đặt giá bán', 'price_set', { f: a.hoa, p: a.giay, v: a.gia }),
    macdinh: (i, uid) => doOp(i, uid, 'Giá mặc định', 'price_reset', {}),
    loinhuan: (i, uid, a) => doOp(i, uid, 'Đặt lãi chung', 'price_pct', { pct: a.phantram }),
  },

  nangcap: {
    async xem(i, uid) {
      const sv = await readSave(i, uid); if (!sv) return;
      const s = sv.s, lv = lvOf(s.xp || 0), up = s.up || 0, vl = s.vl || 0, cap = Math.min(5, Math.floor(lv / 2));
      const lock = engine.F.filter(f => f.u).map(f => `${(s.un || {})[f.id] ? EM().ok : EM().lock} ${f.n} · ${vnd(f.u)}`);
      return i.editReply(layout([H('Nâng cấp', EM().shop),
        `${EM().a} **Quầy xịn** cấp **${up}/5** ${up < 5 ? `· lên cấp tiếp: ${vnd(250000 * (up + 1))}${up >= cap ? ` (cần cấp độ ${(up + 1) * 2}, bạn đang cấp ${lv})` : ''}` : '(tối đa)'}\n-# +8 giây kiên nhẫn, thêm khách · cấp quầy tối đa = cấp độ ÷ 2`,
        `${EM().b} **Quảng bá khách VIP** cấp **${vl}/5** ${vl < 5 ? `· lên cấp tiếp: ${vnd(150000 * (vl + 1))}` : '(tối đa)'}\n-# +4% khách VIP mỗi cấp`,
        { sep: true },
        `${EM().deco} **Mở khóa hoa hiếm**\n${lock.join('\n')}`.slice(0, 3000),
        { sep: true },
        `-# \`/nangcap quay\` · \`/nangcap vip\` · \`/nangcap mokhoa <hoa>\``,
        footer(sv)]));
    },
    quay: (i, uid) => doOp(i, uid, 'Nâng cấp quầy', 'buy_up', {}),
    vip: (i, uid) => doOp(i, uid, 'Quảng bá VIP', 'buy_vip', {}),
    mokhoa: (i, uid, a) => doOp(i, uid, 'Mở khóa hoa', 'unlock', { id: a.hoa }),
  },

  nhiemvu: {
    async xem(i, uid) {
      const sv = await readSave(i, uid); if (!sv) return;
      const s = sv.s, r = s.qr || 0, b = s.qb || { sv: 0, five: 0, rev: 0, day: 1, vn: 0 }, m = r + 1, cl = s.cl || {};
      const Q = [
        [`Phục vụ ${5 * m} khách`, (s.sv || 0) - b.sv, 5 * m, 50000 * m],
        [`Đạt ${3 * m} đánh giá 5 sao`, (s.five || 0) - b.five, 3 * m, 80000 * m],
        [`Doanh thu thêm ${vnd(500000 * m)}`, (s.rev || 0) - b.rev, 500000 * m, 100000 * m],
        [`Sống sót thêm ${3 * m} ngày`, (s.day || 1) - b.day, 3 * m, 60000 * m],
        [`Phục vụ ${2 * m} khách VIP`, (s.vn || 0) - (b.vn || 0), 2 * m, 90000 * m],
      ].map((q, k) => `${cl[k] ? EM().ok : q[1] >= q[2] ? EM().gift : EM().wait} **${k + 1}.** ${q[0]} · ${Math.min(q[1], q[2]).toLocaleString('vi-VN')}/${q[2].toLocaleString('vi-VN')} · thưởng ${vnd(q[3])}${cl[k] ? ' (đã nhận)' : q[1] >= q[2] ? ' → nhận được!' : ''}`);
      const QT = [['Phục vụ thêm {n} khách', 'sv'], ['Nhận thêm {n} đánh giá 5 sao', 'five'], ['Kiếm thêm {n} doanh thu', 'rev']];
      const qq = (s.qq || []).map((q, k) => {
        const t = QT[k] || ['Nhiệm vụ', 'sv'], p = Math.min(q.n, (s[t[1]] || 0) - q.b), isRev = t[1] === 'rev';
        const fmt = (n) => (isRev ? vnd(n) : String(n));
        return `${q.c ? EM().ok : p >= q.n ? EM().gift : EM().wait} **${k + 1}.** ${t[0].replace('{n}', fmt(q.n))} · ${fmt(Math.max(0, p))}/${fmt(q.n)} · thưởng ${vnd(q.r)}${q.c ? ' (đã nhận)' : p >= q.n ? ' → nhận được!' : ''}`;
      });
      return i.editReply(layout([H(`Nhiệm vụ · vòng ${r + 1}`, EM().help),
        Q.join('\n'),
        { sep: true },
        `**Nhiệm vụ nhanh**\n${qq.length ? qq.join('\n') : 'Chưa có (mở tab Nhiệm vụ trong game một lần).'}`,
        { sep: true },
        `-# \`/nhiemvu nhan\` · \`/nhiemvu nhanh\` · \`/nhiemvu lammoi\``,
        footer(sv)]));
    },
    nhan: (i, uid, a) => doOp(i, uid, 'Nhận thưởng nhiệm vụ', 'quest_claim', { i: a.so || 'all' }),
    nhanh: (i, uid, a) => doOp(i, uid, 'Nhận nhiệm vụ nhanh', 'quick_claim', { i: a.so || 'all' }),
    lammoi: (i, uid) => doOp(i, uid, 'Làm mới nhiệm vụ nhanh', 'quick_refresh', {}),
  },

  thanhtuu: {
    async xem(i, uid) {
      const sv = await readSave(i, uid); if (!sv) return;
      const s = sv.s, ac = s.ac || {};
      let ok = 0, ready = 0;
      const rows = ACH.map(a => {
        let d = false; try { d = !!a[2](s); } catch (e) { /* bỏ qua */ }
        if (ac[a[0]]) ok++; else if (d) ready++;
        return `${ac[a[0]] ? EM().ok : d ? EM().gift : EM().wait} **${a[1]}** · ${a[3]}${!ac[a[0]] && d ? ' → nhận được!' : ''}`;
      });
      return i.editReply(layout([H('Thành tích', EM().star),
        `Đã nhận **${ok}/${ACH.length}**${ready ? ` · **${ready}** cái nhận được ngay` : ''}`,
        rows.join('\n').slice(0, 3500),
        { sep: true }, `-# \`/thanhtuu nhan\` để nhận hết`, footer(sv)]));
    },
    nhan: (i, uid, a) => doOp(i, uid, 'Nhận thành tích', 'ach_claim', { id: a.ma || 'all' }),
  },

  thucung: {
    async xem(i, uid) {
      const sv = await readSave(i, uid); if (!sv) return;
      const s = sv.s, po = s.po || {};
      const line = (k, ico, nm) => (po[k] && s[k]
        ? `${ico} **${nm} ${s[k].n}** · gắn bó **${s[k].bond || 0}**`
        : `${ico} **${nm}**: chưa nhận nuôi (200.000đ) → \`/thucung nhannuoi\``);
      return i.editReply(layout([H('Thú cưng', EM().gift), line('cat', EM().cat, 'Mèo'), line('dog', EM().dog, 'Chó'),
        { sep: true }, `-# \`/thucung cham <mèo|chó> <vuốt ve|chơi|cho ăn>\` · cho ăn tốn 2.000đ, tăng gắn bó nhiều hơn`, footer(sv)]));
    },
    nhannuoi: (i, uid, a) => doOp(i, uid, 'Nhận nuôi', 'pet_buy', { k: a.loai }),
    cham: (i, uid, a) => doOp(i, uid, 'Chăm thú cưng', 'pet_do', { k: a.loai, act: a.viec }),
  },

  noithat: {
    async xem(i, uid) {
      const sv = await readSave(i, uid); if (!sv) return;
      const fo = sv.s.fo || {};
      const rows = FURN.map(f => `${fo[f[0]] ? (fo[f[0]] === 1 ? EM().ok : EM().box) : EM().shop} **${f[1]}** · ${vnd(f[2])}${fo[f[0]] ? (fo[f[0]] === 1 ? ' · đang bày' : ' · đang cất') : ''}`);
      return i.editReply(layout([H('Nội thất', EM().shop), rows.join('\n'),
        { sep: true }, `-# ${EM().shop} chưa mua · ${EM().ok} đang bày · ${EM().box} đã cất · \`/noithat mua\` · \`/noithat bay\``, footer(sv)]));
    },
    mua: (i, uid, a) => doOp(i, uid, 'Mua nội thất', 'furn_buy', { k: a.mon }),
    bay: (i, uid, a) => doOp(i, uid, 'Bày / cất nội thất', 'furn_toggle', { k: a.mon }),
  },

  nganhang: {
    async xem(i, uid) {
      const sv = await readSave(i, uid); if (!sv) return;
      const s = sv.s, bk = (s.x2 && s.x2.bk) || [], hide = await X.hideBalOf(uid, s);
      const rows = bk.map((a, k) => {
        const days = (a.u ? a.m : Math.round((a.m || 0) * 30)) || 0, tot = (a.t || 0) * 30;
        const st = a.t ? (days >= tot ? `${EM().ok} đã đến hạn` : `${days}/${tot} ngày`) : 'không kỳ hạn';
        return `**${k + 1}.** ${BANKS[a.b] ? BANKS[a.b][0] : '?'} · ${hide ? '••••' : vnd(a.amt)} · ${a.t ? a.t + ' tháng' : 'không kỳ hạn'} · lãi ${a.r}%/năm · ${st}`;
      });
      const rateTxt = BANKS.map(b => `${b[0]}: ${b[1].join(' / ')}`).join('\n');
      return i.editReply(layout([H('Ngân hàng', EM().card),
        rows.length ? rows.join('\n') : 'Bạn chưa gửi khoản tiết kiệm nào.',
        { sep: true },
        `**Lãi suất %/năm** (kỳ hạn ${TERMS.join('/')} tháng)\n${rateTxt}`,
        `-# Tối thiểu 100.000đ · \`/nganhang gui\` · \`/nganhang rut <số>\` · rút trước hạn chỉ nhận lãi 0,1%/năm`,
        footer(sv)]));
    },
    gui: (i, uid, a) => doOp(i, uid, 'Gửi tiết kiệm', 'bank_dep', { b: Number(a.nganhang), t: Number(a.kyhan), a: a.sotien }),
    rut: (i, uid, a) => doOp(i, uid, 'Rút tiết kiệm', 'bank_wd', { i: a.so, force: !!a.rutsom }),
  },

  nhanvien: {
    async xem(i, uid) {
      const sv = await readSave(i, uid); if (!sv) return;
      const s = sv.s, stf = (s.x2 && s.x2.stf) || [];
      const gap = (l) => Math.max(4, Math.round((19 - 1.5 * l) * 10) / 10), wage = (l) => 20000 + 10000 * l;
      const upCost = (l) => Math.round(120000 * Math.pow(l, 1.7) / 1000) * 1000;
      const monthly = s.hm && typeof s.hm.e === 'number' && (s.hm.p || (s.day || 1) < s.hm.e);
      const pack = monthly ? `Nhân viên tháng (${s.hm.p ? 'đang nghỉ phép' : `còn ${s.hm.e - s.day} ngày`})` : s.hire ? 'Nhân viên theo ngày (hôm nay)' : 'Chưa thuê gói ngày/tháng';
      const rows = stf.map((t, k) => `**${k + 1}.** ${t.n} · cấp ${t.l}/10 · ${gap(t.l)} giây/đơn · lương ${vnd(wage(t.l))}/ngày${t.l < 10 ? ` · lên cấp: ${vnd(upCost(t.l))}` : ' (tối đa)'}`);
      return i.editReply(layout([H('Nhân viên', EM().person),
        `${EM().a} **Gói thuê:** ${pack}`,
        `${EM().b} **Nhân viên cố định (${stf.length}/6)**\n${rows.length ? rows.join('\n') : 'Chưa có.'}`,
        `-# Tuyển người tiếp theo: ${stf.length < 6 ? vnd(200000 + 150000 * stf.length) : 'đã đủ 6'} · \`/nhanvien tuyen\` · \`/nhanvien nangcap\` · thuê theo ngày/tháng: \`/gianhang thuenv\``,
        footer(sv)]));
    },
    tuyen: (i, uid) => doOp(i, uid, 'Tuyển nhân viên', 'staff_hire', {}),
    nangcap: (i, uid, a) => doOp(i, uid, 'Nâng cấp nhân viên', 'staff_up', { i: a.so }),
  },

  quanlycn: {
    mo: (i, uid) => doOp(i, uid, 'Mở chi nhánh', 'br_open', {}),
    nangcap: (i, uid, a) => doOp(i, uid, 'Nâng cấp chi nhánh', 'br_up', { i: a.so }),
  },

  async tuido(i, uid) {
    const sv = await readSave(i, uid); if (!sv) return;
    const s = sv.s, st = s.st || {};
    // mỗi món = emoji của món + số lượng viết nhỏ ngay sau (⁵⁰), 5 món một hàng cho đều và dễ quét mắt
    const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹', sup = (n) => String(n).replace(/\d/g, (d) => SUP[d]);
    const generic = new Set([EM().box, EM().flower]);
    const cell = (x) => { const e = X.itemEmoji(x.id); return `${generic.has(e) ? `**${x.n}**` : e}${sup(st[x.id])}`; }; // chưa có emoji riêng thì ghi tên
    const sect = (ico, title, list) => {
      const have = list.filter(x => (st[x.id] || 0) > 0), total = have.reduce((a, x) => a + st[x.id], 0), cells = have.map(cell), rows = [];
      for (let k = 0; k < cells.length; k += 5) rows.push(cells.slice(k, k + 5).join('   '));
      return `${ico} **${title}**${have.length ? ` · ${total}` : ''}\n${rows.length ? rows.join('\n') : '*Trống*'}`.slice(0, 1800);
    };
    return i.editReply(layout([H('Túi đồ', EM().box),
      sect(EM().flower, 'Hoa', engine.F),
      { sep: true },
      sect(EM().help, 'Giấy gói', engine.PAPER),
      { sep: true },
      sect(EM().gift, 'Quà tặng', engine.GIFT),
      { sep: true }, `-# Số nhỏ cạnh biểu tượng là số lượng · hoa dư hỏng khoảng 60% qua đêm, giấy và quà giữ được lâu · nhập hàng: \`/gianhang nhaphang\``, footer(sv)]));
  },

  async thongke(i, uid) {
    const sv = await readSave(i, uid); if (!sv) return;
    const s = sv.s, lv = lvOf(s.xp || 0), led = s.led || [], day = s.day || 1;
    const sum = (d, k) => led.filter(e => e.d === d && e.k === k).reduce((a, e) => a + (Number(e.amt) || 0), 0);
    const byCat = (d) => {
      const m = {};
      led.filter(e => e.d === d && e.k === 'out').forEach(e => { m[e.cat] = (m[e.cat] || 0) + (Number(e.amt) || 0); });
      return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, v]) => `${c} ${vnd(v)}`).join(' · ');
    };
    const h = (s.h || []).slice(-5);
    const r = s.rpt;
    const blocks = [H(clip((s.pf && s.pf.nm) || s.name || 'Thống kê', 40), EM().star),
      `${EM().a} **Ngày** ${day} · **Cấp độ** ${lv} · **Uy tín** ${(Number(s.rep) || 0).toFixed(1)}\n${EM().b} **Khách đã phục vụ** ${(s.sv || 0).toLocaleString('vi-VN')} · **Đánh giá 5 sao** ${s.five || 0}\n${EM().a} **Tổng doanh thu** ${vnd(s.rev)}`];
    if (r) blocks.push(`${EM().deco} **Ngày ${day - 1} vừa xong**\nDoanh thu ${vnd(r.rev)} · lợi nhuận ${r.pf >= 0 ? '' : '-'}${vnd(Math.abs(r.pf))} · ${r.n} khách, ${r.lost} bỏ đi`);
    if (h.length) blocks.push(`${EM().chart} **Lợi nhuận ${h.length} ngày gần nhất**\n${h.map(v => `${v >= 0 ? '▲' : '▼'} ${vnd(v)}`).join('  ')}`);
    const spent = [day, day - 1].filter(d => d >= 1).map(d => ({ d, out: sum(d, 'out'), cat: byCat(d) })).filter(x => x.out > 0);
    if (spent.length) blocks.push(`${EM().spend} **Chi tiêu**\n${spent.map(x => `Ngày ${x.d}: ${vnd(x.out)}${x.cat ? ` (${x.cat})` : ''}`).join('\n')}`);
    blocks.push({ sep: true }, footer(sv));
    return i.editReply(layout(blocks));
  },
};

// ---------------- op cho bảng điều khiển gian hàng (shop-hub.js) ----------------
// khóa 'lệnh.lệnhcon' -> [tên op trong game, tham số]; khớp đúng các hàm trong HANDLERS ở trên
const OPS = {
  'giaban.dat': (a) => ['price_set', { f: a.hoa, p: a.giay, v: a.gia }],
  'giaban.macdinh': () => ['price_reset', {}],
  'giaban.loinhuan': (a) => ['price_pct', { pct: a.phantram }],
  'nangcap.quay': () => ['buy_up', {}],
  'nangcap.vip': () => ['buy_vip', {}],
  'nangcap.mokhoa': (a) => ['unlock', { id: a.hoa }],
  'nhiemvu.nhan': (a) => ['quest_claim', { i: a.so || 'all' }],
  'nhiemvu.nhanh': (a) => ['quick_claim', { i: a.so || 'all' }],
  'nhiemvu.lammoi': () => ['quick_refresh', {}],
  'thanhtuu.nhan': (a) => ['ach_claim', { id: a.ma || 'all' }],
  'thucung.nhannuoi': (a) => ['pet_buy', { k: a.loai }],
  'thucung.cham': (a) => ['pet_do', { k: a.loai, act: a.viec }],
  'noithat.mua': (a) => ['furn_buy', { k: a.mon }],
  'noithat.bay': (a) => ['furn_toggle', { k: a.mon }],
  'nganhang.gui': (a) => ['bank_dep', { b: Number(a.nganhang), t: Number(a.kyhan), a: a.sotien }],
  'nganhang.rut': (a) => ['bank_wd', { i: a.so, force: !!a.rutsom }],
  'nhanvien.tuyen': () => ['staff_hire', {}],
  'nhanvien.nangcap': (a) => ['staff_up', { i: a.so }],
};

// ---------------- điều phối ----------------
async function run(i, name, sub, a) {
  await i.deferReply();
  const uid = await X.userIdOf(i.user.id);
  if (!uid) return X.say(i, X.NOT_LINKED);
  const sp = SPEC[name];
  const fn = sp.flat ? HANDLERS[name] : HANDLERS[name][sub];
  return fn(i, uid, a || {});
}

async function onSlash(i) {
  const sp = SPEC[i.commandName];
  if (!sp) return;
  const sub = sp.flat ? null : i.options.getSubcommand();
  const ss = sp.flat ? {} : sp.subs[sub];
  return run(i, i.commandName, sub, argsFromSlash(i, ss));
}

function helpBody() {
  const p = X.PREFIX, a = EM().a, b = EM().b;
  return [
    `${a} **\`${p}giaban\`** · xem giá · **\`dat <hoa> <S|M|L> <giá>\`** · **\`loinhuan <%>\`** · **\`macdinh\`**`,
    `${b} **\`${p}nangcap\`** · xem · **\`quay\`** · **\`vip\`** · **\`mokhoa <hoa>\`**`,
    `${a} **\`${p}nhiemvu\`** · xem · **\`nhan [số]\`** · **\`nhanh [số]\`** · **\`lammoi\`**`,
    `${b} **\`${p}thanhtuu\`** · xem · **\`nhan [mã]\`**`,
    `${a} **\`${p}thucung\`** · xem · **\`nhannuoi <mèo|chó>\`** · **\`cham <mèo|chó> <vuốt ve|chơi|cho ăn>\`**`,
    `${b} **\`${p}noithat\`** · xem · **\`mua <món>\`** · **\`bay <món>\`** (bày/cất)`,
    `${a} **\`${p}nganhang\`** · xem · **\`gui <ngân hàng> <kỳ hạn> <số tiền>\`** · **\`rut <số> [rutsom]\`**`,
    `${b} **\`${p}nhanvien\`** · xem · **\`tuyen\`** · **\`nangcap <số>\`**`,
    `${a} **\`${p}quanlycn\`** · **\`mo\`** · **\`nangcap <số>\`** (xem chi nhánh: \`${p}chinhanh\`)`,
    `${b} **\`${p}tuido\`** · kho hoa, giấy, quà · **\`${p}thongke\`** · doanh thu, lợi nhuận, chi tiêu`,
    `${EM().tip} Mọi lệnh có cả dạng \`/lệnh\`. Lệnh đổi dữ liệu chạy ngay trong game nếu web đang mở, còn web tắt thì bot làm thẳng trên bản lưu đám mây.`,
    `${EM().tip} Ví dụ: \`${p}giaban dat hồng M 120k\`, \`${p}nganhang gui vietcombank 12 5m\`, \`${p}nangcap mokhoa tulip\`.`,
  ].join('\n\n');
}

function registerPrefix(prefixCommands) {
  for (const [name, sp] of Object.entries(SPEC)) {
    const runner = async (ctx) => {
      const prefix = X.PREFIX;
      const toks = ctx.args || [];
      let sub = null, a = {};
      try {
        if (!sp.flat) {
          sub = resolveSub(sp, toks[0]);
          if (sub === undefined) {
            const e = new Error(`Lệnh con không có. Dùng: ${Object.keys(sp.subs).map(s => `\`${s}\``).join(', ')} (xem \`${prefix}help\`).`); e.usage = true; throw e;
          }
          const ss = sp.subs[sub];
          const rest = (toks[0] && stripVN(toks[0]) !== sub && !(ss.al || []).includes(stripVN(toks[0])) ? toks : toks.slice(1));
          a = argsFromPrefix(name, sub, ss, rest, prefix);
        }
      } catch (e) {
        if (e.usage) return ctx.msg.reply({ ...layout([`${EM().no} ${e.message}`]), failIfNotExists: false }).catch(() => {});
        throw e;
      }
      return run(ctx, name, sub, a);
    };
    prefixCommands[name] = runner;
    for (const al of sp.al || []) prefixCommands[al] = runner;
  }
}

function init(discordClient, helpers) {
  client = discordClient; X = helpers;
  client.on('interactionCreate', (i) => {
    if (!i.isChatInputCommand() || !SPEC[i.commandName]) return;
    onSlash(i).catch(async (err) => {
      console.error('[game-cmds] lỗi lệnh', i.commandName, err);
      try {
        const m = layout(['Có lỗi xảy ra, thử lại sau nhé.']);
        if (i.deferred || i.replied) await i.editReply({ ...m, attachments: [] }); else await i.reply({ ...m, flags: X.V2 | X.EPH });
      } catch (e) { /* bỏ qua */ }
    });
  });
  if (X.addHelpPage) {
    X.addHelpPage('game', {
      label: 'Quản lý tiệm', desc: 'Giá bán, nâng cấp, nhiệm vụ, thú cưng, ngân hàng...', emoji: () => EM().shop,
      title: 'Quản lý tiệm', ico: () => EM().shop, body: helpBody,
    });
  }
}

module.exports = { commands, init, registerPrefix, SPEC, HANDLERS, OPS, FURN, _t: { parseMoney, pickChoice, argsFromPrefix, resolveSub, costOf, sugOf, maxOf, stripVN } };
