const express = require('express');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares para procesar JSON y datos de formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Variables de estado del socket
let sock = null;
let connectionState = {
    connected: false,
    qr: null
};

const AUTH_DIR = path.join(__dirname, 'auth_info');

/**
 * Inicializa y gestiona la conexión con los WebSockets de WhatsApp.
 */
async function connectToWhatsApp() {
    console.log('Inicializando conexión con WhatsApp...');

    // Inicializar el estado de autenticación con persistencia local
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Inicializar el socket con la configuración especificada para evitar error 405
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        logger: pino({ level: 'silent' })
    });

    // Guardar credenciales cada vez que cambien o se actualicen
    sock.ev.on('creds.update', saveCreds);

    // Monitorear actualizaciones de conexión
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Mostrar QR si es requerido para la vinculación
        if (qr) {
            connectionState.qr = qr;
            console.log('\n--- CÓDIGO QR PARA VINCULACIÓN ---');
            qrcode.generate(qr, { small: true });
            console.log('----------------------------------\n');
        }

        // Manejo de cierres y reconexión automática
        if (connection === 'close') {
            connectionState.connected = false;
            
            // Extracción estricta del código de estado de desconexión
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Conexión cerrada. Código de estado: ${statusCode}. Intentando reconectar: ${shouldReconnect}`);

            if (shouldReconnect) {
                // Timeout de 3 segundos para evitar bucles infinitos agresivos
                setTimeout(connectToWhatsApp, 3000);
            } else {
                console.log('Sesión cerrada voluntariamente por el usuario. Limpiando credenciales antiguas...');
                try {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                } catch (err) {
                    console.error('Error al limpiar credenciales:', err.message);
                }
                // Permitir que empiece una nueva vinculación con un nuevo QR en 3 segundos
                setTimeout(connectToWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            connectionState.connected = true;
            connectionState.qr = null;
            console.log('¡Conexión de WhatsApp establecida con éxito! 🎉');
        }
    });
}

// Iniciar proceso de conexión
connectToWhatsApp();

/**
 * Endpoint de monitoreo del servicio (Health Check)
 */
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        whatsapp: connectionState.connected ? 'CONECTADO' : 'DESCONECTADO',
        esperando_qr: !!connectionState.qr
    });
});

/**
 * Endpoint POST '/enviar-mensaje'
 * Recibe un JSON en el body con 'numero' y 'mensaje'.
 */
app.post('/enviar-mensaje', async (req, res) => {
    const { numero, mensaje } = req.body;

    // 1. Validar que ambos campos existan
    if (!numero || !mensaje) {
        return res.status(400).json({
            status: 'error',
            error: 'Los parámetros "numero" y "mensaje" son requeridos.'
        });
    }

    // 2. Verificar si el bot está conectado antes de intentar enviar
    if (!connectionState.connected || !sock) {
        return res.status(503).json({
            status: 'error',
            error: 'La API de WhatsApp no está conectada o lista. Por favor vincula tu cuenta.'
        });
    }

    try {
        // 3. Limpiar el número quitando cualquier carácter no numérico
        const cleanNumber = numero.toString().replace(/\D/g, '');

        if (cleanNumber.length < 8) {
            return res.status(400).json({
                status: 'error',
                error: 'El número de teléfono provisto no tiene un formato válido.'
            });
        }

        // 4. Formatear al JID estándar de WhatsApp
        const jid = `${cleanNumber}@s.whatsapp.net`;

        console.log(`Enviando mensaje a: ${jid}`);

        // 5. Enviar mensaje de texto
        const sentMsg = await sock.sendMessage(jid, { text: mensaje });

        return res.status(200).json({
            status: 'success',
            message: 'Mensaje enviado exitosamente',
            messageId: sentMsg.key.id
        });

    } catch (error) {
        console.error('Error al enviar el mensaje:', error);
        return res.status(500).json({
            status: 'error',
            error: 'No se pudo enviar el mensaje a través de WhatsApp.',
            details: error.message
        });
    }
});

// Iniciar servidor Express en el puerto configurado
app.listen(PORT, () => {
    console.log(`Servidor de WhatsApp Express escuchando en el puerto ${PORT}`);
});