// relationship.js : hệ thống relationship cho bot Justaseed
// Lệnh: /relationship card | sodo | daily | nhiemvu | danhsach   (và dạng prefix: j!rel card @người ...)
// Cần: SUPABASE_KEY là service role key, đã chạy relationship_setup.sql, npm i @napi-rs/canvas, file rel-core.js cùng thư mục.
const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const RC = require('./rel-core');

let Cv = null;
try { Cv = require('@napi-rs/canvas'); } catch (e) { console.error('[rel] thiếu @napi-rs/canvas, ảnh relationship sẽ không vẽ được'); }
if (Cv && Cv.GlobalFonts) { // nạp font trong ./fonts (nếu có) để chữ giống game
  try {
    const dir = path.join(__dirname, 'fonts');
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/\.(ttf|otf)$/i.test(f)) { try { Cv.GlobalFonts.registerFromPath(path.join(dir, f)); } catch (e) { /* bỏ qua */ } }
  } catch (e) { /* bỏ qua */ }
}

let client = null, supabase = null, X = null, showcase = null;
const HEART = '💞';
const hex = (s) => String(s || '');

// ---------------- lệnh ----------------
const commands = [
  new SlashCommandBuilder().setName('relationship').setDescription('Hệ thống relationship giữa bạn bè trong Justaseed')
    .addSubcommand(c => c.setName('card').setDescription('Xem card relationship của bạn (kèm ping người kia để chọn đúng cặp)')
      .addUserOption(o => o.setName('nguoi').setDescription('Người có relationship với bạn')))
    .addSubcommand(c => c.setName('sodo').setDescription('Xem sơ đồ relationship của bạn'))
    .addSubcommand(c => c.setName('daily').setDescription('Điểm danh cùng nhau để cộng XP relationship')
      .addUserOption(o => o.setName('nguoi').setDescription('Chỉ điểm danh với người này (bỏ trống là tất cả)')))
    .addSubcommand(c => c.setName('nhiemvu').setDescription('Xem và nhận thưởng nhiệm vụ relationship')
      .addUserOption(o => o.setName('nguoi').setDescription('Người có relationship với bạn')))
    .addSubcommand(c => c.setName('danhsach').setDescription('Danh sách relationship của bạn'))
    .toJSON(),
];

// ---------------- dữ liệu ----------------
const sortPair = (a, b) => (a < b ? [a, b] : [b, a]);
async function relsOf(uid, status = 'active') {
  let q = supabase.from('relationships').select('*').or(`user_a.eq.${uid},user_b.eq.${uid}`);
  if (status) q = q.eq('status', status);
  const { data, error } = await q.order('xp', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => Object.assign(r, { other: r.user_a === uid ? r.user_b : r.user_a }));
}
async function relBetween(a, b) {
  const [x, y] = sortPair(a, b);
  const { data, error } = await supabase.from('relationships').select('*').eq('user_a', x).eq('user_b', y).maybeSingle();
  if (error) throw error;
  return data;
}
const gavOf = (raw) => X.parseGav(raw);

const imgCache = new Map(); // key -> { at, img }
async function loadImg(key, getBuf) {
  const h = imgCache.get(key);
  if (h && Date.now() - h.at < 300000) return h.img;
  let img = null;
  try { const buf = await getBuf(); if (buf) img = await Cv.loadImage(buf); } catch (e) { img = null; }
  imgCache.set(key, { at: Date.now(), img });
  if (imgCache.size > 200) imgCache.delete(imgCache.keys().next().value);
  return img;
}
const dataBuf = (u) => { const m = /^data:image\/[a-z]+;base64,(.+)$/i.exec(String(u || '')); return m ? Buffer.from(m[1], 'base64') : null; };
async function urlBuf(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
}

