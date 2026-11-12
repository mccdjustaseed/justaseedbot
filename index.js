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

// ===== ĐĂNG ẢNH TỔNG KẾT LÊN DISCORD (LAYOUT) =====
const {
  AttachmentBuilder: SummaryAttachment,
  ContainerBuilder: SummaryContainer,
  TextDisplayBuilder: SummaryText,
  SectionBuilder: SummarySection,
  ThumbnailBuilder: SummaryThumb,
  MediaGalleryBuilder: SummaryGallery,
  MediaGalleryItemBuilder: SummaryGalleryItem,
  SeparatorBuilder: SummarySeparator,
  MessageFlags: SummaryFlags,
} = require('discord.js');

const SUMMARY_CHANNEL_ID = process.env.CHANNEL_ID;
let postingSummaries = false;

const EM_FLOWERS = '<a:tinyyellowflowers:1569016131426066512>';
const EM_SUNFLOWER = '<:sunflower_art:1569015850617413703>';
const EM_LEAF = '<a:pixelleaf:1569016035875750028>';
const EM_DECO = '<:emoji_143:1569013514968760360>';

async function postDailySummaries() {
  console.log('[summary] đang kiểm tra...');
  if (postingSummaries) return;
  postingSummaries = true;
  try {
    if (!SUMMARY_CHANNEL_ID) return console.error('Thiếu CHANNEL_ID');
    const channel = await client.channels.fetch(SUMMARY_CHANNEL_ID).catch(e => {
      console.error('Không fetch được kênh:', e.message); return null;
    });
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
        const base64 = row.image.includes(',') ? row.image.split(',')[1] : row.image;
        const buffer = Buffer.from(base64, 'base64');
        const attachment = new SummaryAttachment(buffer, { name: 'summary.png' });

        const hasId = row.discord_id && /^\d+$/.test(row.discord_id);
        const owner = hasId ? `<@${row.discord_id}>` : String(row.owner_name || 'Chủ shop');
        const shop = String(row.shop_name || 'Tiệm hoa');
        const when = Math.floor(new Date(row.created_at || Date.now()).getTime() / 1000);

        // Avatar Discord của người chơi (GIF nếu là avatar động)
        let avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
        if (hasId) {
          try {
            const user = await client.users.fetch(row.discord_id);
            avatarUrl = user.displayAvatarURL({ size: 256 });
          } catch (e) {
            console.error('Không lấy được avatar:', e.message);
          }
        }

        // Các dòng chữ trong section (tối đa 3)
        const texts = [
          new SummaryText().setContent(
            `## ${EM_FLOWERS} Tổng kết ngày thứ ${row.day} ${EM_FLOWERS}`
          ),
          new SummaryText().setContent(
            `${EM_SUNFLOWER} **Tên cửa hàng:** ${shop}\n${EM_LEAF} **Chủ shop:** ${owner}`.slice(0, 1000)
          ),
        ];
        const caption = String(row.caption || '').trim();
        if (caption) {
          texts.push(
            new SummaryText().setContent(`${EM_DECO} ${caption.slice(0, 300)}`)
          );
        }

        const section = new SummarySection()
          .addTextDisplayComponents(...texts)
          .setThumbnailAccessory(new SummaryThumb().setURL(avatarUrl));

        const container = new SummaryContainer();
        container.addSectionComponents(section);

        container.addMediaGalleryComponents(
          new SummaryGallery().addItems(
            new SummaryGalleryItem().setURL('attachment://summary.png')
          )
        );

        container.addSeparatorComponents(new SummarySeparator());
        container.addTextDisplayComponents(
          new SummaryText().setContent(`-# ${EM_SUNFLOWER} Justaseed • <t:${when}:R>`)
        );

        await channel.send({
          components: [container],
          files: [attachment],
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

console.log('[summary] CHANNEL_ID =', SUMMARY_CHANNEL_ID);

setInterval(() => {
  if (!client.isReady()) return console.log('[summary] bot chưa ready');
  postDailySummaries();
}, 30000);
// ===== HẾT =====
