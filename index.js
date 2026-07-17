const {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const path = require('path');
const pino = require('pino');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AUTH_DIR = path.join(__dirname, 'auth_info');

let sock = null;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'] // Solución al error 405
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('--- ESCANEA ESTE CÓDIGO QR EN TU WHATSAPP ---');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect ? .error ? .output ? .statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Conexión cerrada. Código de estado: ${statusCode}. ¿Reconectando?: ${shouldReconnect}`);

            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('¡Conexión de WhatsApp establecida con éxito!');
        }
    });
}

app.post('/enviar-mensaje', async(req, res) => {
    const { numero, mensaje } = req.body;

    if (!numero || !mensaje) {
        return res.status(400).json({ error: 'Faltan parámetros: numero y mensaje son obligatorios.' });
    }

    if (!sock) {
        return res.status(500).json({ error: 'WhatsApp no está conectado.' });
    }

    try {
        const numeroLimpio = numero.replace(/\D/g, '');
        const jid = `${numeroLimpio}@s.whatsapp.net`;

        await sock.sendMessage(jid, { text: mensaje });

        return res.status(200).json({ success: true, message: 'Mensaje enviado.' });
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'No se pudo enviar el mensaje.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor API corriendo en puerto ${PORT}`);
    connectToWhatsApp();
});