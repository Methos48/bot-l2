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
// Canal exclusivo para soltar las imágenes programadas
const DISCORD_SCHEDULED_CHANNEL_ID = process.env.DISCORD_SCHEDULED_CHANNEL_ID;

// Tus Webhooks configurados en Discord
const DISCORD_WEBHOOK_URLS = [
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

// Función centralizada para enviar al canal destino (Discord Webhooks + WhatsApp)
async function dispatchMessage(buffer, filename, rawCaption) {
    const waSignature = '👽 *『𝐎𝐊𝐓𝐔𝐁𝐑𝐄』* 👽';
    const waCaptionText = rawCaption ? `${waSignature}\n${rawCaption}` : waSignature;

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

    // 2. Enviar a WhatsApp (Imagen con firma abajo en el caption)
    for (const waGroupId of WA_DESTINATION_GROUPS) {
        try {
            await waSocket.sendMessage(waGroupId, { 
                image: buffer, 
                caption: waCaptionText 
            });
            console.log(`> [WhatsApp] ¡Imagen enviada con éxito al grupo ${waGroupId}!`);
        } catch (err) {
            console.error(`Error enviando imagen al grupo WhatsApp ${waGroupId}:`, err);
        }
    }
}

discordClient.on('messageCreate', async (message) => {
    if (message.author.id === discordClient.user.id || message.author.bot) return;

    const isOrigin = message.channel.id === DISCORD_ORIGIN_CHANNEL_ID;
    const isScheduled = DISCORD_SCHEDULED_CHANNEL_ID && message.channel.id === DISCORD_SCHEDULED_CHANNEL_ID;

    if (!isOrigin && !isScheduled) return;
    
    const images = Array.from(message.attachments.values()).filter(att => att.contentType?.startsWith('image/'));
    const hasText = message.content && message.content.trim().length > 0;

    if (images.length === 0 && !hasText) return;

    const content = message.content || '';

    // Si viene del canal de programación, evaluamos si trae el comando de fecha /DD/MM/YY HH:MM
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
                // Removemos el comando de fecha para que solo quede el texto del boss (si lo hay)
                const cleanCaption = content.replace(scheduleRegex, '').trim();

                console.log(`> [Programador] Imagen programada para el ${day}/${month}/${year} a las ${hour}:${minute}`);
                try { await message.react('⏰'); } catch (e) {}

                for (const img of images) {
                    try {
                        const response = await fetch(img.url);
                        const buffer = await response.buffer();
                        const filename = img.name || 'imagen.png';

                        setTimeout(async () => {
                            await dispatchMessage(buffer, filename, cleanCaption);
                        }, delay);

                    } catch (err) {
                        console.error('Error guardando imagen para programar:', err);
                    }
                }
                return; // Evita que se procese de forma instantánea
            } else {
                try { await message.react('❌'); } catch (e) {}
                return;
            }
        }
    }

    // ==========================================
    // PROCESAMIENTO INSTANTÁNEO (Canal de origen o programados sin formato válido)
    // ==========================================
    const rawCaption = content;
    const waSignature = '👽 *『𝐎𝐊𝐓𝐔𝐁𝐑𝐄』* 👽';
    const waCaptionText = rawCaption ? `${waSignature}\n${rawCaption}` : waSignature;

    if (images.length > 0) {
        console.log(`> [Discord] Imagen(es) detectada(s). Procesando de forma instantánea...`);
        for (const img of images) {
            try {
                const response = await fetch(img.url);
                const buffer = await response.buffer();
                const filename = img.name || 'imagen.png';

                await dispatchMessage(buffer, filename, rawCaption);

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
                const fullText = `${waSignature}\n${rawCaption}`;
                await waSocket.sendMessage(waGroupId, { text: fullText });
                console.log(`> [WhatsApp] ¡Texto enviado con éxito al grupo ${waGroupId}!`);
            } catch (err) {
                console.error(`Error enviando texto al grupo WhatsApp ${waGroupId}:`, err);
            }
        }
    }
});

startWhatsApp();
discordClient.login(DISCORD_BOT_TOKEN);
