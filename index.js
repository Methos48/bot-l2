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

    // Depuración optimizada: ignora eventos internos y muestra chats limpios
    waSocket.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const m = chatUpdate.messages[0];
            if (!m || !m.message) return;
            
            const remoteJid = m.key.remoteJid;
            if (!remoteJid || remoteJid.endsWith('@broadcast') || remoteJid === 'status@broadcast') return;
            
            const sender = m.key.participant || remoteJid;
            
            console.log(`> [WhatsApp] Mensaje en: ${remoteJid} (De: ${sender})`);
            
            if (remoteJid.endsWith('@g.us')) {
                console.log(`¡ID DE GRUPO VÁLIDO!: ${remoteJid}`);
            }
        } catch (e) {
            console.error("Error leyendo mensaje:", e);
        }
    });
}

const discordClient = new DiscordClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

discordClient.on('ready', () => console.log(`Discord listo: ${discordClient.user.tag}`));

discordClient.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.id !== DISCORD_ORIGIN_CHANNEL_ID) return;
    
    console.log(`> [Discord] Mensaje detectado en el canal de origen de L2.`);
    
    const images = Array.from(message.attachments.values()).filter(att => att.contentType?.startsWith('image/'));
    if (images.length === 0 || !WA_GROUP_ID_1) {
        console.log(`> [Discord] No se encontraron imágenes o falta configurar WA_GROUP_ID_1.`);
        return;
    }

    for (const img of images) {
        try {
            console.log(`> [Discord] Descargando imagen y enviando a WhatsApp...`);
            const response = await fetch(img.url);
            const buffer = await response.buffer();
            await waSocket.sendMessage(WA_GROUP_ID_1, { 
                image: buffer, 
                caption: message.content || '' 
            });
            console.log(`> [WhatsApp] ¡Imagen enviada con éxito al grupo!`);
        } catch (err) { 
            console.error('Error enviando imagen a WhatsApp:', err); 
        }
    }
});

startWhatsApp();
discordClient.login(DISCORD_BOT_TOKEN);
