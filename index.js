const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const commands = [
  new SlashCommandBuilder()
    .setName('qr')
    .setDescription('Nhận QR khôi phục tiến trình Justaseed')
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log('Bot online: ' + client.user.tag);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Đã đăng ký lệnh /qr');
  } catch (e) {
    console.error(e);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'qr') return;

  await interaction.deferReply({ ephemeral: true });

  try {
    const { data, error } = await supabase
      .from('qr_requests')
      .select('*')
      .eq('discord_id', interaction.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data || !data.qr_image) {
      return interaction.editReply('Chưa có yêu cầu QR. Hãy vào game, tạo QR rồi bấm "Gửi qua Discord".');
    }

    const embed = new EmbedBuilder()
      .setTitle('QR Khôi phục tiến trình Justaseed')
      .setDescription('Quét mã QR này trong game để khôi phục tiến trình.')
      .setColor(0x4fb06f)
      .setImage('attachment://qr.png')
      .setFooter({ text: 'Justaseed' });

    const base64Data = data.qr_image.includes(',') 
      ? data.qr_image.split(',')[1] 
      : data.qr_image;
    const buffer = Buffer.from(base64Data, 'base64');
    const attachment = new AttachmentBuilder(buffer, { name: 'qr.png' });

    await interaction.editReply({
      embeds: [embed],
      files: [attachment]
    });

  } catch (err) {
    console.error(err);
    await interaction.editReply('Có lỗi khi gửi QR. Thử lại sau.');
  }
});

client.login(TOKEN);

// ===== ĐĂNG TỔNG KẾT / WORKSHOP / VÀNG / DANH THIẾP LÊN DISCORD (LAYOUT) =====
const {
  AttachmentBuilder: SummaryAttachment,
  ContainerBuilder: SummaryContainer,
  TextDisplayBuilder: SummaryText,
  SectionBuilder: SummarySection,
  ThumbnailBuilder: SummaryThumb,
  MediaGalleryBuilder: SummaryGallery,
  MediaGalleryItemBuilder: SummaryGalleryItem,
  SeparatorBuilder: SummarySeparator,
  ActionRowBuilder: SummaryRow,
  ButtonBuilder: SummaryButton,
  ButtonStyle: SummaryButtonStyle,
  MessageFlags: SummaryFlags,
} = require('discord.js');

const SUMMARY_CHANNEL_ID = process.env.CHANNEL_ID;
const GAME_URL = 'https://justaseed.xyz/';
let postingSummaries = false;
let postingShares = false;
let sharesAgain = false; // có bài đến trong lúc đang đăng thì chạy lại ngay

const EM_FLOWERS = '<a:tinyyellowflowers:1569016131426066512>';
const EM_SUNFLOWER = '<:sunflower_art:1569015850617413703>';
const EM_LEAF = '<a:pixelleaf:1569016035875750028>';
const EM_DECO = '<:emoji_143:1569013514968760360>';

// ---------- tiện ích dùng chung ----------
const toBuf = (s) => Buffer.from(String(s).includes(',') ? String(s).split(',')[1] : String(s), 'base64');
const isSnow = (v) => /^\d{5,25}$/.test(String(v || ''));
const clip = (v, n) => String(v ?? '').slice(0, n);
// người có Discord ID -> mention, không có -> in tên thường
const who = (id, name, fallback) => (isSnow(id) ? `<@${id}>` : clip(name || fallback, 40));

// Nút link mở game
const linkRow = () =>
  new SummaryRow().addComponents(
    new SummaryButton()
      .setStyle(SummaryButtonStyle.Link)
      .setLabel('Chơi Justaseed')
      .setEmoji('🌱')
      .setURL(GAME_URL)
  );

// Phần cuối chung: separator + nút link + footer
function addFooter(container, when) {
  container.addSeparatorComponents(new SummarySeparator());
  container.addActionRowComponents(linkRow());
  container.addTextDisplayComponents(
    new SummaryText().setContent(`-# ${EM_SUNFLOWER} Justaseed • <t:${when}:R>`)
  );
}

