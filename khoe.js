// khoe.js : "khoe" ngay trên bot, dùng lại đúng ảnh của game (ảnh tổng kết ngày, ảnh khoe workshop).
//   /khoe ngay       ảnh tổng kết ngày gần nhất
//   /khoe workshop   chọn một món trên kệ workshop để tạo ảnh khoe
// Mỗi ảnh có nút "Khoe lên kênh": bot ghi vào bảng daily_summaries / discord_shares, bài được đăng bằng đúng
// bộ đăng sẵn có trong index.js (cùng layout, cùng thread như khi bấm "Gửi lên Discord" trên web).
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const headless = require('./headless');

let sb = null, X = null;
const shots = new Map();   // id tin nhắn -> ảnh + thông tin để đăng (giữ trong bộ nhớ, tối đa 200 ảnh / 6 giờ)
const lastPost = new Map(); // chống bấm liên tục (giống web: 15 giây)
const TTL = 6 * 3600 * 1000, COOLDOWN = 15000;
const TY = { fa: ['💐', 'Cắm hoa'], br: ['📿', 'Vòng tay'], ca: ['🕯️', 'Nến thơm'], ar: ['🖼️', 'Tranh vẽ'], po: ['🏺', 'Đồ gốm'], sh: ['👕', 'Áo phông'], pf: ['🧴', 'Nước hoa'] };
const isSnow = (v) => /^\d{5,25}$/.test(String(v || ''));
const stripVN = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().trim();

