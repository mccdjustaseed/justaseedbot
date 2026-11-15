// engine.js : luật chơi của game chạy phía bot (dùng khi web tắt). Sao đúng công thức trong game.
// Mỗi hàm sửa trực tiếp object save `s` và ném Error(tiếng Việt) nếu không làm được.
const F = [
  { id: 'cuc', n: 'Cúc họa mi', c: 3000, u: 0, ss: [0, 2] }, { id: 'hong', n: 'Hồng', c: 4000, u: 0, ss: [0, 3] },
  { id: 'hd', n: 'Hướng dương', c: 5000, u: 0, ss: [1, 2] },
  { id: 'cl', n: 'Hoa cứt lợn', c: 2000, u: 70000 }, { id: 'cde', n: 'Hoa chó đẻ', c: 2500, u: 90000 },
  { id: 'adao', n: 'Anh đào', c: 5500, u: 0, ss: [0] }, { id: 'phg', n: 'Hoa phượng', c: 4500, u: 0, ss: [1] },
  { id: 'bl', n: 'Bằng lăng', c: 5000, u: 0, ss: [1] }, { id: 'vt', n: 'Cúc vạn thọ', c: 3500, u: 0, ss: [2, 3] },
  { id: 'ct', n: 'Cát tường', c: 6000, u: 0, ss: [3] },
  { id: 'cc', n: 'Cẩm chướng', c: 5000, u: 100000 }, { id: 'tul', n: 'Tulip', c: 6000, u: 150000 },
  { id: 'dt', n: 'Đồng tiền', c: 5500, u: 200000 }, { id: 'oai', n: 'Oải hương', c: 7000, u: 300000 },
  { id: 'cth', n: 'Cẩm tú cầu', c: 8000, u: 350000 }, { id: 'lily', n: 'Ly ly', c: 9000, u: 450000 },
  { id: 'bcd', n: 'Bồ công anh', c: 6500, u: 280000 }, { id: 'dao', n: 'Hoa đào', c: 7500, u: 380000 },
  { id: 'mai', n: 'Hoa mai', c: 8000, u: 420000 }, { id: 'thuy', n: 'Thủy tiên', c: 9500, u: 520000 },
  { id: 'tc', n: 'Trà my', c: 11000, u: 700000 },
  { id: 'sen', n: 'Sen hồng', c: 10000, u: 600000 }, { id: 'mdon', n: 'Mẫu đơn', c: 12000, u: 800000 },
  { id: 'lan', n: 'Lan hồ điệp', c: 15000, u: 1000000 },
];
const PAPER = [{ id: 'S', n: 'Giấy S', c: 5000 }, { id: 'M', n: 'Giấy M', c: 8000 }, { id: 'L', n: 'Giấy L', c: 12000 }];
const GIFT = [{ id: 'keo', n: 'Kẹo', c: 1000 }, { id: 'thu', n: 'Thư tay', c: 3000 }, { id: 'anh', n: 'Ảnh in', c: 6000 },
  { id: 'the', n: 'Thiệp', c: 2000 }, { id: 'bong', n: 'Bóng bay', c: 1500 }, { id: 'socola', n: 'Socola', c: 4000 },
  { id: 'nen', n: 'Nến thơm', c: 8000 }, { id: 'gau', n: 'Gấu bông', c: 12000 }, { id: 'amua', n: 'Áo mưa', c: 12000 }, { id: 'du', n: 'Dù', c: 18000 }];
