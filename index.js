Entendido. He ajustado el comportamiento para que:Canal 1 (CHANNEL_1) $\rightarrow$ Sigue borrando los mensajes originales después de reenviarlos.Canal 2 (CHANNEL_2) $\rightarrow$ No borra los mensajes originales del canal; los reenvía a su destino (WA_GROUP_ID_3) y el mensaje en Discord se queda intacto.Aquí tienes el código completo con este cambio aplicado:JavaScriptconst { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
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

// Canales de origen separados
const CHANNEL_1 = process.env.DISCORD_ORIGIN_CHANNEL_ID;
const CHANNEL_2 = process.env.DISCORD_ORIGIN_CHANNEL_ID_2;

// Destinos para el Canal 1 (Los de siempre)
const WEBHOOKS_1 = [
    process.env.DISCORD_WEBHOOK_1,
    process.env.DISCORD_WEBHOOK_2
].filter(Boolean);

const WA_GROUPS_1 = [
    process.env.WA_GROUP_ID_1,
    process.env.WA_GROUP_ID_2
].filter(Boolean);

// Destinos para el Canal 2 (Únicamente WhatsApp con WA_GROUP_ID_3)
const WEBHOOKS_2 = [].filter(Boolean);

const WA_GROUPS_2 = [
    process.env.WA_GROUP_ID_3
].filter(Boolean);

const ALLOWED_BOT_ID = '1548524655076184104';

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
