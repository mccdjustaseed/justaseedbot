// headless.js : chạy ĐÚNG code của game (file HTML) trong trình duyệt ẩn trên server để làm việc khi web tắt.
// Mọi thao tác nằm trong game (window.BOTOPS, xem justaseed-full_fixed.html): nhờ vậy luật chỉ định nghĩa MỘT nơi, dùng chung với lúc web đang mở.
// Cần:  npm i playwright  &&  npx playwright install --with-deps chromium
// Và file game đặt ở ./game/index.html (hoặc biến môi trường GAME_HTML).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const BROWSERS_DIR = path.join(__dirname, '.pw-browsers'); // lưu trình duyệt ngay trong thư mục bot (tính vào ổ đĩa của panel)
const TMP_DIR = path.join(__dirname, '.pw-tmp');           // thư mục tạm khi tải, tránh /tmp nhỏ
try { fs.mkdirSync(BROWSERS_DIR, { recursive: true }); fs.mkdirSync(TMP_DIR, { recursive: true }); } catch (e) {}
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_DIR;
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* chưa cài playwright */ }
const GAME_HTML = process.env.GAME_HTML || path.join(__dirname, 'game', 'index.html');

// Trang ẩn chỉ được đọc file game + font Google (để ảnh khoe đúng font như web); mọi yêu cầu mạng khác bị chặn.
const allowReq = (r) => (/^file:|^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(r.request().url()) ? r.continue() : r.abort());
const fontsReady = () => Promise.race([typeof fontsOK2 === 'function' ? fontsOK2() : null, new Promise(r => setTimeout(r, 3000))]); // không chờ font quá 3 giây
const available = () => !!chromium && fs.existsSync(GAME_HTML);
// Giữ MỘT trình duyệt sống suốt, mỗi việc chỉ mở/đóng một context (nhanh hơn nhiều so với mở Chromium mới mỗi lệnh).
// Cho chạy song song tối đa MAX_PAR việc (mặc định 2) thay vì xếp hàng từng việc một.
const MAX_PAR = Number(process.env.HEADLESS_PARALLEL) || 2;
let running = 0; const waiting = [];
function queue(fn) {
  return new Promise((resolve, reject) => {
    const go = () => { running++; Promise.resolve().then(fn).then(resolve, reject).finally(() => { running--; const n = waiting.shift(); if (n) n(); }); };
    if (running < MAX_PAR) go(); else waiting.push(go);
  });
}
const TLOG = process.env.HEADLESS_LOG !== '0';
const timed = (name, fn) => { const t0 = Date.now(), w0 = t0; return queue(async () => { const t1 = Date.now(); try { return await fn(); } finally { if (TLOG) console.log(`[headless] ${name}: chờ hàng ${t1 - w0}ms, chạy ${Date.now() - t1}ms`); } }); };
function run(save, op, args) { return timed('run ' + op, () => runOne(save, op, args)); }


