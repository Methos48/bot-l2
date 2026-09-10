const { Client: DiscordClient, GatewayIntentBits } = require('discord.js');
const { Client: WAClient, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fetch = require('node-fetch');
const express = require('express');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_ORIGIN_CHANNEL_ID = process.env.DISCORD_ORIGIN_CHANNEL_ID;
const DISCORD_WEBHOOK_1 = process.env.DISCORD_WEBHOOK_1;
const DISCORD_WEBHOOK_2 = process.env.DISCORD_WEBHOOK_2;
const WA_GROUP_ID_1 = process.env.WA_GROUP_ID_1;
const WA_GROUP_ID_2 = process.env.WA_GROUP_ID_2;

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot Activo'));
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

const waClient = new WAClient({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

waClient.on('qr', (qr) => {
    console.log('==================================================');
    console.log('ABRE ESTE ENLACE EN TU NAVEGADOR PARA VER EL QR:');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
    console.log('==================================================');
});

waClient.on('ready', () => console.log('¡WhatsApp Conectado!'));

const discordClient = new DiscordClient({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

discordClient.on('ready', () => console.log(`Discord listo: ${discordClient.user.tag}`));

discordClient.on('messageCreate', async (message) => {
  if (message.author.bot || message.channel.id !== DISCORD_ORIGIN_CHANNEL_ID) return;

  const attachments = Array.from(message.attachments.values());
  const images = attachments.filter(att => att.contentType && att.contentType.startsWith('image/'));
  if (images.length === 0) return;

  for (const img of images) {
    const imageUrl = img.url;

    const sendWebhook = async (url) => {
      if (!url) return;
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: message.content || undefined, embeds: [{ image: { url: imageUrl } }] })
        });
      } catch (err) { console.error('Error Webhook:', err); }
    };

    await sendWebhook(DISCORD_WEBHOOK_1);
    await sendWebhook(DISCORD_WEBHOOK_2);

    try {
      const media = await MessageMedia.fromUrl(imageUrl);
      const captionText = message.content || '';
      if (WA_GROUP_ID_1) await waClient.sendMessage(WA_GROUP_ID_1, media, { caption: captionText });
      if (WA_GROUP_ID_2) await waClient.sendMessage(WA_GROUP_ID_2, media, { caption: captionText });
    } catch (err) { console.error('Error WhatsApp:', err); }
  }
});

waClient.initialize();
discordClient.login(DISCORD_BOT_TOKEN);
