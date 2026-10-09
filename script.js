
/* ==========================================
   BRASA WALLET
   FESTIVAL DEL FUEGO
   VERSIÓN 8 · CORREGIDA

   CUENTAS, TARJETAS, RECARGAS,
   HISTORIAL Y PAGOS QR DEMO

   SIN DINERO REAL
========================================== */

// ==========================================
// 1. CONFIGURACIÓN
// ==========================================

const SUPABASE_URL =
  "https://spauudjoiuyyepdoeybh.supabase.co";

// Clave pública usada anteriormente.
// Comparar con Supabase si falla autenticación.
const SUPABASE_PUBLIC_KEY =
  "sb_publishable_iC0A7ougnKtYjs036m5J_A_v7SYdWlk";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLIC_KEY
);

const $ = id => document.getElementById(id);

const COMISION_CENTAVOS = 2000;

const TARJETAS = {
  brasa_visa: {
    nombre: "Visa DEMO",
    numero: "•••• •••• •••• 4242",
    terminacion: "4242",
    clase: ""
  },
  brasa_mastercard: {
    nombre: "Mastercard DEMO",
    numero: "•••• •••• •••• 5555",
    terminacion: "5555",
    clase: "master"
  }
};

let usuarioActual = null;
let modoRegistro = false;
let operacionEnProceso = false;
let tarjetasGuardadas = [];
let establecimientos = [];

// ==========================================
// 2. FUNCIONES GENERALES
// ==========================================

function dinero(centavos) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(Number(centavos || 0) / 100);
}

function fechaLocal(fecha = new Date()) {
  return new Date(fecha).toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function mensaje(texto) {
  $("mensaje").textContent = texto || "";
}

function ocultarPaneles() {
  [
    "panel-tarjetas",
    "panel-recarga",
    "panel-pago",
    "panel-comprobante"
  ].forEach(id => {
    $(id).hidden = true;
  });
}

function irA(id) {
  $(id).scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function bloquearOperaciones(bloquear) {
  operacionEnProceso = bloquear;

  [
    "confirmar-recarga",
    "guardar-tarjeta",
    "cerrar-sesion",
    "btn-recargar",
    "btn-pagar",
    "btn-tarjetas"
  ].forEach(id => {
    $(id).disabled = bloquear;
  });

  actualizarResumenPago();
}

function mostrarAcceso() {
  usuarioActual = null;
  tarjetasGuardadas = [];
  establecimientos = [];

  ocultarPaneles();

  $("pantalla-acceso").hidden = false;
  $("pantalla-wallet").hidden = true;
  $("saldo").textContent = "$0.00";
  $("lista-movimientos").replaceChildren();
}

function mostrarWallet() {
  $("pantalla-acceso").hidden = true;
  $("pantalla-wallet").hidden = false;
}

// ==========================================
// 3. INICIO DE SESIÓN
// ==========================================

function cambiarModo() {
  modoRegistro = !modoRegistro;

  $("campo-nombre").hidden = !modoRegistro;
  $("nombre").required = modoRegistro;

  $("titulo-acceso").textContent =
    modoRegistro
      ? "Crear cuenta"
      : "Iniciar sesión";

  $("boton-acceso").textContent =
    modoRegistro
      ? "Registrarme"
      : "Iniciar sesión";

  $("cambiar-modo").textContent =
    modoRegistro
      ? "¿Ya tienes cuenta? Inicia sesión"
      : "¿No tienes cuenta? Regístrate";

  $("contrasena").autocomplete =
    modoRegistro
      ? "new-password"
      : "current-password";

  mensaje("");
}

async function procesarAcceso(evento) {
  evento.preventDefault();

  const boton = $("boton-acceso");
  boton.disabled = true;

  mensaje("Procesando...");

  try {
    const email = $("correo").value.trim();
    const password = $("contrasena").value;

    if (modoRegistro) {
      const nombre = $("nombre").value.trim();

      if (!nombre) {
        throw new Error("Escribe tu nombre completo.");
      }

      const { data, error } =
        await db.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: nombre },
            emailRedirectTo:
              window.location.origin +
              window.location.pathname
          }
        });

      if (error) throw error;

      if (!data.session) {
        mensaje(
          "Confirma tu correo y después " +
          "inicia sesión."
        );
      } else {
        await cargarUsuario();
      }

    } else {
      const { error } =
        await db.auth.signInWithPassword({
          email,
          password
        });

      if (error) throw error;

      await cargarUsuario();
    }

  } catch (error) {
    mensaje("Error de acceso: " + error.message);

  } finally {
    boton.disabled = false;
  }
}

