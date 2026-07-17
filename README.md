# WhatsApp Baileys Notifications Service

Este es un microservicio API REST diseñado en Node.js con Express y la librería oficial `@whiskeysockets/baileys` para automatizar el envío de notificaciones y mensajes de WhatsApp directamente desde sistemas externos (como backends en Laravel u otros). 

Está optimizado para desplegarse fácilmente en **Railway.app** y utiliza persistencia local para almacenar la sesión de WhatsApp, evitando la necesidad de escanear el código QR en cada despliegue.

## Requisitos Previos

- Node.js v18 o superior
- Un número de WhatsApp disponible para vincular (se recomienda usar un número secundario exclusivo para notificaciones para prevenir suspensiones).

## Instalación Local

1. Clona este repositorio o copia los archivos en tu entorno local.
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Ejecuta el servidor de desarrollo:
   ```bash
   npm start
   ```
4. Observa la consola de tu terminal. Se imprimirá un código QR. Escanéalo con tu app de WhatsApp desde **Dispositivos Vinculados**.
5. Una vez conectado, el servidor creará una carpeta llamada `auth_info/` que contiene las credenciales de tu sesión. **¡No compartas ni subas esta carpeta a repositorios públicos!** (Ya está excluida en el `.gitignore`).

---

## Despliegue en Railway.app

Para desplegar este microservicio de forma persistente en Railway y evitar tener que volver a escanear el QR tras cada redespliegue, sigue estos pasos:

### 1. Crear el Servicio en Railway
1. Sube este repositorio a GitHub (asegúrate de que `node_modules` y `auth_info` estén en tu `.gitignore`).
2. En tu panel de Railway, haz clic en **New Project** -> **Deploy from GitHub repo** y selecciona tu repositorio.

### 2. Configurar el Volumen Persistente (Crucial)
Dado que el contenedor de Railway es efímero y se destruye en cada despliegue, debemos asociar un volumen persistente (Railway Volume) para mantener la carpeta de sesión:
1. Dentro del servicio creado en Railway, ve a la pestaña **Settings**.
2. Desplázate hasta la sección **Volumes** y haz clic en **Mount Volume**.
3. Configura los siguientes parámetros:
   - **Volume Name**: `whatsapp-auth-volume` (o el nombre que prefieras).
   - **Mount Path**: `/app/auth_info` (o la ruta correspondiente al directorio de trabajo en producción. Por defecto, en contenedores de Node.js en Railway es `/app/auth_info`).
4. Haz clic en **Create**. Railway reiniciará el contenedor automáticamente con el volumen montado.

### 3. Escanear el QR Inicial en Railway
1. Una vez que el servicio esté corriendo en Railway, ve a la pestaña **Logs** del servicio.
2. Verás el código QR impreso en los registros de Railway.
3. Abre WhatsApp en tu teléfono, ve a **Dispositivos vinculados** -> **Vincular dispositivo** y escanea el QR desde la consola de Railway.
4. Al vincularse exitosamente, la sesión se guardará directamente en el volumen persistente y no tendrás que volver a escanearlo aunque se redespliegue tu código.

---

## Uso de la API REST

### 1. Health Check (Monitoreo)
Permite comprobar si el servicio está activo y si la sesión de WhatsApp está conectada.

- **Método:** `GET`
- **Ruta:** `/health`
- **Respuesta Exitosa (200 OK):**
  ```json
  {
    "status": "OK",
    "whatsapp": "CONECTADO",
    "esperando_qr": false
  }
  ```

### 2. Enviar Mensaje (Laravel u otro backend)
Envía un mensaje de texto a un destinatario determinado.

- **Método:** `POST`
- **Ruta:** `/enviar-mensaje`
- **Cuerpo de la Petición (JSON):**
  ```json
  {
    "numero": "5215512345678",
    "mensaje": "¡Hola! Tu pedido #10435 ha sido enviado con éxito."
  }
  ```
  *(Nota: El número puede contener espacios, guiones o signos '+', ya que la API se encarga de limpiarlos e interpretarlos de forma segura al formato JID).*

- **Respuestas:**
  - **200 OK:** Mensaje enviado correctamente.
    ```json
    {
      "status": "success",
      "message": "Mensaje enviado con éxito",
      "data": {
        "id": "BAE5A23C89B10D7E",
        "destinatario": "5215512345678@s.whatsapp.net"
      }
    }
    ```
  - **400 Bad Request:** Falta algún parámetro obligatorio o número inválido.
  - **503 Service Unavailable:** El bot no se encuentra conectado o sincronizado con WhatsApp.
  - **500 Internal Server Error:** Ocurrió un fallo en el envío.
