# Reservas de Canchas - App Web Simple

Aplicacion web para reservar turnos de 2 canchas de futbol.

## Stack

- Frontend: HTML, CSS, JavaScript (sin frameworks)
- Backend: Node.js + Express
- Almacenamiento: SQLite (`reservas.sqlite`)
- Subida de comprobantes: `multer` en carpeta `uploads`

## Estructura

- `public/` -> frontend
- `server/` -> backend Express
- `uploads/` -> comprobantes subidos
- `reservas.sqlite` -> base SQLite de reservas y bloqueos

## Instalacion

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. Crear archivo `.env` (copiar desde `.env.example`) y completar datos reales:

   ```env
   PORT=3000
   SQLITE_PATH=
   WHATSAPP_NUMERO=54911XXXXXXXX
   TRANSFER_ALIAS=tu.alias.real
   TRANSFER_CBU=tu.cbu.real
   TRANSFER_TITULAR=Nombre y Apellido
   ADMIN_PASSWORD=tu_clave_admin
   ```

3. Iniciar servidor:

   ```bash
   npm start
   ```

4. Abrir en el navegador:

   [http://localhost:3000](http://localhost:3000)

## API

### `POST /reservas`

Guarda una reserva y el comprobante.

Campos esperados (multipart/form-data):

- `nombre`
- `telefono`
- `cancha` (1 o 2)
- `fecha` (YYYY-MM-DD)
- `horario` (10:00 a 23:00)
- `comprobante` (JPG, PNG, WEBP o PDF, max 5MB)

### `GET /api/reservas?cancha=1&fecha=2026-05-01`

Devuelve reservas filtradas para bloquear horarios ocupados.

### `GET /api/config`

Devuelve configuracion basica (horarios, transferencia, numero WhatsApp).

### Panel administrador

- URL: [http://localhost:3000/admin.html](http://localhost:3000/admin.html)
- Login con `ADMIN_PASSWORD`
- Funciones:
  - Ver reservas con enlace al comprobante
  - Cancelar turnos (solo admin)
  - Crear bloqueos por cancha (dia completo o por horario)
  - Quitar bloqueos

## Notas

- Los horarios ocupados se muestran en gris y no se pueden seleccionar.
- Los horarios bloqueados por admin se muestran en color distinto y no se pueden seleccionar.
- Al reservar, se genera enlace `wa.me` con el mensaje prearmado y se redirige automaticamente.
- El comprobante se guarda en el servidor, pero no puede adjuntarse automaticamente a WhatsApp Web.
- `WHATSAPP_NUMERO` debe ir en formato internacional sin `+`, espacios ni guiones.
- Si no defines `SQLITE_PATH`, la app usa `reservas.sqlite` en la carpeta del proyecto (en Vercel queda en `/tmp`).
- Si un usuario quiere cancelar, lo solicita por WhatsApp y el admin decide la cancelacion desde el panel.