const SP = [
  { n: 'Vườn Đà Lạt', m: 1, cap: 18, it: ['cuc', 'hong', 'hd', 'cc', 'tul', 'dt', 'cth', 'adao', 'phg', 'bl', 'vt', 'ct', 'cl', 'cde', 'bcd'] },
  { n: 'Chợ hoa Quảng Bá', m: 1.25, cap: 40, it: F.map(f => f.id) },
  { n: 'Tiệm giấy & quà', m: 1, cap: 25, it: ['S', 'M', 'L', 'keo', 'thu', 'anh', 'the', 'bong', 'socola', 'nen', 'gau'] },
  { n: 'Tiệm đồ mưa nắng', m: 1, cap: 30, it: ['amua', 'du'] },
];
const ALL = [...F, ...PAPER, ...GIFT];
const byId = Object.fromEntries(ALL.map(x => [x.id, x]));
const isFlower = (id) => F.some(f => f.id === id);
const isPaper = (id) => id === 'S' || id === 'M' || id === 'L';
const season = (s) => Math.floor((((s.day || 1) - 1)) / 7) % 4;
const mkN = (s) => (typeof s.mk === 'number' && s.mk > 0 ? s.mk : 1);
const price = (s, id, m) => Math.round((byId[id].c * (m || 1) * mkN(s)) / 100) * 100;
const vnd = (n) => `${Math.round(n).toLocaleString('vi-VN')}đ`;
function unlocked(s, f) { return f.u ? !!(s.un || {})[f.id] : (!f.ss || f.ss.includes(season(s))); }
function ledger(s, k, cat, name, q, amt) {
  s.led = s.led || [];
  const d = s.day || 1;
  const e = s.led.find(x => x.d === d && x.k === k && x.cat === cat && x.name === name);
  if (e) { e.q += q; e.amt += amt; } else s.led.push({ d, k, cat, name, q, amt });
}

// Nhập hàng: giống `case 'restock'` + confirmBuy() của game
function restock(s, si, id, q) {
  if ((s.ph || 'prep') !== 'prep') throw new Error('Chỉ nhập hàng được ở giai đoạn chuẩn bị');
  si = Number(si); id = String(id); q = Math.floor(Number(q));
  if (!SP[si] || !SP[si].it.includes(id)) throw new Error('Mặt hàng không bán ở nhà cung cấp này');
  if (!(q >= 1 && q <= 200)) throw new Error('Số lượng không hợp lệ');
  const f = F.find(x => x.id === id);
  if (f && !unlocked(s, f)) throw new Error('Bạn chưa mở khóa ' + byId[id].n + ' (hoặc chưa đúng mùa)');
  if (!(Number.isFinite(s.money) && s.money >= 0)) s.money = 0;
  const pr = price(s, id, SP[si].m);
  if (!(Number.isFinite(pr) && pr > 0)) throw new Error('Không tính được giá hôm nay');
  s.bought = s.bought || {}; s.st = s.st || {};
  const k = String(si) + id;
  const rem = isPaper(id) ? Infinity : SP[si].cap - (s.bought[k] || 0);
  if (!(rem > 0)) throw new Error('Đã hết suất nhập ở ' + SP[si].n);
  const can = Math.min(q, rem, Math.floor(s.money / pr));
  if (!(can > 0)) throw new Error('Không đủ tiền (giá ' + vnd(pr) + '/cái)');
  const total = can * pr;
  s.st[id] = (s.st[id] || 0) + can;
  s.bought[k] = (s.bought[k] || 0) + can;
  ledger(s, k, isFlower(id) ? 'Nhập hoa' : isPaper(id) ? 'Giấy gói' : 'Quà tặng', byId[id].n, can, total);
  s.money -= total; s.spent = (s.spent || 0) + total;
  return 'Đã nhập ' + can + ' ' + byId[id].n + (can < q ? ' (bị giới hạn bởi suất hoặc tiền)' : '') + ' · -' + vnd(total);
}