// Tự tải trình duyệt (chỉ bản headless-shell, nhẹ) nếu chưa có. Chỉ tải một lần, các lệnh khác chờ chung.
let installing = null;
function installBrowser() {
  if (installing) return installing;
  console.log('[headless] đang tải trình duyệt lần đầu...');
  let cli;
  try { cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'); } catch (e) { cli = null; }
  const cmd = cli ? process.execPath : 'npx';
  const args = cli ? [cli, 'install', '--only-shell', 'chromium'] : ['playwright', 'install', '--only-shell', 'chromium'];
  installing = new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 600000, maxBuffer: 1 << 24, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR, TMPDIR: TMP_DIR, TMP: TMP_DIR, TEMP: TMP_DIR } }, (err, stdout, stderr) => {
      try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); fs.mkdirSync(TMP_DIR, { recursive: true }); } catch (e) {}
      const code = err ? (err.code == null ? 1 : err.code) : 0;
      console.log('[headless] cài trình duyệt xong, mã ' + code);
      if (err) { console.error(String(stderr || stdout || err.message).slice(-1500)); installing = null; return reject(new Error('Không tải được trình duyệt (mã ' + code + '), xem log Console')); }
      resolve();
    });
  });
  return installing;
}
async function launchBrowser() {
  const opts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  try { return await chromium.launch(opts); }
  catch (e) {
    if (!/Executable doesn't exist/i.test(String(e && e.message))) throw e;
    await installBrowser();
    return await chromium.launch(opts);
  }
}

let browserP = null;
async function getBrowser() {
  if (browserP) { const b = await browserP.catch(() => null); if (b && b.isConnected()) return b; }
  browserP = launchBrowser();
  try { const b = await browserP; b.on('disconnected', () => { browserP = null; }); return b; }
  catch (e) { browserP = null; throw e; }
}
async function newPage() { const b = await getBrowser(); const ctx = await b.newContext(); return { ctx, page: await ctx.newPage() }; }

// ===== TRANG NÓNG: luôn có sẵn 1 trang game đã tải xong, lệnh nào tới thì dùng ngay (không phải goto + chờ game khởi động) =====
// Mỗi trang chỉ dùng MỘT lần rồi đóng, sau đó nền tự chuẩn bị trang mới, nên không lo lẫn trạng thái giữa các lệnh.
const SPARE = process.env.HEADLESS_SPARE == null ? 1 : Number(process.env.HEADLESS_SPARE); // 0 = tắt, quay về cách cũ
const SPARE_MAX_AGE = 20 * 60 * 1000; // trang chờ quá 20 phút thì bỏ, tải lại cho tươi
const spare = []; let filling = 0;
async function prepare() {
  const np = await newPage();
  try {
    await np.page.route('**/*', allowReq);
    await np.page.goto(pathToFileURL(GAME_HTML).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await np.page.waitForFunction(() => typeof qrDo === 'function' && typeof openDay === 'function' && typeof s !== 'undefined' && s && window.BOTOPS, null, { timeout: 30000 });
    np.t = Date.now();
    // Game có rất nhiều setInterval (tick 1 giây, đồng bộ, thông báo...): đóng băng trang chờ để nó không ăn CPU của bot trong lúc đợi
    try { np.cdp = await np.ctx.newCDPSession(np.page); await np.cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); np.frozen = true; }
    catch (e) { np.cdp = null; np.frozen = false; }
    return np;
  } catch (e) { await np.ctx.close().catch(() => {}); throw e; }
}
function refill() {
  while (SPARE > 0 && available() && spare.length + filling < SPARE) {
    filling++;
    prepare().then((p) => { spare.push(p); }, (e) => console.error('[headless] chuẩn bị trang sẵn lỗi:', e.message)).finally(() => { filling--; });
  }
}
// Việc ngắn (thuê nhân viên, mở bán...) dùng lại CHÍNH trang đã tải game: mỗi lệnh chỉ nạp save (qrDo) rồi chạy, không mở/đóng trang nên tốn vài chục ms.
const REUSE_MAX = Number(process.env.HEADLESS_REUSE) || 30; // dùng tối đa chừng này lần rồi thay trang mới cho sạch
async function release(np, ok) {
  try {
    if (ok && np.uses < REUSE_MAX && !np.page.isClosed() && spare.length < Math.max(SPARE, 1) + 1) {
      if (np.cdp) { try { await np.cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); np.frozen = true; } catch (e) { np.frozen = false; } }
      np.t = Date.now(); spare.push(np); return;
    }
  } catch (e) { /* đóng bên dưới */ }
  await np.ctx.close().catch(() => {}); refill();
}
async function takePage() {
  let p = null;
  while (spare.length) {
    const c = spare.shift();
    if (!c.page.isClosed() && Date.now() - c.t < SPARE_MAX_AGE) { p = c; break; }
    c.ctx.close().catch(() => {});
  }
  refill(); // bù trang mới ngay trong lúc lệnh này đang chạy
  if (!p) { p = await prepare(); p.uses = 0; }
  p.uses = (p.uses || 0) + 1;
  if (p.frozen) { try { await p.cdp.send('Page.setWebLifecycleState', { state: 'active' }); } catch (e) { /* trang chưa đóng băng được thì thôi */ } }
  return p;
}

