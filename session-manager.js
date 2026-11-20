const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    Browsers,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = process.env.SESSIONS_PATH || process.env.SESSIONS_DIR || path.join(__dirname, 'sessions');

// Asegurar que la carpeta base de sesiones exista
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

class SessionManager {
    constructor() {
        /** @type {Map<string, { id: string, sock: any, status: string, qrRaw: string|null, qrDataUrl: string|null, phone: string|null, name: string|null, connectedAt: Date|null, isClosing: boolean, reconnectAttempts: number }>} */
        this.sessions = new Map();
        this.reconnectTimers = new Map();
    }

    /**
     * Sanitiza el nombre de la sesión para prevenir vulnerabilidades de ruta
     */
    sanitizeId(id) {
        if (!id || typeof id !== 'string') {
            throw new Error('El ID de sesión debe ser un texto no vacío.');
        }
        const clean = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        if (clean.length === 0) {
            throw new Error('El ID de sesión contiene caracteres no válidos.');
        }
        return clean;
    }

    /**
     * Obtiene la ruta de almacenamiento para una sesión
     */
    getSessionDir(sessionId) {
        return path.join(SESSIONS_DIR, sessionId);
    }

    /**
     * Inicializa o recupera una sesión para un número/usuario específico
     */
    async initSession(rawSessionId) {
        const sessionId = this.sanitizeId(rawSessionId);

        // Si ya existe y está conectada, devolverla directamente
        if (this.sessions.has(sessionId)) {
            const existing = this.sessions.get(sessionId);
            if (existing.status === 'CONNECTED' && existing.sock) {
                return existing;
            }
            if (existing.sock) {
                try {
                    existing.isClosing = true;
                    existing.sock.ev?.removeAllListeners?.('connection.update');
                    existing.sock.ev?.removeAllListeners?.('creds.update');
                    existing.sock.end(undefined);
                } catch (e) {
                    // ignorar error al cerrar socket previo
                }
            }
        }

        const sessionDir = this.getSessionDir(sessionId);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Crear objeto de sesión en memoria
        const session = {
            id: sessionId,
            sock: null,
            status: 'INITIALIZING',
            qrRaw: null,
            qrDataUrl: null,
            phone: null,
            name: null,
            connectedAt: null,
            isClosing: false,
            reconnectAttempts: 0
        };

        this.sessions.set(sessionId, session);

        // Cancelar reconexiones pendientes previas
        if (this.reconnectTimers.has(sessionId)) {
            clearTimeout(this.reconnectTimers.get(sessionId));
            this.reconnectTimers.delete(sessionId);
        }

        try {
            console.log(`[${sessionId}] Cargando estado de autenticación...`);
            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

            // Obtener versión oficial de WhatsApp Web
            let version = [2, 3000, 1015901307];
            try {
                const latest = await fetchLatestBaileysVersion();
                version = latest.version;
                console.log(`[${sessionId}] Usando WhatsApp Web v${version.join('.')}`);
            } catch (err) {
                console.warn(`[${sessionId}] No se pudo consultar la última versión en vivo. Usando versión predeterminada.`);
            }

            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                browser: Browsers.macOS(`WA-${sessionId}`),
                version,
                syncFullHistory: false,
                logger: pino({ level: 'silent' })
            });

            session.sock = sock;

            // Guardar credenciales al actualizarse
            sock.ev.on('creds.update', saveCreds);

            // Manejar eventos de conexión
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    session.qrRaw = qr;
                    session.status = 'QR_READY';
                    try {
                        session.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
                    } catch (qrErr) {
                        console.error(`[${sessionId}] Error al generar DataURL del QR:`, qrErr.message);
                    }

