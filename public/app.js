const canchaSelect = document.getElementById("cancha");
const fechaInput = document.getElementById("fecha");
const btnBuscar = document.getElementById("btnBuscar");
const horariosContainer = document.getElementById("horarios");
const modal = document.getElementById("modal");
const btnCerrarModal = document.getElementById("btnCerrarModal");
const reservaSeleccion = document.getElementById("reservaSeleccion");
const formReserva = document.getElementById("formReserva");
const paso1 = document.getElementById("paso1");
const paso2 = document.getElementById("paso2");
const btnPaso2 = document.getElementById("btnPaso2");
const btnVolverPaso1 = document.getElementById("btnVolverPaso1");
const mensaje = document.getElementById("mensaje");
const aliasTransferencia = document.getElementById("aliasTransferencia");
const cbuTransferencia = document.getElementById("cbuTransferencia");
const titularTransferencia = document.getElementById("titularTransferencia");
const btnSolicitarCancelacion = document.getElementById("btnSolicitarCancelacion");

let config = null;
let reservasActuales = [];
let bloqueosActuales = [];
let seleccion = null;

function formatFecha(fechaIso) {
  const [yyyy, mm, dd] = fechaIso.split("-");
  return `${dd}/${mm}/${yyyy}`;
}

function setMensaje(texto, isError = true) {
  mensaje.textContent = texto;
  mensaje.style.color = isError ? "#c62020" : "#1d6d2b";
}

function todayISO() {
  const date = new Date();
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date - tzOffset).toISOString().split("T")[0];
}

async function loadConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error("No se pudo cargar la configuracion.");
  }
  config = await response.json();
  aliasTransferencia.textContent = config.transferencia.alias;
  cbuTransferencia.textContent = config.transferencia.cbu;
  titularTransferencia.textContent = config.transferencia.titular;
}

async function loadReservas() {
  const cancha = canchaSelect.value;
  const fecha = fechaInput.value;
  const response = await fetch(`/api/reservas?cancha=${encodeURIComponent(cancha)}&fecha=${encodeURIComponent(fecha)}`);
  if (!response.ok) {
    throw new Error("No se pudieron cargar los horarios.");
  }
  reservasActuales = await response.json();
}

async function loadBloqueos() {
  const cancha = canchaSelect.value;
  const fecha = fechaInput.value;
  const response = await fetch(`/api/bloqueos?cancha=${encodeURIComponent(cancha)}&fecha=${encodeURIComponent(fecha)}`);
  if (!response.ok) {
    throw new Error("No se pudieron cargar los bloqueos.");
  }
  bloqueosActuales = await response.json();
}

function isOcupado(horario) {
  return reservasActuales.some((reserva) => reserva.horario === horario);
}

function findBloqueo(horario) {
  const [horaActual] = horario.split(":");
  const horaActualNum = Number(horaActual);
  return bloqueosActuales.find((bloqueo) => {
    if (bloqueo.diaCompleto) return true;
    if (bloqueo.horarioDesde && bloqueo.horarioHasta) {
      const [desde] = bloqueo.horarioDesde.split(":");
      const [hasta] = bloqueo.horarioHasta.split(":");
      return horaActualNum >= Number(desde) && horaActualNum <= Number(hasta);
    }
    return bloqueo.horario === horario;
  });
}

function renderHorarios() {
  horariosContainer.innerHTML = "";

  config.horarios.forEach((horario) => {
    const ocupado = isOcupado(horario);
    const bloqueo = findBloqueo(horario);
    const bloqueado = Boolean(bloqueo);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = horario;
    if (bloqueado) {
      btn.className =
        "rounded-lg px-3 py-3 font-bold bg-amber-100 text-amber-800 cursor-not-allowed";
      btn.title = bloqueo.motivo || "Bloqueado por administracion";
      btn.disabled = true;
    } else if (ocupado) {
      btn.className =
        "rounded-lg px-3 py-3 font-bold bg-slate-200 text-slate-500 cursor-not-allowed";
      btn.disabled = true;
    } else {
      btn.className =
        "rounded-lg px-3 py-3 font-bold bg-emerald-100 text-emerald-900 hover:bg-emerald-200";
      btn.disabled = false;
      btn.addEventListener("click", () => openModal(horario));
    }
    horariosContainer.appendChild(btn);
  });
}

