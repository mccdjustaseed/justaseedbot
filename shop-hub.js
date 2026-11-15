// shop-hub.js : bảng điều khiển gian hàng — MỘT tin nhắn layout gom toàn bộ tính năng của tiệm.
// Mở bằng j!gianhang (hoặc /gianhang trangthai). Chọn mục ở menu trên cùng; mỗi mục có nút thao tác riêng.
// Mọi thao tác dùng lại đúng lệnh có sẵn (cmdShop, nhập hàng, và các op của game-cmds) nên luật chơi không đổi.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const headless = require('./headless');
const engine = require('./engine');
const gc = require('./game-cmds');

let X = null; // helpers của extra-commands (+ shopApi)
const lvOf = (x) => { let l = 1; while (30 * l * (l + 1) <= x) l++; return l; };
const clip = (v, n) => String(v ?? '').slice(0, n);

const TABS = () => {
  const E = X.EM;
  return [
    ['home', 'Tổng quan', 'Tình hình, mở bán, sang ngày mới', E.shop],
    ['nhap', 'Nhập hàng', 'Hoa, giấy gói, quà, đồ mưa nắng', E.box],
    ['gia', 'Giá bán', 'Xem và chỉnh giá từng món', E.money],
    ['nv', 'Nhân viên', 'Tuyển, nâng cấp, thuê theo ngày/tháng', E.person],
    ['nc', 'Nâng cấp', 'Quầy xịn, khách VIP, mở khóa hoa', E.star],
    ['nvu', 'Nhiệm vụ', 'Nhiệm vụ và nhiệm vụ nhanh', E.help],
    ['tt', 'Thành tích', 'Xem và nhận thưởng', E.ok],
    ['tc', 'Thú cưng', 'Mèo và chó của tiệm', E.cat],
    ['nt', 'Nội thất', 'Mua, bày, cất', E.heart],
    ['nh', 'Ngân hàng', 'Gửi và rút tiết kiệm', E.card],
    ['kho', 'Túi đồ', 'Kho hoa, giấy gói, quà', E.flower],
    ['tk', 'Thống kê', 'Doanh thu, lợi nhuận, chi tiêu', E.chart],
  ];
};
// mục xem được lấy từ game-cmds
const VIEW = () => ({
  gia: gc.HANDLERS.giaban.xem, nv: gc.HANDLERS.nhanvien.xem, nc: gc.HANDLERS.nangcap.xem, nvu: gc.HANDLERS.nhiemvu.xem,
  tt: gc.HANDLERS.thanhtuu.xem, tc: gc.HANDLERS.thucung.xem, nt: gc.HANDLERS.noithat.xem, nh: gc.HANDLERS.nganhang.xem,
  kho: gc.HANDLERS.tuido, tk: gc.HANDLERS.thongke,
});

const id = (owner, tab, act, arg) => `hb:${owner}:${tab}:${act}${arg ? ':' + arg : ''}`;
const btn = (owner, tab, act, label, emoji, style = ButtonStyle.Secondary, arg) => {
  const b = new ButtonBuilder().setCustomId(id(owner, tab, act, arg)).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
};
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const P = ButtonStyle.Primary, S = ButtonStyle.Success, D = ButtonStyle.Danger;