async function runOne(save, op, args) {
  if (!available()) throw new Error('Máy chủ bot chưa cài Playwright hoặc thiếu file game (game/index.html)');
  let np = null, ok = false;
  try {
    np = await takePage(); const page = np.page;
    const res = await page.evaluate(({ save, op, args }) => {
      let msg = '';
      window.toast = (t) => { msg = String(t); }; // bắt lý do thất bại như cầu nối trong game
      try { if (typeof live !== 'undefined' && live && live.iv) { clearInterval(live.iv); live.iv = null; } } catch (e) {} // trang dùng lại: dọn đồng hồ còn sót của lệnh trước
      QRO = save; qrDo();
      const fail = (t) => { throw new Error(t); };
      const vnd = (n) => Math.round(n).toLocaleString('vi-VN') + 'đ';
      const T = window.BOTOPS;
      if (!T) fail('File game trên máy chủ bot chưa có bộ thao tác cho bot (BOTOPS), hãy chép bản game mới vào game/index.html');
      let out = '';
      if (op === 'open_day') {
        // Mở bán đúng thời gian web (4/8/15 phút, 30 phút cấp 20, 1 giờ cấp 50) rồi chạy trọn ngày: dừng khi hết giờ hoặc hết hàng
        const m0 = s.money, hired = !!s.hire || !!(s.hm && typeof s.hm.e === 'number' && !s.hm.p && s.day < s.hm.e) || ((s.x2 && s.x2.stf) || []).length > 0;
        T.open_day(args);
        const r = T.sim_day();
        const diff = s.money - m0;
        const lenTxt = r.len >= 3600 ? '1 giờ' : (r.len / 60) + ' phút';
        out = `Đã bán xong ngày ${r.day} (${lenTxt}): ${r.n} khách được phục vụ, ${r.lost} khách bỏ đi${r.dec ? `, ${r.dec} khách được từ chối khéo vì hết hàng` : ''} · doanh thu ${vnd(r.rev)} · tiền ${diff >= 0 ? '+' : '-'}${vnd(Math.abs(diff))} sau chi phí.\n`
          + (r.why === 'stock' ? `Dừng lúc ${r.clock} (giờ trong game) vì hết hàng.` : `Bán đủ ${lenTxt}, hết giờ lúc 22:00.`)
          + (hired ? '' : '\nKhông có nhân viên: quầy tự phục vụ kiểu "bán nền" của web (mỗi 12 giây một lượt), thuê nhân viên sẽ phục vụ nhanh hơn.');
      } else if (op !== 'sim_day' && Object.prototype.hasOwnProperty.call(T, op)) {
        out = String(T[op](args || {}));
      } else fail('Lệnh không hỗ trợ');
      const clean = JSON.stringify(s, (k, v) => (typeof v === 'string' && v.slice(0, 5) == 'data:' ? undefined : v));
      return { out, save: JSON.parse(clean) };
    }, { save, op, args: args || {} });
    ok = true;
    return res;
  } catch (e) {
    throw new Error(String(e.message || e).replace(/^page\.evaluate: (Error: )?/, '').split('\n')[0]);
  } finally {
    if (np) await release(np, ok);
  }
}

