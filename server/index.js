require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, "..");
const RESERVAS_FILE = path.join(ROOT_DIR, "reservas.json");
const BLOQUEOS_FILE = path.join(ROOT_DIR, "bloqueos.json");
const UPLOADS_DIR = path.join(ROOT_DIR, "uploads");

const CANCHAS = [1, 2];
const HORA_INICIO = 10;
const HORA_FIN = 23;
const TRANSFER_ALIAS = process.env.TRANSFER_ALIAS || "CANCHAS.FUTBOL.CMR";
const TRANSFER_CBU = process.env.TRANSFER_CBU || "0000003100099999999999";
const TRANSFER_TITULAR = process.env.TRANSFER_TITULAR || "Club CMR Futbol";
const WHATSAPP_NUMERO =
  (process.env.WHATSAPP_NUMERO || "5491112345678").replace(/\D/g, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const adminSessions = new Map();

if (!fsSync.existsSync(UPLOADS_DIR)) {
  fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safeOriginalName = file.originalname
      .replace(/[^\w.\-]/g, "_")
      .toLowerCase();
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e6)}-${safeOriginalName}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error("Solo se permiten imagenes (JPG, PNG, WEBP) o PDF."));
  },
});

app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(path.join(ROOT_DIR, "public")));

function toHorario(hora) {
  return `${String(hora).padStart(2, "0")}:00`;
}

function horarioToNumber(horario) {
  if (!horario) return null;
  const [hh] = String(horario).split(":");
  return Number(hh);
}

function getBloqueoRango(bloqueo) {
  if (bloqueo.diaCompleto) {
    return { desde: HORA_INICIO, hasta: HORA_FIN };
  }
  if (bloqueo.horarioDesde && bloqueo.horarioHasta) {
    return {
      desde: horarioToNumber(bloqueo.horarioDesde),
      hasta: horarioToNumber(bloqueo.horarioHasta),
    };
  }
  const horaUnica = horarioToNumber(bloqueo.horario);
  return { desde: horaUnica, hasta: horaUnica };
}

function bloqueosSeSuperponen(a, b) {
  if (a.diaCompleto || b.diaCompleto) return true;
  const rangoA = getBloqueoRango(a);
  const rangoB = getBloqueoRango(b);
  if (rangoA.desde == null || rangoA.hasta == null) return false;
  if (rangoB.desde == null || rangoB.hasta == null) return false;
  return rangoA.desde <= rangoB.hasta && rangoB.desde <= rangoA.hasta;
}

function generarHorarios() {
  const horarios = [];
  for (let hora = HORA_INICIO; hora <= HORA_FIN; hora += 1) {
    horarios.push(toHorario(hora));
  }
  return horarios;
}

async function readReservas() {
  return readJsonArrayFile(RESERVAS_FILE);
}

async function readBloqueos() {
  return readJsonArrayFile(BLOQUEOS_FILE);
}

async function readJsonArrayFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(filePath, "[]", "utf-8");
      return [];
    }
    throw error;
  }
}

async function writeReservas(reservas) {
  await fs.writeFile(RESERVAS_FILE, JSON.stringify(reservas, null, 2), "utf-8");
}

async function writeBloqueos(bloqueos) {
  await fs.writeFile(BLOQUEOS_FILE, JSON.stringify(bloqueos, null, 2), "utf-8");
}

function isReservaBloqueada(bloqueos, cancha, fecha, horario) {
  const horarioNum = horarioToNumber(horario);
  return bloqueos.some((b) => {
    const matchCancha = b.cancha === cancha;
    const matchFecha = b.fecha === fecha;
    if (!matchCancha || !matchFecha) return false;
    if (b.diaCompleto) return true;
    if (b.horarioDesde && b.horarioHasta) {
      const desde = horarioToNumber(b.horarioDesde);
      const hasta = horarioToNumber(b.horarioHasta);
      return horarioNum >= desde && horarioNum <= hasta;
    }
    const matchHorario = b.horario === horario;
    return matchCancha && matchFecha && matchHorario;
  });
}