                    console.log(`\n========================================`);
                    console.log(`[${sessionId}] ESCANEA ESTE QR PARA CONECTAR EL NÚMERO:`);
                    qrcodeTerminal.generate(qr, { small: true });
                    console.log(`========================================\n`);
                }

                if (connection === 'open') {
                    session.status = 'CONNECTED';
                    session.qrRaw = null;
                    session.qrDataUrl = null;
                    session.connectedAt = new Date();
                    session.reconnectAttempts = 0;

                    // Extraer información del usuario vinculado
                    const userJid = sock.user?.id || '';
                    const cleanPhone = userJid.split(':')[0].replace(/\D/g, '');
                    session.phone = cleanPhone || null;
                    session.name = sock.user?.name || sock.user?.notify || 'WhatsApp User';

                    console.log(`🎉 [${sessionId}] ¡Sesión conectada con éxito! Teléfono: +${session.phone} (${session.name})`);
                }

                if (connection === 'close') {
                    session.status = 'DISCONNECTED';

                    let statusCode = null;
                    if (lastDisconnect?.error?.output) {
                        statusCode = lastDisconnect.error.output.statusCode;
                    }

                    const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                    console.log(`[${sessionId}] Conexión cerrada. Status: ${statusCode}. LoggedOut: ${isLoggedOut}`);

                    if (isLoggedOut) {
                        console.log(`[${sessionId}] Sesión desvinculada por WhatsApp. Limpiando credenciales...`);
                        await this.deleteSession(sessionId, false);
                    } else if (!session.isClosing) {
                        const delay = Math.min(30000, 3000 * Math.pow(1.5, session.reconnectAttempts));
                        session.reconnectAttempts++;
                        console.log(`[${sessionId}] Reintentando conexión en ${(delay / 1000).toFixed(1)}s (intento ${session.reconnectAttempts})...`);

                        const timer = setTimeout(() => {
                            this.initSession(sessionId).catch((e) => {
                                console.error(`[${sessionId}] Error al reintentar conexión:`, e.message);
                            });
                        }, delay);

                        this.reconnectTimers.set(sessionId, timer);
                    }
                }
            });

            return session;
        } catch (error) {
            session.status = 'ERROR';
            console.error(`[${sessionId}] Error al inicializar sesión:`, error);
            throw error;
        }
    }

    /**
     * Obtiene una sesión por su ID
     */
    getSession(rawSessionId) {
        const sessionId = this.sanitizeId(rawSessionId);
        return this.sessions.get(sessionId) || null;
    }

    /**
     * Retorna el listado de todas las sesiones registradas
     */
    listSessions() {
        const result = [];
        for (const [id, s] of this.sessions.entries()) {
            result.push({
                sessionId: id,
                status: s.status,
                phone: s.phone,
                name: s.name,
                connectedAt: s.connectedAt,
                hasQr: !!s.qrRaw
            });
        }
        return result;
    }

    /**
     * Genera candidatos de marcación para verificar existencia en WhatsApp (resolviendo 52 vs 521 en México)
     */
    buildPhoneCandidates(rawInput) {
        const cleanNumber = rawInput.toString().replace(/@.*$/, '').replace(/\D/g, '');
        if (cleanNumber.length < 8) {
            const err = new Error(`El número '${rawInput}' no tiene un formato válido (mínimo 8 dígitos).`);
            err.statusCode = 422;
            throw err;
        }

        const candidates = [];
        if (cleanNumber.length === 10) {
            candidates.push(`521${cleanNumber}`, `52${cleanNumber}`);
        } else if (cleanNumber.length === 13 && cleanNumber.startsWith('521')) {
            candidates.push(cleanNumber, `52${cleanNumber.slice(3)}`);
        } else if (cleanNumber.length === 12 && cleanNumber.startsWith('52')) {
            candidates.push(`521${cleanNumber.slice(2)}`, cleanNumber);
        } else {
            candidates.push(cleanNumber);
        }

        return { cleanNumber, candidates: [...new Set(candidates)] };
    }

    /**
     * Verifica si un número está registrado en WhatsApp y devuelve su JID oficial
     */
    async checkNumber(rawSessionId, to) {
        const sessionId = this.sanitizeId(rawSessionId);
        const session = this.sessions.get(sessionId);

        if (!session || session.status !== 'CONNECTED' || !session.sock) {
            const err = new Error(`La sesión '${sessionId}' no está conectada a WhatsApp.`);
            err.statusCode = 422;
            throw err;
        }

        const rawStr = to ? to.toString().trim() : '';
        if (rawStr.endsWith('@g.us')) {
            return { exists: true, jid: rawStr, number: rawStr, checked: [rawStr] };
        }

        const { cleanNumber, candidates } = this.buildPhoneCandidates(rawStr);
        const checks = await session.sock.onWhatsApp(...candidates);
        const match = Array.isArray(checks) ? checks.find((item) => item && item.exists) : null;

        if (match) {
            return {
                exists: true,
                jid: match.jid,
                number: match.jid.split('@')[0],
                input: cleanNumber,
                checked: candidates
            };
        }

        return {
            exists: false,
            jid: null,
            number: null,
            input: cleanNumber,
            checked: candidates
        };
    }

    /**
     * Envía un mensaje de texto o multimedia a través de una sesión específica
     */
    async sendMessage(rawSessionId, to, text, options = {}) {
        const sessionId = this.sanitizeId(rawSessionId);
        const session = this.sessions.get(sessionId);

        if (!session || session.status !== 'CONNECTED' || !session.sock) {
            const err = new Error(`La sesión '${sessionId}' no está conectada a WhatsApp.`);
            err.statusCode = 422;
            throw err;
        }

        const check = await this.checkNumber(sessionId, to);
        if (!check.exists || !check.jid) {
            const err = new Error(`El número '${check.input || to}' no está registrado en WhatsApp.`);
            err.statusCode = 422;
            throw err;
        }

        const jid = check.jid;
        const cleanNumber = check.number || check.input;

        let messagePayload;
        if (options.mediaUrl || options.mediaBase64) {
            const mimetype = options.mimetype || 'application/pdf';
            let contentSource;

            if (options.mediaBase64) {
                const cleanBase64 = options.mediaBase64.replace(/^data:[^;]+;base64,/, '');
                contentSource = Buffer.from(cleanBase64, 'base64');
            } else {
                contentSource = { url: options.mediaUrl };
            }

            if (options.type === 'document' || mimetype === 'application/pdf' || (options.fileName && options.fileName.endsWith('.pdf'))) {
                messagePayload = {
                    document: contentSource,
                    mimetype: mimetype,
                    fileName: options.fileName || 'archivo.pdf',
                    caption: text || undefined
                };
            } else {
                messagePayload = {
                    image: contentSource,
                    caption: text || undefined
                };
            }
        } else {
            messagePayload = { text: text.toString() };
        }

        console.log(`[${sessionId}] Enviando mensaje a ${jid}...`);
        const sent = await session.sock.sendMessage(jid, messagePayload);

        return {
            messageId: sent.key.id,
            status: 'sent',
            to: cleanNumber,
            from: session.phone,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cierra y elimina completamente una sesión y sus credenciales en disco
     */
    async deleteSession(rawSessionId, callLogout = true) {
        const sessionId = this.sanitizeId(rawSessionId);
        const session = this.sessions.get(sessionId);

        if (this.reconnectTimers.has(sessionId)) {
            clearTimeout(this.reconnectTimers.get(sessionId));
            this.reconnectTimers.delete(sessionId);
        }

        if (session) {
            session.isClosing = true;
            if (session.sock) {
                try {
                    if (callLogout && session.status === 'CONNECTED') {
                        await session.sock.logout().catch(() => {});
                    }
                    session.sock.end(undefined);
                } catch (e) {
                    // ignorar
                }
            }
            this.sessions.delete(sessionId);
        }

        // Eliminar carpeta de credenciales de esta sesión
        const sessionDir = this.getSessionDir(sessionId);
        if (fs.existsSync(sessionDir)) {
            try {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                console.log(`[${sessionId}] Carpeta de credenciales eliminada.`);
            } catch (err) {
                console.error(`[${sessionId}] Error al borrar credenciales:`, err.message);
            }
        }

        return { success: true, sessionId };
    }

    /**
     * Escanea la carpeta sessions/ y reconecta todas las sesiones almacenadas previamente
     */
    async autoRestoreSessions() {
        if (!fs.existsSync(SESSIONS_DIR)) return;

        const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
        const sessionDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

        if (sessionDirs.length === 0) {
            console.log('No hay sesiones previas para restaurar.');
            return;
        }

        console.log(`Restaurando ${sessionDirs.length} sesión(es) previa(s) de WhatsApp...`);
        for (const id of sessionDirs) {
            try {
                await this.initSession(id);
            } catch (err) {
                console.error(`Error al restaurar sesión previa '${id}':`, err.message);
            }
        }
    }
}

module.exports = new SessionManager();