// Chạy trong trang ẩn: gắn tiến trình từng chi nhánh (đọc từ save của game: x2.br[].plan, x2.dp) vào snapshot của bot
function addBr(sn) {
  try {
    const x = s.x2 || {}, open = s.ph === 'open';
    sn.dp = sn.len ? Math.max(0, Math.min(1, (Number(sn.t) || 0) / sn.len)) : Math.max(0, Math.min(1, Number(x.dp) || 0));
    sn.br = (x.br || []).slice(0, 5).map(b => { const r = b.plan && b.plan.r; return { n: b.n, pause: !!b.pause, sell: open && !b.pause && !!r, dn: r ? r.n : 0, lost: r ? r.lost : 0, rev: r ? r.rev : 0 }; });
    if (!open && x.last) sn.brLast = { rev: x.last.brRev || 0, cost: (x.last.brCost || 0) + (x.last.brRent || 0), lines: (x.last.lines || []).filter(t => /^CN /.test(t)) };
  } catch (e) { /* không có chi nhánh */ }
  return sn;
}
// Phiên bán THỜI GIAN THẬT: giữ trình duyệt ẩn mở suốt ngày bán, bot gọi step() mỗi vài giây để game chạy thêm đúng số giây đã trôi.
const MAX_SESSIONS = Number(process.env.MAX_DAY_SESSIONS) || 2;
let sessions = 0;
const REPL = (k, v) => (typeof v === 'string' && v.slice(0, 5) == 'data:' ? undefined : v);
async function startDay(save, args) {
  if (!available()) throw new Error('Máy chủ bot chưa cài Playwright hoặc thiếu file game (game/index.html)');
  if (sessions >= MAX_SESSIONS) throw new Error(`Máy chủ đang chạy tối đa ${MAX_SESSIONS} ngày bán cùng lúc, thử lại sau ít phút`);
  sessions++;
  let ctx = null, closed = false;
  const dispose = async () => { if (closed) return; closed = true; sessions--; if (ctx) await ctx.close().catch(() => {}); };
  try {
    const np = await takePage(); ctx = np.ctx; const page = np.page;
    const first = await page.evaluate(({ save, args, fn }) => {
      window.toast = () => {};
      QRO = save; qrDo();
      const msg = window.BOTOPS.open_day(args || {});
      clearInterval(live.iv); live.iv = null; // bot tự điều khiển nhịp, không để đồng hồ thật của trang chạy chen vào
      return { msg, snap: eval('(' + fn + ')')(window.BOTOPS.sim_step({ n: 0 })), money0: s.money, day0: s.day - 0 };
    }, { save, args, fn: addBr.toString() });
    const clean = (fn) => fn.catch((e) => { throw new Error(String(e.message || e).replace(/^page\.evaluate: (Error: )?/, '').split('\n')[0]); });
    return {
      first,
      step: (n) => clean(page.evaluate(({ n, fn }) => eval('(' + fn + ')')(window.BOTOPS.sim_step({ n })), { n, fn: addBr.toString() })),
      // ảnh tổng kết ngày: gọi đúng dayCv() của game (cùng ảnh nút "Lưu / chia sẻ ảnh tổng kết" trên web)
      image: () => clean(page.evaluate(async (fr) => { await eval('(' + fr + ')')(); return dayCv(s.rpt).toDataURL('image/png'); }, fontsReady.toString())).then(toPng),
      close: () => clean(page.evaluate((fn) => eval('(' + fn + ')')(window.BOTOPS.sim_close()), addBr.toString())),
      finish: () => clean(page.evaluate((REPLs) => JSON.parse(JSON.stringify(s, (k, v) => (typeof v === 'string' && v.slice(0, 5) == 'data:' ? undefined : v))), null)),
      dispose,
    };
  } catch (e) {
    await dispose();
    throw new Error(String(e.message || e).replace(/^page\.evaluate: (Error: )?/, '').split('\n')[0]);
  }
}
// Lấy bản lưu MỚI TINH của game (đúng như người chơi mở web lần đầu) để tạo tài khoản cho người chơi bắt đầu từ bot.
function newSave() {
  return queue(async () => {
    if (!available()) throw new Error('Máy chủ bot chưa cài Playwright hoặc thiếu file game (game/index.html)');
    let ctx = null;
    try {
      const np = await takePage(); ctx = np.ctx; const page = np.page;
      await page.waitForFunction(() => typeof s !== 'undefined' && s && typeof def === 'function', null, { timeout: 30000 });
      return await page.evaluate(() => JSON.parse(JSON.stringify(def(), (k, v) => (typeof v === 'string' && v.slice(0, 5) == 'data:' ? undefined : v))));
    } finally { if (ctx) await ctx.close().catch(() => {}); }
  });
}
const toPng = (d) => Buffer.from(String(d).split(',')[1], 'base64');
// Vẽ ảnh khoe bằng chính code game trong trình duyệt ẩn.
//   kind 'day'      : ảnh tổng kết ngày gần nhất (s.rpt)
//   kind 'workshop' : ảnh khoe một món trên kệ workshop (arg = id món, o = 'v' dọc | 'h' ngang)
function shot(save, kind, arg, o) {
  return queue(async () => {
    if (!available()) throw new Error('Máy chủ bot chưa cài Playwright hoặc thiếu file game (game/index.html)');
    let ctx = null;
    try {
      const np = await takePage(); ctx = np.ctx; const page = np.page;
      await page.waitForLoadState('load', { timeout: 2500 }).catch(() => {}); // chờ stylesheet font (không có mạng thì bỏ qua)
      await page.waitForFunction(() => typeof qrDo === 'function' && typeof s !== 'undefined' && s && typeof dayCv === 'function' && window.XB, null, { timeout: 30000 });
      const data = await page.evaluate(async ({ save, kind, arg, o, fr }) => {
        window.toast = () => {};
        QRO = save; qrDo();
        await eval('(' + fr + ')')();
        if (kind === 'day') {
          if (!s.rpt) throw new Error('Chưa có ngày bán nào kết thúc để khoe');
          return dayCv(s.rpt).toDataURL('image/png');
        }
        if (kind === 'workshop') {
          if (!(s.shelf || []).some(x => x.id == arg)) throw new Error('Không tìm thấy món này trên kệ');
          SHC = null;
          await XB.photo(arg, o === 'h' ? 'h' : 'v');
          if (!SHC) throw new Error('Game không tạo được ảnh món này');
          return SHC.toDataURL('image/png');
        }
        if (kind === 'shop') { // ảnh gian hàng: đúng hình quầy trong game (scene), bày các loại hoa đang có
          if (typeof scene !== 'function') throw new Error('File game chưa có hình gian hàng (scene)');
          const ids = String(arg || '').split(',').filter(Boolean);
          const d = document.createElement('div'); d.innerHTML = scene(ids);
          let t = new XMLSerializer().serializeToString(d.firstElementChild);
          const cs = getComputedStyle(document.documentElement);
          t = t.replace(/var\(--([\w-]+)\)/g, (m, k) => cs.getPropertyValue('--' + k).trim() || '#fff')
            .replace(/style="width:100%;display:block;border-radius:20px"/, '')
            .replace('<svg', '<svg width="800" height="496"')
            .replace(/(<svg[^>]*>)/, '$1<style>.hd2{opacity:0}</style>');
          const im = new Image();
          await new Promise((ok, no) => { im.onload = ok; im.onerror = no; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t); });
          const c = document.createElement('canvas'); c.width = 800; c.height = 496;
          c.getContext('2d').drawImage(im, 0, 0, 800, 496);
          return c.toDataURL('image/png');
        }
        throw new Error('Loại ảnh không hỗ trợ');
      }, { save, kind, arg: arg == null ? null : String(arg), o: o || 'v', fr: fontsReady.toString() });
      return toPng(data);
    } catch (e) {
      throw new Error(String(e.message || e).replace(/^page\.evaluate: (Error: )?/, '').split('\n')[0]);
    } finally { if (ctx) await ctx.close().catch(() => {}); }
  });
}
// Khởi động sẵn trình duyệt ngay khi bot bật để lệnh đầu tiên không bị chậm.
function warmup() { if (available()) getBrowser().then(() => { console.log('[headless] trình duyệt đã sẵn sàng'); refill(); }, (e) => console.error('[headless] warmup lỗi:', e.message)); }
process.on('exit', () => { try { if (browserP) browserP.then(b => b.close()).catch(() => {}); } catch (e) {} });
module.exports = { available, run, startDay, newSave, shot, warmup };