// Tạo thread dưới bài vừa đăng và ping người gửi vào đó.
// Lỗi ở bước này (thiếu quyền, kênh không hỗ trợ thread...) không làm hỏng bài đã đăng.
async function openThread(msg, title, row, note) {
  try {
    const thread = await msg.startThread({
      name: clip(title, 100) || 'Justaseed',
      autoArchiveDuration: 1440, // tự lưu trữ sau 24 giờ không hoạt động
      reason: 'Justaseed: thread cho bài đăng mới',
    });
    if (isSnow(row.discord_id)) {
      await thread.send({
        content: `<@${row.discord_id}> ${note}`,
        allowedMentions: { parse: [], users: [String(row.discord_id)] },
      });
    }
  } catch (e) {
    console.error('Không tạo được thread:', e.message);
  }
}

// Lấy avatar: ưu tiên ảnh avatar trong game, không có thì dùng avatar Discord
async function resolveAvatar(row, files) {
  if (row.avatar) {
    files.push(new SummaryAttachment(toBuf(row.avatar), { name: 'avatar.png' }));
    return 'attachment://avatar.png';
  }
  let url = 'https://cdn.discordapp.com/embed/avatars/0.png';
  if (isSnow(row.discord_id)) {
    try {
      const user = await client.users.fetch(row.discord_id);
      url = user.displayAvatarURL({ size: 256 });
    } catch (e) { console.error('Không lấy được avatar:', e.message); }
  }
  return url;
}

async function getChannel() {
  if (!SUMMARY_CHANNEL_ID) { console.error('Thiếu CHANNEL_ID'); return null; }
  return client.channels.fetch(SUMMARY_CHANNEL_ID).catch(e => {
    console.error('Không fetch được kênh:', e.message); return null;
  });
}

// ---------- 1. TỔNG KẾT NGÀY ----------
async function postDailySummaries() {
  console.log('[summary] đang kiểm tra...');
  if (postingSummaries) return;
  postingSummaries = true;
  try {
    const channel = await getChannel();
    if (!channel) return;

    const { data, error } = await supabase
      .from('daily_summaries')
      .select('*')
      .eq('posted', false)
      .order('created_at', { ascending: true })
      .limit(3);
    if (error) return console.error('Lỗi đọc Supabase:', error.message);
    if (!data?.length) return;

    for (const row of data) {
      try {
        const files = [new SummaryAttachment(toBuf(row.image), { name: 'summary.png' })];
        const avatarUrl = await resolveAvatar(row, files);

        const owner = isSnow(row.discord_id) ? `<@${row.discord_id}>` : String(row.owner_name || 'Chủ shop');
        const shop = String(row.shop_name || 'Tiệm hoa'); // tên shop do game gửi (s.name)
        const when = Math.floor(new Date(row.created_at || Date.now()).getTime() / 1000);

        const container = new SummaryContainer();

        container.addTextDisplayComponents(
          new SummaryText().setContent(`### ${EM_FLOWERS} Tổng kết ngày thứ ${row.day} ${EM_FLOWERS}`)
        );

        const texts = [
          new SummaryText().setContent(
            `${EM_SUNFLOWER} **Tên cửa hàng:** ${shop}\n${EM_LEAF} **Chủ shop:** ${owner}`.slice(0, 1000)
          ),
        ];
        const caption = String(row.caption || '').trim();
        if (caption) texts.push(new SummaryText().setContent(`${EM_DECO} ${caption.slice(0, 300)}`));

        container.addSectionComponents(
          new SummarySection()
            .addTextDisplayComponents(...texts)
            .setThumbnailAccessory(new SummaryThumb().setURL(avatarUrl))
        );

        // Separator dưới section
        container.addSeparatorComponents(new SummarySeparator());

        container.addMediaGalleryComponents(
          new SummaryGallery().addItems(new SummaryGalleryItem().setURL('attachment://summary.png'))
        );

        addFooter(container, when); // separator + nút link + footer

        const sent = await channel.send({
          components: [container],
          files,
          flags: SummaryFlags.IsComponentsV2,
          allowedMentions: { parse: [] },
        });
        console.log('Đã đăng tổng kết id', row.id);
        await openThread(sent, `Tổng kết ngày ${row.day} - ${shop}`, row, 'tổng kết ngày của bạn đã được đăng, mọi người cùng trò chuyện ở đây nhé!');
      } catch (err) {
        console.error('Lỗi đăng tổng kết id', row.id, err);
      } finally {
        await supabase.from('daily_summaries').update({ posted: true }).eq('id', row.id);
      }
    }
  } finally {
    postingSummaries = false;
  }
}

