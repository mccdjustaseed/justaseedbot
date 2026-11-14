/* rel-core.js — lõi relationship dùng CHUNG cho game (nhúng vào HTML) và bot (require).
   Chỉ chứa: loại có sẵn, màu, công thức cấp độ, nhiệm vụ, và hàm vẽ card / sơ đồ lên canvas 2D.
   Không phụ thuộc DOM hay Node: nhận ctx (CanvasRenderingContext2D) và ảnh đã tải sẵn từ bên ngoài. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RELCORE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- màu
  const hexToRgb = (h) => {
    h = String(h || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    const m = /^#([0-9a-f]{6})$/i.exec(h);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const rgbToHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  };
  const hslToHex = (h, s, l) => {
    const f = (n) => {
      const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
      return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return rgbToHex(f(0), f(8), f(4));
  };
  const alpha = (hex, a) => {
    if (/^rgba?\(/i.test(hex)) return hex;
    const c = hexToRgb(hex) || [0, 0, 0];
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  };
  const lum = (hex) => {
    const c = hexToRgb(hex) || [0, 0, 0];
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const onColor = (hex) => (lum(hex) > 0.42 ? '#1b2a22' : '#ffffff');

  // ---------------------------------------------------------------- loại có sẵn (kèm màu + hoa văn chìm)
  // pal: bg1/bg2 nền chuyển sắc, ink chữ, mut chữ phụ, acc điểm nhấn, acc2 điểm nhấn nhạt, soft hoa văn chìm,
  //      line màu đậm dùng trên nền sáng (sơ đồ), panel khung mờ, dark = nền tối
  const PRESET_ORDER = ['bff', 'brother', 'sister', 'lover', 'tire', 'team', 'soul', 'rival'];
  const PRESETS = {
    bff: { name: 'Bạn thân', icon: 'star', pal: { bg1: '#cdeeff', bg2: '#eef9ff', ink: '#12384f', mut: '#4f7f99', acc: '#1f8fd0', acc2: '#7fd0f5', soft: '#8fd2f2', line: '#1f8fd0', panel: 'rgba(255,255,255,0.62)', dark: false } },
    brother: { name: 'Anh em', icon: 'bolt', pal: { bg1: '#c6f0e4', bg2: '#eafbf6', ink: '#0f3b36', mut: '#4a8079', acc: '#16a08c', acc2: '#6fd8c4', soft: '#86dccb', line: '#12806f', panel: 'rgba(255,255,255,0.62)', dark: false } },
    sister: { name: 'Chị em', icon: 'flower', pal: { bg1: '#ffd6e5', bg2: '#fff2f6', ink: '#5a2a3c', mut: '#b0768b', acc: '#e0567f', acc2: '#ff9db9', soft: '#ffb8cf', line: '#d23f6b', panel: 'rgba(255,255,255,0.62)', dark: false } },
    lover: { name: 'Iu dấu', icon: 'heart', pal: { bg1: '#ffbfce', bg2: '#fff0f3', ink: '#5e1730', mut: '#a8506a', acc: '#e0245e', acc2: '#ff6b94', soft: '#ff9db5', line: '#d01f55', panel: 'rgba(255,255,255,0.62)', dark: false } },
    tire: { name: 'Lốp xe tăng', icon: 'tire', pal: { bg1: '#2a331f', bg2: '#4d5e36', ink: '#f2f6e6', mut: '#bccaa3', acc: '#f2c21b', acc2: '#d8e07a', soft: '#8aa05c', line: '#4d5e36', panel: 'rgba(255,255,255,0.10)', dark: true } },
    team: { name: 'Đồng đội', icon: 'shield', pal: { bg1: '#ffd8a3', bg2: '#fff3e0', ink: '#5a3320', mut: '#a87858', acc: '#e8742c', acc2: '#ffb067', soft: '#ffc58a', line: '#d9631c', panel: 'rgba(255,255,255,0.62)', dark: false } },
    soul: { name: 'Tri kỷ', icon: 'moon', pal: { bg1: '#140d33', bg2: '#3d2c80', ink: '#f4efff', mut: '#bcaeef', acc: '#ffd54a', acc2: '#b39dff', soft: '#7f6cd6', line: '#5a43b0', panel: 'rgba(255,255,255,0.10)', dark: true } },
    rival: { name: 'Kỳ phùng địch thủ', icon: 'swords', pal: { bg1: '#dde2ea', bg2: '#f7f8fb', ink: '#1f2430', mut: '#6b7385', acc: '#d9372b', acc2: '#7d8aa3', soft: '#b7c0d2', line: '#c42f24', panel: 'rgba(255,255,255,0.66)', dark: false } },
  };
  const ICON_ORDER = ['heart', 'star', 'flower', 'bolt', 'tire', 'shield', 'moon', 'swords', 'sprout'];
  const ICON_EMOJI = { heart: '❤️', star: '⭐', flower: '🌸', bolt: '⚡', tire: '🛞', shield: '🛡️', moon: '🌙', swords: '⚔️', sprout: '🌱' };

  // màu tùy chọn theo mã hex
  function fromHex(hex) {
    const rgb = hexToRgb(hex) || [79, 176, 111];
    const [h, s0, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    const s = Math.max(0.3, Math.min(0.95, s0));
    const base = rgbToHex(rgb[0], rgb[1], rgb[2]);
    if (l < 0.3) { // nền tối
      return {
        bg1: base, bg2: hslToHex(h, s0 * 0.9, Math.min(0.4, l + 0.2)), ink: '#f6f3ff', mut: hslToHex(h, s0 * 0.5, 0.8),
        acc: hslToHex(h, Math.max(s, 0.6), 0.68), acc2: hslToHex(h, s, 0.8), soft: hslToHex(h, s0 * 0.8, 0.46),
        line: base, panel: 'rgba(255,255,255,0.10)', dark: true,
      };
    }
    const acc = l > 0.72 ? hslToHex(h, s, 0.55) : base;
    return {
      bg1: hslToHex(h, s, 0.86), bg2: hslToHex(h, s * 0.6, 0.955), ink: hslToHex(h, Math.min(s, 0.45), 0.16),
      mut: hslToHex(h, s * 0.35, 0.4), acc, acc2: hslToHex(h, s, 0.72), soft: hslToHex(h, s, 0.78),
      line: acc, panel: 'rgba(255,255,255,0.62)', dark: false,
    };
  }
  // trả { pal, deco }: màu có sẵn đi kèm hoa văn chìm của loại đó; màu hex dùng hoa văn theo biểu tượng đã chọn
  function paletteOf(r) {
    const ck = r && r.color_key;
    if (ck && PRESETS[ck]) return { pal: PRESETS[ck].pal, deco: PRESETS[ck].icon };
    return { pal: fromHex(r && r.color_hex), deco: (r && r.icon && ICON_ORDER.includes(r.icon)) ? r.icon : 'star' };
  }

  // ---------------------------------------------------------------- cấp độ (khớp hàm rel_level trong SQL)
  const cum = (l) => 20 * l * l + 60 * l - 80;           // XP tích lũy để đạt cấp l (cấp 1 = 0)
  const lvOf = (xp) => { let l = 1; xp = Math.max(0, xp | 0); while (l < 99 && cum(l + 1) <= xp) l++; return l; };
  const prog = (xp) => {
    xp = Math.max(0, xp | 0);
    const lv = lvOf(xp), a = cum(lv), b = cum(lv + 1);
    return { lv, into: xp - a, need: b - a, pct: Math.max(0, Math.min(1, (xp - a) / (b - a))) };
  };
  const TITLES = [[1, 'Mới quen'], [4, 'Quen thân'], [8, 'Thân thiết'], [15, 'Gắn bó'], [25, 'Khắng khít'], [40, 'Định mệnh']];
  const titleOf = (lv) => TITLES.filter(t => lv >= t[0]).pop()[1];

  // ---------------------------------------------------------------- ngày (giờ Việt Nam, UTC+7)
  const vnDay = (ts) => new Date((ts == null ? Date.now() : ts) + 7 * 3600e3).toISOString().slice(0, 10);
  const dayMs = (ds) => Date.parse(ds + 'T00:00:00Z');
  const addDay = (ds, n) => new Date(dayMs(ds) + n * 86400e3).toISOString().slice(0, 10);
  const daysSince = (iso, now) => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return 1;
    return Math.max(1, Math.round((dayMs(vnDay(now)) - dayMs(vnDay(t))) / 86400e3) + 1);
  };
  function isoWeek(ds) { // 'YYYY-Www' (khớp to_char(d,'IYYY-"W"IW') của Postgres)
    const d = new Date(dayMs(ds));
    const dn = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dn + 3);
    const year = d.getUTCFullYear(), thu = d.valueOf();
    d.setUTCMonth(0, 1);
    if (d.getUTCDay() !== 4) d.setUTCMonth(0, 1 + ((4 - d.getUTCDay()) + 7) % 7);
    return year + '-W' + String(1 + Math.ceil((thu - d.valueOf()) / 604800000)).padStart(2, '0');
  }
  // chuỗi cùng điểm danh còn hiệu lực nếu ngày cuối >= hôm qua
  const streakNow = (rel, now) => {
    const today = vnDay(now);
    if (!rel || !rel.streak || !rel.both_day) return 0;
    return String(rel.both_day) >= addDay(today, -1) ? rel.streak : 0;
  };

  // ---------------------------------------------------------------- nhiệm vụ (khớp rel_quest_defs trong SQL)
  const QUESTS = [
    { id: 'd_both', sc: 'd', ev: 'both', need: 1, xp: 25, t: 'Cùng điểm danh hôm nay' },
    { id: 'd_gift', sc: 'd', ev: 'gift', need: 1, xp: 20, t: 'Tặng nhau 1 món quà' },
    { id: 'd_wall', sc: 'd', ev: 'wall', need: 2, xp: 15, t: 'Ký tường nhà nhau 2 lần' },
    { id: 'w_both', sc: 'w', ev: 'both', need: 5, xp: 120, t: 'Cùng điểm danh 5 ngày trong tuần' },
    { id: 'w_gift', sc: 'w', ev: 'gift', need: 5, xp: 100, t: 'Tặng nhau 5 món quà trong tuần' },
    { id: 'w_buy', sc: 'w', ev: 'buy', need: 3, xp: 100, t: 'Mua đồ của nhau 3 lần trong tuần' },
    { id: 'w_visit', sc: 'w', ev: 'visit', need: 7, xp: 60, t: 'Thăm nhà nhau 7 lần trong tuần' },
    { id: 'w_wall', sc: 'w', ev: 'wall', need: 7, xp: 70, t: 'Ký tường nhà nhau 7 lần trong tuần' },
  ];
  function questList(rel, now) {
    const today = vnDay(now), wk = isoWeek(today), q = (rel && rel.quests) || {};
    const dOk = q.d === today, wOk = q.w === wk;
    const dc = dOk ? (q.dc || {}) : {}, cd = dOk ? (q.cd || []) : [];
    const wc = wOk ? (q.wc || {}) : {}, cw = wOk ? (q.cw || []) : [];
    return QUESTS.map(def => {
      const have = Math.min(def.need, ((def.sc === 'd' ? dc : wc)[def.ev]) | 0);
      const claimed = (def.sc === 'd' ? cd : cw).includes(def.id);
      return Object.assign({}, def, { have, claimed, ready: have >= def.need && !claimed });
    });
  }

  // ---------------------------------------------------------------- vẽ cơ bản
  const FONTS = { head: "'Baloo 2','Baloo2','Onest','Segoe UI',sans-serif", body: "Onest,'Segoe UI',sans-serif" };
  const fontsOf = (o) => Object.assign({}, FONTS, (o && o.fonts) || {});
  const fmtN = (n) => { try { return Number(n || 0).toLocaleString('vi-VN'); } catch (e) { return String(n | 0); } };

  function rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  function fitFont(ctx, text, weight, size, family, maxW, minSize) {
    let sz = size;
    for (; ;) {
      ctx.font = `${weight} ${sz}px ${family}`;
      if (ctx.measureText(text).width <= maxW || sz <= (minSize || 14)) break;
      sz -= 2;
    }
    return sz;
  }
  function clipText(ctx, text, maxW) {
    text = String(text == null ? '' : text);
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }
  function mulberry(seed) {
    let a = (seed | 0) + 0x6D2B79F5;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---------------------------------------------------------------- biểu tượng vẽ bằng nét vector (không cần font emoji)
  function drawIcon(ctx, key, cx, cy, r, color) {
    ctx.save();
    ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    switch (key) {
      case 'heart': {
        const t = r;
        ctx.moveTo(cx, cy + t * 0.92);
        ctx.bezierCurveTo(cx - t * 1.55, cy - t * 0.05, cx - t * 0.95, cy - t * 1.15, cx, cy - t * 0.4);
        ctx.bezierCurveTo(cx + t * 0.95, cy - t * 1.15, cx + t * 1.55, cy - t * 0.05, cx, cy + t * 0.92);
        ctx.closePath(); ctx.fill(); break;
      }
      case 'star': {
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.46 : r;
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr + r * 0.06;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath(); ctx.fill(); break;
      }
      case 'flower': {
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
          ctx.moveTo(cx + Math.cos(a) * r * 0.52 + r * 0.44, cy + Math.sin(a) * r * 0.52);
          ctx.arc(cx + Math.cos(a) * r * 0.52, cy + Math.sin(a) * r * 0.52, r * 0.44, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
        ctx.globalAlpha *= 0.45; ctx.fillStyle = '#ffffff'; ctx.fill(); break;
      }
      case 'bolt': {
        const p = [[0.18, -1], [-0.58, 0.12], [-0.06, 0.12], [-0.2, 1], [0.62, -0.22], [0.08, -0.22]];
        p.forEach((q, i) => { const x = cx + q[0] * r, y = cy + q[1] * r; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.closePath(); ctx.fill(); break;
      }
      case 'tire': {
        ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.moveTo(cx + r * 0.56, cy); ctx.arc(cx, cy, r * 0.56, 0, Math.PI * 2);
        ctx.fill('evenodd');
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.08); ctx.globalAlpha *= 0.55; ctx.strokeStyle = '#000000';
        for (let i = 0; i < 12; i++) { // gai lốp
          const a = i * Math.PI / 6;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r * 0.66, cy + Math.sin(a) * r * 0.66);
          ctx.lineTo(cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94);
          ctx.stroke();
        }
        break;
      }
      case 'shield': {
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.82, cy - r * 0.62);
        ctx.quadraticCurveTo(cx + r * 0.9, cy + r * 0.45, cx, cy + r);
        ctx.quadraticCurveTo(cx - r * 0.9, cy + r * 0.45, cx - r * 0.82, cy - r * 0.62);
        ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.lineWidth = Math.max(1.5, r * 0.14); ctx.globalAlpha *= 0.4; ctx.strokeStyle = '#ffffff';
        ctx.moveTo(cx, cy - r * 0.55); ctx.lineTo(cx, cy + r * 0.55); ctx.moveTo(cx - r * 0.42, cy - r * 0.05); ctx.lineTo(cx + r * 0.42, cy - r * 0.05); ctx.stroke();
        break;
      }
      case 'moon': {
        ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
        ctx.beginPath();
        ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.moveTo(cx + r * 0.45 + r * 0.82, cy - r * 0.18); ctx.arc(cx + r * 0.45, cy - r * 0.18, r * 0.82, 0, Math.PI * 2);
        ctx.fill('evenodd'); break;
      }
      case 'swords': {
        ctx.lineWidth = r * 0.2;
        ctx.moveTo(cx - r * 0.8, cy - r * 0.8); ctx.lineTo(cx + r * 0.7, cy + r * 0.7);
        ctx.moveTo(cx + r * 0.8, cy - r * 0.8); ctx.lineTo(cx - r * 0.7, cy + r * 0.7);
        ctx.stroke();
        ctx.beginPath(); ctx.lineWidth = r * 0.16;
        ctx.moveTo(cx + r * 0.3, cy + r * 0.05); ctx.lineTo(cx + r * 0.05, cy + r * 0.3); // chắn kiếm
        ctx.moveTo(cx - r * 0.3, cy + r * 0.05); ctx.lineTo(cx - r * 0.05, cy + r * 0.3);
        ctx.stroke(); break;
      }
      case 'sprout': {
        ctx.lineWidth = r * 0.16;
        ctx.moveTo(cx, cy + r * 0.95); ctx.quadraticCurveTo(cx - r * 0.05, cy + r * 0.2, cx, cy - r * 0.2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx - r * 0.42, cy - r * 0.28, r * 0.5, r * 0.26, -Math.PI / 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + r * 0.42, cy - r * 0.5, r * 0.5, r * 0.26, Math.PI / 5, 0, Math.PI * 2); ctx.fill(); break;
      }
      default: { // dự phòng: chấm tròn
        ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // hoa văn chìm: biểu tượng phù hợp loại relationship, rải đều, rất mờ
  function drawDeco(ctx, W, H, key, color, seed, opt) {
    const rnd = mulberry(seed || 1), cols = (opt && opt.cols) || 6, rows = (opt && opt.rows) || 4;
    const cw = W / cols, ch = H / rows;
    ctx.save();
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        if (rnd() < 0.18) continue;
        const x = (gx + 0.2 + rnd() * 0.6) * cw, y = (gy + 0.2 + rnd() * 0.6) * ch;
        const r = 20 + rnd() * 30, rot = (rnd() - 0.5) * 0.9;
        ctx.save();
        ctx.globalAlpha = 0.1 + rnd() * 0.09;
        ctx.translate(x, y); ctx.rotate(rot);
        drawIcon(ctx, key, 0, 0, r, color);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawAvatar(ctx, img, cx, cy, r, ring, fallbackColor, name, F) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    let ok = false;
    if (img) {
      const iw = img.width || img.naturalWidth || 0, ih = img.height || img.naturalHeight || 0, m = Math.min(iw, ih);
      if (m > 0) { try { ctx.drawImage(img, (iw - m) / 2, (ih - m) / 2, m, m, cx - r, cy - r, r * 2, r * 2); ok = true; } catch (e) { ok = false; } }
    }
    if (!ok) {
      ctx.fillStyle = fallbackColor; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(r * 0.95)}px ${F.head}`;
      ctx.fillText(String(name || '?').trim().charAt(0).toUpperCase() || '?', cx, cy + r * 0.06);
    }
    ctx.restore();
    ctx.lineWidth = Math.max(4, r * 0.06); ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(cx, cy, r + ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = Math.max(4, r * 0.05); ctx.strokeStyle = ring;
    ctx.beginPath(); ctx.arc(cx, cy, r + Math.max(4, r * 0.06) + ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.textBaseline = 'alphabetic';
  }

  // ---------------------------------------------------------------- dữ liệu card
  // a, b: { name, img }. rel: hàng relationships (hoặc bản nháp có kind/type_name/icon/color_key/color_hex/xp/started_at)
  function buildCardData(rel, a, b, now) {
    const pp = paletteOf(rel), pr = prog(rel.xp | 0);
    return {
      a, b, typeName: String(rel.type_name || '').slice(0, 24) || 'Bạn bè', icon: ICON_ORDER.includes(rel.icon) ? rel.icon : 'star',
      pal: pp.pal, deco: pp.deco, seed: Number(rel.id) || 7,
      days: rel.started_at ? daysSince(rel.started_at, now) : 1,
      level: pr.lv, into: pr.into, need: pr.need, pct: pr.pct, xp: rel.xp | 0,
      streak: streakNow(rel, now), title: titleOf(pr.lv),
    };
  }

  // ---------------------------------------------------------------- vẽ CARD 1200x675
  function drawCard(ctx, W, H, d, opt) {
    const F = fontsOf(opt), pal = d.pal, onAcc = onColor(pal.acc);
    ctx.save();
    // nền + hoa văn chìm
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, pal.bg1); g.addColorStop(1, pal.bg2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    drawDeco(ctx, W, H, d.deco, pal.soft, d.seed);
    rrect(ctx, 16, 16, W - 32, H - 32, 36); ctx.lineWidth = 3; ctx.strokeStyle = alpha(pal.acc, 0.35); ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `600 24px ${F.body}`; ctx.fillStyle = pal.mut;
    ctx.fillText('JUSTASEED · RELATIONSHIP', W / 2, 64);

    // hai người ở hai bên
    const cy = 238, R = 116, lx = 220, rx = W - 220;
    ctx.setLineDash([2, 18]); ctx.lineCap = 'round'; ctx.lineWidth = 9; ctx.strokeStyle = alpha(pal.acc, 0.75);
    ctx.beginPath(); ctx.moveTo(lx + R + 28, cy); ctx.lineTo(rx - R - 28, cy); ctx.stroke();
    ctx.setLineDash([]);
    drawAvatar(ctx, d.a.img, lx, cy, R, pal.acc, pal.acc2, d.a.name, F);
    drawAvatar(ctx, d.b.img, rx, cy, R, pal.acc, pal.acc2, d.b.name, F);
    ctx.textAlign = 'center'; ctx.fillStyle = pal.ink;
    [[lx, d.a.name], [rx, d.b.name]].forEach(([x, n]) => {
      n = String(n || 'Người chơi');
      fitFont(ctx, n, 700, 40, F.head, 340, 22);
      ctx.fillText(clipText(ctx, n, 340), x, 428);
    });

    // giữa: biểu tượng + tên loại relationship
    ctx.beginPath(); ctx.arc(W / 2, cy, 94, 0, Math.PI * 2);
    ctx.fillStyle = pal.dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.92)'; ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = pal.acc; ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, cy, 78, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = alpha(pal.acc, 0.3); ctx.stroke();
    drawIcon(ctx, d.icon, W / 2, cy, 52, pal.acc);

    ctx.textAlign = 'center'; ctx.fillStyle = pal.ink;
    fitFont(ctx, d.typeName, 700, 44, F.head, 380, 22);
    ctx.fillText(clipText(ctx, d.typeName, 380), W / 2, 394);

    // số ngày
    const dayTxt = `${fmtN(d.days)} ngày bên nhau`;
    ctx.font = `600 28px ${F.body}`;
    const tw = ctx.measureText(dayTxt).width + 48;
    rrect(ctx, W / 2 - tw / 2, 414, tw, 46, 23); ctx.fillStyle = alpha(pal.acc, 0.18); ctx.fill();
    ctx.fillStyle = pal.ink; ctx.fillText(dayTxt, W / 2, 446);

    // khung cấp độ + thanh XP
    rrect(ctx, 48, 490, W - 96, 140, 36); ctx.fillStyle = pal.panel; ctx.fill();
    ctx.beginPath(); ctx.arc(142, 560, 50, 0, Math.PI * 2); ctx.fillStyle = pal.acc; ctx.fill();
    ctx.fillStyle = onAcc; ctx.textAlign = 'center';
    ctx.globalAlpha = 0.85; ctx.font = `700 18px ${F.body}`; ctx.fillText('LV', 142, 535); ctx.globalAlpha = 1;
    ctx.font = `700 46px ${F.head}`; ctx.fillText(String(d.level), 142, 582);

    ctx.textAlign = 'left'; ctx.fillStyle = pal.ink; ctx.font = `700 30px ${F.head}`;
    ctx.fillText(d.title, 220, 538);
    ctx.textAlign = 'right'; ctx.fillStyle = pal.mut; ctx.font = `600 24px ${F.body}`;
    ctx.fillText(`${fmtN(d.xp)} XP`, 900, 538);

    const bx = 220, by = 552, bw = 680, bh = 28;
    rrect(ctx, bx, by, bw, bh, 14); ctx.fillStyle = alpha(pal.ink, 0.13); ctx.fill();
    if (d.pct > 0) {
      const fw = Math.max(bh, bw * d.pct), bg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      bg.addColorStop(0, pal.acc); bg.addColorStop(1, pal.acc2);
      rrect(ctx, bx, by, fw, bh, 14); ctx.fillStyle = bg; ctx.fill();
    }
    ctx.textAlign = 'left'; ctx.fillStyle = pal.mut; ctx.font = `500 24px ${F.body}`;
    ctx.fillText(`${fmtN(d.into)} / ${fmtN(d.need)} XP để lên cấp ${d.level + 1}`, 220, 612);

    ctx.beginPath(); ctx.moveTo(940, 518); ctx.lineTo(940, 602); ctx.lineWidth = 2; ctx.strokeStyle = alpha(pal.ink, 0.12); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = pal.mut; ctx.font = `500 22px ${F.body}`;
    ctx.fillText('Chuỗi cùng nhau', 1020, 538);
    ctx.fillStyle = pal.ink; ctx.font = `700 44px ${F.head}`;
    ctx.fillText(d.streak > 0 ? String(d.streak) : '—', 1020, 586);
    ctx.fillStyle = pal.mut; ctx.font = `500 22px ${F.body}`;
    ctx.fillText(d.streak > 0 ? 'ngày liên tiếp' : 'chưa có chuỗi', 1020, 614);

    ctx.fillStyle = alpha(pal.mut, 0.9); ctx.font = `500 20px ${F.body}`;
    ctx.fillText('justaseed.xyz', W / 2, 660);
    ctx.restore();
  }

  // ---------------------------------------------------------------- vẽ SƠ ĐỒ 1200x960
  // d: { title, me:{name,img}, nodes:[{id,name,img,typeName,icon,pal,level}], links:[{a,b,pal}], more }
  function drawMap(ctx, W, H, d, opt) {
    const F = fontsOf(opt), GREEN = '#4fb06f';
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#eef8ef'); g.addColorStop(1, '#e2f1fb');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(79,176,111,0.10)';
    for (let y = 30; y < H; y += 40) for (let x = 30; x < W; x += 40) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }

    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#244033'; ctx.font = `700 50px ${F.head}`;
    ctx.fillText('Sơ đồ relationship', W / 2, 74);
    ctx.fillStyle = '#678a73'; ctx.font = `500 28px ${F.body}`;
    ctx.fillText(clipText(ctx, d.title || '', W - 160), W / 2, 116);

    const cx = W / 2, cy = Math.round(H * 0.545), MAXN = 14, RY = H > 960 ? 370 : 300;
    const all = d.nodes || [];
    d = Object.assign({}, d, { nodes: all.slice(0, MAXN), more: (d.more || 0) + Math.max(0, all.length - MAXN) });
    const n = d.nodes.length, outer = n, inner = 0;
    const pos = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, n);
      pos.push({ x: cx + Math.cos(a) * 470, y: cy + Math.sin(a) * RY, r: n > 10 ? 46 : 52 });
    }
    const byId = {}; d.nodes.forEach((nd, i) => { byId[nd.id] = pos[i]; });
    const lineOf = (p) => (p && (p.line || p.acc)) || '#4fb06f';

    // cạnh giữa các node (hai người cùng có relationship với mình và với nhau)
    (d.links || []).forEach(l => {
      const A = byId[l.a], B = byId[l.b];
      if (!A || !B) return;
      ctx.save(); ctx.setLineDash([10, 10]); ctx.lineCap = 'round'; ctx.lineWidth = 3.5; ctx.globalAlpha = 0.5;
      ctx.strokeStyle = lineOf(l.pal);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.restore();
    });
    // cạnh nối về mình
    d.nodes.forEach((nd, i) => {
      const p = pos[i];
      ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = lineOf(nd.pal); ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.restore();
    });
    // huy hiệu biểu tượng trên cạnh
    d.nodes.forEach((nd, i) => {
      const p = pos[i], mx = cx + (p.x - cx) * 0.5, my = cy + (p.y - cy) * 0.5;
      ctx.beginPath(); ctx.arc(mx, my, 27, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = lineOf(nd.pal); ctx.stroke();
      drawIcon(ctx, nd.icon, mx, my, 15, lineOf(nd.pal));
    });
    // node (vòng ngoài: nhãn bên dưới; vòng trong: nhãn nằm cạnh để khỏi chồng nhau)
    d.nodes.forEach((nd, i) => {
      const p = pos[i], isInner = false;
      drawAvatar(ctx, nd.img, p.x, p.y, p.r, lineOf(nd.pal), (nd.pal && nd.pal.acc2) || '#9bd7ad', nd.name, F);
      const bw = n > 10 ? 196 : 236, side = p.x >= cx ? 1 : -1;
      const px = isInner ? (side > 0 ? p.x + p.r + 10 : p.x - p.r - 10 - bw) : p.x - bw / 2;
      const py = isInner ? p.y - 33 : p.y + p.r + 8;
      rrect(ctx, px, py, bw, 66, 18); ctx.fillStyle = 'rgba(255,255,255,0.86)'; ctx.fill();
      const tx = px + bw / 2, tw = bw - 16;
      ctx.textAlign = 'center'; ctx.fillStyle = '#244033';
      fitFont(ctx, nd.name, 700, 26, F.head, tw, 16);
      ctx.fillText(clipText(ctx, nd.name, tw), tx, py + 30);
      ctx.fillStyle = lineOf(nd.pal);
      const sub = `${nd.typeName} · Lv ${nd.level}`;
      fitFont(ctx, sub, 600, 21, F.body, tw, 13);
      ctx.fillText(clipText(ctx, sub, tw), tx, py + 56);
    });
    // mình ở giữa
    drawAvatar(ctx, d.me.img, cx, cy, 76, GREEN, '#9bd7ad', d.me.name, F);
    rrect(ctx, cx - 140, cy + 76 + 12, 280, 46, 18); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = '#244033';
    fitFont(ctx, d.me.name, 700, 30, F.head, 260, 18);
    ctx.fillText(clipText(ctx, d.me.name, 260), cx, cy + 76 + 44);
    if (!n) {
      ctx.fillStyle = '#678a73'; ctx.font = `500 28px ${F.body}`;
      ctx.fillText('Chưa có relationship nào', cx, cy + 190);
    }
    if (d.more > 0) {
      ctx.textAlign = 'right'; ctx.fillStyle = '#678a73'; ctx.font = `500 22px ${F.body}`;
      ctx.fillText(`+${d.more} mối quan hệ nữa`, W - 40, H - 40);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(103,138,115,0.9)'; ctx.font = `500 20px ${F.body}`;
    ctx.fillText('justaseed.xyz', 40, H - 40);
    ctx.restore();
  }

  // ---------------------------------------------------------------- kiểm tra đầu vào dùng chung
  const hexOk = (h) => /^#[0-9a-f]{6}$/i.test(String(h || ''));

  return {
    PRESETS, PRESET_ORDER, ICON_ORDER, ICON_EMOJI, QUESTS, TITLES,
    hexToRgb, rgbToHex, hslToHex, alpha, onColor, fromHex, paletteOf, hexOk,
    cum, lvOf, prog, titleOf, vnDay, addDay, daysSince, isoWeek, streakNow, questList,
    drawIcon, drawDeco, drawAvatar, buildCardData, drawCard, drawMap, fmtN,
    CARD_W: 1200, CARD_H: 675, MAP_W: 1200, mapHeight: (n) => (n > 8 ? 1120 : 960),
  };
});
