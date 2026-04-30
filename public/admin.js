const loginCard = document.getElementById("loginCard");
const adminPanel = document.getElementById("adminPanel");
const adminPassword = document.getElementById("adminPassword");
const btnLogin = document.getElementById("btnLogin");
const btnLogout = document.getElementById("btnLogout");
const loginMessage = document.getElementById("loginMessage");
const adminMessage = document.getElementById("adminMessage");
const bloqCancha = document.getElementById("bloqCancha");
const bloqFecha = document.getElementById("bloqFecha");
const bloqHorarioDesde = document.getElementById("bloqHorarioDesde");
const bloqHorarioHasta = document.getElementById("bloqHorarioHasta");
const bloqDiaCompleto = document.getElementById("bloqDiaCompleto");
const bloqMotivo = document.getElementById("bloqMotivo");
const btnCrearBloqueo = document.getElementById("btnCrearBloqueo");
const bloqueosList = document.getElementById("bloqueosList");
const reservasList = document.getElementById("reservasList");

let config = null;
let adminToken = localStorage.getItem("adminToken") || "";

function todayISO() {
  const date = new Date();
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date - tzOffset).toISOString().split("T")[0];
}

function formatFecha(fechaIso) {
  const [yyyy, mm, dd] = fechaIso.split("-");
  return `${dd}/${mm}/${yyyy}`;
}

function setMessage(el, text, isError = true) {
  el.textContent = text;
  el.style.color = isError ? "#c62020" : "#1d6d2b";
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Error de servidor.");
  }
  return data;
}

async function loadConfig() {
  config = await api("/api/config");
  const options = config.horarios
    .map((h) => `<option value="${h}">${h}</option>`)
    .join("");
  bloqHorarioDesde.innerHTML = options;
  bloqHorarioHasta.innerHTML = options;
}

function renderReservas(reservas) {
  if (!reservas.length) {
    reservasList.innerHTML = "<p>No hay reservas.</p>";
    return;
  }
  reservasList.innerHTML = reservas
    .map(
      (r) => `
      <article class="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p><strong>${r.nombre}</strong> - ${r.telefono}</p>
        <p>Cancha ${r.cancha} - ${formatFecha(r.fecha)} - ${r.horario}</p>
        <p>
          <a href="${r.comprobanteUrl}" target="_blank" rel="noopener noreferrer">Ver comprobante</a>
        </p>
        <button class="mt-1 rounded-lg bg-red-700 px-3 py-2 font-semibold text-white hover:bg-red-800" data-action="cancelar" data-id="${r.id}" type="button">
          Cancelar turno
        </button>
      </article>
    `
    )
    .join("");
}

function renderBloqueos(bloqueos) {
  if (!bloqueos.length) {
    bloqueosList.innerHTML = "<p>No hay bloqueos activos.</p>";
    return;
  }
  bloqueosList.innerHTML = bloqueos
    .map(
      (b) => `
      <article class="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p><strong>Cancha ${b.cancha}</strong> - ${formatFecha(b.fecha)}</p>
        <p>${describeBloqueoHorario(b)}</p>
        <p>Motivo: ${b.motivo}</p>
        <button class="mt-1 rounded-lg bg-red-700 px-3 py-2 font-semibold text-white hover:bg-red-800" data-action="quitar-bloqueo" data-id="${b.id}" type="button">
          Quitar bloqueo
        </button>
      </article>
    `
    )
    .join("");
}

function describeBloqueoHorario(bloqueo) {
  if (bloqueo.diaCompleto) return "Dia completo";
  if (bloqueo.horarioDesde && bloqueo.horarioHasta) {
    return `Horario ${bloqueo.horarioDesde} a ${bloqueo.horarioHasta}`;
  }
  return `Horario ${bloqueo.horario}`;
}

async function refreshAdminData() {
  const [reservas, bloqueos] = await Promise.all([
    api("/api/admin/reservas"),
    api("/api/admin/bloqueos"),
  ]);
  renderReservas(reservas);
  renderBloqueos(bloqueos);
}

function setAuthenticatedUI(isAuth) {
  loginCard.classList.toggle("hidden", isAuth);
  adminPanel.classList.toggle("hidden", !isAuth);
}

btnLogin.addEventListener("click", async () => {
  try {
    const password = adminPassword.value.trim();
    if (!password) {
      setMessage(loginMessage, "Ingresa la clave admin.");
      return;
    }
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    adminToken = data.token;
    localStorage.setItem("adminToken", adminToken);
    setAuthenticatedUI(true);
    setMessage(loginMessage, "");
    await refreshAdminData();
  } catch (error) {
    setMessage(loginMessage, error.message || "No se pudo iniciar sesion.");
  }
});

btnLogout.addEventListener("click", () => {
  adminToken = "";
  localStorage.removeItem("adminToken");
  window.location.href = "/";
});

btnCrearBloqueo.addEventListener("click", async () => {
  try {
    const payload = {
      cancha: Number(bloqCancha.value),
      fecha: bloqFecha.value,
      horario: bloqHorarioDesde.value,
      horarioDesde: bloqDiaCompleto.checked ? "" : bloqHorarioDesde.value,
      horarioHasta: bloqDiaCompleto.checked ? "" : bloqHorarioHasta.value,
      diaCompleto: bloqDiaCompleto.checked,
      motivo: bloqMotivo.value.trim(),
    };
    await api("/api/admin/bloqueos", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setMessage(adminMessage, "Bloqueo creado correctamente.", false);
    await refreshAdminData();
  } catch (error) {
    setMessage(adminMessage, error.message || "No se pudo crear el bloqueo.");
  }
});

bloqDiaCompleto.addEventListener("change", () => {
  bloqHorarioDesde.disabled = bloqDiaCompleto.checked;
  bloqHorarioHasta.disabled = bloqDiaCompleto.checked;
});

bloqueosList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.action !== "quitar-bloqueo") return;
  const id = target.dataset.id;
  if (!id) return;
  try {
    await api(`/api/admin/bloqueos/${id}`, { method: "DELETE" });
    setMessage(adminMessage, "Bloqueo eliminado.", false);
    await refreshAdminData();
  } catch (error) {
    setMessage(adminMessage, error.message || "No se pudo eliminar el bloqueo.");
  }
});

reservasList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.action !== "cancelar") return;
  const id = target.dataset.id;
  if (!id) return;
  const confirmar = window.confirm(
    "¿Seguro que queres cancelar este turno? Esta accion lo libera."
  );
  if (!confirmar) return;
  try {
    const data = await api(`/api/admin/reservas/${id}`, { method: "DELETE" });
    setMessage(adminMessage, "Turno cancelado y liberado.", false);
    const r = data.reserva;
    const telefono = r.telefono.replace(/\D/g, "");
    const fecha = formatFecha(r.fecha);
    const mensaje = encodeURIComponent(
      `Hola ${r.nombre}, te informamos que tu turno en Cancha ${r.cancha} el ${fecha} a las ${r.horario}hs fue cancelado por administración. Disculpá los inconvenientes.`
    );
    window.open(`https://wa.me/${telefono}?text=${mensaje}`, "_blank");
    await refreshAdminData();
  } catch (error) {
    setMessage(adminMessage, error.message || "No se pudo cancelar el turno.");
  }
});

async function init() {
  bloqFecha.value = todayISO();
  await loadConfig();
  if (adminToken) {
    try {
      setAuthenticatedUI(true);
      await refreshAdminData();
      return;
    } catch (_error) {
      adminToken = "";
      localStorage.removeItem("adminToken");
    }
  }
  setAuthenticatedUI(false);
}

init();