// ---------- 2. VẬT PHẨM WORKSHOP ----------
async function sendWorkshop(channel, row) {
  const p = row.payload || {};
  const files = [new SummaryAttachment(toBuf(row.image), { name: 'workshop.png' })];
  const avatarUrl = await resolveAvatar(row, files);
  const when = Math.floor(new Date(row.created_at || Date.now()).getTime() / 1000);

  const q = Math.max(0, Math.min(100, Number(p.quality) || 0));
  const starN = Math.max(1, Math.min(5, Math.round(q / 20)));
  const stars = '★'.repeat(starN) + '☆'.repeat(5 - starN);
  const value = Number(p.value) > 0 ? `${Number(p.value).toLocaleString('vi-VN')}đ` : null;

  // loại workshop (Cắm hoa, Nến thơm, Áo phông...) do game gửi
  const wsType = clip(p.workshop_type || p.type || 'Workshop', 30);
  const wsEmoji = clip(p.emoji, 8);

  const poster = isSnow(row.discord_id) ? `<@${row.discord_id}>` : 'Chủ shop';
  const maker = who(p.maker_id, p.maker_name, 'Không rõ');

  const lines = [
    `${EM_SUNFLOWER} **Vật phẩm:** ${clip(p.name, 60)}`,
    `${EM_LEAF} **Loại:** ${wsEmoji} ${wsType}`,
    `${EM_SUNFLOWER} **Chất lượng:** ${q}/100 ${stars}`,
  ];
  if (p.materials) lines.push(`${EM_LEAF} **Nguyên liệu:** ${clip(p.materials, 300)}`);
  if (p.scent) lines.push(`${EM_SUNFLOWER} **Hương:** ${clip(p.scent, 80)}`);
  if (value) lines.push(`${EM_LEAF} **Giá trị:** ${value}`);
  lines.push(`${EM_SUNFLOWER} **Người làm:** ${maker}`);
  if (p.gifter_name || p.gifter_id) {
    lines.push(`${EM_LEAF} **Người tặng:** ${who(p.gifter_id, p.gifter_name, 'Bạn bè')}`);
    if (p.gift_msg) lines.push(`${EM_DECO} *“${clip(p.gift_msg, 80)}”*`);
  }
  lines.push(`${EM_SUNFLOWER} **Khoe bởi:** ${poster} · ${clip(p.shop_name || 'Tiệm hoa', 60)}`);

  const texts = [new SummaryText().setContent(lines.join('\n').slice(0, 1800))];
  const caption = String(p.caption || '').trim();
  if (caption) texts.push(new SummaryText().setContent(`${EM_DECO} ${caption.slice(0, 300)}`));

  const container = new SummaryContainer();
  // tiêu đề hiện đúng loại workshop thay vì tên món
  container.addTextDisplayComponents(
    new SummaryText().setContent(`### ${EM_FLOWERS} Workshop: ${wsEmoji} ${wsType} ${EM_FLOWERS}`)
  );
  container.addSectionComponents(
    new SummarySection()
      .addTextDisplayComponents(...texts)
      .setThumbnailAccessory(new SummaryThumb().setURL(avatarUrl))
  );
  container.addSeparatorComponents(new SummarySeparator());
  container.addMediaGalleryComponents(
    new SummaryGallery().addItems(new SummaryGalleryItem().setURL('attachment://workshop.png'))
  );
  addFooter(container, when);

  // Ping thật người làm và người tặng (bỏ trùng). Chỉ ping được khi payload có Discord ID.
  const pingIds = [...new Set([p.maker_id, p.gifter_id].filter(isSnow).map(String))];
  console.log('[workshop] maker_id =', p.maker_id, '| gifter_id =', p.gifter_id, '| ping =', pingIds);

  const sent = await channel.send({
    components: [container],
    files,
    flags: SummaryFlags.IsComponentsV2,
    allowedMentions: { parse: [], users: pingIds },
  });
  // tên thread có loại workshop
  await openThread(sent, `Workshop ${wsType}: ${clip(p.name, 60)}`, row, 'vật phẩm workshop của bạn đã được đăng, mọi người cùng trò chuyện ở đây nhé!');
}