// ==========================================
// 4. PERFIL
// ==========================================

async function cargarUsuario() {
  const { data, error } = await db.auth.getUser();

  if (error || !data.user) {
    mostrarAcceso();
    return;
  }

  usuarioActual = data.user;
  mostrarWallet();

  const { data: perfil } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", usuarioActual.id)
    .maybeSingle();

  $("nombre-usuario").textContent =
    perfil?.full_name ||
    usuarioActual.user_metadata?.full_name ||
    "Visitante";

  await cargarSaldo();
  await cargarTarjetas();
  await cargarComercios();

  // Abrir establecimiento desde un QR.
  const idQR = new URLSearchParams(
    window.location.search
  ).get("merchant");

  if (
    idQR &&
    establecimientos.some(c => c.id === idQR)
  ) {
    abrirPago(idQR);
  }
}

// ==========================================
// 5. SALDO
// ==========================================

async function cargarSaldo() {
  if (!usuarioActual) return;

  const { data, error } = await db
    .from("wallets")
    .select("id, balance_cents")
    .eq("user_id", usuarioActual.id)
    .maybeSingle();

  if (error) {
    $("saldo").textContent = "No disponible";
    mensaje("Error de saldo: " + error.message);
    return;
  }

  if (!data) {
    $("saldo").textContent = "No disponible";
    mensaje("Monedero no encontrado.");
    return;
  }

  $("saldo").textContent = dinero(data.balance_cents);

  await cargarHistorial(data.id);
}

// ==========================================
// 6. HISTORIAL
// ==========================================

async function cargarHistorial(walletId) {
  const { data, error } = await db
    .from("wallet_transactions")
    .select(
      "id, type, amount_cents, description, " +
      "merchant_name, created_at"
    )
    .eq("wallet_id", walletId)
    .order("created_at", { ascending: false })
    .limit(40);

  const lista = $("lista-movimientos");
  lista.replaceChildren();

  if (error) {
    mensaje("Error de historial: " + error.message);
    return;
  }

  if (!data?.length) {
    const p = document.createElement("p");
    p.textContent = "Todavía no tienes movimientos.";
    lista.appendChild(p);
    return;
  }

  for (const movimiento of data) {
    const fila = document.createElement("div");
    fila.className = "movimiento-item";

    const descripcion = document.createElement("p");

    const comercio = movimiento.merchant_name
      ? " · " + movimiento.merchant_name
      : "";

    descripcion.textContent =
      (movimiento.description || "Movimiento DEMO") +
      comercio +
      " · " + fechaLocal(movimiento.created_at);

    const importe = document.createElement("strong");
    const valor = Number(movimiento.amount_cents);

    importe.textContent =
      (valor > 0 ? "+" : "") + dinero(valor);

    fila.append(descripcion, importe);
    lista.appendChild(fila);
  }
}

// ==========================================
// 7. TARJETAS FICTICIAS
// ==========================================

async function cargarTarjetas() {
  if (!usuarioActual) return;

  const { data, error } = await db
    .from("demo_cards")
    .select("id, card_type, created_at")
    .eq("user_id", usuarioActual.id)
    .order("created_at", { ascending: true });

  if (error) {
    mensaje("Error de tarjetas: " + error.message);
    return;
  }

  tarjetasGuardadas = data || [];

  dibujarTarjetas();
  llenarSelectorTarjetas();
}