// thông tin hiển thị của một người chơi: tên, avatar, Discord ID
const personCache = new Map();
async function personsOf(uids) {
  const need = [...new Set(uids)].filter(u => !personCache.has(u) || Date.now() - personCache.get(u).at > 120000);
  if (need.length) {
    const [pr, sp] = await Promise.all([
      supabase.from('profiles').select('id,username,display_name').in('id', need),
      supabase.from('shop_public').select('user_id,game_avatar').in('user_id', need),
    ]);
    const P = {}, S = {};
    (pr.data || []).forEach(x => { P[x.id] = x; });
    (sp.data || []).forEach(x => { S[x.user_id] = x; });
    for (const u of need) {
      const gav = gavOf(S[u] && S[u].game_avatar);
      personCache.set(u, {
        at: Date.now(), uid: u, discordId: X.discordIdOf(u),
        name: clip(gav.nm || (P[u] && (P[u].display_name || P[u].username)) || 'Người chơi', 40),
        av: gav.av || null,
      });
    }
  }
  const out = {};
  for (const u of uids) out[u] = personCache.get(u);
  return out;
}
const clip = (v, n) => String(v ?? '').slice(0, n);
async function avatarOf(p) {
  if (!p) return null;
  if (p.av) { const img = await loadImg(`av:${p.uid}:${p.av.length}`, async () => dataBuf(p.av)); if (img) return img; }
  if (p.discordId) {
    return loadImg(`dc:${p.discordId}`, async () => {
      const u = await client.users.fetch(p.discordId);
      return urlBuf(u.displayAvatarURL({ extension: 'png', size: 256 }));
    });
  }
  return null;
}

// ---------------- vẽ ảnh ----------------
function canvasPng(w, h, draw) {
  const cv = Cv.createCanvas(w, h);
  draw(cv.getContext('2d'));
  return cv.toBuffer('image/png');
}
// left/right: uid của hai người (left đứng bên trái)
async function renderCard(rel, leftUid, rightUid) {
  const P = await personsOf([leftUid, rightUid]);
  const [ia, ib] = await Promise.all([avatarOf(P[leftUid]), avatarOf(P[rightUid])]);
  const d = RC.buildCardData(rel, { name: P[leftUid].name, img: ia }, { name: P[rightUid].name, img: ib }, Date.now());
  return { png: canvasPng(RC.CARD_W, RC.CARD_H, (ctx) => RC.drawCard(ctx, RC.CARD_W, RC.CARD_H, d)), P, d };
}
async function renderMap(uid) {
  const rels = await relsOf(uid);
  const ids = [uid, ...rels.map(r => r.other)];
  const [P, webRes] = await Promise.all([personsOf(ids), supabase.rpc('rel_core_web', { p_uid: uid })]);
  const imgs = await Promise.all(ids.map(u => avatarOf(P[u])));
  const nodes = rels.map((r, i) => {
    const pp = RC.paletteOf(r);
    return { id: r.other, name: P[r.other].name, img: imgs[i + 1], typeName: r.type_name, icon: r.icon, pal: pp.pal, level: RC.lvOf(r.xp) };
  });
  const pal = Object.fromEntries(nodes.map(n => [n.id, n.pal]));
  const links = (Array.isArray(webRes.data) ? webRes.data : [])
    .filter(e => pal[e.a] && pal[e.b])
    .map(e => ({ a: e.a, b: e.b, pal: RC.paletteOf({ color_key: e.color_key, color_hex: e.color_hex, icon: e.icon }).pal }));
  const H = RC.mapHeight(nodes.length);
  const d = { title: `${P[uid].name} · ${rels.length} mối quan hệ`, me: { name: P[uid].name, img: imgs[0] }, nodes, links, more: 0 };
  return { png: canvasPng(RC.MAP_W, H, (ctx) => RC.drawMap(ctx, RC.MAP_W, H, d)), P, count: rels.length };
}

