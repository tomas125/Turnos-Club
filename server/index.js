const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");
const multer = require("multer");
const fs = require("fs/promises");
const fsSync = require("fs");
const crypto = require("crypto");
let kv = null;
try {
  ({ kv } = require("@vercel/kv"));
} catch (_error) {
  kv = null;
}
let sqlite3 = null;
try {
  sqlite3 = require("sqlite3").verbose();
} catch (_error) {
  sqlite3 = null;
}
let supabase = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const { createClient } = require("@supabase/supabase-js");
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
} catch (_error) {
  supabase = null;
}

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, "..");
const IS_VERCEL = process.env.VERCEL === "1";
const DATA_DIR = IS_VERCEL ? path.join("/tmp", "reservas-turno-data") : ROOT_DIR;
const DB_FILE = process.env.SQLITE_PATH || path.join(DATA_DIR, "reservas.sqlite");
const RESERVAS_FILE = path.join(DATA_DIR, "reservas.json");
const BLOQUEOS_FILE = path.join(DATA_DIR, "bloqueos.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

const CANCHAS = [1, 2];
const HORA_INICIO = 10;
const HORA_FIN = 23;
const TRANSFER_ALIAS = process.env.TRANSFER_ALIAS || "CANCHAS.FUTBOL.CMR";
const TRANSFER_CBU = process.env.TRANSFER_CBU || "0000003100099999999999";
const TRANSFER_TITULAR = process.env.TRANSFER_TITULAR || "Club CMR Futbol";
const WHATSAPP_NUMERO =
  (process.env.WHATSAPP_NUMERO || "5491112345678").replace(/\D/g, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PASSWORD;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const USE_SUPABASE = Boolean(supabase);
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "comprobantes";
const USE_KV =
  !USE_SUPABASE &&
  Boolean(kv) &&
  Boolean(process.env.KV_REST_API_URL) &&
  Boolean(process.env.KV_REST_API_TOKEN);
const KV_RESERVAS_KEY = "reservas";
const KV_BLOQUEOS_KEY = "bloqueos";

if (!fsSync.existsSync(DATA_DIR)) {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fsSync.existsSync(UPLOADS_DIR)) {
  fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const USE_SQLITE = !USE_SUPABASE && Boolean(sqlite3);
const db = USE_SQLITE ? new sqlite3.Database(DB_FILE) : null;

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

async function initDb() {
  if (!USE_SQLITE) return;
  await dbRun(`
    CREATE TABLE IF NOT EXISTS reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      telefono TEXT NOT NULL,
      cancha INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      horario TEXT NOT NULL,
      comprobante_nombre_original TEXT NOT NULL,
      comprobante_archivo TEXT NOT NULL,
      comprobante_mimetype TEXT NOT NULL,
      comprobante_size INTEGER NOT NULL,
      creado_en TEXT NOT NULL
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS bloqueos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cancha INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      horario TEXT,
      horario_desde TEXT,
      horario_hasta TEXT,
      dia_completo INTEGER NOT NULL,
      motivo TEXT NOT NULL,
      creado_en TEXT NOT NULL
    )
  `);
}

const dbReady = initDb();

const storage = USE_SUPABASE
  ? multer.memoryStorage()
  : multer.diskStorage({
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
app.use(async (_req, _res, next) => {
  try {
    await dbReady;
    next();
  } catch (error) {
    next(error);
  }
});

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

function mapReservaRow(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    telefono: row.telefono,
    cancha: row.cancha,
    fecha: row.fecha,
    horario: row.horario,
    comprobante: {
      nombreOriginal: row.comprobante_nombre_original,
      archivo: row.comprobante_archivo,
      mimetype: row.comprobante_mimetype,
      size: row.comprobante_size,
    },
    creadoEn: row.creado_en,
  };
}

function mapBloqueoRow(row) {
  return {
    id: row.id,
    cancha: row.cancha,
    fecha: row.fecha,
    horario: row.horario,
    horarioDesde: row.horario_desde,
    horarioHasta: row.horario_hasta,
    diaCompleto: Boolean(row.dia_completo),
    motivo: row.motivo,
    creadoEn: row.creado_en,
  };
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

async function writeJsonArrayFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function readKvArray(key) {
  const data = await kv.get(key);
  return Array.isArray(data) ? data : [];
}

async function writeKvArray(key, data) {
  await kv.set(key, data);
}

async function readReservas({ fecha = "", cancha = null } = {}) {
  if (USE_SUPABASE) {
    let query = supabase
      .from("reservas")
      .select("*")
      .order("fecha", { ascending: true })
      .order("horario", { ascending: true });
    if (fecha) query = query.eq("fecha", fecha);
    if (cancha) query = query.eq("cancha", Number(cancha));
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data.map(mapReservaRow);
  }
  if (USE_KV) {
    const reservas = await readKvArray(KV_RESERVAS_KEY);
    return reservas.filter((r) => {
      const fechaOk = fecha ? r.fecha === fecha : true;
      const canchaOk = cancha ? Number(r.cancha) === Number(cancha) : true;
      return fechaOk && canchaOk;
    });
  }
  if (!USE_SQLITE) {
    const reservas = await readJsonArrayFile(RESERVAS_FILE);
    return reservas.filter((r) => {
      const fechaOk = fecha ? r.fecha === fecha : true;
      const canchaOk = cancha ? Number(r.cancha) === Number(cancha) : true;
      return fechaOk && canchaOk;
    });
  }
  const where = [];
  const params = [];
  if (fecha) {
    where.push("fecha = ?");
    params.push(fecha);
  }
  if (cancha) {
    where.push("cancha = ?");
    params.push(cancha);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await dbAll(
    `SELECT * FROM reservas ${whereSql} ORDER BY fecha ASC, horario ASC, id DESC`,
    params
  );
  return rows.map(mapReservaRow);
}

async function readBloqueos({ fecha = "", cancha = null } = {}) {
  if (USE_SUPABASE) {
    let query = supabase
      .from("bloqueos")
      .select("*")
      .order("fecha", { ascending: true });
    if (fecha) query = query.eq("fecha", fecha);
    if (cancha) query = query.eq("cancha", Number(cancha));
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data.map(mapBloqueoRow);
  }
  if (USE_KV) {
    const bloqueos = await readKvArray(KV_BLOQUEOS_KEY);
    return bloqueos
      .map((b) => ({ ...b, diaCompleto: Boolean(b.diaCompleto) }))
      .filter((b) => {
        const fechaOk = fecha ? b.fecha === fecha : true;
        const canchaOk = cancha ? Number(b.cancha) === Number(cancha) : true;
        return fechaOk && canchaOk;
      });
  }
  if (!USE_SQLITE) {
    const bloqueos = await readJsonArrayFile(BLOQUEOS_FILE);
    return bloqueos
      .map((b) => ({ ...b, diaCompleto: Boolean(b.diaCompleto) }))
      .filter((b) => {
        const fechaOk = fecha ? b.fecha === fecha : true;
        const canchaOk = cancha ? Number(b.cancha) === Number(cancha) : true;
        return fechaOk && canchaOk;
      });
  }
  const where = [];
  const params = [];
  if (fecha) {
    where.push("fecha = ?");
    params.push(fecha);
  }
  if (cancha) {
    where.push("cancha = ?");
    params.push(cancha);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await dbAll(
    `SELECT * FROM bloqueos ${whereSql} ORDER BY fecha ASC, id DESC`,
    params
  );
  return rows.map(mapBloqueoRow);
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
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  const payload = String(expiresAt);
  const signature = crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

function isValidAdminToken(token) {
  if (!token) return false;
  const [payload, providedSignature] = String(token).split(".");
  if (!payload || !providedSignature) return false;
  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(payload)
    .digest("hex");
  if (providedSignature !== expectedSignature) return false;
  return Date.now() <= Number(payload);
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
    const reservas = await readReservas({ fecha, cancha });
    res.json(reservas);
  } catch (error) {
    next(error);
  }
});

app.get("/api/bloqueos", async (req, res, next) => {
  try {
    const fecha = (req.query.fecha || "").trim();
    const cancha = req.query.cancha ? Number(req.query.cancha) : null;
    const bloqueos = await readBloqueos({ fecha, cancha });
    res.json(bloqueos);
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

    const creadoEn = new Date().toISOString();
    let comprobanteUrl;
    let comprobanteArchivo;
    let reservaId;

    if (USE_SUPABASE) {
      const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
      const storagePath = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);
      const { data: urlData } = supabase.storage
        .from(SUPABASE_BUCKET)
        .getPublicUrl(storagePath);
      comprobanteArchivo = storagePath;
      comprobanteUrl = urlData.publicUrl;
      const { data: insertData, error: insertError } = await supabase
        .from("reservas")
        .insert({
          nombre,
          telefono,
          cancha,
          fecha,
          horario,
          comprobante_nombre_original: req.file.originalname,
          comprobante_archivo: storagePath,
          comprobante_mimetype: req.file.mimetype,
          comprobante_size: req.file.size,
          creado_en: creadoEn,
        })
        .select()
        .single();
      if (insertError) throw new Error(insertError.message);
      reservaId = insertData.id;
    } else if (USE_KV) {
      comprobanteArchivo = req.file.filename;
      comprobanteUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
      const reservasAll = await readKvArray(KV_RESERVAS_KEY);
      reservaId =
        reservasAll.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
      reservasAll.push({
        id: reservaId,
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
        creadoEn,
      });
      await writeKvArray(KV_RESERVAS_KEY, reservasAll);
    } else if (USE_SQLITE) {
      comprobanteArchivo = req.file.filename;
      comprobanteUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
      const insertResult = await dbRun(
        `INSERT INTO reservas
        (nombre, telefono, cancha, fecha, horario, comprobante_nombre_original, comprobante_archivo, comprobante_mimetype, comprobante_size, creado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nombre,
          telefono,
          cancha,
          fecha,
          horario,
          req.file.originalname,
          req.file.filename,
          req.file.mimetype,
          req.file.size,
          creadoEn,
        ]
      );
      reservaId = insertResult.lastID;
    } else {
      comprobanteArchivo = req.file.filename;
      comprobanteUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
      const reservasAll = await readJsonArrayFile(RESERVAS_FILE);
      reservaId =
        reservasAll.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
      reservasAll.push({
        id: reservaId,
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
        creadoEn,
      });
      await writeJsonArrayFile(RESERVAS_FILE, reservasAll);
    }

    const reserva = {
      id: reservaId,
      nombre,
      telefono,
      cancha,
      fecha,
      horario,
      comprobante: {
        nombreOriginal: req.file.originalname,
        archivo: comprobanteArchivo,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
      creadoEn,
    };

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
      comprobanteUrl: USE_SUPABASE
        ? supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(r.comprobante.archivo).data.publicUrl
        : `/uploads/${r.comprobante.archivo}`,
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
    const eliminada = reservas.find((r) => Number(r.id) === id);
    if (!eliminada) {
      return res.status(404).json({ error: "Reserva no encontrada." });
    }
    if (USE_SUPABASE) {
      await supabase.storage.from(SUPABASE_BUCKET).remove([eliminada.comprobante.archivo]);
      const { error } = await supabase.from("reservas").delete().eq("id", id);
      if (error) throw new Error(error.message);
    } else if (USE_KV) {
      const reservasAll = await readKvArray(KV_RESERVAS_KEY);
      const restantes = reservasAll.filter((r) => Number(r.id) !== id);
      await writeKvArray(KV_RESERVAS_KEY, restantes);
    } else if (USE_SQLITE) {
      await dbRun("DELETE FROM reservas WHERE id = ?", [id]);
    } else {
      const reservasAll = await readJsonArrayFile(RESERVAS_FILE);
      const restantes = reservasAll.filter((r) => Number(r.id) !== id);
      await writeJsonArrayFile(RESERVAS_FILE, restantes);
    }
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

    const creadoEn = new Date().toISOString();
    let bloqueoId;
    if (USE_SUPABASE) {
      const { data: insertData, error: insertError } = await supabase
        .from("bloqueos")
        .insert({
          cancha,
          fecha,
          horario: nuevoBloqueo.horario,
          horario_desde: nuevoBloqueo.horarioDesde,
          horario_hasta: nuevoBloqueo.horarioHasta,
          dia_completo: diaCompleto,
          motivo,
          creado_en: creadoEn,
        })
        .select()
        .single();
      if (insertError) throw new Error(insertError.message);
      bloqueoId = insertData.id;
    } else if (USE_KV) {
      const bloqueosAll = await readKvArray(KV_BLOQUEOS_KEY);
      bloqueoId =
        bloqueosAll.reduce((max, b) => Math.max(max, Number(b.id) || 0), 0) + 1;
      bloqueosAll.push({
        id: bloqueoId,
        cancha,
        fecha,
        horario: nuevoBloqueo.horario,
        horarioDesde: nuevoBloqueo.horarioDesde,
        horarioHasta: nuevoBloqueo.horarioHasta,
        diaCompleto,
        motivo,
        creadoEn,
      });
      await writeKvArray(KV_BLOQUEOS_KEY, bloqueosAll);
    } else if (USE_SQLITE) {
      const insertResult = await dbRun(
        `INSERT INTO bloqueos
        (cancha, fecha, horario, horario_desde, horario_hasta, dia_completo, motivo, creado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cancha,
          fecha,
          nuevoBloqueo.horario,
          nuevoBloqueo.horarioDesde,
          nuevoBloqueo.horarioHasta,
          diaCompleto ? 1 : 0,
          motivo,
          creadoEn,
        ]
      );
      bloqueoId = insertResult.lastID;
    } else {
      const bloqueosAll = await readJsonArrayFile(BLOQUEOS_FILE);
      bloqueoId =
        bloqueosAll.reduce((max, b) => Math.max(max, Number(b.id) || 0), 0) + 1;
      bloqueosAll.push({
        id: bloqueoId,
        cancha,
        fecha,
        horario: nuevoBloqueo.horario,
        horarioDesde: nuevoBloqueo.horarioDesde,
        horarioHasta: nuevoBloqueo.horarioHasta,
        diaCompleto,
        motivo,
        creadoEn,
      });
      await writeJsonArrayFile(BLOQUEOS_FILE, bloqueosAll);
    }

    const bloqueo = {
      id: bloqueoId,
      cancha,
      fecha,
      horario: nuevoBloqueo.horario,
      horarioDesde: nuevoBloqueo.horarioDesde,
      horarioHasta: nuevoBloqueo.horarioHasta,
      diaCompleto,
      motivo,
      creadoEn,
    };
    return res.status(201).json(bloqueo);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/bloqueos/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bloqueos = await readBloqueos();
    const eliminado = bloqueos.find((b) => Number(b.id) === id);
    if (!eliminado) {
      return res.status(404).json({ error: "Bloqueo no encontrado." });
    }
    if (USE_SUPABASE) {
      const { error } = await supabase.from("bloqueos").delete().eq("id", id);
      if (error) throw new Error(error.message);
    } else if (USE_KV) {
      const bloqueosAll = await readKvArray(KV_BLOQUEOS_KEY);
      const restantes = bloqueosAll.filter((b) => Number(b.id) !== id);
      await writeKvArray(KV_BLOQUEOS_KEY, restantes);
    } else if (USE_SQLITE) {
      await dbRun("DELETE FROM bloqueos WHERE id = ?", [id]);
    } else {
      const bloqueosAll = await readJsonArrayFile(BLOQUEOS_FILE);
      const restantes = bloqueosAll.filter((b) => Number(b.id) !== id);
      await writeJsonArrayFile(BLOQUEOS_FILE, restantes);
    }
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
  });
}

module.exports = app;
