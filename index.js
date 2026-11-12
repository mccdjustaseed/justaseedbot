const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
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

// ===== ĐĂNG TỔNG KẾT / WORKSHOP / DANH THIẾP LÊN DISCORD (LAYOUT) =====
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

        await channel.send({
          components: [container],
          files,
          flags: SummaryFlags.IsComponentsV2,
          allowedMentions: { parse: [] },
        });
        console.log('Đã đăng tổng kết id', row.id);
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

  const poster = isSnow(row.discord_id) ? `<@${row.discord_id}>` : 'Chủ shop';
  const maker = who(p.maker_id, p.maker_name, 'Không rõ');

  const lines = [
    `${EM_SUNFLOWER} **Vật phẩm:** ${clip(p.name, 60)}`,
    `${EM_LEAF} **Loại:** ${clip(p.emoji, 8)} ${clip(p.type, 30)}`,
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
  container.addTextDisplayComponents(
    new SummaryText().setContent(`### ${EM_FLOWERS} Workshop: ${clip(p.name, 60)} ${EM_FLOWERS}`)
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

  await channel.send({
    components: [container],
    files,
    flags: SummaryFlags.IsComponentsV2,
    allowedMentions: { parse: [], users: pingIds },
  });
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

  await channel.send({
    components: [container],
    files,
    flags: SummaryFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

async function postShares() {
  if (postingShares) return;
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
  }
}

console.log('[summary] CHANNEL_ID =', SUMMARY_CHANNEL_ID);

setInterval(() => {
  if (!client.isReady()) return console.log('[summary] bot chưa ready');
  postDailySummaries();
  postShares();
}, 30000);
// ===== HẾT =====