// ---------------- bài khoe lên kênh (dùng chung cho nút trong bot và bài gửi từ game) ----------------
const who = (p) => (p && p.discordId ? `<@${p.discordId}>` : (p ? p.name : 'Người chơi')); // mention chỉ hiển thị, không ping
function specCard(rel, A, B, png, caption) {
  const lv = RC.lvOf(rel.xp);
  return {
    kind: 'relcard', png, file: 'relcard.png',
    title: `Relationship: ${rel.type_name}`,
    lines: [
      `**Cặp đôi:** ${who(A)} & ${who(B)}`,
      `**Loại:** ${rel.type_name} · **Cấp:** ${lv} (${RC.titleOf(lv)}) · **XP:** ${RC.fmtN(rel.xp)}`,
      `**Ngày bên nhau:** ${RC.fmtN(rel.started_at ? RC.daysSince(rel.started_at, Date.now()) : 1)}`,
      caption ? `*${clip(caption, 200)}*` : null,
    ].filter(Boolean),
    threadTitle: `Relationship ${rel.type_name}: ${A.name} & ${B.name}`,
    threadNote: `Card relationship ${rel.type_name} của ${A.name} & ${B.name} đã được đăng, mọi người cùng trò chuyện ở đây nhé!`,
  };
}
function specMap(me, count, png) {
  return {
    kind: 'relmap', png, file: 'relmap.png',
    title: `Sơ đồ relationship của ${me.name}`,
    lines: [`**Chủ sơ đồ:** ${who(me)}`, `**Số mối quan hệ:** ${count}`],
    threadTitle: `Sơ đồ relationship: ${me.name}`,
    threadNote: `Sơ đồ relationship của ${me.name} đã được đăng, mọi người cùng trò chuyện ở đây nhé!`,
  };
}
// bài do game gửi (bảng discord_shares: kind relcard | relmap). Kiểm tra lại người gửi có thật sự thuộc cặp.
async function specFromShare(row, pngBuf) {
  const p = row.payload || {};
  if (row.kind === 'relmap') {
    const me = (await personsOf([row.user_id]))[row.user_id];
    return specMap(me, Number(p.count) || 0, pngBuf);
  }
  if (row.kind !== 'relcard') return null;
  const { data: rel } = await supabase.from('relationships').select('*').eq('id', Number(p.rel_id) || 0).maybeSingle();
  if (!rel || rel.status !== 'active' || ![rel.user_a, rel.user_b].includes(row.user_id)) return null;
  const other = rel.user_a === row.user_id ? rel.user_b : rel.user_a;
  const P = await personsOf([row.user_id, other]);
  return specCard(rel, P[row.user_id], P[other], pngBuf, p.caption);
}

