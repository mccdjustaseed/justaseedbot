// upload-emojis.js — xuất toàn bộ icon của game ra PNG và tải lên làm emoji của bot (application emoji)
//
//   node upload-emojis.js --export-only   chỉ xuất PNG vào ./emoji-png (để tự kéo thả lên Discord)
//   node upload-emojis.js                 xuất PNG + tải lên emoji của bot, ghi ./emoji-map.json
//
// Cần: TOKEN, CLIENT_ID trong .env (như bot), @napi-rs/canvas. Emoji của bot dùng được ở mọi server bot có mặt, tối đa 2000.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Cv = require('@napi-rs/canvas');
const { iconSvg, ICON_KEYS } = require('./game-assets');

const SIZE = 128;                       // Discord khuyên 128x128, tối đa 256 KB
const PREFIX = 'js_';                   // tên emoji: js_ring, js_money...
const OUT = path.join(__dirname, 'emoji-png');
const EXPORT_ONLY = process.argv.includes('--export-only');

// chuẩn hóa SVG của game (thuộc tính không có ngoặc kép) giống render.js
const clean = (svg) => svg
  .replace(/(\s[\w:-]+)=([^\s"'>]+?)(?=\s|\/>|>)/g, '$1="$2"')
  .replace(/<svg\b([^>]*)>/, (m, at) => `<svg${at.replace(/\s(?:width|height)="[^"]*"/g, '')} width="${SIZE}" height="${SIZE}">`)
  .replace(/currentColor/g, '#3b5a47');

async function toPng(svg) {
  const img = await Cv.loadImage(Buffer.from(clean(svg)));
  const c = Cv.createCanvas(SIZE, SIZE), ctx = c.getContext('2d');
  const k = Math.min(SIZE / img.width, SIZE / img.height) * 0.94, w = img.width * k, h = img.height * k;
  ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h); // nền trong suốt, căn giữa
  return c.toBuffer('image/png');
}

(async () => {
  // gom theo tên icon (nhiều emoji cùng trỏ về 1 icon) -> 1 emoji / icon
  const byName = new Map(), chars = {};
  for (const [ch, name] of Object.entries(ICON_KEYS)) {
    (chars[name] = chars[name] || []).push(ch);
    if (!byName.has(name)) byName.set(name, ch);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const files = [];
  for (const [name, ch] of byName) {
    const svg = iconSvg(ch);
    if (!svg) { console.warn('bỏ qua (không có SVG):', name); continue; }
    const buf = await toPng(svg);
    const en = (PREFIX + name).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32);
    fs.writeFileSync(path.join(OUT, en + '.png'), buf);
    files.push({ name: en, buf, from: name, chars: chars[name] });
  }
  console.log(`Đã xuất ${files.length} icon vào ${OUT}`);
  if (EXPORT_ONLY) return;

  const { TOKEN, CLIENT_ID } = process.env;
  if (!TOKEN || !CLIENT_ID) throw new Error('Thiếu TOKEN hoặc CLIENT_ID trong .env');
  const { REST } = require('discord.js');
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const base = `/applications/${CLIENT_ID}/emojis`;

  const have = new Map(((await rest.get(base)).items || []).map(e => [e.name, e]));
  const map = {};
  for (const f of files) {
    let e = have.get(f.name);
    if (!e) {
      for (let tries = 0; tries < 3 && !e; tries++) {
        try {
          e = await rest.post(base, { body: { name: f.name, image: 'data:image/png;base64,' + f.buf.toString('base64') } });
          console.log('+ đã tải lên', f.name);
        } catch (err) {
          console.error('! lỗi', f.name, err.message);
          await new Promise(r => setTimeout(r, 1500)); // chờ rồi thử lại (rate limit)
        }
      }
    } else console.log('= đã có', f.name);
    if (e) for (const ch of f.chars) map[ch] = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
  }
  fs.writeFileSync(path.join(__dirname, 'emoji-map.json'), JSON.stringify(map, null, 1));
  console.log(`Xong. Ghi emoji-map.json (${Object.keys(map).length} ký tự -> emoji).`);
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
