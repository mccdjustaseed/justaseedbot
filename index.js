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
const CHANNEL_ID = process.env.CHANNEL_ID; // ID kênh muốn đăng

// Hàm đăng tổng kết
async function postDailySummaries() {
  if (!CHANNEL_ID) return;
  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const { data } = await supabase
    .from('daily_summaries')
    .select('*')
    .eq('posted', false)
    .order('created_at', { ascending: true })
    .limit(5);

  if (!data || !data.length) return;

  for (const row of data) {
    try {
      const embed = new EmbedBuilder()
        .setTitle(`Tổng kết ngày thứ ${row.day}`)
        .setColor(0x4fb06f) // màu xanh lá chủ đạo của game
        .addFields(
          { name: 'Tên cửa hàng', value: row.shop_name || 'Tiệm hoa', inline: true },
          { name: 'Chủ shop', value: row.owner_name || 'Chủ shop', inline: true }
        )
        .setImage('attachment://summary.png')
        .setFooter({ text: 'Justaseed' })
        .setTimestamp();

      if (row.caption) embed.setDescription(row.caption);

      const base64 = row.image.includes(',') ? row.image.split(',')[1] : row.image;
      const buffer = Buffer.from(base64, 'base64');
      const attachment = new AttachmentBuilder(buffer, { name: 'summary.png' });

      await channel.send({ embeds: [embed], files: [attachment] });

      await supabase.from('daily_summaries').update({ posted: true }).eq('id', row.id);
    } catch (err) {
      console.error('Lỗi đăng tổng kết:', err);
    }
  }
}

// Gọi mỗi 30 giây
setInterval(postDailySummaries, 30000);