// ---------------- giao diện tin nhắn ----------------
const em = () => X.EM;
const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
};
async function cardMessage(rel, meUid, owner) {
  const { png, P } = await renderCard(rel, meUid, rel.user_a === meUid ? rel.user_b : rel.user_a);
  const other = rel.user_a === meUid ? rel.user_b : rel.user_a;
  const pr = RC.prog(rel.xp), A = P[meUid], B = P[other];
  return X.layout([
    X.H(`${rel.type_name}: ${clip(A.name, 30)} & ${clip(B.name, 30)}`, HEART),
    { img: 'attachment://relcard.png' },
    `${em().a} **Cấp ${pr.lv}** · ${RC.titleOf(pr.lv)} · ${RC.fmtN(rel.xp)} XP\n${em().b} **${RC.fmtN(RC.daysSince(rel.started_at, Date.now()))}** ngày bên nhau`,
    { sep: true },
    { row: new ActionRowBuilder().addComponents(
      btn(`rl:show:card:${rel.id}:${owner}`, 'Khoe lên kênh', ButtonStyle.Primary, em().star),
      btn(`rl:ref:card:${rel.id}:${owner}`, 'Làm mới', ButtonStyle.Secondary, em().refresh)) },
    `-# ${em().a} Justaseed • ${X.stamp()}`,
  ], { files: [new AttachmentBuilder(png, { name: 'relcard.png' })], attachments: [] });
}
async function mapMessage(uid, owner) {
  const r = await renderMap(uid);
  return X.layout([
    X.H('Sơ đồ relationship', HEART),
    { img: 'attachment://relmap.png' },
    `${em().a} **${r.count}** mối quan hệ`,
    { sep: true },
    { row: new ActionRowBuilder().addComponents(
      btn(`rl:show:map:${uid}:${owner}`, 'Khoe lên kênh', ButtonStyle.Primary, em().star),
      btn(`rl:ref:map:${uid}:${owner}`, 'Làm mới', ButtonStyle.Secondary, em().refresh)) },
    `-# ${em().a} Justaseed • ${X.stamp()}`,
  ], { files: [new AttachmentBuilder(r.png, { name: 'relmap.png' })], attachments: [] });
}
async function pickMessage(rels, uid, what, owner) {
  const P = await personsOf(rels.map(r => r.other));
  const sel = new StringSelectMenuBuilder().setCustomId(`rl:sel:${what}:${owner}`).setPlaceholder('Chọn relationship')
    .addOptions(rels.slice(0, 25).map(r => new StringSelectMenuOptionBuilder()
      .setValue(String(r.id)).setLabel(clip(`${r.type_name} · ${P[r.other].name}`, 100)).setDescription(`Cấp ${RC.lvOf(r.xp)} · ${RC.fmtN(r.xp)} XP`)));
  return X.layout([X.H('Chọn relationship', HEART), 'Bạn có nhiều relationship, hãy chọn một cái:', { row: new ActionRowBuilder().addComponents(sel) }]);
}
const bar = (have, need) => { const n = 8, f = Math.round(n * Math.min(1, have / need)); return '▰'.repeat(f) + '▱'.repeat(n - f); };
async function questMessage(rel, meUid, owner) {
  const other = rel.user_a === meUid ? rel.user_b : rel.user_a;
  const P = await personsOf([meUid, other]);
  const list = RC.questList(rel, Date.now());
  const line = (q) => `${q.claimed ? em().ok : q.ready ? em().gift : em().wait} ${q.t}\n-# ${bar(q.have, q.need)} ${q.have}/${q.need} · +${q.xp} XP${q.claimed ? ' · đã nhận' : ''}`;
  const rows = [], ready = list.filter(q => q.ready);
  for (let i = 0; i < ready.length && i < 10; i += 5) {
    rows.push({ row: new ActionRowBuilder().addComponents(ready.slice(i, i + 5).map(q =>
      btn(`rl:claim:${rel.id}:${q.id}:${owner}`, `Nhận +${q.xp} XP`, ButtonStyle.Success))) });
  }
  const pr = RC.prog(rel.xp);
  return X.layout([
    X.H(`Nhiệm vụ: ${clip(rel.type_name, 20)} · ${clip(P[other].name, 24)}`, HEART),
    `${em().a} Cấp **${pr.lv}** · ${pr.into}/${pr.need} XP`,
    { sep: true },
    `**Hôm nay**\n${list.filter(q => q.sc === 'd').map(line).join('\n')}`,
    `**Tuần này**\n${list.filter(q => q.sc === 'w').map(line).join('\n')}`,
    { sep: true }, ...rows,
    `-# Nhiệm vụ làm mới 0 giờ sáng (giờ Việt Nam) · tuần bắt đầu từ thứ Hai · ${X.stamp()}`,
  ]);
}

