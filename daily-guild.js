// daily-guild.js : đọc kênh Daily Guild trên Discord -> bảng Supabase `daily_guild`
// Web (Sky > Daily Guild) đọc bảng này và tự cập nhật bằng Realtime.
// Cần: SUPABASE_KEY là service role key, Node 18+, bot có quyền View Channel + Read Message History ở kênh,
//      Message Content Intent đã bật (bot hiện đã bật). Chạy file daily-guild.sql trước.
const CHANNEL_ID = process.env.DAILY_GUILD_CHANNEL_ID || '1571136797394870324';
const TABLE = 'daily_guild', BUCKET = 'dailyguild';
const KEEP = Number(process.env.DAILY_GUILD_KEEP) || 60;   // số tin giữ lại trong bảng
const BACKFILL = 30;                                       // số tin lấy lại khi bot khởi động
const MAX_IMG = 8 * 1024 * 1024;

const log = (...a) => console.log('[daily-guild]', ...a);
const err = (...a) => console.error('[daily-guild]', ...a);

let supabase = null, client = null, chain = Promise.resolve();
// xử lý lần lượt từng việc để tin sửa/xóa không đè nhau
const queue = (fn) => { chain = chain.then(fn).catch(e => err(e && e.message || e)); return chain; };

// link ảnh cdn.discordapp.com có chữ ký và hết hạn sau ~24h -> chép ảnh sang Supabase Storage để web không bị vỡ ảnh
const isCdn = (u) => /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(u);

// lấy chữ + ảnh từ tin dạng layout (Components V2)
function walk(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, out)); return; }
  const j = typeof node.toJSON === 'function' ? node.toJSON() : node;
  if (j.type === 10 && j.content) out.text.push(j.content);                                   // TextDisplay
  if (j.type === 11 && j.media && j.media.url) out.images.push(j.media.url);                  // Thumbnail
  if (j.type === 12 && Array.isArray(j.items)) j.items.forEach(i => i.media && i.media.url && out.images.push(i.media.url)); // MediaGallery
  if (j.components) walk(j.components, out);
  if (j.accessory) walk(j.accessory, out);
}

function build(m) {
  const text = [], imgs = [];
  const srcs = [m];
  const snap = m.messageSnapshots && m.messageSnapshots.first && m.messageSnapshots.first();
  if (snap) srcs.push(snap); // tin được chuyển tiếp
  for (const x of srcs) {
    const body = (x === m ? m.cleanContent : (x.content || '')) || '';
    if (body.trim()) text.push(body.trim());
    const atts = x.attachments && x.attachments.values ? [...x.attachments.values()] : [];
    for (const a of atts) {
      if ((a.contentType || '').startsWith('image/')) imgs.push(a.url);
      else text.push('📎 ' + (a.name || 'tệp đính kèm'));
    }
    for (const e of x.embeds || []) {
      if (e.data && e.data.type && e.data.type !== 'rich') continue; // bỏ xem trước link
      if (e.title) text.push('**' + e.title + '**');
      if (e.description) text.push(e.description);
      for (const f of e.fields || []) text.push('**' + f.name + '**\n' + f.value);
      const im = (e.image && e.image.url) || (e.thumbnail && e.thumbnail.url);
      if (im) imgs.push(im);
    }
    try {
      const out = { text: [], images: [] };
      walk(x.components, out);
      text.push(...out.text); imgs.push(...out.images);
    } catch (e) { /* bỏ qua */ }
  }
  const content = text.join('\n\n').replace(/<a?:(\w+):\d+>/g, ':$1:').trim();
  const a = m.author;
  return {
    message_id: m.id,
    author_name: (m.member && m.member.displayName) || (a && (a.globalName || a.username)) || 'Discord',
    author_avatar: (a && a.displayAvatarURL) ? a.displayAvatarURL({ extension: 'png', size: 64 }) : null,
    content,
    images: [...new Set(imgs)].slice(0, 10),
    created_at: new Date(m.createdTimestamp).toISOString(),
    edited_at: m.editedTimestamp ? new Date(m.editedTimestamp).toISOString() : null,
  };
}