// ---------- 2b. MÓN VÀNG (TIỆM VÀNG) ----------
async function sendGold(channel, row) {
  const p = row.payload || {};
  const files = [new SummaryAttachment(toBuf(row.image), { name: 'gold.png' })];
  const avatarUrl = await resolveAvatar(row, files);
  const when = Math.floor(new Date(row.created_at || Date.now()).getTime() / 1000);

  const goldType = clip(p.type || 'Trang sức', 30);
  const goldEmoji = clip(p.emoji || '💍', 8);
  const value = Number(p.value) > 0 ? `${Number(p.value).toLocaleString('vi-VN')}đ` : null;
  const poster = isSnow(row.discord_id) ? `<@${row.discord_id}>` : 'Chủ shop';

  const lines = [
    `${EM_SUNFLOWER} **Món vàng:** ${clip(p.name, 60)}`,
    `${EM_LEAF} **Loại:** ${goldEmoji} ${goldType}${p.custom ? ' · Đặt riêng' : ''}`,
    `${EM_SUNFLOWER} **Trọng lượng:** ${clip(p.weight, 30)}`,
    `${EM_LEAF} **Tuổi vàng:** ${clip(p.karat, 30)}`,
  ];
  if (p.gem) lines.push(`${EM_SUNFLOWER} **Đá:** ${clip(p.gem, 40)}`);
  if (p.tone) lines.push(`${EM_LEAF} **Màu vàng:** ${clip(p.tone, 30)}`);
  if (value) lines.push(`${EM_SUNFLOWER} **Giá trị lúc khoe:** ${value}`);
  lines.push(`${EM_LEAF} **Khoe bởi:** ${poster} · ${clip(p.shop_name || 'Tiệm hoa', 60)}`);

  const texts = [new SummaryText().setContent(lines.join('\n').slice(0, 1800))];
  const caption = String(p.caption || '').trim();
  if (caption) texts.push(new SummaryText().setContent(`${EM_DECO} ${caption.slice(0, 300)}`));

  const container = new SummaryContainer();
  container.addTextDisplayComponents(
    new SummaryText().setContent(`### ${EM_FLOWERS} Tiệm vàng: ${goldEmoji} ${goldType} ${EM_FLOWERS}`)
  );
  container.addSectionComponents(
    new SummarySection()
      .addTextDisplayComponents(...texts)
      .setThumbnailAccessory(new SummaryThumb().setURL(avatarUrl))
  );
  container.addSeparatorComponents(new SummarySeparator());
  container.addMediaGalleryComponents(
    new SummaryGallery().addItems(new SummaryGalleryItem().setURL('attachment://gold.png'))
  );
  addFooter(container, when);

  const sent = await channel.send({
    components: [container],
    files,
    flags: SummaryFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
  await openThread(sent, `Tiệm vàng: ${clip(p.name, 70)}`, row, 'món vàng của bạn đã được đăng, mọi người cùng trò chuyện ở đây nhé!');
}

// ---------- 3. DANH THIẾP ----------
async function sendCard(channel, row) {
  const files = [new SummaryAttachment(toBuf(row.image), { name: 'card.png' })];
  const when = Math.floor(new Date(row.created_at || Date.now()).getTime() / 1000);
  const player = isSnow(row.discord_id) ? `<@${row.discord_id}>` : 'Một người chơi';

  const container = new SummaryContainer();
  container.addTextDisplayComponents(
    new SummaryText().setContent(`### ${EM_FLOWERS} ${player} đã gửi lên một danh thiếp ${EM_FLOWERS}`)
  );
  container.addSeparatorComponents(new SummarySeparator());
  container.addMediaGalleryComponents(
    new SummaryGallery().addItems(new SummaryGalleryItem().setURL('attachment://card.png'))
  );
  addFooter(container, when);

  const sent = await channel.send({
    components: [container],
    files,
    flags: SummaryFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
  await openThread(sent, 'Danh thiếp của người chơi', row, 'danh thiếp của bạn đã được đăng, mọi người cùng trò chuyện ở đây nhé!');
}

async function postShares() {
  // đang đăng thì đánh dấu để chạy lại ngay sau đó, không bỏ sót bài mới
  if (postingShares) { sharesAgain = true; return; }
  postingShares = true;
  try {
    const channel = await getChannel();
    if (!channel) return;

    const { data, error } = await supabase
      .from('discord_shares')
      .select('*')
      .eq('posted', false)
      .order('created_at', { ascending: true })
      .limit(3);
    if (error) return console.error('Lỗi đọc discord_shares:', error.message);
    if (!data?.length) return;

    for (const row of data) {
      try {
        if (row.kind === 'workshop') await sendWorkshop(channel, row);
        else if (row.kind === 'gold') await sendGold(channel, row);
        else if (row.kind === 'card') await sendCard(channel, row);
        else console.error('Loại share lạ:', row.kind);
        console.log('Đã đăng', row.kind, 'id', row.id);
      } catch (err) {
        console.error('Lỗi đăng', row.kind, 'id', row.id, err);
      } finally {
        await supabase.from('discord_shares').update({ posted: true }).eq('id', row.id);
      }
    }
  } finally {
    postingShares = false;
    if (sharesAgain) { sharesAgain = false; postShares(); }
  }
}

console.log('[summary] CHANNEL_ID =', SUMMARY_CHANNEL_ID);

// nhận bài ngay khi game gửi (cần chạy SQL: alter publication supabase_realtime add table public.discord_shares;)
supabase
  .channel('discord_shares_rt')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'discord_shares' },
    () => { if (client.isReady()) postShares(); })
  .subscribe((st) => console.log('[shares] realtime:', st));

// dự phòng 5 giây cho workshop/vàng/danh thiếp, tổng kết ngày vẫn 30 giây
setInterval(() => {
  if (!client.isReady()) return;
  postShares();
}, 5000);

setInterval(() => {
  if (!client.isReady()) return console.log('[summary] bot chưa ready');
  postDailySummaries();
}, 30000);
// ===== HẾT =====

// ===== ĐỒNG BỘ THÀNH VIÊN SERVER -> bảng server_members =====
// Cần: Server Members Intent bật trong Developer Portal, SUPABASE_KEY là service role key, biến GUILD_ID (ID server).
const GUILD_ID = process.env.GUILD_ID; // ID server của bot (bỏ trống thì dùng server đầu tiên)

async function syncMembers() {
  try {
    const guild = GUILD_ID ? await client.guilds.fetch(GUILD_ID) : client.guilds.cache.first();
    if (!guild) return console.error('[members] không tìm thấy server');
    const members = await guild.members.fetch();
    const ids = [...members.filter(m => !m.user.bot).keys()];

    for (let i = 0; i < ids.length; i += 500) {
      const rows = ids.slice(i, i + 500).map(id => ({ discord_id: id }));
      const { error } = await supabase.from('server_members')
        .upsert(rows, { onConflict: 'discord_id', ignoreDuplicates: true });
      if (error) return console.error('[members] lỗi upsert:', error.message);
    }

    // xóa người đã rời server
    const inGuild = new Set(ids), gone = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('server_members').select('discord_id').range(from, from + 999);
      if (error || !data?.length) break;
      data.forEach(r => { if (!inGuild.has(r.discord_id)) gone.push(r.discord_id); });
      if (data.length < 1000) break;
    }
    for (let i = 0; i < gone.length; i += 200) {
      await supabase.from('server_members').delete().in('discord_id', gone.slice(i, i + 200));
    }
    console.log(`[members] đã đồng bộ ${ids.length} thành viên, xóa ${gone.length}`);
  } catch (e) {
    console.error('[members] lỗi đồng bộ:', e.message);
  }
}

const inOurGuild = (m) => !GUILD_ID || m.guild.id === GUILD_ID;

client.on('guildMemberAdd', async (m) => {
  if (!inOurGuild(m) || m.user.bot) return;
  const { error } = await supabase.from('server_members')
    .upsert({ discord_id: m.id }, { onConflict: 'discord_id', ignoreDuplicates: true });
  if (error) console.error('[members] lỗi thêm:', error.message);
});

client.on('guildMemberRemove', async (m) => {
  if (!inOurGuild(m)) return;
  const { error } = await supabase.from('server_members').delete().eq('discord_id', m.id);
  if (error) console.error('[members] lỗi xóa:', error.message);
});

client.once('ready', () => {
  syncMembers();
  setInterval(syncMembers, 6 * 60 * 60 * 1000); // đồng bộ lại mỗi 6 giờ cho chắc
});
// ===== HẾT =====

// ===== MUA ROLE TRONG GAME -> GẮN ROLE DISCORD =====
// Cần quyền Manage Roles, và role của bot phải nằm CAO HƠN các role được bán.
let grantingRoles = false, grantAgain = false;
async function grantRoles() {
  if (grantingRoles) { grantAgain = true; return; }
  grantingRoles = true;
  try {
    const guild = GUILD_ID ? await client.guilds.fetch(GUILD_ID) : client.guilds.cache.first();
    if (!guild) return console.error('[roles] không tìm thấy server');
    const { data, error } = await supabase.from('role_purchases').select('*')
      .eq('status', 'pending').order('created_at', { ascending: true }).limit(10);
    if (error) return console.error('[roles] lỗi đọc đơn:', error.message);
    for (const row of data || []) {
      let status = 'done', err = null;
      try {
        const { data: item } = await supabase.from('shop_roles').select('role_id,price,active').eq('role_id', row.role_id).maybeSingle();
        if (!item || !item.active) throw new Error('Role không còn bán');
        if (Number(item.price) !== Number(row.price)) throw new Error('Giá đã thay đổi');
        const member = await guild.members.fetch(row.discord_id).catch(() => null);
        if (!member) throw new Error('Chưa tham gia server');
        await member.roles.add(String(row.role_id), 'Justaseed: mua role trong game');
        console.log('[roles] đã gắn', row.role_id, 'cho', row.discord_id);
      } catch (e) {
        status = 'failed'; err = clip(e.message, 200);
        console.error('[roles] lỗi đơn', row.id, e.message);
      }
      await supabase.from('role_purchases').update({ status, error: err }).eq('id', row.id);
    }
  } finally {
    grantingRoles = false;
    if (grantAgain) { grantAgain = false; grantRoles(); }
  }
}
supabase.channel('role_purchases_rt')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'role_purchases' },
    () => { if (client.isReady()) grantRoles(); })
  .subscribe((st) => console.log('[roles] realtime:', st));