// ---------------- xử lý lệnh ----------------
async function resolveTarget(i, uid) { // trả về { rel } | { error } | { many }
  const target = i.options.getUser('nguoi');
  if (target) {
    const other = await X.userIdOf(target.id);
    if (!other) return { error: `${target.username} chưa liên kết tài khoản game.` };
    const rel = await relBetween(uid, other);
    if (!rel || rel.status !== 'active') return { error: `Bạn và ${target.username} chưa có relationship nào.` };
    return { rel };
  }
  const rels = await relsOf(uid);
  if (!rels.length) return { error: 'Bạn chưa có relationship nào. Vào game → Cộng đồng → Bạn bè, bấm nút 💞 cạnh một người bạn để bắt đầu.' };
  if (rels.length === 1) return { rel: rels[0] };
  return { many: rels };
}
async function cmdRel(i) {
  const sub = i.options.getSubcommand();
  await i.deferReply(); // trả lời công khai tại kênh dùng lệnh
  if (!Cv) return X.say(i, 'Máy chủ bot chưa cài @napi-rs/canvas nên chưa vẽ được ảnh.');
  const uid = await X.userIdOf(i.user.id);
  if (!uid) return X.say(i, X.NOT_LINKED);
  const owner = i.user.id;

  if (sub === 'card') {
    const r = await resolveTarget(i, uid);
    if (r.error) return X.say(i, r.error);
    if (r.many) return i.editReply(await pickMessage(r.many, uid, 'card', owner));
    return i.editReply(await cardMessage(r.rel, uid, owner));
  }
  if (sub === 'sodo') return i.editReply(await mapMessage(uid, owner));
  if (sub === 'nhiemvu') {
    const r = await resolveTarget(i, uid);
    if (r.error) return X.say(i, r.error);
    if (r.many) return i.editReply(await pickMessage(r.many, uid, 'quest', owner));
    return i.editReply(await questMessage(r.rel, uid, owner));
  }
  if (sub === 'danhsach') {
    const all = await relsOf(uid, null);
    if (!all.length) return X.say(i, 'Bạn chưa có relationship nào.');
    const P = await personsOf(all.map(r => r.other));
    const lines = all.map(r => r.status === 'active'
      ? `${em().a} **${r.type_name}** · ${P[r.other].name} · Cấp ${RC.lvOf(r.xp)} · ${RC.fmtN(r.xp)} XP · ${RC.fmtN(RC.daysSince(r.started_at, Date.now()))} ngày`
      : `${em().wait} **${r.type_name}** · ${P[r.other].name} · ${r.requested_by === uid ? 'đang chờ bạn ấy chấp nhận' : 'bạn ấy đang chờ bạn chấp nhận (vào game)'}`);
    return i.editReply(X.layout([X.H('Relationship của bạn', HEART), lines.join('\n').slice(0, 3500), `-# ${X.stamp()}`]));
  }
  if (sub === 'daily') {
    let rels;
    const target = i.options.getUser('nguoi');
    if (target) {
      const r = await resolveTarget(i, uid);
      if (r.error) return X.say(i, r.error);
      rels = [r.rel];
    } else rels = await relsOf(uid);
    if (!rels.length) return X.say(i, 'Bạn chưa có relationship nào.');
    const P = await personsOf(rels.map(r => r.user_a === uid ? r.user_b : r.user_a));
    const out = [];
    for (const rel of rels.slice(0, 20)) {
      const other = rel.user_a === uid ? rel.user_b : rel.user_a;
      const { data, error } = await supabase.rpc('rel_core_checkin', { p_uid: uid, p_rel: rel.id });
      const nm = `**${clip(rel.type_name, 20)}** · ${P[other].name}`;
      if (error) out.push(`${em().no} ${nm}: lỗi, thử lại sau`);
      else if (!data.ok) out.push(`${em().wait} ${nm}: ${data.msg}`);
      else out.push(`${em().ok} ${nm}: +${data.add} XP${data.both ? ` · cả hai đã điểm danh, **+${data.bonus} XP**, chuỗi ${data.streak} ngày` : ' · chờ bạn ấy điểm danh để nhận thêm'}${data.level_up ? ` · ${HEART} lên cấp ${data.level}!` : ''}`);
    }
    return i.editReply(X.layout([X.H('Điểm danh cùng nhau', HEART), out.join('\n').slice(0, 3500), `-# Cả hai cùng điểm danh trong ngày để nhận thưởng thêm và giữ chuỗi · ${X.stamp()}`]));
  }
}