function createAdminSession() {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  adminSessions.set(token, expiresAt);
  return token;
}

function isValidAdminToken(token) {
  if (!token) return false;
  const expiresAt = adminSessions.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  const [, token] = auth.split(" ");
  if (!isValidAdminToken(token)) {
    return res.status(401).json({ error: "No autorizado." });
  }
  return next();
}

function validateReservaPayload(body) {
  const nombre = (body.nombre || "").trim();
  const telefono = (body.telefono || "").trim();
  const cancha = Number(body.cancha);
  const fecha = (body.fecha || "").trim();
  const horario = (body.horario || "").trim();

  if (!nombre || nombre.length < 3) {
    return "El nombre y apellido es obligatorio.";
  }
  if (!telefono || telefono.length < 6) {
    return "El telefono es obligatorio.";
  }
  if (!CANCHAS.includes(cancha)) {
    return "Cancha invalida.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return "Fecha invalida.";
  }
  if (!generarHorarios().includes(horario)) {
    return "Horario invalido.";
  }
  return null;
}

app.get("/api/config", (_req, res) => {
  res.json({
    canchas: CANCHAS,
    horarios: generarHorarios(),
    transferencia: {
      alias: TRANSFER_ALIAS,
      cbu: TRANSFER_CBU,
      titular: TRANSFER_TITULAR,
    },
    whatsappNumero: WHATSAPP_NUMERO,
  });
});

app.post("/api/admin/login", (req, res) => {
  const password = (req.body?.password || "").trim();
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Clave de admin incorrecta." });
  }
  const token = createAdminSession();
  return res.json({ token, expiresInMs: ADMIN_SESSION_TTL_MS });
});

app.get("/api/reservas", async (req, res, next) => {
  try {
    const fecha = (req.query.fecha || "").trim();
    const cancha = req.query.cancha ? Number(req.query.cancha) : null;
    const reservas = await readReservas();

    const filtered = reservas.filter((r) => {
      const fechaOk = fecha ? r.fecha === fecha : true;
      const canchaOk = cancha ? r.cancha === cancha : true;
      return fechaOk && canchaOk;
    });

    res.json(filtered);
  } catch (error) {
    next(error);
  }
});

app.get("/api/bloqueos", async (req, res, next) => {
  try {
    const fecha = (req.query.fecha || "").trim();
    const cancha = req.query.cancha ? Number(req.query.cancha) : null;
    const bloqueos = await readBloqueos();
    const filtered = bloqueos.filter((b) => {
      const fechaOk = fecha ? b.fecha === fecha : true;
      const canchaOk = cancha ? b.cancha === cancha : true;
      return fechaOk && canchaOk;
    });
    res.json(filtered);
  } catch (error) {
    next(error);
  }
});