setInterval(() => { if (client.isReady()) grantRoles(); }, 10000);
// ===== HẾT =====

// ===== ĐỒNG BỘ DANH SÁCH ROLE SERVER -> bảng guild_roles (để tab Quản trị chọn role) =====
async function syncRoles() {
  try {
    const guild = GUILD_ID ? await client.guilds.fetch(GUILD_ID) : client.guilds.cache.first();
    if (!guild) return console.error('[guild_roles] không tìm thấy server');
    const roles = await guild.roles.fetch();
    const me = await guild.members.fetchMe();
    const top = me.roles.highest.position;
    const rows = [...roles.values()].filter(r => r.id !== guild.id).map(r => ({
      role_id: r.id,
      name: clip(r.name, 100),
      color: r.color ? '#' + r.color.toString(16).padStart(6, '0') : null,
      position: r.position,
      assignable: !r.managed && r.position < top,
      updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('guild_roles').upsert(rows.slice(i, i + 200), { onConflict: 'role_id' });
      if (error) return console.error('[guild_roles] lỗi upsert:', error.message);
    }
    const keep = new Set(rows.map(r => r.role_id)), gone = [];
    const { data } = await supabase.from('guild_roles').select('role_id');
    (data || []).forEach(r => { if (!keep.has(r.role_id)) gone.push(r.role_id); });
    if (gone.length) await supabase.from('guild_roles').delete().in('role_id', gone);
    console.log(`[guild_roles] đã đồng bộ ${rows.length} role, xóa ${gone.length}`);
  } catch (e) {
    console.error('[guild_roles] lỗi đồng bộ:', e.message);
  }
}
let syncRolesTimer = null;
const syncRolesSoon = (g) => {
  if (GUILD_ID && g && g.id !== GUILD_ID) return;
  clearTimeout(syncRolesTimer);
  syncRolesTimer = setTimeout(syncRoles, 2000); // gộp nhiều thay đổi liên tiếp
};
client.on('roleCreate', (r) => syncRolesSoon(r.guild));
client.on('roleUpdate', (_o, r) => syncRolesSoon(r.guild));
client.on('roleDelete', (r) => syncRolesSoon(r.guild));
client.once('ready', () => {
  syncRoles();
  setInterval(syncRoles, 10 * 60 * 1000); // đồng bộ lại mỗi 10 phút cho chắc
});
// ===== HẾT =====