// ---------- hàng điều hướng + nút theo mục ----------
function navRows(owner, tab, s) {
  const E = X.EM, rows = [];
  const tabs = TABS();
  rows.push(row(new StringSelectMenuBuilder().setCustomId(id(owner, tab, 'nav')).setPlaceholder('Chọn mục quản lý gian hàng')
    .addOptions(tabs.map(([k, n, d, em]) => new StringSelectMenuOptionBuilder().setValue(k).setLabel(n).setDescription(d).setEmoji(em).setDefault(k === tab)))));
  const ph = (s && s.ph) || 'prep';
  const ref = btn(owner, tab, 'ref', 'Làm mới', E.refresh);
  if (tab === 'home') {
    if (ph === 'prep') {
      rows.push(row(btn(owner, tab, 'go', 'Nhập hàng', E.box, P, 'nhap'), btn(owner, tab, 'mo', 'Mở bán', E.shop, S),
        btn(owner, tab, 'hire', 'Thuê NV ngày', E.person, ButtonStyle.Secondary, 'ngay'),
        btn(owner, tab, 'hire', 'Thuê NV tháng', E.person, ButtonStyle.Secondary, 'thang'), ref));
      rows.push(row(new StringSelectMenuBuilder().setCustomId(id(owner, tab, 'open')).setPlaceholder('Mở bán và chọn thời gian bán…')
        .addOptions([['240', '4 phút'], ['480', '8 phút'], ['900', '15 phút'], ['1800', '30 phút (cần cấp 20)'], ['3600', '1 giờ (cần cấp 50)']]
          .map(([v, n]) => new StringSelectMenuOptionBuilder().setValue(v).setLabel(n).setEmoji(E.clock)))));
    } else if (ph === 'end') rows.push(row(btn(owner, tab, 'next', 'Sang ngày mới', E.shop, S), ref));
    else rows.push(row(ref));
  } else if (tab === 'gia') {
    rows.push(row(btn(owner, tab, 'dat', 'Đặt giá một món', E.money, P), btn(owner, tab, 'loinhuan', 'Đặt lãi chung', E.money),
      btn(owner, tab, 'macdinh', 'Về giá mặc định', E.refresh, D), ref));
  } else if (tab === 'nv') {
    rows.push(row(btn(owner, tab, 'tuyen', 'Tuyển nhân viên', E.person, P), btn(owner, tab, 'nvup', 'Nâng cấp nhân viên', E.star),
      btn(owner, tab, 'hire', 'Thuê theo ngày', E.person, ButtonStyle.Secondary, 'ngay'),
      btn(owner, tab, 'hire', 'Thuê theo tháng', E.person, ButtonStyle.Secondary, 'thang'), ref));
  } else if (tab === 'nc') {
    rows.push(row(btn(owner, tab, 'quay', 'Nâng cấp quầy', E.shop, P), btn(owner, tab, 'vip', 'Quảng bá VIP', E.star, P), ref));
    const lock = engine.F.filter(f => f.u && !((s && s.un) || {})[f.id]);
    if (lock.length) rows.push(row(new StringSelectMenuBuilder().setCustomId(id(owner, tab, 'unl')).setPlaceholder('Mở khóa hoa hiếm…')
      .addOptions(lock.slice(0, 25).map(f => new StringSelectMenuOptionBuilder().setValue(f.id).setLabel(f.n).setDescription(X.vnd(f.u)).setEmoji(X.EM.flower)))));
  } else if (tab === 'nvu') {
    rows.push(row(btn(owner, tab, 'nvnhan', 'Nhận nhiệm vụ', E.gift, S), btn(owner, tab, 'nvnhanh', 'Nhận nhiệm vụ nhanh', E.gift, S),
      btn(owner, tab, 'nvmoi', 'Làm mới nhiệm vụ nhanh', E.refresh), ref));
  } else if (tab === 'tt') {
    rows.push(row(btn(owner, tab, 'ttnhan', 'Nhận hết thành tích', E.gift, S), ref));
  } else if (tab === 'tc') {
    rows.push(row(btn(owner, tab, 'adopt', 'Nhận nuôi mèo', E.cat, P, 'cat'), btn(owner, tab, 'adopt', 'Nhận nuôi chó', E.dog, P, 'dog'), ref));
    const o = [];
    for (const [k, n, em] of [['cat', 'Mèo', E.cat], ['dog', 'Chó', E.dog]]) for (const [a, an] of [['pet', 'Vuốt ve'], ['play', 'Chơi cùng'], ['feed', 'Cho ăn (2.000đ)']])
      o.push(new StringSelectMenuOptionBuilder().setValue(`${k}|${a}`).setLabel(`${n} · ${an}`).setEmoji(em));
    rows.push(row(new StringSelectMenuBuilder().setCustomId(id(owner, tab, 'pet')).setPlaceholder('Chăm sóc thú cưng…').addOptions(o)));
  } else if (tab === 'nt') {
    rows.push(row(ref));
    const fo = (s && s.fo) || {};
    rows.push(row(new StringSelectMenuBuilder().setCustomId(id(owner, tab, 'furn')).setPlaceholder('Mua / bày / cất một món nội thất…')
      .addOptions(gc.FURN.map(([k, n, pr]) => new StringSelectMenuOptionBuilder().setValue(k).setLabel(n)
        .setDescription(fo[k] ? (fo[k] === 1 ? 'Đang bày · bấm để cất' : 'Đang cất · bấm để bày') : `Chưa mua · ${X.vnd(pr)}`)
        .setEmoji(fo[k] ? (fo[k] === 1 ? E.ok : E.box) : E.shop)))));
  } else if (tab === 'nh') {
    rows.push(row(btn(owner, tab, 'gui', 'Gửi tiết kiệm', E.card, P), btn(owner, tab, 'rut', 'Rút tiết kiệm', E.money), ref));
  } else rows.push(row(ref));
  return rows;
}

