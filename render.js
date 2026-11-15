// render.js : vẽ ảnh cho bot Justaseed theo giao diện trong game
// - Màu lấy từ tiến trình của chính người chơi: s.pf.col (màu chủ đề), s.dark (chế độ tối), s.bgL / s.bgD (nền tùy chỉnh)
// - Icon vẽ bằng đúng bộ icon SVG của game (game-assets.js, trích từ file game) nên không bị ô vuông và giống hệt trong game
// - Vật phẩm workshop / món vàng trong ảnh tiến độ dùng đúng hình vẽ vật phẩm của game
// - Avatar / emoji / font đều được cache để lần vẽ sau nhanh hơn
const fs = require('fs');
const path = require('path');
const { iconSvg, ICON_RE, wsItemSvg, goldSvg, flowerSvg } = require('./game-assets');

const FONT = '"Baloo 2", "Onest", "DejaVu Sans", "Noto Sans", sans-serif';      // tiêu đề / số
const FONT_BODY = '"Onest", "Baloo 2", "DejaVu Sans", "Noto Sans", sans-serif'; // chữ thường
const SC = 1.5; // độ nét: ảnh xuất ra = kích thước logic × 1.5

// ---------- màu ----------
const hex6 = (h) => (/^#[0-9a-f]{6}$/i.test(h || '') ? h : null);
const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const A = rgb(a), B = rgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const lum = (h) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const alpha = (h, a) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };

// Bảng màu y hệt biến CSS của game (:root / data-theme=dark / applyBg), thêm màu chủ đề của người chơi
function themeOf(s) {
  s = s || {};
  const col = hex6(s.pf && s.pf.col) || '#4fb06f';
  const dark = !!s.dark;
  const custom = hex6(dark ? s.bgD : s.bgL);
  let bg, card, ink, mut, ln, tint;
  if (custom) { // người chơi tự chọn nền: giữ nền đó, chỉ phủ nhẹ màu chủ đề (giống applyBg + .pfw)
    bg = custom;
    if (lum(custom) > 0.5) { ink = '#244033'; mut = '#5d7c68'; card = mix(custom, '#ffffff', 0.7); ln = mix(custom, '#000000', 0.2); }
    else { ink = '#e6f4e8'; mut = '#a9c8b3'; card = mix(custom, '#ffffff', 0.2); ln = mix(custom, '#ffffff', 0.25); }
    tint = mix(bg, col, 0.16);
  } else if (dark) { // chế độ tối: cả bảng màu ngả theo màu chủ đề
    bg = mix(col, '#000000', 0.9); tint = mix(col, '#000000', 0.82); card = mix(col, '#000000', 0.74);
    ln = mix(col, '#000000', 0.62); ink = mix(col, '#ffffff', 0.9); mut = mix(col, '#ffffff', 0.58);
  } else {
    bg = mix(col, '#ffffff', 0.88); tint = mix(col, '#ffffff', 0.78); card = mix('#fffdf7', col, 0.04);
    ln = mix(col, '#ffffff', 0.7); ink = mix(col, '#000000', 0.8); mut = mix(col, '#000000', 0.45);
  }
  const isDark = lum(bg) < 0.5;
  return {
    col, dark: isDark, bg, card, ink, mut, ln,
    tint,                                                  // nền trang hồ sơ (.pfw)
    border: mix(ln, col, 0.5),                             // viền thẻ (.pfw .card)
    g: isDark ? mix(col, '#000000', 0.45) : mix(col, '#ffffff', 0.65), // nền nhạt của header
    g3: isDark ? mix(col, '#ffffff', 0.12) : mix(col, '#000000', 0.28), // chữ nhấn (số tiền)
    gold: isDark ? '#f0c24a' : '#b8860b',
    goldBg: isDark ? '#5a4a1a' : '#ffe9a8',
    goldBar: ['#e0b43c', '#ffe38a'],
  };
}

// ---------- khung avatar ----------
const FRAME_BASE = [null, ['#ff6fa0'], ['#ffe27a', '#e0a800'], ['#b39ddb'],
  ['#ff6b6b', '#ffd166', '#7bd88f', '#6bb5ff', '#b39ddb'], ['#ffd166', '#ff6fa0', '#6bb5ff', '#7bd88f']];