function openModal(horario) {
  seleccion = {
    cancha: Number(canchaSelect.value),
    fecha: fechaInput.value,
    horario,
  };
  reservaSeleccion.textContent = `Cancha ${seleccion.cancha} - ${formatFecha(seleccion.fecha)} - ${seleccion.horario}`;
  paso1.classList.remove("hidden");
  paso2.classList.add("hidden");
  setMensaje("");
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
  formReserva.reset();
  seleccion = null;
  setMensaje("");
}

function validarPaso1() {
  const nombre = document.getElementById("nombre").value.trim();
  const telefono = document.getElementById("telefono").value.trim();
  if (nombre.length < 3) {
    setMensaje("Ingresa nombre y apellido.");
    return false;
  }
  if (telefono.length < 6) {
    setMensaje("Ingresa un telefono valido.");
    return false;
  }
  return true;
}

function buildWhatsAppUrl(reserva) {
  const comprobanteTexto = reserva.comprobanteUrl
    ? `Comprobante: ${reserva.comprobanteUrl}`
    : "Comprobante: cargado en la web";

  const text = [
    "Hola, quiero reservar:",
    `Nombre: ${reserva.nombre}`,
    `Telefono: ${reserva.telefono}`,
    `Cancha: ${reserva.cancha}`,
    `Fecha: ${formatFecha(reserva.fecha)}`,
    `Horario: ${reserva.horario}`,
    comprobanteTexto,
    "Ya realice la transferencia.",
  ].join("\n");

  return `https://wa.me/${config.whatsappNumero}?text=${encodeURIComponent(text)}`;
}

async function refreshHorarios() {
  if (!fechaInput.value) {
    fechaInput.value = todayISO();
  }
  await Promise.all([loadReservas(), loadBloqueos()]);
  renderHorarios();
}

function buildCancelacionWhatsAppUrl() {
  const cancha = canchaSelect.value;
  const fecha = fechaInput.value ? formatFecha(fechaInput.value) : "(indicar fecha)";
  const texto = [
    "Hola, quiero solicitar la cancelacion de un turno.",
    `Cancha: ${cancha}`,
    `Fecha: ${fecha}`,
    "Horario: (indicar horario)",
    "Nombre y telefono: (indicar datos)",
  ].join("\n");
  return `https://wa.me/${config.whatsappNumero}?text=${encodeURIComponent(texto)}`;
}

btnBuscar.addEventListener("click", async () => {
  try {
    await refreshHorarios();
  } catch (error) {
    setMensaje(error.message || "Error al cargar horarios.");
  }
});

btnCerrarModal.addEventListener("click", closeModal);
modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

btnPaso2.addEventListener("click", () => {
  if (!validarPaso1()) return;
  setMensaje("");
  paso1.classList.add("hidden");
  paso2.classList.remove("hidden");
});

btnVolverPaso1.addEventListener("click", () => {
  paso2.classList.add("hidden");
  paso1.classList.remove("hidden");
  setMensaje("");
});

btnSolicitarCancelacion.addEventListener("click", () => {
  if (!config?.whatsappNumero) {
    setMensaje("No hay numero de WhatsApp configurado.");
    return;
  }
  window.location.href = buildCancelacionWhatsAppUrl();
});

formReserva.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!seleccion) return;

  const formData = new FormData(formReserva);
  formData.set("cancha", String(seleccion.cancha));
  formData.set("fecha", seleccion.fecha);
  formData.set("horario", seleccion.horario);

  try {
    setMensaje("Guardando reserva...", false);
    const response = await fetch("/reservas", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "No se pudo guardar la reserva.");
    }

    setMensaje("Reserva guardada. Redirigiendo a WhatsApp...", false);
    await refreshHorarios();
    const whatsappUrl = buildWhatsAppUrl(data);

    setTimeout(() => {
      closeModal();
      window.location.href = whatsappUrl;
    }, 800);
  } catch (error) {
    setMensaje(error.message || "Error al reservar.");
  }
});

async function init() {
  fechaInput.min = todayISO();
  fechaInput.value = todayISO();
  try {
    await loadConfig();
    await refreshHorarios();
  } catch (error) {
    setMensaje(error.message || "Error inicializando la aplicacion.");
  }
}

init();