// gắn ghi chú + hàng điều hướng vào một payload layout có sẵn
function addNav(p, owner, tab, s, note, files) {
  const c = p && p.components && p.components[0];
  if (!c || !c.addActionRowComponents) return p;
  if (note) c.components.splice(1, 0, new TextDisplayBuilder().setContent(clip(note, 900)));
  c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  for (const r of navRows(owner, tab, s)) c.addActionRowComponents(r);
  return { ...p, attachments: [], files: files || [] };
}

// ---------- ảnh gian hàng (hình quầy trong game, bày hoa đang có) ----------
const shopImgCache = new Map(); // khóa theo giao diện + hoa đang bày -> { png } | { fail: thời điểm }
async function shopImage(s) {
  if (!headless.available()) return null;
  const st = s.st || {};
  const ids = engine.F.filter(f => (st[f.id] || 0) > 0).sort((a, b) => (st[b.id] || 0) - (st[a.id] || 0)).slice(0, 5).map(f => f.id);
  const key = JSON.stringify([ids, !!s.dark, s.wx || '', new Date().getMonth()]);
  const hit = shopImgCache.get(key);
  if (hit && hit.png) return hit.png;
  if (hit && Date.now() - hit.fail < 60000) return null; // vừa lỗi, 60 giây nữa mới thử lại
  try {
    const png = await Promise.race([headless.shot(s, 'shop', ids.join(',')), new Promise((_, no) => setTimeout(() => no(new Error('vẽ ảnh quá lâu')), 15000))]);
    shopImgCache.set(key, { png });
    if (shopImgCache.size > 60) shopImgCache.delete(shopImgCache.keys().next().value);
    return png;
  } catch (e) {
    console.error('[hub] không vẽ được ảnh gian hàng:', e.message || e);
    shopImgCache.set(key, { fail: Date.now() });
    return null;
  }
}

// ---------- trang Tổng quan ----------
async function homePayload(sv, owner, uid, note) {
  const s = sv.s, E = X.EM, A = X.shopApi, hide = await X.hideBalOf(uid, s), st = s.st || {};
  const monthly = s.hm && typeof s.hm.e === 'number' && (s.hm.p || (s.day || 1) < s.hm.e);
  const staff = monthly ? `Nhân viên tháng (${s.hm.p ? 'đang nghỉ phép' : `còn ${s.hm.e - s.day} ngày`})` : s.hire ? 'Nhân viên theo ngày' : 'Chưa thuê gói ngày/tháng';
  const ph = s.ph || 'prep';
  const sum = (list) => list.reduce((a, x) => a + (st[x.id] || 0), 0);
  const fl = sum(engine.F), pp = sum(engine.PAPER), gf = sum(engine.GIFT) ;
  const png = await shopImage(s);
  let hint;
  if (ph === 'prep') hint = !fl || !pp ? `${E.tip} Cần **đủ cả hoa và giấy gói** mới mở bán được. Bấm **Nhập hàng** để bắt đầu.` : `${E.tip} Đã sẵn sàng: chỉnh giá nếu muốn, thuê nhân viên rồi bấm **Mở bán**.`;
  else if (ph === 'open') hint = `${E.wait} Đang bán. Các thao tác đổi dữ liệu bị chặn đến hết ngày, bấm **Làm mới** để xem tiến độ.`;
  else hint = `${E.ok} Đã hết ngày. Bấm **Sang ngày mới** để quay lại giai đoạn chuẩn bị.`;
  const blocks = [
    X.H(clip(s.pf && s.pf.nm || s.name || 'Tiệm hoa', 40), E.shop),
    `${E.a} **Giai đoạn:** ${A.PHASE[ph] || 'Không rõ'}${ph === 'open' ? A.progOpen(s) : ''}\n${E.b} **Ngày:** ${s.day || 1} · **Cấp độ:** ${lvOf(s.xp || 0)} · **Thời gian bán:** ${A.lenName(s.len)}\n${E.a} **Số dư:** ${hide ? '••••••' : X.vnd(sv.money)}\n${E.b} **Nhân viên:** ${staff}`,
    { sep: true },
    png ? { img: 'attachment://shop.png' } : null,
    png ? { sep: true } : null,
    hint,
    `-# ${E.a} Justaseed • dữ liệu ${X.stamp(sv.at)}`,
  ];
  return addNav(X.layout(blocks), owner, 'home', s, note, png ? [new AttachmentBuilder(png, { name: 'shop.png' })] : []);
}