function dibujarTarjetas() {
  const lista = $("lista-tarjetas");
  lista.replaceChildren();

  if (!tarjetasGuardadas.length) {
    const p = document.createElement("p");
    p.className = "secundario";
    p.textContent = "No tienes tarjetas DEMO registradas.";
    lista.appendChild(p);
    return;
  }

  for (const tarjeta of tarjetasGuardadas) {
    const info = TARJETAS[tarjeta.card_type];
    if (!info) continue;

    const visual = document.createElement("div");
    visual.className = "tarjeta-demo " + info.clase;

    const superior = document.createElement("div");
    superior.className = "tarjeta-demo-superior";

    const marca = document.createElement("span");
    marca.textContent = "🔥 BRASA";

    const tipo = document.createElement("span");
    tipo.textContent = info.nombre;

    superior.append(marca, tipo);

    const chip = document.createElement("div");
    chip.className = "tarjeta-demo-chip";

    const numero = document.createElement("div");
    numero.className = "tarjeta-demo-numero";
    numero.textContent = info.numero;

    const pie = document.createElement("div");
    pie.className = "tarjeta-demo-pie";

    const t1 = document.createElement("span");
    t1.textContent = "TARJETA FICTICIA";

    const t2 = document.createElement("span");
    t2.textContent = "SIN VENCIMIENTO";

    pie.append(t1, t2);

    const eliminar = document.createElement("button");
    eliminar.type = "button";
    eliminar.className = "eliminar-tarjeta";
    eliminar.textContent = "Eliminar tarjeta DEMO";

    eliminar.addEventListener("click", () => {
      eliminarTarjeta(tarjeta.id);
    });

    visual.append(superior, chip, numero, pie, eliminar);
    lista.appendChild(visual);
  }
}

function llenarSelectorTarjetas() {
  const select = $("tarjeta-recarga");
  select.replaceChildren();

  if (!tarjetasGuardadas.length) {
    const op = document.createElement("option");
    op.value = "";
    op.textContent = "Registra una tarjeta primero";
    select.appendChild(op);
    return;
  }

  for (const tarjeta of tarjetasGuardadas) {
    const info = TARJETAS[tarjeta.card_type];
    if (!info) continue;

    const op = document.createElement("option");
    op.value = tarjeta.id;
    op.textContent =
      info.nombre + " · •••• " + info.terminacion;

    select.appendChild(op);
  }
}

async function guardarTarjeta(evento) {
  evento.preventDefault();

  if (!usuarioActual || operacionEnProceso) return;

  const tipo = $("tipo-tarjeta").value;

  if (!TARJETAS[tipo]) {
    mensaje("Tarjeta de prueba inválida.");
    return;
  }

  const boton = $("guardar-tarjeta");
  boton.disabled = true;

  try {
    const { error } = await db
      .from("demo_cards")
      .insert({
        user_id: usuarioActual.id,
        card_type: tipo
      });

    if (error) throw error;

    await cargarTarjetas();
    mensaje("Tarjeta DEMO registrada.");

  } catch (error) {
    mensaje(
      error.code === "23505"
        ? "Esa tarjeta ya está registrada."
        : "Error: " + error.message
    );

  } finally {
    boton.disabled = false;
  }
}

async function eliminarTarjeta(id) {
  if (!usuarioActual || operacionEnProceso) return;

  const confirmar = window.confirm(
    "¿Eliminar esta tarjeta ficticia? " +
    "No se modificará tu saldo."
  );

  if (!confirmar) return;

  const { error } = await db
    .from("demo_cards")
    .delete()
    .eq("id", id)
    .eq("user_id", usuarioActual.id);

  if (error) {
    mensaje("Error: " + error.message);
    return;
  }

  await cargarTarjetas();
  mensaje("Tarjeta DEMO eliminada.");
}

function abrirTarjetas() {
  if (operacionEnProceso) return;

  ocultarPaneles();
  $("panel-tarjetas").hidden = false;
  irA("panel-tarjetas");
}

// ==========================================
// 8. RECARGAS
// ==========================================

function llenarMontos() {
  const select = $("monto-recarga");
  select.replaceChildren();

  for (let monto = 100; monto <= 5000; monto += 100) {
    const op = document.createElement("option");

    op.value = String(monto);
    op.textContent = dinero(monto * 100);

    if (monto === 500) {
      op.selected = true;
    }

    select.appendChild(op);
  }
}

function actualizarResumenRecarga() {
  const monto = Number($("monto-recarga").value);

  const valido =
    Number.isInteger(monto) &&
    monto >= 100 &&
    monto <= 5000 &&
    monto % 100 === 0;

  const centavos = valido ? monto * 100 : 0;

  $("resumen-monto").textContent = dinero(centavos);
  $("resumen-comision").textContent =
    dinero(COMISION_CENTAVOS);

  $("resumen-total").textContent =
    dinero(centavos + COMISION_CENTAVOS);

  $("confirmar-recarga").disabled =
    !valido || operacionEnProceso;
}

