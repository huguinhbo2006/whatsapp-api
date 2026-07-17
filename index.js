const express = require('express');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Variables de control de conexión
let sock = null;
let connectionState = {
    connected: false,
    qr: null,
    error: null
};

// Ruta de almacenamiento de credenciales para persistencia
const AUTH_DIR = path.join(__dirname, 'auth_info');

/**
 * Inicializa y gestiona la conexión con WhatsApp WebSockets (Baileys)
 */
async function connectToWhatsApp() {
    console.log('Iniciando cliente de WhatsApp...');

    // Configuración del almacenamiento de estado de autenticación de Baileys
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Creamos el socket de WhatsApp
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Desactivamos el comportamiento por defecto para controlarlo nosotros
        logger: pino({ level: 'silent' }) // Nivel de log para no saturar la consola de Railway con debug de red
    });

    // Escuchar actualizaciones de credenciales para persistirlas
    sock.ev.on('creds.update', saveCreds);

    // Escuchar el estado de la conexión
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            connectionState.qr = qr;
            console.log('\n--- CÓDIGO QR PARA VINCULACIÓN ---');
            console.log('Escanea este código QR con tu aplicación de WhatsApp:');
            qrcode.generate(qr, { small: true });
            console.log('----------------------------------\n');
        }

        if (connection === 'close') {
            connectionState.connected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Conexión cerrada. Razón: ${lastDisconnect?.error?.message || 'Desconocida'} (Status Code: ${statusCode})`);
            
            if (shouldReconnect) {
                console.log('Intentando reconexión automática en 5 segundos...');
                setTimeout(connectToWhatsApp, 5000);
            } else {
                console.log('El usuario cerró sesión en WhatsApp. Limpiando credenciales y esperando nuevo QR...');
                try {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                } catch (err) {
                    console.error('Error al limpiar la carpeta de autenticación:', err.message);
                }
                // Volvemos a iniciar para generar un nuevo QR
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            connectionState.connected = true;
            connectionState.qr = null;
            connectionState.error = null;
            const userJid = sock.user.id;
            console.log(`==================================================`);
            console.log(`¡Conexión exitosa a WhatsApp!`);
            console.log(`Conectado como: ${userJid}`);
            console.log(`==================================================`);
        }
    });
}

// Inicializar la conexión de WhatsApp
connectToWhatsApp();

/**
 * Endpoint de salud (Health Check)
 * Útil para monitorear el estado desde Railway.app
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
 * Recibe: { "numero": "521XXXXXXXXXX", "mensaje": "Texto del pedido" }
 */
app.post('/enviar-mensaje', async (req, res) => {
    const { numero, mensaje } = req.body;

    // 1. Validación básica de campos
    if (!numero || !mensaje) {
        return res.status(400).json({
            status: 'error',
            error: 'Los parámetros "numero" y "mensaje" son obligatorios en el cuerpo de la petición.'
        });
    }

    // 2. Validación de estado de conexión
    if (!connectionState.connected || !sock) {
        return res.status(503).json({
            status: 'error',
            error: 'El servicio de WhatsApp no está conectado actualmente. Por favor, vincula el dispositivo o espera a que se reconecte.'
        });
    }

    try {
        // 3. Limpieza del número de teléfono (deja solo dígitos)
        let cleanNumber = numero.toString().replace(/\D/g, '');

        if (cleanNumber.length < 8) {
            return res.status(400).json({
                status: 'error',
                error: 'El número de teléfono provisto no parece válido o es demasiado corto.'
            });
        }

        // 4. Formatear al estándar JID de WhatsApp (@s.whatsapp.net)
        const jid = `${cleanNumber}@s.whatsapp.net`;

        console.log(`Enviando mensaje a: ${jid}...`);

        // 5. Enviar mensaje a través del socket de Baileys
        const sentMessage = await sock.sendMessage(jid, { text: mensaje });

        console.log(`Mensaje enviado con éxito. ID: ${sentMessage.key.id}`);

        return res.status(200).json({
            status: 'success',
            message: 'Mensaje enviado con éxito',
            data: {
                id: sentMessage.key.id,
                destinatario: jid
            }
        });

    } catch (error) {
        console.error('Error al enviar el mensaje:', error);
        return res.status(500).json({
            status: 'error',
            error: 'Ocurrió un error interno al intentar enviar el mensaje de WhatsApp.',
            details: error.message
        });
    }
});

// Iniciar servidor Express
app.listen(PORT, () => {
    console.log(`Servidor Express escuchando en el puerto ${PORT}`);
});
