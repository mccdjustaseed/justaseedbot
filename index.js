const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = 'DÁN_BOT_TOKEN_CỦA_BẠN';
const CLIENT_ID = 'DÁN_CLIENT_ID_CỦA_BẠN';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName('qr')
    .setDescription('Nhận QR khôi phục tiến trình')
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
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'qr') {
    try {
      await interaction.user.send('Xin chào! Đây là tin nhắn riêng từ bot Justaseed.');
      await interaction.reply({ content: 'Đã gửi tin nhắn riêng cho bạn!', ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: 'Không gửi được DM. Hãy mở quyền nhận tin nhắn từ thành viên server.', ephemeral: true });
    }
  }
});

client.login(TOKEN);