function abrirRecarga() {
  if (operacionEnProceso) return;

  if (!tarjetasGuardadas.length) {
    abrirTarjetas();
    mensaje("Primero registra una tarjeta ficticia.");
    return;
  }

  ocultarPaneles();
  actualizarResumenRecarga();

  $("panel-recarga").hidden = false;
  mensaje("");
  irA("panel-recarga");
}

async function confirmarRecarga(evento) {
  evento.preventDefault();

  if (!usuarioActual || operacionEnProceso) return;

  const monto = Number($("monto-recarga").value);

  const tarjeta = tarjetasGuardadas.find(
    t => t.id === $("tarjeta-recarga").value
  );

  if (
    !Number.isInteger(monto) ||
    monto < 100 ||
    monto > 5000 ||
    monto % 100 !== 0 ||
    !tarjeta
  ) {
    mensaje("Importe o tarjeta DEMO inválidos.");
    return;
  }

  const info = TARJETAS[tarjeta.card_type];
  if (!info) return;

  const centavos = monto * 100;

  const confirmado = window.confirm(
    "RECARGA DEMO\n\n" +
    "Tarjeta: " + info.nombre +
    " •••• " + info.terminacion + "\n" +
    "Saldo a recibir: " + dinero(centavos) + "\n" +
    "Comisión: " + dinero(COMISION_CENTAVOS) +
    "\nTOTAL: " +
    dinero(centavos + COMISION_CENTAVOS) +
    "\n\nNo se utilizará dinero real.\n\n" +
    "¿Confirmar recarga?"
  );

  if (!confirmado) return;

  bloquearOperaciones(true);
  $("confirmar-recarga").textContent =
    "Procesando recarga...";

  mensaje("Registrando recarga ficticia...");

  let respuesta = null;

  try {
    const { data, error } = await db.rpc(
      "brasa_demo_topup",
      { p_amount_cents: centavos }
    );

    if (error) throw error;

    if (!data?.success) {
      throw new Error("Recarga no confirmada.");
    }

    respuesta = data;

  } catch (error) {
    mensaje(
      "Error o confirmación pendiente: " +
      error.message +
      ". Revisa el historial antes de reintentar."
    );

  } finally {
    bloquearOperaciones(false);
    $("confirmar-recarga").textContent =
      "Confirmar recarga DEMO";
  }

  if (respuesta) {
    $("saldo").textContent =
      dinero(respuesta.balance_cents);

    mostrarTicket({
      titulo: "¡Recarga registrada!",
      tipo: "Recarga DEMO",
      concepto:
        info.nombre + " •••• " + info.terminacion,
      importe: respuesta.recharged_cents,
      comision: respuesta.fee_cents,
      total: respuesta.simulated_total_cents,
      saldo: respuesta.balance_cents,
      folio: respuesta.reference
    });
  }

  // Esta consulta no vuelve a ejecutar el abono.
  await cargarSaldo();
}

// ==========================================
// 9. ESTABLECIMIENTOS CORREGIDOS
// ==========================================

async function cargarComercios() {
  const select = $("establecimiento");
  const lista = $("lista-qr");

  establecimientos = [];
  select.replaceChildren();
  lista.replaceChildren();

  const cargando = document.createElement("option");
  cargando.value = "";
  cargando.textContent =
    "Cargando establecimientos...";

  select.appendChild(cargando);

  try {
    // La tabla real utiliza:
    // id (UUID), name, is_active.
    //
    // NO utiliza slug ni active.

    const { data, error } = await db
      .from("brasa_merchants")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name");

    if (error) throw error;

    establecimientos = data || [];

    select.replaceChildren();

    const inicial = document.createElement("option");
    inicial.value = "";

    inicial.textContent = establecimientos.length
      ? "Selecciona un establecimiento"
      : "No hay establecimientos disponibles";

    select.appendChild(inicial);

    for (const comercio of establecimientos) {
      const op = document.createElement("option");

      op.value = comercio.id;
      op.textContent = comercio.name;

      select.appendChild(op);
    }

    dibujarQR();
    actualizarResumenPago();

  } catch (error) {
    select.replaceChildren();

    const fallo = document.createElement("option");
    fallo.value = "";
    fallo.textContent =
      "No se pudieron cargar los negocios";

    select.appendChild(fallo);

    mensaje(
      "Error al cargar establecimientos: " +
      error.message
    );
  }
}

// ==========================================
// 10. GENERAR CÓDIGOS QR
// ==========================================