// ---------- dựng một mục ----------
async function render(owner, uid, tab, note, fresh = true) {
  const sv = await (fresh ? X.loadFresh(uid) : X.loadSave(uid));
  if (!sv) return { ...X.layout([X.NO_SAVE]), attachments: [], files: [] };
  const s = sv.s;
  if (tab === 'home') return homePayload(sv, owner, uid, note);
  if (tab === 'nhap') {
    if ((s.ph || 'prep') !== 'prep') return homePayload(sv, owner, uid, `${X.EM.no} Chỉ nhập hàng được ở giai đoạn chuẩn bị.`);
    return X.shopApi.nhLayout(owner, uid, sv, -1, 0, note);
  }
  const fn = VIEW()[tab];
  if (!fn) return homePayload(sv, owner, uid, note);
  const cap = { user: { id: owner }, deferReply: async () => {}, editReply: async (p) => { cap.p = p; return p; } };
  await fn(cap, uid, {});
  if (!cap.p) return homePayload(sv, owner, uid, note);
  return addNav(cap.p, owner, tab, s, note);
}
async function show(i, uid, tab = 'home', note) {
  return i.editReply(await render(String(i.user.id), uid, tab, note, true));
}

// ---------- thực thi ----------
// chạy một op game-cmds rồi dựng lại mục hiện tại kèm ghi chú kết quả
async function runOp(i, owner, uid, tab, key, a) {
  const E = X.EM, A = X.shopApi;
  let note;
  if (A.daySessions.has(uid)) note = `${E.wait} Gian hàng đang bán, hãy đợi hết ngày rồi dùng thao tác này.`;
  else if (A.busyUsers.has(uid)) note = `${E.wait} Bạn đang có một lệnh khác đang xử lý, đợi một chút nhé.`;
  else {
    A.busyUsers.add(uid);
    try {
      const [op, args] = gc.OPS[key](a || {});
      const r = await X.gameOp(uid, op, args);
      note = `${r.queued ? E.wait : E.ok} ${clip(r.msg, 600)}`;
    } catch (e) { note = `${E.no} ${clip(e && e.message || e, 400)}`; }
    finally { A.busyUsers.delete(uid); }
  }
  return i.editReply(await render(owner, uid, tab, note, false));
}
// chạy lệnh /gianhang (mở bán, thuê nhân viên, sang ngày mới) bằng cmdShop, kết quả hiện ngay trong bảng
async function runShop(i, owner, uid, sub, strings) {
  const px = Object.create(i);
  px.commandName = 'gianhang';
  px.options = { getSubcommand: () => sub, getString: (n) => (strings || {})[n] ?? null, getInteger: () => null, getUser: () => null };
  px.deferReply = async () => {};
  // bảng gian hàng (tin nhắn của bot) có thể bị lệnh mở bán lấy làm tin tiến độ (hub.taken = true);
  // khi đó kết quả + bảng điều khiển được gửi thành tin mới bên dưới thay vì sửa đè lên tin tiến độ
  const isComp = typeof i.isButton === 'function' && (i.isButton() || (typeof i.isStringSelectMenu === 'function' && i.isStringSelectMenu()));
  const mine = isComp && i.message && i.message.author && i.client && i.client.user && i.message.author.id === i.client.user.id;
  px.hub = mine ? { msg: i.message, taken: false } : null;
  px.editReply = async (p) => {
    const sv = await X.loadSave(uid).catch(() => null);
    const pl = addNav(p, owner, 'home', sv && sv.s);
    if (px.hub && px.hub.taken) {
      const ch = i.channel || (i.channelId ? await i.client.channels.fetch(i.channelId).catch(() => null) : null);
      if (ch) return ch.send(pl);
    }
    return i.editReply(pl);
  };
  px.deferred = true;
  return X.shopApi.cmdShop(px);
}

// ---------- form nhập ----------
const MODALS = {
  dat: { title: 'Đặt giá bán một món', f: [['hoa', 'Loại hoa (vd: hồng)', 'hồng'], ['giay', 'Cỡ giấy: S, M hoặc L', 'M'], ['gia', 'Giá bán (vd: 120k)', '120k']] },
  loinhuan: { title: 'Đặt lãi chung', f: [['phantram', 'Lãi % so với vốn (0-200)', '30']] },
  nvup: { title: 'Nâng cấp nhân viên', f: [['so', 'Số thứ tự nhân viên (xem ở mục Nhân viên)', '1']] },
  gui: { title: 'Gửi tiết kiệm', f: [['nganhang', 'Ngân hàng (vd: vietcombank)', 'vietcombank'], ['kyhan', 'Kỳ hạn tháng (0 = không kỳ hạn)', '12'], ['sotien', 'Số tiền (từ 100k, vd 5m)', '5m']] },
  rut: { title: 'Rút tiết kiệm', f: [['so', 'Số thứ tự khoản gửi', '1'], ['rutsom', 'Gõ "rutsom" nếu đồng ý rút trước hạn', '']] },
};
const OPKEY = { dat: ['giaban', 'dat'], loinhuan: ['giaban', 'loinhuan'], nvup: ['nhanvien', 'nangcap'], gui: ['nganhang', 'gui'], rut: ['nganhang', 'rut'] };