const FRAME_SPECIAL = { // chỉ lấy màu chính của từng khung đặc biệt (game có thêm hiệu ứng động)
  6: ['#ffd54a', '#e0a800'], 7: ['#ff8fb3', '#ffc2d6'], 8: ['#2f9e57', '#5fcf80'], 9: ['#ff9fc0', '#ffd3e1'],
  10: ['#ff6bd6', '#7a5cff', '#3fc1ff', '#7ae582', '#ffd54a'], 11: ['#a9ddff', '#ffffff'], 12: ['#ff4d1a', '#ffb01a'],
  13: ['#ff6f91', '#ffffff'], 14: ['#fff6c8', '#f0c24a'], 15: ['#2f8f4e', '#e8334f'], 16: ['#ff9fc0', '#ff4d8d'],
  17: ['#0f1a45', '#8ea2ff', '#ffd54a'], 18: ['#ff6b6b', '#ffd54a', '#7bd88f', '#6bb5ff', '#d66bff'],
  19: ['#7fe0ff', '#1f8fd0'], 20: ['#fff1a8', '#e0a800', '#8a5a00'], 21: ['#e8742c', '#d9a21b'],
  22: ['#e9fbff', '#7fe0ff', '#b9a6ff'], 23: ['#c77dff', '#7a52c7'],
};
function frameColors(fr, afr, themeCol) {
  let i = Math.max(0, Math.floor(Number(fr) || 0));
  if (i === 5 && !afr) i = 0; // "Ánh dương" cần mở khóa
  if (i === 0) return [themeCol];
  return FRAME_BASE[i] || FRAME_SPECIAL[i] || [themeCol];
}