function urlComercio(id) {
  const url = new URL(
    window.location.origin +
    window.location.pathname
  );

  // El QR transporta el UUID real.
  url.searchParams.set("merchant", id);

  return url.toString();
}

function dibujarQR() {
  const lista = $("lista-qr");
  lista.replaceChildren();

  for (const comercio of establecimientos) {
    const caja = document.createElement("div");
    caja.className = "qr-negocio";

    const titulo = document.createElement("h4");
    titulo.textContent = comercio.name;

    const zonaQR = document.createElement("div");
    zonaQR.className = "qr-imagen";

    const enlace = document.createElement("a");
    enlace.href = urlComercio(comercio.id);
    enlace.textContent =
      "Abrir enlace del establecimiento";

    caja.append(titulo, zonaQR, enlace);
    lista.appendChild(caja);

    if (window.QRCode &&
        typeof window.QRCode.toCanvas === "function") {

      const canvas = document.createElement("canvas");
      zonaQR.appendChild(canvas);

      window.QRCode.toCanvas(
        canvas,
        urlComercio(comercio.id),
        {
          width: 185,
          margin: 4,
          errorCorrectionLevel: "M",
          color: {
            dark: "#21130d",
            light: "#ffffff"
          }
        },
        error => {
          if (error) {
            zonaQR.textContent =
              "Error al generar QR.";
          }
        }
      );

    } else {
      zonaQR.textContent =
        "Código QR no disponible. " +
        "Usa el enlace inferior.";
    }
  }
}

// ==========================================
// 11. PANTALLA DE PAGO
// ==========================================

function abrirPago(id = "") {
  if (operacionEnProceso) return;

  ocultarPaneles();
  $("panel-pago").hidden = false;

  if (
    id &&
    establecimientos.some(c => c.id === id)
  ) {
    $("establecimiento").value = id;
  }

  actualizarResumenPago();
  irA("panel-pago");
}

function obtenerMontoPago() {
  const texto = $("importe-pago").value.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(texto)) {
    return null;
  }

  const centavos = Math.round(Number(texto) * 100);

  if (
    !Number.isSafeInteger(centavos) ||
    centavos < 100 ||
    centavos > 500000
  ) {
    return null;
  }

  return centavos;
}

function actualizarResumenPago() {
  const id = $("establecimiento").value;

  const comercio = establecimientos.find(
    c => c.id === id
  );

  const centavos = obtenerMontoPago();

  $("pago-comercio").textContent =
    comercio?.name || "—";

  $("pago-importe").textContent =
    centavos === null ? "$0.00" : dinero(centavos);

  $("pago-total").textContent =
    centavos === null ? "$0.00" : dinero(centavos);

  $("confirmar-pago").disabled =
    !comercio ||
    centavos === null ||
    operacionEnProceso;
}

// ==========================================
// 12. CONFIRMAR PAGO CON UUID
// ==========================================

async function confirmarPago(evento) {
  evento.preventDefault();

  if (!usuarioActual || operacionEnProceso) return;

  const id = $("establecimiento").value;

  const comercio = establecimientos.find(
    c => c.id === id
  );

  const centavos = obtenerMontoPago();

  if (!comercio || centavos === null) {
    mensaje(
      "Selecciona un establecimiento y " +
      "un importe de $1 a $5,000."
    );
    return;
  }

  const confirmado = window.confirm(
    "BRASA WALLET · PAGO DEMO\n\n" +
    "Negocio: " + comercio.name + "\n" +
    "Compra: " + dinero(centavos) + "\n" +
    "Comisión: $0.00\n\n" +
    "Total a descontar: " + dinero(centavos) +
    "\n\nOperación ficticia.\n\n" +
    "¿Confirmar compra?"
  );

  if (!confirmado) return;

  bloquearOperaciones(true);
  $("confirmar-pago").textContent =
    "Procesando pago...";

  mensaje("Procesando compra DEMO...");

  let respuesta = null;

  try {
    // Función SQL instalada:
    // brasa_demo_pay(uuid,bigint)
    //
    // p_merchant_id = UUID del establecimiento.

    const { data, error } = await db.rpc(
      "brasa_demo_pay",
      {
        p_merchant_id: id,
        p_amount_cents: centavos
      }
    );

    if (error) throw error;

    if (!data?.success) {
      throw new Error(
        "Supabase no confirmó el pago."
      );
    }

    respuesta = data;

  } catch (error) {
    mensaje(
      "No se pudo confirmar el pago: " +
      error.message +
      ". Revisa el saldo y el historial " +
      "antes de volver a intentar."
    );

  } finally {
    bloquearOperaciones(false);
    $("confirmar-pago").textContent =
      "Confirmar pago DEMO";
  }

  if (respuesta) {
    $("saldo").textContent =
      dinero(respuesta.balance_cents);

    mostrarTicket({
      titulo: "¡Pago realizado!",
      tipo: "Compra DEMO",
      concepto: respuesta.merchant_name,
      importe: -respuesta.paid_cents,
      comision: 0,
      total: respuesta.paid_cents,
      saldo: respuesta.balance_cents,
      folio: respuesta.reference
    });

    $("importe-pago").value = "";

    const url = new URL(window.location.href);
    url.searchParams.delete("merchant");

    window.history.replaceState(
      {},
      "",
      url.toString()
    );
  }

  // Consultar saldo actualizado,
  // sin ejecutar nuevamente el pago.
  await cargarSaldo();
}

