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
const DISCORD_ORIGIN_CHANNEL_ID = process.env.DISCORD_ORIGIN_CHANNEL_ID;
const DISCORD_SCHEDULED_CHANNEL_ID = process.env.DISCORD_SCHEDULED_CHANNEL_ID;

const DISCORD_WEBHOOK_URLS = [
    process.env.DISCORD_WEBHOOK_1,
    process.env.DISCORD_WEBHOOK_2
].filter(Boolean);

const WA_DESTINATION_GROUPS = [
    process.env.WA_GROUP_ID_1,
    process.env.WA_GROUP_ID_2
].filter(Boolean);

// ID del otro bot autorizado para enviar mensajes
const ALLOWED_BOT_ID = '1548524655076184104';

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

// Función centralizada para enviar al canal destino (Discord Webhooks + WhatsApp sin encabezado)
async function dispatchMessage(buffer, filename, rawCaption) {
    // 1. Enviar a Discord (Webhooks)
    for (const webhookUrl of DISCORD_WEBHOOK_URLS) {
        try {
            const form = new FormData();
            form.append('file0', buffer, { filename: filename });
            if (rawCaption) {
                form.append('content', rawCaption);
            }

            await fetch(webhookUrl, {
                method: 'POST',
                body: form
            });
        } catch (err) {
            console.error(`Error enviando imagen al webhook de Discord:`, err);
        }
    }

    // 2. Enviar a WhatsApp (Imagen con el texto limpio, sin encabezado)
    for (const waGroupId of WA_DESTINATION_GROUPS) {
        try {
            const waPayload = { image: buffer };
            if (rawCaption) {
                waPayload.caption = rawCaption;
            }

            await waSocket.sendMessage(waGroupId, waPayload);
            console.log(`> [WhatsApp] ¡Imagen enviada con éxito al grupo ${waGroupId}!`);
        } catch (err) {
            console.error(`Error enviando imagen al grupo WhatsApp ${waGroupId}:`, err);
        }
    }
}

discordClient.on('messageCreate', async (message) => {
    // Si es este mismo bot, o si es cualquier otro bot que NO sea el autorizado, lo ignoramos
    if (message.author.id === discordClient.user.id || (message.author.bot && message.author.id !== ALLOWED_BOT_ID)) return;

    const isOrigin = message.channel.id === DISCORD_ORIGIN_CHANNEL_ID;
    const isScheduled = DISCORD_SCHEDULED_CHANNEL_ID && message.channel.id === DISCORD_SCHEDULED_CHANNEL_ID;

    if (!isOrigin && !isScheduled) return;
    
    let content = message.content || '';
    let imageBuffers = [];

    // 1. Verificar si es un mensaje con Snapshot
    try {
        if (message.messageSnapshots && message.messageSnapshots.size > 0) {
            const snapshot = message.messageSnapshots.first();
            if (snapshot) {
                if (!content && snapshot.content) {
                    content = snapshot.content;
                }
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

    // 2. Si no hubo snapshot, buscar adjuntos directos normales
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

    // 3. Buscar en Embeds
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

    // 4. Buscar en Mensajes Citados / Respuestas
    if (imageBuffers.length === 0 && message.reference && message.reference.messageId) {
        try {
            const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
            if (referencedMessage) {
                if (!content && referencedMessage.content) content = referencedMessage.content;
                for (const [_, att] of referencedMessage.attachments) {
                    if (att.contentType?.startsWith('image/') || att.filename.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/)) {
                        const res = await fetch(att.url);
                        const buf = await res.buffer();
                        imageBuffers.push({ buffer: buf, filename: att.filename || 'imagen.png' });
                    }
                }
            }
        } catch (e) {
            console.error('Error obteniendo mensaje referenciado:', e);
        }
    }

    const hasText = content && content.trim().length > 0;
    const hasImages = imageBuffers.length > 0;

    if (!hasImages && !hasText) return;

    // Si viene del canal de programación
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

                console.log(`> [Programador] Imagen programada para el ${day}/${month}/${year} a las ${hour}:${minute}`);
                try { await message.react('⏰'); } catch (e) {}

                for (const imgData of imageBuffers) {
                    setTimeout(async () => {
                        await dispatchMessage(imgData.buffer, imgData.filename, cleanCaption);
                    }, delay);
                }
                return;
            } else {
                try { await message.react('❌'); } catch (e) {}
                return;
            }
        }
    }

    // ==========================================
    // PROCESAMIENTO INSTANTÁNEO
    // ==========================================
    const rawCaption = content;

    if (hasImages) {
        console.log(`> [Discord] Imagen(es) detectada(s). Procesando...`);
        for (const imgData of imageBuffers) {
            try {
                await dispatchMessage(imgData.buffer, imgData.filename, rawCaption);
            } catch (err) { 
                console.error('Error procesando imagen:', err); 
            }
        }
    } else if (hasText) {
        console.log(`> [Discord] Texto detectado. Procesando de forma instantánea...`);
        for (const webhookUrl of DISCORD_WEBHOOK_URLS) {
            try {
                await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: rawCaption })
                });
            } catch (err) {
                console.error(`Error enviando texto al webhook de Discord:`, err);
            }
        }

        for (const waGroupId of WA_DESTINATION_GROUPS) {
            try {
                await waSocket.sendMessage(waGroupId, { text: rawCaption });
                console.log(`> [WhatsApp] ¡Texto enviado con éxito al grupo ${waGroupId} (sin encabezado)!`);
            } catch (err) {
                console.error(`Error enviando texto al grupo WhatsApp ${waGroupId}:`, err);
            }
        }
    }
});

startWhatsApp();
discordClient.login(DISCORD_BOT_TOKEN);
