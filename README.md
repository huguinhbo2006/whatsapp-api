# 🚀 WhatsApp Multi-Session API (Baileys + Express)

Microservicio API REST diseñado en **Node.js** con **Express** y **`@whiskeysockets/baileys`** que permite **conectar y gestionar múltiples números y cuentas de WhatsApp simultáneamente** desde un solo servidor.

Ideal para sistemas multi-empresa, sucursales (ej. varias taquerías o negocios) o departamentos independientes.

---

## 🌟 Características Principales

* **Multiusuario & Multisesión:** Conecta tantos números de WhatsApp como requieras (cada uno identificado por un `sessionId` e.g. `taqueria_mary`, `sucursal_norte`, `usuario_10`).
* **Ultra Liviano:** Basado en WebSockets directos. Consume solo ~30 MB de RAM por cuenta conectada (a diferencia de Chromium/Puppeteer).
* **Persistencia Independiente:** Cada número almacena sus credenciales en `sessions/<sessionId>/`.
* **Reconexión Automática:** Al reiniciar el servidor o contenedor, todas las cuentas previamente vinculadas se reconectan automáticamente.
* **Visor Web de QR en Tiempo Real (`/sessions/:sessionId/qr-view`):** Permite a cualquier usuario o administrador abrir un enlace en el navegador, escanear el QR con su celular y ver confirmación instantánea sin mirar los logs de la consola.
* **Envío de Texto y Multimedia:** Soporta envío de texto plano, imágenes y comprobantes/tickets en formato PDF.

---

## 🚀 Inicio Rápido Local

1. **Instalar dependencias:**
   ```bash
   cd whatsapp-api
   npm install
   ```
2. **Iniciar el servidor:**
   ```bash
   npm start
   ```
3. El servidor iniciará en `http://localhost:3000`.

---

## 📱 Cómo Vincular un Número de WhatsApp

Solo abre en tu navegador:
```
http://localhost:3000/sessions/NOMBRE_DE_SESION/qr-view
```
*(Reemplaza `NOMBRE_DE_SESION` con el identificador que desees, por ejemplo `taqueria_mary` o `pedidos_1`)*.

1. Aparecerá el código QR en la pantalla.
2. Abre WhatsApp en tu celular -> **Dispositivos vinculados** -> **Vincular un dispositivo**.
3. Escanea el código en pantalla.
4. La página se actualizará automáticamente a **✅ ¡Conectado con éxito!** mostrando el número vinculado.

---

## 📡 Endpoints de la API REST

### 1. Estado Global del Sistema
* **`GET /health`**
  * Devuelve el estado general del servidor y el conteo de sesiones activas.

### 2. Listar Todas las Sesiones
* **`GET /sessions`**
  * Retorna todas las sesiones activas, su estado (`CONNECTED`, `QR_READY`, `DISCONNECTED`), teléfono vinculado y fecha de conexión.

### 3. Iniciar Sesión / Solicitar QR en JSON
* **`POST /sessions/:sessionId/start`**
* **`GET /sessions/:sessionId/qr`**
  * Respuesta:
    ```json
    {
      "sessionId": "taqueria_mary",
      "status": "QR_READY",
      "qrRaw": "2@4N1...==",
      "qrImage": "data:image/png;base64,iVBORw..."
    }
    ```

### 4. Consultar Estado de una Sesión Específica
* **`GET /sessions/:sessionId/status`**
  * Devuelve si la sesión está conectada, el número de teléfono y el nombre del perfil de WhatsApp.

### 5. Enviar Mensaje de Texto
* **`POST /sessions/:sessionId/send-message`**
* **Body (JSON):**
  ```json
  {
    "numero": "5213312345678",
    "mensaje": "¡Hola! Tu pedido de tacos ya va en camino 🌮🛵"
  }
  ```

### 6. Enviar Archivo / PDF / Imagen
* **`POST /sessions/:sessionId/send-media`**
* **Body (JSON):**
  ```json
  {
    "numero": "5213312345678",
    "mediaUrl": "https://api-pedidos.taqueriamary.com/orders/12/pdf",
    "caption": "Adjunto tu comprobante de compra en PDF",
    "fileName": "ticket-pedido.pdf",
    "mimetype": "application/pdf"
  }
  ```

### 7. Desvincular / Cerrar Sesión
* **`POST /sessions/:sessionId/logout`** o **`DELETE /sessions/:sessionId`**
  * Cierra la conexión de WhatsApp de esa cuenta y elimina permanentemente sus credenciales en disco.

---

## ☁️ Despliegue en Railway.app

Para mantener todos los números vinculados tras cada redespliegue en Railway:

1. En tu panel de Railway, ve a tu servicio -> **Settings** -> **Volumes**.
2. Haz clic en **Mount Volume**.
3. Configura:
   * **Mount Path:** `/app/sessions`
4. ¡Listo! Cualquier sesión guardada en `/app/sessions` persistirá indefinidamente.
