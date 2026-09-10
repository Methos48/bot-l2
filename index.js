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
const WA_GROUP_ID_1 = process.env.WA_GROUP_ID_1;

let waSocket;

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    waSocket = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }), // Oculta logs excesivos para mantener limpio
        printQRInTerminal: false
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

    // Detector de ID de grupos al recibir mensajes
    waSocket.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        const remoteJid = m.key.remoteJid;
        if (remoteJid && remoteJid.endsWith('@g.us')) {
            console.log(`[GRUPO DETECTADO] ID del Grupo: ${remoteJid}`);
        }
    });
}

const discordClient = new DiscordClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

discordClient.on('ready', () => console.log(`Discord listo: ${discordClient.user.tag}`));

discordClient.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.id !== DISCORD_ORIGIN_CHANNEL_ID) return;
    const images = Array.from(message.attachments.values()).filter(att => att.contentType?.startsWith('image/'));
    if (images.length === 0 || !WA_GROUP_ID_1) return;

    for (const img of images) {
        try {
            const response = await fetch(img.url);
            const buffer = await response.buffer();
            await waSocket.sendMessage(WA_GROUP_ID_1, { 
                image: buffer, 
                caption: message.content || '' 
            });
        } catch (err) { console.error('Error enviando a WhatsApp:', err); }
    }
});

startWhatsApp();
discordClient.login(DISCORD_BOT_TOKEN);