function remember(id, entry) {
  if (!id) return;
  shots.set(String(id), { ...entry, at: Date.now() });
  for (const [k, v] of shots) if (shots.size > 200 || Date.now() - v.at > TTL) shots.delete(k); else break;
}
const shareRow = (owner, kind) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`kh:p:${kind}:${owner}`).setStyle(ButtonStyle.Primary).setLabel('Khoe lên kênh').setEmoji(X.EM.star));
const shopName = (s) => (s.pf && s.pf.nm) || s.name || 'Tiệm hoa';
const theme = (s) => (s.pf && /^#[0-9a-f]{6}$/i.test(s.pf.col || '') ? s.pf.col : '#4fb06f');

// ---------------- lệnh /khoe ----------------
const commands = [
  new SlashCommandBuilder().setName('khoe').setDescription('Tạo ảnh khoe và đăng lên kênh Discord')
    .addSubcommand(c => c.setName('ngay').setDescription('Ảnh tổng kết ngày bán gần nhất'))
    .addSubcommand(c => c.setName('workshop').setDescription('Ảnh khoe một món trong kệ workshop')
      .addStringOption(o => o.setName('kieu').setDescription('Kiểu ảnh').addChoices({ name: 'Ảnh dọc', value: 'v' }, { name: 'Ảnh ngang', value: 'h' }))),
].map(c => c.toJSON());

async function cmdKhoe(i, sub, kieu) {
  await i.deferReply();
  const E = X.EM;
  if (!headless.available()) return X.say(i, 'Máy chủ bot chưa cài Playwright hoặc thiếu file game nên chưa vẽ được ảnh khoe.');
  const uid = await X.userIdOf(i.user.id);
  if (!uid) return X.say(i, X.NOT_LINKED);
  const sv = await X.loadFresh(uid);
  if (!sv) return X.say(i, X.NO_SAVE);
  const s = sv.s;

  if (sub === 'ngay') {
    if (!s.rpt) return X.say(i, 'Chưa có ngày bán nào kết thúc để khoe. Hãy bán xong một ngày rồi thử lại nhé.');
    const png = await headless.shot(s, 'day');
    return sendPreview(i, { kind: 'd', png, day: s.rpt.d || (s.day || 1) - 1, shop: shopName(s), theme: theme(s) },
      `Ảnh tổng kết ngày ${s.rpt.d || (s.day || 1) - 1}`, 'summary.png');
  }
  // workshop: chọn món
  const items = (s.shelf || []).slice(-25).reverse();
  if (!items.length) return X.say(i, 'Kệ workshop chưa có món nào để khoe. Hãy làm xong một món workshop rồi thử lại.');
  const menu = new StringSelectMenuBuilder().setCustomId(`kh:w:${i.user.id}:${kieu === 'h' ? 'h' : 'v'}`).setPlaceholder('Chọn món muốn khoe')
    .addOptions(items.map(x => {
      const t = TY[x.t] || ['🎁', 'Workshop'];
      return new StringSelectMenuOptionBuilder().setValue(String(x.id)).setLabel(X.clip(x.n || t[1], 100))
        .setDescription(X.clip(`${t[1]} · chất lượng ${x.q | 0}/100`, 100)).setEmoji(t[0]);
    }));
  return i.editReply(X.layout([X.H('Khoe món workshop', E.ws), 'Chọn một món trên kệ để tạo ảnh khoe.', { row: new ActionRowBuilder().addComponents(menu) }]));
}

async function sendPreview(i, entry, title, file) {
  const E = X.EM;
  const msg = await i.editReply(X.layout([
    X.H(title, E.chart),
    { img: `attachment://${file}` },
    { sep: true },
    { row: shareRow(i.user.id, entry.kind) },
    `-# ${E.a} Bấm **Khoe lên kênh** để đăng ảnh này lên kênh chung của server.`,
  ], { files: [new AttachmentBuilder(entry.png, { name: file })], attachments: [] }));
  remember(msg && msg.id, entry);
}

async function onSelect(i) {
  const [, , owner, kieu] = i.customId.split(':');
  if (i.user.id !== owner) return i.reply({ ...X.layout(['Menu này của người dùng lệnh.']), flags: X.V2 | X.EPH });
  const id = i.values[0];
  await i.update(X.layout([X.H('Khoe món workshop', X.EM.ws), `${X.EM.wait} Đang vẽ ảnh, vài giây thôi…`]));
  try {
    const uid = await X.userIdOf(owner);
    const sv = uid && await X.loadFresh(uid);
    if (!sv) return i.editReply(X.layout([X.NO_SAVE]));
    const s = sv.s, x = (s.shelf || []).find(v => String(v.id) === String(id));
    if (!x) return i.editReply(X.layout(['Món này không còn trên kệ nữa.']));
    const png = await headless.shot(s, 'workshop', id, kieu);
    const t = TY[x.t] || ['🎁', 'Workshop'], me = (s.pf && s.pf.nm) || s.name || 'Chủ tiệm';
    const mine = !x.gf && (!x.cr || x.cr === me);
    const payload = {
      name: String(x.n || '').slice(0, 60), type: t[1], emoji: t[0], quality: x.q | 0,
      materials: String(x.mt || '').slice(0, 300), scent: String(x.sc || '').slice(0, 80), value: 0,
      maker_name: String(x.cr || me).slice(0, 40), maker_id: isSnow(x.crd) ? String(x.crd) : (mine ? owner : null),
      gifter_name: x.gf ? String(x.gf).slice(0, 40) : null, gifter_id: x.gf && isSnow(x.gfd) ? String(x.gfd) : null, gift_msg: String(x.gm || '').slice(0, 80),
      workshop_type: t[1], shop_name: shopName(s).slice(0, 60), caption: '',
    };
    const entry = { kind: 'w', png, payload };
    const E = X.EM;
    await i.editReply(X.layout([
      X.H(`Ảnh khoe: ${X.clip(x.n, 40)}`, E.ws), { img: 'attachment://workshop.png' }, { sep: true },
      { row: shareRow(owner, 'w') },
      `-# ${E.a} Bấm **Khoe lên kênh** để đăng ảnh này lên kênh chung của server.`,
    ], { files: [new AttachmentBuilder(png, { name: 'workshop.png' })], attachments: [] }));
    remember(i.message.id, entry);
  } catch (e) {
    console.error('[khoe] lỗi vẽ ảnh workshop:', e.message || e);
    await i.editReply(X.layout([`${X.EM.no} Chưa vẽ được ảnh (${X.clip(e.message || e, 150)}). Thử lại sau nhé.`], { attachments: [] })).catch(() => {});
  }
}

// ---------------- nút "Khoe lên kênh" ----------------
async function onPost(i) {
  const [, , kind, owner] = i.customId.split(':');
  const eph = (t) => i.reply({ ...X.layout([t]), flags: X.V2 | X.EPH });
  if (i.user.id !== owner) return eph('Nút này của người chơi đã tạo ảnh.');
  let e = shots.get(i.message.id);
  if (!e) return eph(`Ảnh này đã hết hạn. Hãy dùng \`/khoe ${kind === 'w' ? 'workshop' : 'ngay'}\` để tạo lại.`);
  if (e.posted) return eph(`${X.EM.ok} Ảnh này đã được gửi lên kênh rồi.`);
  if (Date.now() - (lastPost.get(owner) || 0) < COOLDOWN) return eph('Bạn gửi hơi nhanh, đợi vài giây nhé.');
  lastPost.set(owner, Date.now());
  await i.deferReply({ flags: X.EPH });
  try {
    const uid = await X.userIdOf(owner);
    if (!uid) return X.say(i, X.NOT_LINKED);
    const image = 'data:image/png;base64,' + e.png.toString('base64'), now = new Date().toISOString();
    let r;
    if (e.kind === 'd') {
      r = await sb.from('daily_summaries').insert({
        user_id: uid, discord_id: owner, image, day: e.day, shop_name: e.shop,
        owner_name: i.user.globalName || i.user.username, caption: null, theme_color: e.theme, avatar: null, created_at: now,
      });
    } else {
      r = await sb.from('discord_shares').insert({ user_id: uid, discord_id: owner, kind: 'workshop', image, avatar: null, payload: e.payload, created_at: now });
    }
    if (r.error) throw r.error;
    e.posted = true;
    await X.say(i, `${X.EM.ok} Đã gửi! Bot sẽ đăng ảnh lên kênh chung trong giây lát.`);
  } catch (err) {
    lastPost.delete(owner);
    console.error('[khoe] lỗi gửi bài:', err.message || err);
    await X.say(i, `${X.EM.no} Chưa gửi được (${X.clip(err.message || err, 150)}). Thử lại sau nhé.`);
  }
}

function init(client, supabase, helpers) {
  sb = supabase; X = helpers;
  client.on('interactionCreate', async (i) => {
    try {
      if (i.isChatInputCommand() && i.commandName === 'khoe') return await cmdKhoe(i, i.options.getSubcommand(), i.options.getString('kieu'));
      if (i.isStringSelectMenu() && i.customId.startsWith('kh:w:')) return await onSelect(i);
      if (i.isButton() && i.customId.startsWith('kh:p:')) return await onPost(i);
    } catch (err) {
      console.error('[khoe] lỗi', err);
      try {
        const m = X.layout(['Có lỗi xảy ra, thử lại sau nhé.'], { attachments: [] });
        if (i.deferred || i.replied) await i.editReply(m); else await i.reply({ ...m, flags: X.V2 | X.EPH });
      } catch (e) { /* bỏ qua */ }
    }
  });
}
// j!khoe [ngay | workshop [ngang]]
function registerPrefix(prefixCommands) {
  prefixCommands.khoe = (ctx) => {
    const a = (ctx.args || []).map(stripVN), sub = ['workshop', 'ws'].includes(a[0]) ? 'workshop' : 'ngay';
    return cmdKhoe(ctx, sub, ['ngang', 'h'].includes(a[1]) ? 'h' : 'v');
  };
}

module.exports = { commands, init, registerPrefix, remember, shareRow };