module.exports = function makeRenderer(Cv) {
  if (!Cv) return null;

  // nạp font tùy chọn trong ./fonts (Baloo 2, Onest .ttf)
  try {
    const dir = path.join(__dirname, 'fonts');
    if (fs.existsSync(dir)) fs.readdirSync(dir).filter(f => /\.(ttf|otf)$/i.test(f))
      .forEach(f => Cv.GlobalFonts.registerFromPath(path.join(dir, f)));
  } catch (e) { console.error('[render] lỗi nạp font:', e.message); }

  // ---------- icon / hình SVG của game ----------
  // SVG của game có thuộc tính không đặt trong ngoặc kép (cx=20) -> chuẩn hóa để bộ vẽ SVG đọc được
  function cleanSvg(svg, w, h) {
    svg = String(svg).replace(/(\s[\w:-]+)=([^\s"'>]+?)(?=\s|\/>|>)/g, '$1="$2"');
    return svg.replace(/<svg\b([^>]*)>/, (m, at) =>
      `<svg${at.replace(/\s(?:width|height)="[^"]*"/g, '')} width="${w}" height="${h}">`);
  }
  const svgCache = new Map();
  function svgImage(svg, w, h) {
    const k = w + 'x' + h + ':' + svg;
    if (svgCache.has(k)) return svgCache.get(k);
    const p = (async () => {
      try { return await Cv.loadImage(Buffer.from(cleanSvg(svg, w, h))); }
      catch (e) { console.error('[render] lỗi vẽ SVG:', e.message); return null; }
    })();
    svgCache.set(k, p);
    if (svgCache.size > 300) svgCache.delete(svgCache.keys().next().value);
    return p;
  }
  // icon của game theo ký tự (emoji cũ -> icon game); không có trong bộ icon thì trả null (bỏ qua, không vẽ ô vuông)
  function emojiImg(ch, color = '#3b5a47') {
    let svg = null;
    try { svg = iconSvg(ch); } catch (e) { /* bỏ qua */ }
    if (!svg) return null;
    return svgImage(svg.replace(/currentColor/g, color), 96, 96);
  }

  const imgCache = new Map(); // key -> { at, p }
  async function imgFrom(src, key) {
    if (!src) return null;
    const k = key || (typeof src === 'string' ? src.slice(0, 200) + ':' + src.length : null);
    const hit = k && imgCache.get(k);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.p;
    const p = (async () => {
      try {
        if (Buffer.isBuffer(src)) return await Cv.loadImage(src);
        const s = String(src);
        if (s.startsWith('data:')) return await Cv.loadImage(Buffer.from(s.split(',')[1], 'base64'));
        if (/^https?:\/\//.test(s)) {
          const r = await fetch(s, { signal: AbortSignal.timeout(5000) });
          if (!r.ok) return null;
          return await Cv.loadImage(Buffer.from(await r.arrayBuffer()));
        }
      } catch (e) { /* bỏ qua ảnh lỗi */ }
      return null;
    })();
    if (k) { imgCache.set(k, { at: Date.now(), p }); if (imgCache.size > 80) imgCache.delete(imgCache.keys().next().value); }
    return p;
  }

  // ---------- vẽ cơ bản ----------
  const EMO_RE = ICON_RE; // khớp đúng các ký tự mà bộ icon của game có (1 nhóm bắt)
  const NO_PICT = /\p{Extended_Pictographic}\uFE0F?/gu; // emoji không có trong bộ icon: bỏ, không vẽ ô vuông

  function rr(ctx, x, y, w, h, r, fill, stroke, lw = 2) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  // gradient 160deg giống header hồ sơ trong game: linear-gradient(160deg, a, b)
  function grad160(ctx, x, y, w, h, a, b, deg = 160) {
    const r = deg * Math.PI / 180, dx = Math.sin(r), dy = -Math.cos(r);
    const len = Math.abs(w * dx) + Math.abs(h * dy), cx = x + w / 2, cy = y + h / 2;
    const g = ctx.createLinearGradient(cx - dx * len / 2, cy - dy * len / 2, cx + dx * len / 2, cy + dy * len / 2);
    g.addColorStop(0, a); g.addColorStop(1, b);
    return g;
  }
  // chữ + emoji (ảnh Twemoji), tự thu nhỏ chữ nếu vượt maxW
  async function rich(ctx, t, x, y, size, color, weight = 600, align = 'left', maxW, family = FONT) {
    const segs = String(t ?? '').split(EMO_RE)
      .map((v, i) => (i % 2 === 1 ? { v, e: true } : { v: v.replace(NO_PICT, ''), e: false })).filter(s => s.v);
    for (const s of segs) if (s.e) s.img = await emojiImg(s.v, color);
    const measure = (z) => {
      ctx.font = `${weight} ${z}px ${family}`;
      return segs.reduce((w, s) => w + (s.e ? (s.img ? z * 1.12 : 0) : ctx.measureText(s.v).width), 0);
    };
    let z = size, w = measure(z);
    if (maxW && w > maxW) { z = Math.max(size * 0.55, size * maxW / w); w = measure(z); }
    let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.font = `${weight} ${z}px ${family}`; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    for (const s of segs) {
      if (s.e) { if (s.img) { ctx.drawImage(s.img, cx, y - z * 0.86, z * 1.08, z * 1.08); cx += z * 1.12; } }
      else { ctx.fillText(s.v, cx, y); cx += ctx.measureText(s.v).width; }
    }
    return w;
  }
  const body = (ctx, t, x, y, size, color, weight = 500, align = 'left', maxW) => rich(ctx, t, x, y, size, color, weight, align, maxW, FONT_BODY);

  function bar(ctx, x, y, w, h, pct, c1, c2, track) {
    pct = Math.max(0, Math.min(1, pct || 0));
    rr(ctx, x, y, w, h, h / 2, track);
    if (pct > 0) {
      const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, c1); g.addColorStop(1, c2 || c1);
      rr(ctx, x, y, Math.max(h, w * pct), h, h / 2, g);
    }
  }
  function coverFit(ctx, img, x, y, w, h) {
    const k = Math.max(w / img.width, h / img.height), sw = w / k, sh = h / k;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }

  // avatar tròn + khung của người chơi
  function avatar(ctx, img, cx, cy, R, T, fr, afr) {
    const cols = frameColors(fr, afr, T.col), fw = R * 0.15;
    ctx.save();
    ctx.shadowColor = alpha(cols[0], 0.5); ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(cx, cy, R + fw, 0, Math.PI * 2); ctx.fillStyle = T.card; ctx.fill();
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    if (img) coverFit(ctx, img, cx - R, cy - R, R * 2, R * 2);
    else { ctx.fillStyle = T.g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
    ctx.restore();
    let st = cols[0];
    if (cols.length > 1) {
      st = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      cols.forEach((c, j) => st.addColorStop(j / (cols.length - 1), c));
    }
    ctx.beginPath(); ctx.arc(cx, cy, R + fw / 2, 0, Math.PI * 2); ctx.lineWidth = fw; ctx.strokeStyle = st; ctx.stroke();
    if (Number(fr) >= 6) { // khung đặc biệt: thêm hạt sáng xung quanh
      const c2 = cols[cols.length - 1], n = 16;
      for (let k = 0; k < n; k++) {
        const a = k * Math.PI * 2 / n, rr2 = R + fw * 1.35;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2, R * 0.035, 0, Math.PI * 2);
        ctx.fillStyle = cols[k % cols.length] || c2; ctx.fill();
      }
    }
  }

  const vnd = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;
  const clip = (v, n) => String(v ?? '').slice(0, n);
  const mk = (W, H) => {
    const c = Cv.createCanvas(Math.round(W * SC), Math.round(H * SC)), ctx = c.getContext('2d');
    ctx.scale(SC, SC);
    return { c, ctx };
  };
  const out = (c) => c.toBuffer('image/png');

  // nền chung: màu nền game + lớp tint chủ đề giống .pfw
  function page(ctx, W, H, T) {
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
    rr(ctx, 12, 12, W - 24, H - 24, 44, T.tint, alpha(T.col, 0.28), 2);
  }

  // ---------- /profile ----------
  async function renderProfile(p) {
    const T = themeOf(p.s), s = p.s, W = 960, H = 760;
    const { c, ctx } = mk(W, H);
    page(ctx, W, H, T);

    // header: gradient 160deg (g -> card) như modal hồ sơ trong game; có ảnh bìa thì dùng làm nền
    const hx = 32, hy = 32, hw = W - 64, hh = 358;
    ctx.save(); rr(ctx, hx, hy, hw, hh, 36); ctx.clip();
    ctx.fillStyle = grad160(ctx, hx, hy, hw, hh, T.g, T.card); ctx.fillRect(hx, hy, hw, hh);
    if (p.cover) {
      ctx.globalAlpha = 0.9; coverFit(ctx, p.cover, hx, hy, hw, 210); ctx.globalAlpha = 1;
      const fade = ctx.createLinearGradient(0, hy + 90, 0, hy + 230); fade.addColorStop(0, alpha(T.card, 0)); fade.addColorStop(1, T.card);
      ctx.fillStyle = fade; ctx.fillRect(hx, hy + 90, hw, 140);
    }
    ctx.restore();
    rr(ctx, hx, hy, hw, hh, 36, null, T.border, 2);

    const lv = p.lv, title = p.title;
    // chip @discord
    if (p.discordName) {
      const t = `@${clip(p.discordName, 24)}`; ctx.font = `600 20px ${FONT_BODY}`;
      const tw = ctx.measureText(t).width + 28;
      rr(ctx, hx + hw - tw - 18, hy + 18, tw, 38, 19, alpha(T.card, 0.85), T.border, 1.5);
      await body(ctx, t, hx + hw - tw / 2 - 18, hy + 44, 20, T.mut, 600, 'center');
    }
    avatar(ctx, p.avatar, W / 2, hy + 112, 66, T, p.fr, p.afr);
    await rich(ctx, p.name, W / 2, hy + 232, 48, T.ink, 800, 'center', hw - 120);
    await body(ctx, p.subtitle, W / 2, hy + 268, 23, T.mut, 600, 'center', hw - 120);

    // cấp + thanh XP
    await rich(ctx, `Cấp ${lv}`, hx + 40, hy + 314, 26, T.ink, 800);
    await body(ctx, `${Math.round(p.xpIn).toLocaleString('vi-VN')}/${Math.round(p.xpNeed).toLocaleString('vi-VN')} XP`, hx + hw - 40, hy + 314, 22, T.mut, 600, 'right');
    bar(ctx, hx + 40, hy + 326, hw - 80, 14, p.xpIn / Math.max(1, p.xpNeed), T.col, mix(T.col, '#ffffff', 0.25), T.card);

    // lưới thống kê: 3 cột × 2 hàng, thẻ giống .card trong game
    const gx = 32, gy = 412, gap = 14, cw = (W - 64 - gap * 2) / 3, ch = 124;
    for (let i = 0; i < p.stats.length; i++) {
      const st = p.stats[i], x = gx + (i % 3) * (cw + gap), y = gy + Math.floor(i / 3) * (ch + gap);
      rr(ctx, x, y, cw, ch, 26, T.card, T.border, 2);
      await rich(ctx, st.icon, x + cw / 2, y + 44, 32, T.ink, 600, 'center');
      await rich(ctx, st.value, x + cw / 2, y + 84, 31, st.accent ? T.g3 : T.ink, 800, 'center', cw - 28);
      await body(ctx, st.label, x + cw / 2, y + 110, 20, T.mut, 600, 'center', cw - 28);
    }
    await body(ctx, p.footer, W / 2, H - 30, 18, T.mut, 600, 'center');
    return out(c);
  }

  // ---------- /workshop, /vang ----------
  // r: { icon, svg?, name, sub, right, pct } — svg (nếu có) là hình vật phẩm của game, thay cho icon
  async function drawRow(ctx, T, W, y, RH, r) {
    const done = r.pct >= 1;
    rr(ctx, 32, y, W - 64, RH - 14, 28, T.card, done ? alpha(T.gold, 0.6) : T.border, 2);
    rr(ctx, 52, y + 17, 80, 80, 22, done ? T.goldBg : T.g, null);
    const pic = r.svg ? await svgImage(r.svg, 256, 256) : null;
    if (pic) { // vừa khung 64×64 giữa ô, giữ nguyên tỉ lệ
      const k = Math.min(64 / pic.width, 64 / pic.height), w = pic.width * k, h = pic.height * k;
      ctx.drawImage(pic, 92 - w / 2, y + 57 - h / 2, w, h);
    } else await rich(ctx, r.icon, 92, y + 70, 44, T.ink, 600, 'center');
    await rich(ctx, r.name, 154, y + 44, 30, T.ink, 800, 'left', 520);
    await body(ctx, r.sub, 154, y + 72, 20, T.mut, 600, 'left', 520);
    await rich(ctx, r.right, W - 56, y + 44, 27, done ? T.gold : T.g3, 800, 'right', 260);
    bar(ctx, 154, y + 86, W - 244 - 64, 14, r.pct, done ? T.goldBar[0] : T.col, done ? T.goldBar[1] : mix(T.col, '#ffffff', 0.3), T.tint);
    await body(ctx, `${Math.round(Math.min(1, r.pct) * 100)}%`, W - 56, y + 100, 19, T.mut, 700, 'right');
  }

  async function renderProgress(s, title, subtitle, rows, icon) {
    const T = themeOf(s), W = 960, RH = 128, top = 188;
    const H = top + rows.length * RH + 34;
    const { c, ctx } = mk(W, H);
    page(ctx, W, H, T);

    const hx = 32, hy = 32, hw = W - 64, hh = 134;
    ctx.save(); rr(ctx, hx, hy, hw, hh, 32); ctx.clip();
    ctx.fillStyle = grad160(ctx, hx, hy, hw, hh, T.g, T.card); ctx.fillRect(hx, hy, hw, hh);
    ctx.restore();
    rr(ctx, hx, hy, hw, hh, 32, null, T.border, 2);
    rr(ctx, hx + 26, hy + 26, 82, 82, 22, T.card, T.border, 2);
    await rich(ctx, icon, hx + 67, hy + 82, 46, T.ink, 600, 'center');
    await rich(ctx, title, hx + 130, hy + 62, 40, T.ink, 800, 'left', hw - 170);
    await body(ctx, subtitle, hx + 130, hy + 98, 22, T.mut, 600, 'left', hw - 170);

    for (let i = 0; i < rows.length; i++) await drawRow(ctx, T, W, top + i * RH, RH, rows[i]);
    return out(c);
  }

  // ---------- /tien : thẻ ngân hàng theo màu chủ đề ----------
  async function renderBankCard(s, { name, cardNo, money, hide }) {
    const T = themeOf(s), W = 860, H = 500;
    const { c, ctx } = mk(W, H);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
    const x = 30, y = 30, w = W - 60, h = H - 60;
    ctx.save(); ctx.shadowColor = alpha(T.col, 0.35); ctx.shadowBlur = 28; ctx.shadowOffsetY = 10;
    rr(ctx, x, y, w, h, 40, T.col); ctx.restore();
    ctx.save(); rr(ctx, x, y, w, h, 40); ctx.clip();
    ctx.fillStyle = grad160(ctx, x, y, w, h, mix(T.col, '#ffffff', 0.18), mix(T.col, '#000000', 0.38)); ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.beginPath(); ctx.arc(x + w - 70, y + 40, 210, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.beginPath(); ctx.arc(x + 60, y + h + 20, 190, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    await rich(ctx, 'Justaseed Bank', x + 40, y + 70, 32, '#ffffff', 800);
    await rich(ctx, '🌱', x + w - 70, y + 72, 40, '#fff', 600, 'center'); // icon cây non của game
    rr(ctx, x + 40, y + 108, 74, 54, 12, '#f0d98a', 'rgba(0,0,0,.18)', 2); // chip
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 40, y + 135); ctx.lineTo(x + 114, y + 135); ctx.moveTo(x + 77, y + 108); ctx.lineTo(x + 77, y + 162); ctx.stroke();
    const num = cardNo ? String(cardNo).replace(/(\d{4})(?=\d)/g, '$1  ') : '••••  ••••  ••••  ••••';
    await rich(ctx, num, x + 40, y + 228, 46, '#ffffff', 800, 'left', w - 80);
    await body(ctx, 'CHỦ THẺ', x + 40, y + 290, 17, 'rgba(255,255,255,.7)', 600);
    await rich(ctx, clip(name, 26), x + 40, y + 326, 30, '#ffffff', 800, 'left', w * 0.5);
    await body(ctx, 'SỐ DƯ', x + w - 40, y + 290, 17, 'rgba(255,255,255,.7)', 600, 'right');
    await rich(ctx, hide ? '••••••' : vnd(money), x + w - 40, y + 326, 34, '#ffffff', 800, 'right', w * 0.5);
    return out(c);
  }

  // ---------- 1 ảnh = 1 tiến độ (mỗi mẻ workshop / đơn vàng một ảnh riêng) ----------
  async function renderRow(s, r) {
    const T = themeOf(s), W = 960, H = 170;
    const { c, ctx } = mk(W, H);
    page(ctx, W, H, T);
    await drawRow(ctx, T, W, 28, 128, r);
    return out(c);
  }


  // ---------- ảnh "Menu hôm nay": bảng menu trang trí giống hệt trang web (V28 menuBoard) ----------
  const fl5 = (n, pc, cc, r) => {
    let o = '';
    for (let i = 0; i < n; i++) o += `<ellipse cx="0" cy="-${r}" rx="${r * 0.55}" ry="${r * 0.85}" transform="rotate(${i * 360 / n})"/>`;
    return `<g fill="${pc}" stroke="${cc}" stroke-width="1">${o}</g><circle r="${r * 0.45}" fill="${cc}"/>`;
  };
  const MENU_CORNER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M3 62C3 30 18 8 62 3" fill="none" stroke="#4f9d63" stroke-width="2" stroke-linecap="round"/>' +
    '<g fill="#6cc07a" stroke="#3f8452" stroke-width=".7"><ellipse cx="12" cy="38" rx="6" ry="2.6" transform="rotate(-62 12 38)"/><ellipse cx="22" cy="22" rx="6" ry="2.6" transform="rotate(-40 22 22)"/><ellipse cx="40" cy="10" rx="6" ry="2.6" transform="rotate(-15 40 10)"/></g>' +
    `<g transform="translate(15 15)">${fl5(6, '#ff9ec7', '#e0538f', 6)}</g><g transform="translate(40 8) scale(.8)">${fl5(5, '#ffffff', '#f2a33a', 5)}</g><g transform="translate(8 40) scale(.8)">${fl5(5, '#c9a7f0', '#8f4fb3', 5)}</g></svg>`;
  // hoa chưa có hình trong game: vẽ bông hoa chung, màu theo mã hoa
  function genericFlower(id) {
    const h = [...String(id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7) / 360;
    const f = (n) => { const k = (n + h * 12) % 12, a = 0.7 * Math.min(0.62, 1 - 0.62); return Math.round(255 * (0.62 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
    const col = `#${f(0)}${f(8)}${f(4)}`;
    let pet = '';
    for (let i = 0; i < 6; i++) pet += `<ellipse cx="20" cy="7" rx="4.2" ry="6" fill="${col}" transform="rotate(${i * 60} 20 14)"/>`;
    return `<svg viewBox="0 0 40 40"><path d="M20 22V39" stroke="#4f9d63" stroke-width="3" stroke-linecap="round"/><ellipse cx="26" cy="32" rx="5.5" ry="2.5" fill="#6cc07a" transform="rotate(-30 26 32)"/>${pet}<circle cx="20" cy="14" r="3.5" fill="#ffd766"/></svg>`;
  }
  const kfmt = (v) => (v % 1000 === 0 ? `${v / 1000}k` : vnd(v));
  const SERIF = 'Georgia, "DejaVu Serif", "Noto Serif", serif';

  // rows: [{ id, name, z: { S:{n,price}, M:{...}, L:{...} } }] (engine.menuRows); opt.tag: dòng nhỏ phía trên tiêu đề
  async function renderMenu(s, rows, opt = {}) {
    const T = themeOf(s), W = 960, RH = 86, HEAD = 292, FOOT = 78;
    const n = rows.length, body0 = n ? n * RH : 120;
    const H = HEAD + body0 + FOOT;
    const { c, ctx } = mk(W, H);
    page(ctx, W, H, T);
    const bx = 30, by = 30, bw = W - 60, bh = H - 60;
    const pk = T.dark ? '#7a3552' : '#f4a9c4', pink = T.dark ? '#ff8fb0' : '#c43a66';

    // khung bảng: nền thẻ + chấm lưới + viền đôi (viền màu chủ đề, viền hồng ngoài)
    rr(ctx, bx - 8, by - 8, bw + 16, bh + 16, 52, null, pk, 4);
    ctx.save(); rr(ctx, bx, by, bw, bh, 44); ctx.clip();
    ctx.fillStyle = T.card; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = T.ln;
    for (let y = by + 12; y < by + bh; y += 24) for (let x = bx + 12; x < bx + bw; x += 24) { ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    rr(ctx, bx, by, bw, bh, 44, null, T.border, 5);

    // 4 góc hoa lá
    const cimg = await svgImage(MENU_CORNER, 256, 256), CS = 124;
    if (cimg) for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      ctx.save();
      ctx.translate(fx > 0 ? bx : bx + bw, fy > 0 ? by : by + bh); ctx.scale(fx, fy);
      ctx.drawImage(cimg, -6, -6, CS, CS);
      ctx.restore();
    }

    // tiêu đề
    const cx = W / 2;
    await body(ctx, (opt.tag ? `JUSTASEED · ${String(opt.tag).toUpperCase()}` : 'JUSTASEED'), cx, by + 62, 21, T.mut, 700, 'center', bw - 300);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `italic 700 68px ${SERIF}`;
    ctx.fillStyle = T.dark ? '#7a3552' : '#f4b6cc'; ctx.fillText('Menu hôm nay', cx + 3, by + 140 + 3);
    ctx.fillStyle = T.g3; ctx.fillText('Menu hôm nay', cx, by + 140);
    if (n) {
      const label = `${n} MÓN`; ctx.font = `800 24px ${FONT}`;
      const pw = ctx.measureText(label).width + 44;
      rr(ctx, cx - pw / 2, by + 160, pw, 40, 20, '#e0567f');
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, cx, by + 188);
    }

    // cột: icon | tên | S | M | L
    const x0 = bx + 40, x1 = bx + bw - 40, colX = [x1 - 300, x1 - 150, x1], ZS = [['S', '3 bông'], ['M', '5 bông'], ['L', '10 bông']];
    const hy = by + 236;
    for (let k = 0; k < 3; k++) {
      await rich(ctx, ZS[k][0], colX[k] - 70, hy, 34, T.g3, 800, 'center');
      await body(ctx, ZS[k][1], colX[k] - 70, hy + 22, 16, T.mut, 600, 'center');
    }
    ctx.strokeStyle = T.border; ctx.lineWidth = 2;
    for (const dy of [34, 38]) { ctx.beginPath(); ctx.moveTo(x0, hy + dy); ctx.lineTo(x1, hy + dy); ctx.stroke(); }

    if (!n) {
      await body(ctx, 'Chưa có món. Cần đủ hoa (S=3, M=5, L=10 bông) và giấy gói.', cx, hy + 100, 24, T.mut, 600, 'center', bw - 100);
    }
    for (let i = 0; i < n; i++) {
      const r = rows[i], y = hy + 46 + i * RH;
      const pic = await svgImage(flowerSvg(r.id, 64) || genericFlower(r.id), 128, 128);
      if (pic) ctx.drawImage(pic, x0 + 4, y + 8, 62, 62);
      await rich(ctx, r.name, x0 + 84, y + 50, 31, T.ink, 800, 'left', colX[0] - 70 - 150 - (x0 + 84) + 70);
      for (let k = 0; k < 3; k++) {
        const z = r.z[ZS[k][0]], px = colX[k] - 70;
        if (z) {
          await rich(ctx, kfmt(z.price), px, y + 42, 32, pink, 800, 'center', 130);
          await body(ctx, `còn ${z.n}`, px, y + 66, 17, T.mut, 600, 'center');
        } else await rich(ctx, '–', px, y + 48, 30, T.ln, 700, 'center');
      }
      if (i < n - 1) {
        ctx.save(); ctx.setLineDash([3, 8]); ctx.lineWidth = 2; ctx.strokeStyle = T.ln;
        ctx.beginPath(); ctx.moveTo(x0, y + RH - 4); ctx.lineTo(x1, y + RH - 4); ctx.stroke(); ctx.restore();
      }
    }
    await body(ctx, 'Giá theo nghìn đồng (k) · Khách có thể gọi bó mix 2 loại hoa', cx, by + bh - 34, 19, T.mut, 600, 'center', bw - 120);
    return out(c);
  }

  // PNG 128x128 của một loài hoa (hình trong game, chưa có thì bông hoa chung) — dùng làm emoji của bot
  async function flowerPng(id) {
    const img = await svgImage(flowerSvg(id, 64) || genericFlower(id), 128, 128);
    if (!img) return null;
    const c = Cv.createCanvas(128, 128), ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 128, 128);
    return c.toBuffer('image/png');
  }

  // PNG 128x128 của một icon trong bộ icon game (dùng làm emoji của bot); không có icon thì null
  async function iconPng(ch, color = '#4f9d63') {
    const img = await emojiImg(ch, color);
    if (!img) return null;
    const c = Cv.createCanvas(128, 128), ctx = c.getContext('2d');
    ctx.drawImage(img, 8, 8, 112, 112);
    return c.toBuffer('image/png');
  }

  // ---------- ảnh ngang dài: tiến trình thăng cấp (chat server / j!rank) ----------
  // p: { s, avatar, name, lv, xpIn, xpNeed, title, fr, afr, up, gain, sub }
  async function renderLevel(p) {
    const T = themeOf(p.s), W = 1000, H = 260;
    const { c, ctx } = mk(W, H);
    page(ctx, W, H, T);
    const hx = 28, hy = 28, hw = W - 56, hh = H - 56;
    ctx.save(); rr(ctx, hx, hy, hw, hh, 36); ctx.clip();
    ctx.fillStyle = grad160(ctx, hx, hy, hw, hh, T.g, T.card); ctx.fillRect(hx, hy, hw, hh);
    if (p.up) { // hạt confetti khi vừa lên cấp
      const cols = [T.col, T.gold, mix(T.col, '#ffffff', 0.5), '#ff8fb3', '#ffd166'];
      for (let k = 0; k < 46; k++) {
        const x = hx + ((k * 97 + 31) % hw), y = hy + ((k * 53 + 11) % hh), r = 3 + (k % 4);
        ctx.globalAlpha = 0.55; ctx.fillStyle = cols[k % cols.length];
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    rr(ctx, hx, hy, hw, hh, 36, null, T.border, 2);

    avatar(ctx, p.avatar, 140, H / 2, 62, T, p.fr, p.afr);
    const x0 = 250, xr = W - 56;
    if (p.up) {
      const label = 'LÊN CẤP!'; ctx.font = `800 22px ${FONT}`;
      const tw = ctx.measureText(label).width + 36;
      rr(ctx, x0, 52, tw, 38, 19, T.col, null);
      await body(ctx, label, x0 + tw / 2, 79, 22, '#ffffff', 800, 'center');
    } else await body(ctx, p.sub || 'Tiến trình cấp độ', x0, 78, 22, T.mut, 600, 'left', 420);
    await rich(ctx, p.name, x0, 134, 42, T.ink, 800, 'left', 470);
    await body(ctx, p.title || '', x0, 168, 22, T.mut, 600, 'left', 470);

    await body(ctx, 'CẤP', xr, 82, 22, T.mut, 700, 'right');
    await rich(ctx, String(p.lv), xr, 146, 70, T.g3, 800, 'right', 220);

    const bx = x0, bw = xr - x0, by = 192;
    bar(ctx, bx, by, bw, 16, p.xpIn / Math.max(1, p.xpNeed), T.col, mix(T.col, '#ffffff', 0.25), T.card);
    await body(ctx, `${Math.round(p.xpIn).toLocaleString('vi-VN')}/${Math.round(p.xpNeed).toLocaleString('vi-VN')} XP`, xr, by + 42, 20, T.mut, 600, 'right');
    if (p.gain) await body(ctx, `+${p.gain} XP`, bx, by + 42, 20, T.g3, 700, 'left');
    return out(c);
  }

  return { renderLevel, renderProfile, renderProgress, renderRow, renderBankCard, renderMenu, flowerPng, iconPng, imgFrom, themeOf, mix, wsItemSvg, goldSvg };
};
module.exports.themeOf = themeOf;
module.exports.mix = mix;