// ==========================================
// 13. COMPROBANTES
// ==========================================

function mostrarTicket(datos) {
  $("ticket-titulo").textContent = datos.titulo;
  $("ticket-tipo").textContent = datos.tipo;
  $("ticket-concepto").textContent = datos.concepto;

  $("ticket-importe").textContent =
    dinero(datos.importe);

  $("ticket-comision").textContent =
    dinero(datos.comision);

  $("ticket-total").textContent =
    dinero(datos.total);

  $("ticket-saldo").textContent =
    dinero(datos.saldo);

  $("ticket-fecha").textContent =
    fechaLocal();

  $("ticket-folio").textContent =
    String(datos.folio || "Sin folio");

  ocultarPaneles();

  $("panel-comprobante").hidden = false;
  irA("panel-comprobante");

  mensaje("Operación ficticia registrada.");
}

// ==========================================
// 14. CERRAR SESIÓN
// ==========================================

async function cerrarSesion() {
  if (operacionEnProceso) return;

  const { error } = await db.auth.signOut();

  if (error) {
    mensaje("Error: " + error.message);
    return;
  }

  mostrarAcceso();
  $("form-acceso").reset();
  mensaje("Sesión cerrada correctamente.");
}

// ==========================================
// 15. EVENTOS
// ==========================================

$("form-acceso").addEventListener(
  "submit", procesarAcceso
);

$("cambiar-modo").addEventListener(
  "click", cambiarModo
);

$("cerrar-sesion").addEventListener(
  "click", cerrarSesion
);

$("btn-tarjetas").addEventListener(
  "click", abrirTarjetas
);

$("cerrar-tarjetas").addEventListener(
  "click", () => {
    $("panel-tarjetas").hidden = true;
  }
);

$("form-tarjeta").addEventListener(
  "submit", guardarTarjeta
);

$("btn-recargar").addEventListener(
  "click", abrirRecarga
);

$("cerrar-recarga").addEventListener(
  "click", () => {
    if (!operacionEnProceso) {
      $("panel-recarga").hidden = true;
    }
  }
);

$("monto-recarga").addEventListener(
  "change", actualizarResumenRecarga
);

$("form-recarga").addEventListener(
  "submit", confirmarRecarga
);

$("btn-pagar").addEventListener(
  "click", () => abrirPago()
);

$("cerrar-pago").addEventListener(
  "click", () => {
    if (!operacionEnProceso) {
      $("panel-pago").hidden = true;
    }
  }
);

$("establecimiento").addEventListener(
  "change", actualizarResumenPago
);

$("importe-pago").addEventListener(
  "input", actualizarResumenPago
);

$("form-pago").addEventListener(
  "submit", confirmarPago
);

$("cerrar-comprobante").addEventListener(
  "click", () => {
    $("panel-comprobante").hidden = true;
    irA("pantalla-wallet");
  }
);

$("btn-historial").addEventListener(
  "click", async () => {
    await cargarSaldo();
    irA("seccion-historial");
  }
);

// ==========================================
// 16. INICIAR APLICACIÓN
// ==========================================

async function iniciarApp() {
  llenarMontos();
  actualizarResumenRecarga();
  actualizarResumenPago();

  try {
    await cargarUsuario();
  } catch (error) {
    mensaje(
      "Error al iniciar Brasa Wallet: " +
      error.message
    );
  }
}

iniciarApp();
