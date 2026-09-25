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
const WEBHOOKS_2 = [].filter(Boolean); // Sin webhooks para el canal 2

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

    waSocket.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        const remoteJid = m.key.remoteJid;
        if (remoteJid && remoteJid.endsWith('@g.us')) {
            console.log(`> [WhatsApp ID Encontrado] El ID de este grupo es: ${remoteJid}`);
        }
    });
}

async function dispatchToTargets(buffer, filename, rawCaption, webhooks, waGroups) {
    for (const webhookUrl of webhooks) {
        try {
            const form = new FormData();
            if (buffer) {
                form.append('file0', buffer, { filename: filename });
            }
            if (rawCaption) {
                form.append('content', rawCaption);
            }
            await fetch(webhookUrl, { method: 'POST', body: form });
        } catch (err) {
            console.error(`Error enviando al webhook de Discord:`, err);
        }
    }

    for (const waGroupId of waGroups) {
        try {
            if (buffer) {
                const waPayload = { image: buffer };
                if (rawCaption) waPayload.caption = rawCaption;
                await waSocket.sendMessage(waGroupId, waPayload);
            } else if (rawCaption) {
                await waSocket.sendMessage(waGroupId, { text: rawCaption });
            }
            console.log(`> [WhatsApp] ¡Mensaje enviado con éxito al grupo ${waGroupId}!`);
        } catch (err) {
            console.error(`Error enviando al grupo WhatsApp ${waGroupId}:`, err);
        }
    }
}

discordClient.on('messageCreate', async (message) => {
    console.log(`[DEBUG EXTREMO] ¡Mensaje capturado! Canal: ${message.channel.id} | Autor: ${message.author.tag}`);

    if (message.author.id === discordClient.user.id) return;
    if (message.author.bot && message.author.id !== ALLOWED_BOT_ID) return;

    const isChannel1 = CHANNEL_1 && message.channel.id === CHANNEL_1;
    const isChannel2 = CHANNEL_2 && message.channel.id === CHANNEL_2;
    const isScheduled = DISCORD_SCHEDULED_CHANNEL_ID && message.channel.id === DISCORD_SCHEDULED_CHANNEL_ID;

    if (!isChannel1 && !isChannel2 && !isScheduled) return;
    
    let targetWebhooks = WEBHOOKS_1;
    let targetWaGroups = WA_GROUPS_1;

    if (isChannel2) {
        targetWebhooks = WEBHOOKS_2;
        targetWaGroups = WA_GROUPS_2;
    }

    let content = message.content || '';
    let imageBuffers = [];

    try {
        if (message.messageSnapshots && message.messageSnapshots.size > 0) {
            const snapshot = message.messageSnapshots.first();
            if (snapshot) {
                if (!content && snapshot.content) content = snapshot.content;
                if (snapshot.attachments && snapshot.attachments.size > 0) {
                    for (const [_, att] of snapshot.attachments) {
                        if (att.contentType?.startsWith('image/') || att.filename.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/)) {
                            const res = await fetch(att.url);
                            const buf = await res.buffer();
                            imageBuffers.push({ buffer: buf, filename: att.filename || 'imagen_snapshot.png' });
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('Error procesando messageSnapshots:', e);
    }

    if (imageBuffers.length === 0 && message.attachments.size > 0) {
        for (const [_, att] of message.attachments) {
            if (att.contentType?.startsWith('image/') || att.filename.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/)) {
                try {
                    const res = await fetch(att.url);
                    const buf = await res.buffer();
                    imageBuffers.push({ buffer: buf, filename: att.filename || 'imagen.png' });
                } catch (e) {
                    console.error('Error descargando adjunto:', e);
                }
            }
        }
    }

    if (imageBuffers.length === 0 && message.embeds.length > 0) {
        for (const embed of message.embeds) {
            if (embed.image && embed.image.url) {
                try {
                    const res = await fetch(embed.image.url);
                    const buf = await res.buffer();
                    imageBuffers.push({ buffer: buf, filename: 'imagen_reenviada.png' });
                    if (!content && embed.description) content = embed.description;
                } catch (e) {
                    console.error('Error descargando imagen de embed:', e);
                }
            }
        }
    }

    const hasText = content && content.trim().length > 0;
    const hasImages = imageBuffers.length > 0;

    if (!hasImages && !hasText) return;

    if (isScheduled) {
        const scheduleRegex = /^\/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/;
        const match = content.match(scheduleRegex);

        if (match) {
            const [, day, month, yearStr, hour, minute] = match;
            const year = yearStr.length === 2 ? `20${yearStr}` : yearStr;
            const targetDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`);
            const now = new Date();
            const delay = targetDate.getTime() - now.getTime();

            if (delay > 0) {
                const cleanCaption = content.replace(scheduleRegex, '').trim();
                try { await message.react('⏰'); } catch (e) {}
                try { await message.delete(); } catch (e) {}

                for (const imgData of imageBuffers) {
                    setTimeout(async () => {
                        await dispatchToTargets(imgData.buffer, imgData.filename, cleanCaption, targetWebhooks, targetWaGroups);
                    }, delay);
                }
                return;
            } else {
                try { await message.react('❌'); } catch (e) {}
                return;
            }
        }
    }

    const rawCaption = content;

    if (hasImages) {
        for (const imgData of imageBuffers) {
            try {
                await dispatchToTargets(imgData.buffer, imgData.filename, rawCaption, targetWebhooks, targetWaGroups);
            } catch (err) { 
                console.error('Error procesando imagen:', err); 
            }
        }
    } else if (hasText) {
        await dispatchToTargets(null, null, rawCaption, targetWebhooks, targetWaGroups);
    }

    try {
        await message.delete();
        console.log('> [Discord] Mensaje original eliminado del canal.');
    } catch (err) {
        console.error('Error al intentar eliminar el mensaje de Discord:', err);
    }
});

startWhatsApp();
