const { Client, LocalAuth } = require('whatsapp-web.js');
const { Client: DiscordClient, GatewayIntentBits } = require('discord.js');
const qrcode = require('qrcode-terminal');
const fetch = require('node-fetch');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.status(200).send('Bot Activo 🚀'));
app.listen(PORT);

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_ORIGIN_CHANNEL_ID = process.env.DISCORD_ORIGIN_CHANNEL_ID;

const DISCORD_DEST_CHANNELS = [
    process.env.DISCORD_WEBHOOK_1,
    process.env.DISCORD_WEBHOOK_2
].filter(Boolean);

const WA_DESTINATION_GROUPS = [
    process.env.WA_GROUP_ID_1,
    process.env.WA_GROUP_ID_2
].filter(Boolean);

// Inicializar WhatsApp con la configuración clásica de Puppeteer
const waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

waClient.on('qr', (qr) => {
    console.log('Escanea este código QR para WhatsApp:');
    qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => {
    console.log('¡WhatsApp conectado correctamente!');
});

// Inicializar Discord
const discordClient = new DiscordClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

discordClient.on('ready', () => {
    console.log(`> [Discord] ¡Conectado como ${discordClient.user.tag}!`);
});

discordClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== DISCORD_ORIGIN_CHANNEL_ID) return;
    
    const images = Array.from(message.attachments.values()).filter(att => att.contentType?.startsWith('image/'));
    if (images.length === 0) return;

    for (const img of images) {
        try {
            const response = await fetch(img.url);
            const buffer = await response.buffer();
            const captionText = message.content || '';
            const media = new (require('whatsapp-web.js')).MessageMedia(
                response.headers.get('content-type') || 'image/jpeg',
                buffer.toString('base64'),
                'imagen.jpg'
            );

            // Reenviar a Discord
            for (const destChannelId of DISCORD_DEST_CHANNELS) {
                try {
                    const destChannel = await discordClient.channels.fetch(destChannelId);
                    if (destChannel) {
                        await destChannel.send({ content: captionText, files: [img.url] });
                    }
                } catch (err) {
                    console.error(`Error enviando a Discord:`, err);
                }
            }

            // Reenviar a WhatsApp usando los IDs limpios
            for (const rawWaGroupId of WA_DESTINATION_GROUPS) {
                try {
                    const cleanNumbers = rawWaGroupId.replace(/\D/g, '');
                    const waGroupId = `${cleanNumbers}@g.us`;

                    await waClient.sendMessage(waGroupId, media, { caption: captionText });
                    console.log(`> [WhatsApp] Imagen enviada al grupo ${waGroupId}`);
                } catch (err) {
                    console.error(`Error enviando a WhatsApp:`, err);
                }
            }
        } catch (err) { 
            console.error('Error procesando imagen:', err); 
        }
    }
});

waClient.initialize();
discordClient.login(DISCORD_BOT_TOKEN);