async function mirror(urls, mid) {
  const images = [], files = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    if (!isCdn(u) || typeof fetch !== 'function') { images.push(u); continue; }
    try {
      const r = await fetch(u);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (Number(r.headers.get('content-length') || 0) > MAX_IMG) throw new Error('ảnh quá lớn');
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_IMG) throw new Error('ảnh quá lớn');
      const ct = (r.headers.get('content-type') || 'image/png').split(';')[0];
      const ext = ((ct.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 5)) || 'png';
      const path = `${mid}/${i}.${ext}`;
      const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true, cacheControl: '31536000' });
      if (up.error) throw up.error;
      images.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
      files.push(path);
    } catch (e) { err('không lưu được ảnh:', e.message); images.push(u); }
  }
  return { images, files };
}

async function remove(ids) {
  ids = [].concat(ids);
  if (!ids.length) return;
  const { data } = await supabase.from(TABLE).select('files').in('message_id', ids);
  const files = (data || []).flatMap(r => r.files || []);
  await supabase.from(TABLE).delete().in('message_id', ids);
  if (files.length) await supabase.storage.from(BUCKET).remove(files);
}

async function save(m, onlyIfChanged) {
  const row = build(m);
  if (!row.content && !row.images.length) return remove(m.id);
  const { data: old } = await supabase.from(TABLE).select('files,edited_at').eq('message_id', m.id).maybeSingle();
  if (onlyIfChanged && old && (old.edited_at ? new Date(old.edited_at).getTime() : 0) === (row.edited_at ? new Date(row.edited_at).getTime() : 0)) return;
  const mi = await mirror(row.images, m.id);
  row.images = mi.images; row.files = mi.files;
  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'message_id' });
  if (error) throw error;
  const stale = ((old && old.files) || []).filter(p => !mi.files.includes(p));
  if (stale.length) await supabase.storage.from(BUCKET).remove(stale);
}

async function prune() {
  const { data } = await supabase.from(TABLE).select('message_id').order('created_at', { ascending: false }).range(KEEP, KEEP + 500);
  if (data && data.length) await remove(data.map(r => r.message_id));
}

async function backfill() {
  const ch = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!ch || !ch.messages) return err('không thấy kênh ' + CHANNEL_ID + ' (kiểm tra ID và quyền View Channel / Read Message History)');
  const msgs = await ch.messages.fetch({ limit: BACKFILL });
  const arr = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  for (const m of arr) await save(m, true);
  // xóa khỏi bảng những tin đã bị xóa lúc bot offline
  const have = new Set(arr.map(m => m.id));
  let q = supabase.from(TABLE).select('message_id');
  if (arr.length) q = q.gte('created_at', new Date(arr[0].createdTimestamp).toISOString());
  const { data } = await q;
  const gone = (data || []).map(r => r.message_id).filter(id => !have.has(id));
  if (gone.length) await remove(gone);
  await prune();
  log(`đã đồng bộ ${arr.length} tin, xóa ${gone.length}`);
}

function init(discordClient, sb) {
  client = discordClient; supabase = sb;

  client.on('messageCreate', (m) => {
    if (m.channelId !== CHANNEL_ID) return;
    queue(async () => { await save(m); await prune(); });
  });
  client.on('messageUpdate', (_o, n) => {
    if (n.channelId !== CHANNEL_ID) return;
    queue(async () => { const full = n.partial ? await n.fetch() : n; await save(full); });
  });
  client.on('messageDelete', (m) => {
    if (m.channelId !== CHANNEL_ID) return;
    queue(() => remove(m.id));
  });
  client.on('messageDeleteBulk', (msgs, channel) => {
    if (channel.id !== CHANNEL_ID) return;
    queue(() => remove([...msgs.keys()]));
  });

  client.once('ready', () => {
    queue(backfill);
    setInterval(() => queue(backfill), 30 * 60 * 1000); // đối chiếu lại mỗi 30 phút cho chắc
  });
}

module.exports = { init };