async function onInteraction(i) {
  try {
    if (i.isChatInputCommand() && i.commandName === 'relationship') return await cmdRel(i);
    if (!(i.isButton() || i.isStringSelectMenu()) || !i.customId.startsWith('rl:')) return;
    const parts = i.customId.split(':');
    const owner = parts[parts.length - 1];
    if (i.user.id !== owner) return i.reply({ ...X.layout(['Nút này của người dùng lệnh.']), flags: X.V2 | X.EPH });
    const uid = await X.userIdOf(owner);
    if (!uid) return;

    if (i.isStringSelectMenu()) { // rl:sel:<card|quest>:<owner>
      await i.deferUpdate();
      const { data: rel } = await supabase.from('relationships').select('*').eq('id', Number(i.values[0])).maybeSingle();
      if (!rel || rel.status !== 'active' || ![rel.user_a, rel.user_b].includes(uid)) return i.editReply({ ...X.layout(['Không tìm thấy relationship.']), attachments: [] });
      return i.editReply(parts[2] === 'quest' ? await questMessage(rel, uid, owner) : await cardMessage(rel, uid, owner));
    }
    const act = parts[1];
    if (act === 'claim') { // rl:claim:<relId>:<questId>:<owner>
      await i.deferUpdate();
      const { data } = await supabase.rpc('rel_core_claim', { p_uid: uid, p_rel: Number(parts[2]), p_quest: parts[3] });
      const { data: rel } = await supabase.from('relationships').select('*').eq('id', Number(parts[2])).maybeSingle();
      if (!rel) return;
      const msg = await questMessage(rel, uid, owner);
      if (data && !data.ok) await i.followUp({ ...X.layout([`${em().no} ${data.msg}`]), flags: X.V2 }).catch(() => {});
      else if (data && data.ok) await i.followUp({ ...X.layout([`${em().ok} +${data.add} XP${data.level_up ? ` · ${HEART} lên cấp ${data.level}!` : ''}`]), flags: X.V2 }).catch(() => {});
      return i.editReply(msg);
    }
    if (act === 'ref') { // rl:ref:<card|map>:<id>:<owner>
      await i.deferUpdate();
      if (parts[2] === 'map') return i.editReply(await mapMessage(uid, owner));
      const { data: rel } = await supabase.from('relationships').select('*').eq('id', Number(parts[3])).maybeSingle();
      if (!rel || rel.status !== 'active' || ![rel.user_a, rel.user_b].includes(uid)) return;
      return i.editReply(await cardMessage(rel, uid, owner));
    }
    if (act === 'show') { // rl:show:<card|map>:<id>:<owner>
      await i.deferReply();
      if (!showcase) return X.say(i, 'Chưa cấu hình kênh khoe.');
      let spec;
      if (parts[2] === 'map') {
        const r = await renderMap(uid);
        spec = specMap(r.P[uid], r.count, r.png);
      } else {
        const { data: rel } = await supabase.from('relationships').select('*').eq('id', Number(parts[3])).maybeSingle();
        if (!rel || rel.status !== 'active' || ![rel.user_a, rel.user_b].includes(uid)) return X.say(i, 'Không tìm thấy relationship.');
        const other = rel.user_a === uid ? rel.user_b : rel.user_a;
        const r = await renderCard(rel, uid, other);
        spec = specCard(rel, r.P[uid], r.P[other], r.png);
      }
      const sent = await showcase(spec);
      return X.say(i, sent ? `${em().ok} Đã khoe lên kênh: ${sent.url}` : `${em().no} Không đăng được lên kênh khoe (kiểm tra CHANNEL_ID).`);
    }
  } catch (err) {
    console.error('[rel] lỗi', err);
    try {
      const m = { ...X.layout(['Có lỗi xảy ra, thử lại sau nhé.']), attachments: [] };
      if (i.deferred || i.replied) await i.editReply(m); else if (i.isRepliable()) await i.reply({ ...m, flags: X.V2 });
    } catch (e) { /* bỏ qua */ }
  }
}

// ---------------- lệnh prefix: j!rel card @người, j!rel sodo, j!rel daily, j!rel nhiemvu, j!rel ds ----------------
const strip = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const SUBS = { card: 'card', the: 'card', sodo: 'sodo', map: 'sodo', daily: 'daily', diemdanh: 'daily', nhiemvu: 'nhiemvu', quest: 'nhiemvu', danhsach: 'danhsach', ds: 'danhsach', list: 'danhsach' };
async function prefixRel(ctx) {
  const sub = SUBS[strip(ctx.args[0] || 'danhsach')];
  if (!sub) return ctx.reply(X.layout([`${em().no} Cú pháp: \`${X.PREFIX}rel card|sodo|daily|nhiemvu|ds [@người]\``]));
  const user = ctx.msg.mentions.users.first() || null;
  ctx.options = { getSubcommand: () => sub, getUser: (n) => (n === 'nguoi' ? user : null), getString: () => null, getInteger: () => null };
  return cmdRel(ctx);
}
function registerPrefix(prefixCommands) {
  for (const k of ['rel', 'relationship', 'quanhe', 'qh']) prefixCommands[k] = prefixRel;
}

function init(discordClient, sb, helpers) {
  client = discordClient; supabase = sb; X = helpers;
  client.on('interactionCreate', onInteraction);
}
// index.js gọi hàm này để cấp hàm đăng bài khoe (có tạo thread, không ping)
function setShowcase(fn) { showcase = fn; }

module.exports = { commands, init, setShowcase, registerPrefix, specFromShare };
