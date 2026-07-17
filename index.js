const express = require('express');
const cors = require('cors');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const QRCodeImage = require('qrcode'); // Asegúrate de tener este paquete para renderizar imágenes en el navegador

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares para procesar JSON, datos de formularios y habilitar CORS para tu Landing
app.use(cors());
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

    try {
        // Obtener dinámicamente la última versión web de WhatsApp para evitar el error 405
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`Usando versión de WhatsApp Web oficial: ${version.join('.')}. ¿Es la última disponible?: ${isLatest}`);

        // Inicializar el socket con la versión obtenida dinámicamente
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, // Apagamos la terminal de Railway para que no rompa caracteres
            browser: Browsers.macOS('Desktop'),
            version: version,
            syncFullHistory: false,
            logger: pino({ level: 'silent' })
        });
    } catch (vError) {
        console.error('Error al recuperar la versión de Baileys desde los servidores:', vError.message);
        console.log('Intentando conectar con una versión por defecto para recuperación...');

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.macOS('Desktop'),
            syncFullHistory: false,
            logger: pino({ level: 'silent' })
        });
    }

    // Guardar credenciales cada vez que cambien o se actualicen
    sock.ev.on('creds.update', saveCreds);

    // Monitorear actualizaciones de conexión
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Guardar el string del QR en nuestro estado para que el navegador lo pueda leer
        if (qr) {
            connectionState.qr = qr;
            console.log('--- NUEVO CÓDIGO QR GENERADO: Entra a /qr en tu navegador para escanearlo ---');
        }

        // Manejo de cierres y reconexión automática
        if (connection === 'close') {
            connectionState.connected = false;

            // Extracción clásica sin operadores ?. para evitar problemas con el formateador de tu editor
            let statusCode = null;
            if (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output) {
                statusCode = lastDisconnect.error.output.statusCode;
            }

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            if (statusCode === 405) {
                console.error('¡ADVERTENCIA CRÍTICA!: Se recibió el Status Code 405 (Versión rechazada por WhatsApp). Reintentando conexión con la versión web simulada en 5 segundos...');
            } else {
                console.log(`Conexión cerrada. Código de estado: ${statusCode}. Intentando reconectar: ${shouldReconnect}`);
            }

            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            } else {
                console.log('Sesión cerrada voluntariamente por el usuario. Limpiando credenciales antiguas...');
                try {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                } catch (err) {
                    console.error('Error al limpiar credenciales:', err.message);
                }
                setTimeout(connectToWhatsApp, 5000);
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
 * NUEVA RUTA: Endpoint visual para ver y escanear el QR como imagen perfecta
 */
app.get('/qr', async(req, res) => {
    if (connectionState.connected) {
        return res.send('<h1>¡WhatsApp ya está conectado con éxito! 🎉</h1>');
    }

    if (!connectionState.qr) {
        return res.send('<h1>Esperando que WhatsApp genere el código QR... Refresca en 5 segundos. 🔄</h1>');
    }

    try {
        // Convierte el string de autenticación en una imagen QR tipo DataURL (base64)
        const qrImageBase64 = await QRCodeImage.toDataURL(connectionState.qr);

        // Renderiza un HTML simple y centrado para que lo escanees cómodamente
        res.send(`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; background-color: #f5f5f7;">
                <div style="background: white; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center;">
                    <h2 style="color: #1a8e4e; margin-bottom: 10px;">Vincular Taquería Mary 🌮</h2>
                    <p style="color: #666; margin-bottom: 20px; font-size: 14px;">Escanea este código desde la sección "Dispositivos vinculados" en tu WhatsApp.</p>
                    <img src="${qrImageBase64}" alt="Código QR de WhatsApp" style="width: 300px; height: 300px; display: block; margin: 0 auto;" />
                    <p style="margin-top: 20px; font-size: 11px; color: #999;">La página se actualizará sola cuando completes la vinculación.</p>
                </div>
            </div>
            <script>
                // Monitoreo en bucle para refrescar la página cuando se conecte con éxito
                setInterval(async () => {
                    try {
                        const response = await fetch('/health');
                        const data = await response.json();
                        if (data.whatsapp === 'CONECTADO') {
                            location.reload();
                        }
                    } catch(e){}
                }, 3000);
            </script>
        `);
    } catch (err) {
        res.status(500).send('Error al generar la imagen del código QR.');
    }
});

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
app.post('/enviar-mensaje', async(req, res) => {
    const { numero, mensaje } = req.body;

    if (!numero || !mensaje) {
        return res.status(400).json({
            status: 'error',
            error: 'Los parámetros "numero" y "mensaje" son requeridos.'
        });
    }

    if (!connectionState.connected || !sock) {
        return res.status(503).json({
            status: 'error',
            error: 'La API de WhatsApp no está conectada o lista. Por favor vincula tu cuenta.'
        });
    }

    try {
        const cleanNumber = numero.toString().replace(/\D/g, '');

        if (cleanNumber.length < 8) {
            return res.status(400).json({
                status: 'error',
                error: 'El número de teléfono provisto no tiene un formato válido.'
            });
        }

        const jid = `${cleanNumber}@s.whatsapp.net`;
        console.log(`Enviando mensaje a: ${jid}`);
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