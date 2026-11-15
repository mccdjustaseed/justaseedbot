// save-store.js : bot đọc/sửa/ghi bản lưu đám mây (game_saves) khi web game đang tắt.
// Ghi theo kiểu "chỉ ghi nếu chưa ai sửa trước" (so cột rev) để không đè mất dữ liệu của web.
const zlib = require('zlib');
const { promisify } = require('util');
const inflateRawA = promisify(zlib.inflateRaw), deflateRawA = promisify(zlib.deflateRaw);

function decode(code) {
  const tag = String(code).slice(0, 5);
  let buf = Buffer.from(String(code).slice(5).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (tag === 'JSA1:') buf = zlib.inflateRawSync(buf);
  else if (tag !== 'JSA0:') throw new Error('Sai định dạng save');
  return JSON.parse(buf.toString('utf8'));
}
// Bản không đồng bộ: save lớn (có ảnh) giải nén/nén bằng bản sync sẽ đứng cả bot vài trăm ms, làm MỌI người chơi bị chậm
async function decodeAsync(code) {
  const tag = String(code).slice(0, 5);
  let buf = Buffer.from(String(code).slice(5).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (tag === 'JSA1:') buf = await inflateRawA(buf);
  else if (tag !== 'JSA0:') throw new Error('Sai định dạng save');
  return JSON.parse(buf.toString('utf8'));
}
async function encodeAsync(obj) {
  const raw = await deflateRawA(Buffer.from(JSON.stringify(obj), 'utf8'));
  return 'JSA1:' + raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function encode(obj) {
  const raw = zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8'));
  return 'JSA1:' + raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// fn(s) sửa trực tiếp object save và trả về chuỗi kết quả. Thử lại tối đa 3 lần nếu bị ghi trước.
async function edit(supabase, uid, fn) {
  for (let k = 0; k < 3; k++) {
    const { data, error } = await supabase.from('game_saves').select('data,rev').eq('user_id', uid).maybeSingle();
    if (error) throw new Error(/\brev\b/.test(error.message || '') ? 'Chưa chạy file game_saves_rev.sql trong Supabase (thiếu cột rev)' : error.message);
    if (!data || !data.data) throw new Error('Chưa có save trên đám mây');
    const s = await decodeAsync(data.data);
    const r = await fn(s);
    const next = r && r.save ? r.save : s, out = r && r.save ? r.out : r;
    const rev = Number(data.rev) || 0;
    const { data: upd, error: e2 } = await supabase.from('game_saves').update({
      data: await encodeAsync(next), xp: Math.round(next.xp || 0), day: next.day || 1, money: Math.round(next.money || 0),
      updated_at: new Date().toISOString(), rev: rev + 1,
    }).eq('user_id', uid).eq('rev', rev).select('user_id');
    if (e2) throw e2;
    if (upd && upd.length) return out;
  }
  throw new Error('Save vừa bị thay đổi, thử lại sau');
}
module.exports = { decode, encode, decodeAsync, encodeAsync, edit };
