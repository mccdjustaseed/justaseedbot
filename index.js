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

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
// (nếu dùng import: import { EmbedBuilder, AttachmentBuilder } from 'discord.js')

const CHANNEL_ID = process.env.CHANNEL_ID;
let postingSummaries = false;

async function postDailySummaries() {
  if (postingSummaries) return;
  postingSummaries = true;
  try {
    if (!CHANNEL_ID) return console.error('Thiếu CHANNEL_ID');
    const channel = await client.channels.fetch(CHANNEL_ID).catch(e => {
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
        const attachment = new AttachmentBuilder(buffer, { name: 'summary.png' });

        const embed = new EmbedBuilder()
          .setTitle(`Tổng kết ngày thứ ${row.day}`)
          .setColor(0x4fb06f)
          .addFields(
            { name: 'Tên cửa hàng', value: String(row.shop_name || 'Tiệm hoa').slice(0, 1024), inline: true },
            { name: 'Chủ shop', value: String(row.owner_name || 'Chủ shop').slice(0, 1024), inline: true }
          )
          .setImage('attachment://summary.png')
          .setFooter({ text: 'Justaseed' })
          .setTimestamp();
        if (row.caption) embed.setDescription(row.caption);

        await channel.send({ embeds: [embed], files: [attachment] });
        console.log('Đã đăng tổng kết id', row.id);
      } catch (err) {
        console.error('Lỗi đăng tổng kết id', row.id, err);
      } finally {
        // đánh dấu luôn để dòng lỗi không chặn hàng đợi
        await supabase.from('daily_summaries').update({ posted: true }).eq('id', row.id);
      }
    }
  } finally {
    postingSummaries = false;
  }
}

// Đặt trong sự kiện ready (discord.js v14: 'ready', v15: 'clientReady')
client.once('ready', () => {
  postDailySummaries();
  setInterval(postDailySummaries, 30000);
});
