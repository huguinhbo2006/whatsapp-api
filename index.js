const express = require('express');
const cors = require('cors');
const sessionManager = require('./session-manager');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

/**
 * 1. Health check global
 */
app.get('/health', (req, res) => {
    const list = sessionManager.listSessions();
    const connectedCount = list.filter((s) => s.status === 'CONNECTED').length;

    res.status(200).json({
        status: 'OK',
        uptime_seconds: Math.floor(process.uptime()),
        total_sessions: list.length,
        connected_sessions: connectedCount,
        sessions: list
    });
});

/**
 * 2. Listar todas las sesiones
 */
app.get('/sessions', (req, res) => {
    const sessions = sessionManager.listSessions();
    res.json({
        count: sessions.length,
        sessions
    });
});

/**
 * 3. Iniciar o conectar una sesión (por ID)
 * Si la sesión no existe, se inicia y genera un QR nuevo.
 */
app.post('/sessions/:sessionId/start', async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const session = await sessionManager.initSession(sessionId);

        res.json({
            success: true,
            sessionId: session.id,
            status: session.status,
            phone: session.phone,
            qrImage: session.qrDataUrl,
            qrRaw: session.qrRaw,
            qrViewUrl: `/sessions/${session.id}/qr-view`
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * 4. Obtener estado de una sesión
 */
app.get('/sessions/:sessionId/status', (req, res) => {
    const session = sessionManager.getSession(req.params.sessionId);
    if (!session) {
        return res.status(404).json({
            success: false,
            error: `La sesión '${req.params.sessionId}' no existe. Iníciala con POST /sessions/${req.params.sessionId}/start.`
        });
    }

    res.json({
        sessionId: session.id,
        status: session.status,
        phone: session.phone,
        name: session.name,
        connectedAt: session.connectedAt,
        hasQr: !!session.qrRaw
    });
});

/**
 * 5. Obtener el código QR en JSON (DataURL base64 y raw string)
 */
app.get('/sessions/:sessionId/qr', async (req, res) => {
    try {
        let session = sessionManager.getSession(req.params.sessionId);
        if (!session) {
            // Inicializar automáticamente si se solicita el QR
            session = await sessionManager.initSession(req.params.sessionId);
        }

        if (session.status === 'CONNECTED') {
            return res.json({
                sessionId: session.id,
                status: 'CONNECTED',
                message: 'Esta sesión ya está conectada a WhatsApp.',
                phone: session.phone
            });
        }

        res.json({
            sessionId: session.id,
            status: session.status,
            qrRaw: session.qrRaw,
            qrImage: session.qrDataUrl
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 6. Vista Web Visual del QR para escanear en navegador (/sessions/:sessionId/qr-view)
 */
app.get('/sessions/:sessionId/qr-view', async (req, res) => {
    const sessionId = req.params.sessionId;
    let session = sessionManager.getSession(sessionId);

    if (!session) {
        try {
            session = await sessionManager.initSession(sessionId);
        } catch (err) {
            return res.status(500).send(`<h3>Error al inicializar sesión: ${err.message}</h3>`);
        }
    }

    const html = `
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>Conectar WhatsApp — ${sessionId}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: #f0f2f5;
          margin: 0;
          padding: 24px 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          color: #111b21;
        }
        .card {
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          max-width: 440px;
          width: 100%;
          padding: 28px;
          text-align: center;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .logo { font-size: 2.2rem; }
        h1 { margin: 0; font-size: 1.35rem; }
        .session-badge {
          display: inline-block;
          background: #e7f8ee;
          color: #008040;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 0.85rem;
          margin-bottom: 16px;
        }
        .qr-wrap {
          margin: 18px 0;
          min-height: 260px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fafafa;
          border-radius: 12px;
          border: 1px dashed #d1d7db;
          padding: 12px;
        }
        .qr-img {
          width: 250px;
          height: 250px;
          border-radius: 8px;
        }
        .steps {
          text-align: left;
          font-size: 0.9rem;
          color: #3b4a54;
          line-height: 1.5;
          margin: 16px 0;
          padding-left: 20px;
        }
        .status-box {
          padding: 10px 14px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 0.9rem;
          margin-top: 14px;
        }
        .status-connected { background: #d1fae5; color: #065f46; }
        .status-waiting { background: #fef3c7; color: #92400e; }
        .btn-logout {
          background: #fee2e2;
          color: #991b1b;
          border: none;
          padding: 8px 16px;
          font-weight: 700;
          border-radius: 8px;
          cursor: pointer;
          margin-top: 12px;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <span class="logo">💬</span>
          <h1>Conectar WhatsApp</h1>
        </div>
        <div class="session-badge">Sesión: <strong>${sessionId}</strong></div>

        <div id="content">
          <p style="color:#54656f; font-size: 0.9rem;">Cargando estado...</p>
        </div>

        <ol class="steps">
          <li>Abre <strong>WhatsApp</strong> en tu teléfono.</li>
          <li>Toca <strong>Menú ⋮</strong> o <strong>Ajustes ⚙️</strong>.</li>
          <li>Toca <strong>Dispositivos vinculados</strong> y luego <strong>Vincular un dispositivo</strong>.</li>
          <li>Apunta tu teléfono a esta pantalla para escanear el código.</li>
        </ol>
      </div>

      <script>
        const sessionId = ${JSON.stringify(sessionId)};
        const contentDiv = document.getElementById('content');

        async function refreshStatus() {
          try {
            const res = await fetch('/sessions/' + sessionId + '/qr');
            const data = await res.json();

            if (data.status === 'CONNECTED') {
              contentDiv.innerHTML = \`
                <div class="status-box status-connected">
                  ✅ ¡Conectado con éxito!
                  <div style="font-size: 1.05rem; margin-top: 4px;">Número: +<strong>\${data.phone || 'Vinculado'}</strong></div>
                </div>
                <button class="btn-logout" onclick="logoutSession()">Desvincular sesión</button>
              \`;
            } else if (data.qrImage) {
              contentDiv.innerHTML = \`
                <div class="qr-wrap">
                  <img class="qr-img" src="\${data.qrImage}" alt="Código QR de WhatsApp" />
                </div>
                <div class="status-box status-waiting">⏳ Esperando escaneo con tu teléfono...</div>
              \`;
            } else {
              contentDiv.innerHTML = \`
                <div class="qr-wrap">
                  <p style="color:#667781;">Generando código QR... espera un momento.</p>
                </div>
              \`;
            }
          } catch (e) {
            contentDiv.innerHTML = '<p style="color:red;">Error de conexión con el servidor.</p>';
          }
        }

        async function logoutSession() {
          if (!confirm('¿Deseas desvincular este número de WhatsApp?')) return;
          await fetch('/sessions/' + sessionId + '/logout', { method: 'POST' });
          location.reload();
        }

        refreshStatus();
        setInterval(refreshStatus, 3000);
      </script>
    </body>
    </html>
    `;

    res.send(html);
});

/**
 * 6.5 Verificar si un número tiene cuenta de WhatsApp activa
 * GET /sessions/:sessionId/check-number/:numero
 * POST /sessions/:sessionId/check-number  Body: { "numero": "3312345678" }
 */
const checkNumberHandler = async (req, res) => {
    const { sessionId } = req.params;
    const recipient = req.params.numero || req.body?.numero || req.body?.to || req.query?.numero;

    if (!recipient) {
        return res.status(400).json({
            success: false,
            error: 'El parámetro "numero" es obligatorio.'
        });
    }

    try {
        const result = await sessionManager.checkNumber(sessionId, recipient);
        res.json({
            success: true,
            sessionId,
            ...result
        });
    } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({
            success: false,
            sessionId,
            error: err.message
        });
    }
};

app.get('/sessions/:sessionId/check-number/:numero', checkNumberHandler);
app.post('/sessions/:sessionId/check-number', checkNumberHandler);

/**
 * 7. Enviar mensaje de texto desde una sesión específica
 * POST /sessions/:sessionId/send-message
 * Body: { "numero": "5213312345678", "mensaje": "Hola!" }
 */
app.post('/sessions/:sessionId/send-message', async (req, res) => {
    const { sessionId } = req.params;
    const { numero, to, mensaje, text } = req.body;

    const recipient = numero || to;
    const messageText = mensaje || text;

    if (!recipient || !messageText) {
        return res.status(400).json({
            success: false,
            error: 'Los parámetros "numero" (o "to") y "mensaje" (o "text") son obligatorios.'
        });
    }

    try {
        const result = await sessionManager.sendMessage(sessionId, recipient, messageText);
        res.json({
            success: true,
            sessionId,
            ...result
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({
            success: false,
            sessionId,
            error: err.message
        });
    }
});

/**
 * 8. Enviar imagen o archivo / PDF desde una sesión específica
 * POST /sessions/:sessionId/send-media
 * Body: {
 *   "numero": "5213312345678",
 *   "mediaUrl": "https://midominio.com/ticket.pdf",
 *   "caption": "Tu comprobante de compra",
 *   "type": "document" | "image",
 *   "fileName": "ticket.pdf",
 *   "mimetype": "application/pdf"
 * }
 */
app.post('/sessions/:sessionId/send-media', async (req, res) => {
    const { sessionId } = req.params;
    const { numero, to, mediaUrl, mediaBase64, caption, text, type, fileName, mimetype } = req.body;

    const recipient = numero || to;
    if (!recipient || (!mediaUrl && !mediaBase64)) {
        return res.status(400).json({
            success: false,
            error: 'Los parámetros "numero" y ("mediaUrl" o "mediaBase64") son obligatorios.'
        });
    }

    try {
        const isPdf = (fileName && fileName.endsWith('.pdf')) || mimetype === 'application/pdf' || (mediaUrl && mediaUrl.endsWith('.pdf'));
        const result = await sessionManager.sendMessage(sessionId, recipient, caption || text || '', {
            mediaUrl,
            mediaBase64,
            type: type || (isPdf ? 'document' : 'image'),
            fileName: fileName || (isPdf ? 'documento.pdf' : 'archivo.dat'),
            mimetype: mimetype || (isPdf ? 'application/pdf' : 'image/jpeg')
        });

        res.json({
            success: true,
            sessionId,
            ...result
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({
            success: false,
            sessionId,
            error: err.message
        });
    }
});

/**
 * 9. Desvincular y eliminar una sesión
 * POST /sessions/:sessionId/logout o DELETE /sessions/:sessionId
 */
const logoutHandler = async (req, res) => {
    try {
        const result = await sessionManager.deleteSession(req.params.sessionId);
        res.json({
            success: true,
            message: `Sesión '${req.params.sessionId}' cerrada y credenciales eliminadas.`,
            ...result
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
};

app.post('/sessions/:sessionId/logout', logoutHandler);
app.delete('/sessions/:sessionId', logoutHandler);

/**
 * 10. Endpoint heredado /enviar-mensaje (compatibilidad hacia atrás)
 * Busca la sesión indicada en header x-session-id o body.sessionId;
 * si no se especifica, usa la primera sesión conectada o 'default'.
 */
app.post('/enviar-mensaje', async (req, res) => {
    const { numero, mensaje } = req.body;
    let targetSessionId = req.headers['x-session-id'] || req.body.sessionId;

    if (!targetSessionId) {
        // Buscar la primera sesión que esté conectada
        const all = sessionManager.listSessions();
        const connected = all.find((s) => s.status === 'CONNECTED');
        targetSessionId = connected ? connected.sessionId : 'default';
    }

    try {
        const result = await sessionManager.sendMessage(targetSessionId, numero, mensaje);
        return res.status(200).json({
            status: 'success',
            sessionId: targetSessionId,
            message: 'Mensaje enviado exitosamente',
            messageId: result.messageId
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            status: 'error',
            sessionId: targetSessionId,
            error: error.message
        });
    }
});

/**
 * Página principal de bienvenida con guía de uso rápida
 */
app.get('/', (req, res) => {
    const sessions = sessionManager.listSessions();
    res.send(`
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>WhatsApp Multi-Session API</title>
        <style>
          body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
          code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
          pre { background: #1e293b; color: #f8fafc; padding: 14px; border-radius: 8px; overflow-x: auto; }
          .tag { background: #0284c7; color: #fff; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; }
        </style>
      </head>
      <body>
        <h1>🚀 WhatsApp Multi-Session API</h1>
        <p>API REST para conectar múltiples números de WhatsApp simultáneamente con Baileys.</p>
        
        <h3>Sesiones actuales (${sessions.length}):</h3>
        <ul>
          ${sessions.length === 0 ? '<li>Ninguna sesión activa. Crea una en <code>/sessions/TU_NOMBRE/qr-view</code></li>' : ''}
          ${sessions.map((s) => `<li><strong>${s.sessionId}</strong> — Estado: <code>${s.status}</code> ${s.phone ? `(+${s.phone})` : ''} · <a href="/sessions/${s.sessionId}/qr-view">Ver QR</a></li>`).join('')}
        </ul>

        <h3>Cómo conectar un nuevo número:</h3>
        <p>Abre en tu navegador la URL: <br><code>http://localhost:${PORT}/sessions/NOMBRE_DE_SESION/qr-view</code></p>
      </body>
      </html>
    `);
});

// Iniciar servidor y auto-restaurar sesiones previas guardadas
app.listen(PORT, async () => {
    console.log(`====================================================`);
    console.log(` Servidor WhatsApp Multi-Session activo en puerto ${PORT}`);
    console.log(` URL de control: http://localhost:${PORT}/`);
    console.log(`====================================================`);

    await sessionManager.autoRestoreSessions();
});
