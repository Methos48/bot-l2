const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Client: DiscordClient, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch');
const express = require('express');
const pino = require('pino');

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

let waSocket;

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    waSocket = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: false
    });

    waSocket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('==================================================');
            console.log('ABRE ESTE ENLACE EN TU NAVEGADOR PARA VER EL QR:');
            console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
            console.log('==================================================');
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startWhatsApp();
        } else if (connection === 'open') {
            console.log('¡WhatsApp Conectado y Estable sin Puppeteer!');
        }
    });

    waSocket.ev.on('creds.update', saveCreds);
}

const discordClient = new DiscordClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

discordClient.on('ready', () => {
    console.log(`> [Discord] ¡Conectado exitosamente como ${discordClient.user.tag}!`);
});

discordClient.on('messageCreate', async (message) => {
    // 1. IGNORAR mensajes de nuestro propio bot o de cualquier otro bot para evitar bucles
    if (message.author.id === discordClient.user.id || message.author.bot) return;

    if (message.channel.id !== DISCORD_ORIGIN_CHANNEL_ID) return;
    
    const images = Array.from(message.attachments.values()).filter(att => att.contentType?.startsWith('image/'));
    if (images.length === 0) return;

    console.log(`> [Discord] Imagen detectada en el canal de origen. Procesando...`);

    for (const img of images) {
        try {
            const response = await fetch(img.url);
            const buffer = await response.buffer();
            const captionText = message.content || '';

            // Reenviar a canales de Discord destino
            for (const destChannelId of DISCORD_DEST_CHANNELS) {
                try {
                    const destChannel = await discordClient.channels.fetch(destChannelId);
                    if (destChannel) {
                        await destChannel.send({ content: captionText, files: [img.url] });
                    }
                } catch (err) {
                    console.error(`Error enviando al canal Discord ${destChannelId}:`, err);
                }
            }

            // Reenviar a grupos de WhatsApp
            for (const waGroupId of WA_DESTINATION_GROUPS) {
                try {
                    await waSocket.sendMessage(waGroupId, { 
                        image: buffer, 
                        caption: captionText 
                    });
                    console.log(`> [WhatsApp] ¡Imagen enviada con éxito al grupo ${waGroupId}!`);
                } catch (err) {
                    console.error(`Error enviando al grupo WhatsApp ${waGroupId}:`, err);
                }
            }

        } catch (err) { 
            console.error('Error procesando imagen:', err); 
        }
    }
});

startWhatsApp();
discordClient.login(DISCORD_BOT_TOKEN);
