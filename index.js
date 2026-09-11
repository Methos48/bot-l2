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

discordClient.on('messageCreate', async (message) => {
    // 1. IGNORAR mensajes de nuestro propio bot o de cualquier otro bot para evitar bucles
    if (message.author.id === discordClient.user.id || message.author.bot) return;

    if (message.channel.id !== DISCORD_ORIGIN_CHANNEL_ID) return;
    
    const images = Array.from(message.attachments.values()).filter(att => att.contentType?.startsWith('image/'));
    const hasText = message.content && message.content.trim().length > 0;

    // Si no tiene ni imágenes ni texto, no hacemos nada
    if (images.length === 0 && !hasText) return;

    const captionText = message.content || '';

    // ==========================================
    // CASO A: EL MENSAJE TIENE IMÁGENES
    // ==========================================
    if (images.length > 0) {
        console.log(`> [Discord] Imagen(es) detectada(s) en el canal de origen. Procesando...`);

        for (const img of images) {
            try {
                const response = await fetch(img.url);
                const buffer = await response.buffer();

                // Reenviar a canales de Discord destino usando los Webhooks con Embeds
                for (const webhookUrl of DISCORD_WEBHOOK_URLS) {
                    try {
                        const payload = {
                            embeds: [{
                                description: captionText || "",
                                image: {
                                    url: img.url
                                },
                                color: 0xDC143C // Color rojo acorde al clan
                            }]
                        };

                        await fetch(webhookUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                    } catch (err) {
                        console.error(`Error enviando imagen al webhook de Discord:`, err);
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
                        console.error(`Error enviando imagen al grupo WhatsApp ${waGroupId}:`, err);
                    }
                }

            } catch (err) { 
                console.error('Error procesando imagen:', err); 
            }
        }
    } 
    // ==========================================
    // CASO B: EL MENSAJE ES SOLO TEXTO PLANO
    // ==========================================
    else if (hasText) {
        console.log(`> [Discord] Texto detectado en el canal de origen. Procesando...`);

        // Reenviar texto a canales de Discord destino usando los Webhooks
        for (const webhookUrl of DISCORD_WEBHOOK_URLS) {
            try {
                await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: captionText
                    })
                });
            } catch (err) {
                console.error(`Error enviando texto al webhook de Discord:`, err);
            }
        }

        // Reenviar texto a grupos de WhatsApp
        for (const waGroupId of WA_DESTINATION_GROUPS) {
            try {
                await waSocket.sendMessage(waGroupId, { 
                    text: captionText 
                });
                console.log(`> [WhatsApp] ¡Texto enviado con éxito al grupo ${waGroupId}!`);
            } catch (err) {
                console.error(`Error enviando texto al grupo WhatsApp ${waGroupId}:`, err);
            }
        }
    }
});

startWhatsApp();
discordClient.login(DISCORD_BOT_TOKEN);
