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
    console.log('> [WhatsApp] Iniciando conexión con Baileys...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    waSocket = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: false
    });

    waSocket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        console.log(`> [WhatsApp Connection Update]:`, update);
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`> [WhatsApp] Conexión cerrada. ¿Reconectar?: ${shouldReconnect}`);
            if (shouldReconnect) startWhatsApp();
        } else if (connection === 'open') {
            console.log('> [WhatsApp] ¡Conectado y 100% estable!');
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
    if (message.author.bot) return;
    
    if (message.channel.id !== DISCORD_ORIGIN_CHANNEL_ID) return;
    
    const images = Array.from(message.attachments.values()).filter(att => att.contentType?.startsWith('image/'));
    if (images.length === 0) return;

    for (const img of images) {
        try {
            console.log('> [Discord] Imagen detectada en el canal de origen. Procesando...');
            const response = await fetch(img.url);
            const buffer = await response.buffer();
            const captionText = message.content || '';

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

            for (const rawWaGroupId of WA_DESTINATION_GROUPS) {
                try {
                    const cleanNumbers = rawWaGroupId.replace(/\D/g, '');
                    const waGroupId = `${cleanNumbers}@g.us`;

                    if (!waSocket) {
                        console.error('> [WhatsApp Error] El socket de WhatsApp no está inicializado.');
                        continue;
                    }

                    await waSocket.sendMessage(waGroupId, { 
                        image: buffer, 
                        caption: captionText 
                    }, { 
                        quoted: undefined 
                    });
                    
                    console.log(`> [WhatsApp] ¡Imagen enviada con éxito al grupo ${waGroupId}!`);
                } catch (err) {
                    console.error(`Error enviando al grupo WhatsApp ${rawWaGroupId}:`, err);
                }
            }

        } catch (err) { 
            console.error('Error procesando imagen:', err); 
        }
    }
});

startWhatsApp();
discordClient.login(DISCORD_BOT_TOKEN);