// Nhập cho chi nhánh: giống swWrap() của game — tạm đổi kho/suất nhập của quầy sang kho/suất của chi nhánh,
// tiền vẫn trừ vào ví chung, còn tổng chi `spent` của quầy chính không bị cộng.
function restockTo(s, bi, si, id, q) {
  if (bi == null || bi < 0) return restock(s, si, id, q);
  const b = ((s.x2 || {}).br || [])[bi];
  if (!b) throw new Error('Không tìm thấy chi nhánh');
  b.st = b.st || {}; b.bought = b.bought || {};
  const SV = { st: s.st, bo: s.bought }, sp0 = s.spent;
  s.st = b.st; s.bought = b.bought;
  try { return restock(s, si, id, q).replace(/^Đã nhập/, 'Đã nhập vào CN ' + b.n + ':'); }
  finally {
    const d = (Number(s.spent) || 0) - (Number(sp0) || 0); // tiền nhập cho chi nhánh: ghi riêng để ảnh tổng kết ngày trừ vào lợi nhuận
    if (d > 0) { s.x2 = s.x2 || {}; s.x2.brBuy = (s.x2.brBuy || 0) + d; }
    b.st = s.st; b.bought = s.bought; s.st = SV.st; s.bought = SV.bo; s.spent = sp0;
  }
}

// "Nhập tất cả" (giống nút "Thêm tất cả hàng vào giỏ" của game): lần lượt từng loại hàng, nhập tối đa theo suất còn và tiền còn
function planAll(s, bi, si) {
  const S = SP[si];
  const b = bi >= 0 ? ((s.x2 || {}).br || [])[bi] : null;
  const bought = (b ? b.bought : s.bought) || {};
  let money = Math.max(0, Number(s.money) || 0), total = 0;
  const items = [];
  // nhà cung cấp hoa: lần lượt từng loại hoa; giấy & quà / đồ mưa nắng: lần lượt từng mặt hàng, KHÔNG mua giấy (giấy không giới hạn suất, sẽ rút cạn tiền)
  const order = S.it.some(isFlower) ? F : S.it.map(id => byId[id]).filter(Boolean);
  for (const f of order) {
    if (!S.it.includes(f.id) || isPaper(f.id) || !unlocked(s, f)) continue;
    const pr = price(s, f.id, S.m);
    if (!(pr > 0)) continue;
    const q = Math.min(200, S.cap - (bought[String(si) + f.id] || 0), Math.floor(money / pr));
    if (q > 0) { items.push({ id: f.id, q, pr }); money -= q * pr; total += q * pr; }
  }
  return { items, total, left: money };
}

// Menu hôm nay: giống menu() của game — hoa đủ số bông (S=3, M=5, L=10) và còn giấy cùng cỡ
const SIZES = [{ id: 'S', k: 3 }, { id: 'M', k: 5 }, { id: 'L', k: 10 }];
function salePrice(s, f, z) {
  const v = (s.pr || {})[f + z];
  if (Number.isFinite(v)) return v;
  const k = SIZES.find(x => x.id === z).k;
  return Math.round((k * byId[f].c + byId[z].c) * 2.1 / 1000) * 1000; // MARK = 1.1 như game
}
function menuRows(s, st) {
  st = st || {};
  const rows = [];
  F.filter(f => unlocked(s, f) || (st[f.id] || 0) > 0).forEach(f => {
    const z = {};
    SIZES.forEach(p => {
      if ((st[f.id] || 0) >= p.k && (st[p.id] || 0) >= 1) z[p.id] = { n: Math.min(Math.floor(st[f.id] / p.k), st[p.id]), price: salePrice(s, f.id, p.id) };
    });
    if (Object.keys(z).length) rows.push({ id: f.id, name: f.n, z });
  });
  return rows;
}
// số phần của một loại hoa đang nằm trong menu (lấy cỡ bán được nhiều nhất, vì các cỡ dùng chung kho hoa)
const sellable = (rows, id) => Math.max(0, ...rows.filter(r => r.id === id).map(r => Math.max(0, ...Object.values(r.z).map(x => x.n))));
module.exports = { restock, restockTo, planAll, menuRows, sellable, salePrice, price, SP, F, PAPER, GIFT, byId, unlocked, season };