app.post("/reservas", upload.single("comprobante"), async (req, res, next) => {
  try {
    const validationError = validateReservaPayload(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Debes subir un comprobante." });
    }

    const nombre = req.body.nombre.trim();
    const telefono = req.body.telefono.trim();
    const cancha = Number(req.body.cancha);
    const fecha = req.body.fecha.trim();
    const horario = req.body.horario.trim();

    const reservas = await readReservas();
    const bloqueos = await readBloqueos();
    const ocupado = reservas.some(
      (r) => r.cancha === cancha && r.fecha === fecha && r.horario === horario
    );
    const bloqueado = isReservaBloqueada(bloqueos, cancha, fecha, horario);

    if (ocupado) {
      return res
        .status(409)
        .json({ error: "Ese horario ya fue reservado. Elegi otro." });
    }
    if (bloqueado) {
      return res
        .status(409)
        .json({ error: "Ese horario esta bloqueado por administracion." });
    }

    const reserva = {
      id: Date.now(),
      nombre,
      telefono,
      cancha,
      fecha,
      horario,
      comprobante: {
        nombreOriginal: req.file.originalname,
        archivo: req.file.filename,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
      creadoEn: new Date().toISOString(),
    };

    const comprobanteUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;

    reservas.push(reserva);
    await writeReservas(reservas);

    return res.status(201).json({
      ...reserva,
      comprobanteUrl,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/reservas", requireAdmin, async (_req, res, next) => {
  try {
    const reservas = await readReservas();
    const reservasConLink = reservas.map((r) => ({
      ...r,
      comprobanteUrl: `/uploads/${r.comprobante.archivo}`,
    }));
    res.json(reservasConLink);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/reservas/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const reservas = await readReservas();
    const index = reservas.findIndex((r) => Number(r.id) === id);
    if (index === -1) {
      return res.status(404).json({ error: "Reserva no encontrada." });
    }
    const [eliminada] = reservas.splice(index, 1);
    await writeReservas(reservas);
    return res.json({ ok: true, reserva: eliminada });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/bloqueos", requireAdmin, async (_req, res, next) => {
  try {
    const bloqueos = await readBloqueos();
    res.json(bloqueos);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/bloqueos", requireAdmin, async (req, res, next) => {
  try {
    const cancha = Number(req.body.cancha);
    const fecha = (req.body.fecha || "").trim();
    const horario = (req.body.horario || "").trim();
    const horarioDesde = (req.body.horarioDesde || "").trim();
    const horarioHasta = (req.body.horarioHasta || "").trim();
    const motivo = (req.body.motivo || "").trim() || "Bloqueado por administracion";
    const diaCompleto = Boolean(req.body.diaCompleto);
    const horariosValidos = generarHorarios();

    if (!CANCHAS.includes(cancha)) {
      return res.status(400).json({ error: "Cancha invalida." });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: "Fecha invalida." });
    }
    const tieneRango = Boolean(horarioDesde && horarioHasta);
    if (!diaCompleto && tieneRango) {
      if (!horariosValidos.includes(horarioDesde) || !horariosValidos.includes(horarioHasta)) {
        return res.status(400).json({ error: "Rango horario invalido." });
      }
      if (horarioToNumber(horarioDesde) > horarioToNumber(horarioHasta)) {
        return res.status(400).json({ error: "El horario desde no puede ser mayor al hasta." });
      }
    } else if (!diaCompleto && !horariosValidos.includes(horario)) {
      return res.status(400).json({ error: "Horario invalido." });
    }

    const bloqueos = await readBloqueos();
    const nuevoBloqueo = {
      cancha,
      fecha,
      diaCompleto,
      horario: diaCompleto ? null : tieneRango ? null : horario,
      horarioDesde: diaCompleto ? null : tieneRango ? horarioDesde : null,
      horarioHasta: diaCompleto ? null : tieneRango ? horarioHasta : null,
    };
    const yaExiste = bloqueos.some((b) => {
      const mismaCanchaYFecha = b.cancha === cancha && b.fecha === fecha;
      return mismaCanchaYFecha && bloqueosSeSuperponen(b, nuevoBloqueo);
    });

    if (yaExiste) {
      return res.status(409).json({ error: "Ese bloqueo se superpone con otro ya existente." });
    }

    const bloqueo = {
      id: Date.now(),
      cancha,
      fecha,
      horario: nuevoBloqueo.horario,
      horarioDesde: nuevoBloqueo.horarioDesde,
      horarioHasta: nuevoBloqueo.horarioHasta,
      diaCompleto,
      motivo,
      creadoEn: new Date().toISOString(),
    };

    bloqueos.push(bloqueo);
    await writeBloqueos(bloqueos);
    return res.status(201).json(bloqueo);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/bloqueos/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bloqueos = await readBloqueos();
    const index = bloqueos.findIndex((b) => Number(b.id) === id);
    if (index === -1) {
      return res.status(404).json({ error: "Bloqueo no encontrado." });
    }
    const [eliminado] = bloqueos.splice(index, 1);
    await writeBloqueos(bloqueos);
    return res.json({ ok: true, bloqueo: eliminado });
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "El comprobante supera 5MB. Subi un archivo mas liviano." });
    }
    return res.status(400).json({ error: "Error al subir comprobante." });
  }
  if (err.message) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: "Error interno del servidor." });
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
