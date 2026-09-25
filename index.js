El código actual ya incluye la lógica para permitir que lea mensajes del bot autorizado (ALLOWED_BOT_ID), así como para procesar texto, emojis (tanto normales como de Discord) e imágenes (ya sea mediante archivos adjuntos, embeds o capturas).

Aquí tienes el archivo completo con todo listo. Solo asegúrate de tener bien configurada la variable ALLOWED_BOT_ID con el ID del bot que envía los mensajes para que no sea bloqueado:

JavaScript
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Client: DiscordClient, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch');
const FormData = require('form-data');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.status(200).send('Bot Activo 🚀'));
app.listen(PORT);

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_SCHEDULED_CHANNEL_ID = process.env.DISCORD_SCHEDULED_CHANNEL_ID;

// Canales de origen de Discord que el bot escuchará
const DISCORD_ORIGIN_CHANNELS = [
    process.env.DISCORD_ORIGIN_CHANNEL_ID,
    process.env.DISCORD_ORIGIN_CHANNEL_ID_2
].filter(Boolean);

// Webhooks de Discord donde se reenviarán los mensajes
const DISCORD_WEBHOOK_URLS = [
    process.env.DISCORD_WEBHOOK_1,
    process.env.DISCORD_WEBHOOK_2,
    process.env.DISCORD_WEBHOOK_3
].filter(Boolean);

// Grupos de WhatsApp de destino
const WA_DESTINATION_GROUPS = [
    process.env.WA_GROUP_ID_1,
    process.env.WA_GROUP_ID_2,
    process.env.WA_GROUP_ID_3
].filter(Boolean);

const ALLOWED_BOT_ID = '1548524655076184104'; // ID del bot permitido para enviar mensajes

// --- INICIALIZACIÓN DE DISCORD ---
console.log('> [Sistema] Configurando cliente de Discord...');
const discordClient = new DiscordClient({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

discordClient.on('warn', info => console.log(`[DISCORD WARN] ${info}`));
discordClient.on('error', error => console.error(`[DISCORD ERROR]`, error));
discordClient.on('ready', () => console.log(`> [Discord] ¡Conectado exitosamente como ${discordClient.user.tag}!`));

if (!DISCORD_BOT_TOKEN) {
    console.error('> [Error CRÍTICO] La variable DISCORD_BOT_TOKEN no está definida.');
} else {
    discordClient.login(DISCORD_BOT_TOKEN)
        .then(() => console.log('> [Discord] Login solicitado con éxito.'))
        .catch(err => console.error('> [Discord] Fallo al iniciar sesión:', err));
}
// ---------------------------------

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

    // --- CAPTURADOR TEMPORAL DE ID DE GRUPO DE WHATSAPP ---
    waSocket.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        const remoteJid = m.key.remoteJid;
        if (remoteJid && remoteJid.endsWith('@g.us')) {
            console.log(`> [WhatsApp ID Encontrado] El ID de este grupo es: ${remoteJid}`);
        }
    });
    // ------------------------------------------------     
}

async function dispatchMessage(buffer, filename, rawCaption) {
    for (const webhookUrl of DISCORD_WEBHOOK_URLS) {
        try {
            const form = new FormData();
            form.append('file0', buffer, { filename: filename });
            if (rawCaption) {
                form.append('content', rawCaption);
            }
            await fetch(webhookUrl, { method: 'POST', body: form });
        } catch (err) {
            console.error(`Error enviando imagen al webhook de Discord:`, err);
        }
    }

    for (const waGroupId of WA_DESTINATION_GROUPS) {
        try {
            const waPayload = { image: buffer };
            if (rawCaption) {
                waPayload.caption = rawCaption;
            }
            await waSocket.sendMessage(waGroupId, waPayload);
            console.log(`> [WhatsApp] ¡Imagen enviada con éxito al grupo ${waGroupId}!`);
        } catch (err) {
            console.error(`Error e