function openModal(i, owner, tab, act) {
  const m = MODALS[act];
  const mod = new ModalBuilder().setCustomId(`hbm:${owner}:${tab}:${act}`).setTitle(m.title);
  for (const [k, label, ph] of m.f) {
    const t = new TextInputBuilder().setCustomId(k).setLabel(label).setStyle(TextInputStyle.Short).setRequired(!(act === 'rut' && k === 'rutsom')).setMaxLength(40);
    if (ph) t.setPlaceholder(ph);
    mod.addComponents(row(t));
  }
  return i.showModal(mod);
}
async function submitModal(i, owner, uid, tab, act) {
  await i.deferUpdate();
  const m = MODALS[act], [name, sub] = OPKEY[act];
  const vals = m.f.map(([k]) => String(i.fields.getTextInputValue(k) || '').trim());
  let toks;
  if (act === 'dat' || act === 'gui') toks = [...vals[0].split(/\s+/), ...vals.slice(1)]; // tên hoa/ngân hàng có thể nhiều từ
  else toks = vals.filter(Boolean);
  let a;
  try { a = gc._t.argsFromPrefix(name, sub, gc.SPEC[name].subs[sub], toks, X.PREFIX); }
  catch (e) { return i.editReply(await render(owner, uid, tab, `${X.EM.no} ${clip(e.message, 400)}`, false)); }
  return runOp(i, owner, uid, tab, `${name}.${sub}`, a);
}

// ---------- điều phối ----------
async function handle(i) {
  const p = i.customId.split(':'), owner = p[1], tab = p[2], act = p[3], arg = p[4];
  if (i.user.id !== owner) return i.reply({ ...X.layout(['Bảng gian hàng này của người dùng lệnh. Hãy gõ `' + X.PREFIX + 'gianhang` để mở bảng riêng của bạn.']), flags: X.V2 | X.EPH });
  const uid = await X.userIdOf(owner);
  if (!uid) return i.reply({ ...X.layout([X.NOT_LINKED]), flags: X.V2 | X.EPH });

  if (i.isModalSubmit()) return submitModal(i, owner, uid, tab, act);
  if (i.isButton() && MODALS[act]) return openModal(i, owner, tab, act);
  await i.deferUpdate();

  if (i.isStringSelectMenu()) {
    const v = i.values[0];
    if (act === 'nav') return show(i, uid, v);
    if (act === 'open') return runShop(i, owner, uid, 'mo', { thoigian: v });
    if (act === 'unl') return runOp(i, owner, uid, tab, 'nangcap.mokhoa', { hoa: v });
    if (act === 'pet') { const [loai, viec] = v.split('|'); return runOp(i, owner, uid, tab, 'thucung.cham', { loai, viec }); }
    if (act === 'furn') {
      const sv = await X.loadSave(uid), owned = sv && sv.s.fo && sv.s.fo[v];
      return runOp(i, owner, uid, tab, owned ? 'noithat.bay' : 'noithat.mua', { mon: v });
    }
    return;
  }
  switch (act) {
    case 'go': return show(i, uid, arg || 'home');
    case 'ref': return show(i, uid, tab);
    case 'mo': return runShop(i, owner, uid, 'mo', {});
    case 'next': return runShop(i, owner, uid, 'ngaymoi', {});
    case 'hire': return runShop(i, owner, uid, 'thuenv', { loai: arg });
    case 'macdinh': return runOp(i, owner, uid, tab, 'giaban.macdinh');
    case 'tuyen': return runOp(i, owner, uid, tab, 'nhanvien.tuyen');
    case 'quay': return runOp(i, owner, uid, tab, 'nangcap.quay');
    case 'vip': return runOp(i, owner, uid, tab, 'nangcap.vip');
    case 'nvnhan': return runOp(i, owner, uid, tab, 'nhiemvu.nhan');
    case 'nvnhanh': return runOp(i, owner, uid, tab, 'nhiemvu.nhanh');
    case 'nvmoi': return runOp(i, owner, uid, tab, 'nhiemvu.lammoi');
    case 'ttnhan': return runOp(i, owner, uid, tab, 'thanhtuu.nhan');
    case 'adopt': return runOp(i, owner, uid, tab, 'thucung.nhannuoi', { loai: arg });
  }
}

function init(helpers) { X = helpers; }
module.exports = { init, handle, show, render };
