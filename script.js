
/* =========================================
   BRASA WALLET · FESTIVAL DEL FUEGO
   Cuentas, tarjetas, recargas y pagos QR
   SISTEMA DEMOSTRATIVO · SIN DINERO REAL
========================================= */

// 1. SUPABASE
const SUPABASE_URL =
  "https://spauudjoiuyyepdoeybh.supabase.co";

// Clave pública transcrita de la captura anterior.
// Verificar con Supabase si aparece error de conexión.
const SUPABASE_PUBLIC_KEY =
  "sb_publishable_iC0A7ougnKtYjs036m5J_A_v7SYdWlk";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLIC_KEY
);

// 2. CONFIGURACIÓN
const $ = id => document.getElementById(id);
const COMISION = 2000;

const TIPOS_TARJETA = {
  brasa_visa: {
    nombre: "Visa DEMO",
    terminacion: "4242",
    numero: "•••• •••• •••• 4242",
    clase: ""
  },
  brasa_mastercard: {
    nombre: "Mastercard DEMO",
    terminacion: "5555",
    numero: "•••• •••• •••• 5555",
    clase: "master"
  }
};

let usuarioActual = null;
let modoRegistro = false;
let operacionEnProceso = false;
let tarjetas = [];
let comercios = [];
let folioPendiente = null;

// 3. FUNCIONES GENERALES
function dinero(centavos) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(Number(centavos || 0) / 100);
}

function mensaje(texto) {
  $("mensaje").textContent = texto;
}

function fechaLocal(fecha = new Date()) {
  return new Date(fecha).toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function ocultarPaneles() {
  ["panel-tarjetas", "panel-recarga",
   "panel-pago", "panel-comprobante"]
    .forEach(id => $(id).hidden = true);
}

function irA(id) {
  $(id).scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function mostrarAcceso() {
  usuarioActual = null;
  tarjetas = [];
  comercios = [];
  ocultarPaneles();
  $("pantalla-acceso").hidden = false;
  $("pantalla-wallet").hidden = true;
  $("saldo").textContent = "Cargando...";
}

function mostrarWallet() {
  $("pantalla-acceso").hidden = true;
  $("pantalla-wallet").hidden = false;
}

function bloquearOperaciones(bloquear) {
  operacionEnProceso = bloquear;
  $("confirmar-recarga").disabled = bloquear;
  $("confirmar-pago").disabled = bloquear;
  $("guardar-tarjeta").disabled = bloquear;
  $("cerrar-sesion").disabled = bloquear;
}

// 4. REGISTRO Y LOGIN
function cambiarModo() {
  modoRegistro = !modoRegistro;

  $("campo-nombre").hidden = !modoRegistro;
  $("nombre").required = modoRegistro;

  $("titulo-acceso").textContent =
    modoRegistro ? "Crear cuenta" : "Iniciar sesión";

  $("boton-acceso").textContent =
    modoRegistro ? "Registrarme" : "Iniciar sesión";

  $("cambiar-modo").textContent = modoRegistro
    ? "¿Ya tienes cuenta? Inicia sesión"
    : "¿No tienes cuenta? Regístrate";

  $("contrasena").autocomplete = modoRegistro
    ? "new-password" : "current-password";

  mensaje("");
}

async function procesarAcceso(evento) {
  evento.preventDefault();
  $("boton-acceso").disabled = true;
  mensaje("Procesando solicitud...");

  try {
    const email = $("correo").value.trim();
    const password = $("contrasena").value;

    if (modoRegistro) {
      const nombre = $("nombre").value.trim();

      if (!nombre) {
        throw new Error("Escribe tu nombre.");
      }

      const { data, error } = await db.auth.signUp({
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
          "Confirma tu correo y luego inicia sesión."
        );
      } else {
        await cargarUsuario();
      }
    } else {
      const { error } =
        await db.auth.signInWithPassword({
          email, password
        });

      if (error) throw error;
      await cargarUsuario();
    }
  } catch (error) {
    mensaje("Error de acceso: " + error.message);
  } finally {
    $("boton-acceso").disabled = false;
  }
}

// 5. CARGAR CUENTA
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

  // Si se abrió Brasa Wallet mediante QR,
  // seleccionar automáticamente el comercio.
  const slugQR = new URLSearchParams(
    window.location.search
  ).get("merchant");

  if (slugQR && comercios.some(c => c.slug === slugQR)) {
    abrirPago(slugQR);
  }
}

// 6. CONSULTAR SALDO
async function cargarSaldo() {
  if (!usuarioActual) return;

  const { data: wallet, error } = await db
    .from("wallets")
    .select("id, balance_cents")
    .eq("user_id", usuarioActual.id)
    .maybeSingle();

  if (error) {
    mensaje("Error al cargar saldo: " + error.message);
    $("saldo").textContent = "No disponible";
    return;
  }

  if (!wallet) {
    $("saldo").textContent = "No disponible";
    mensaje("No encontramos tu monedero.");
    return;
  }

  $("saldo").textContent = dinero(wallet.balance_cents);
  await cargarHistorial(wallet.id);
}

// 7. HISTORIAL
async function cargarHistorial(walletId) {
  const { data, error } = await db
    .from("wallet_transactions")
    .select(
      "id, type, amount_cents, description, " +
      "merchant_name, created_at, reference"
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

  for (const mov of data) {
    const fila = document.createElement("div");
    fila.className = "movimiento-item";

    const detalle = document.createElement("p");
    const comercio = mov.merchant_name
      ? " · " + mov.merchant_name : "";

    detalle.textContent =
      mov.description + comercio +
      " · " + fechaLocal(mov.created_at);

    const importe = document.createElement("strong");
    const valor = Number(mov.amount_cents);

    importe.textContent =
      (valor > 0 ? "+" : "") + dinero(valor);

    fila.append(detalle, importe);
    lista.appendChild(fila);
  }
}

// 8. TARJETAS DE PRUEBA
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

  tarjetas = data || [];
  dibujarTarjetas();
  actualizarSelectorTarjetas();
}

function dibujarTarjetas() {
  const lista = $("lista-tarjetas");
  lista.replaceChildren();

  if (!tarjetas.length) {
    const p = document.createElement("p");
    p.className = "secundario";
    p.textContent = "Todavía no tienes tarjetas DEMO.";
    lista.appendChild(p);
    return;
  }

  for (const tarjeta of tarjetas) {
    const tipo = TIPOS_TARJETA[tarjeta.card_type];
    if (!tipo) continue;

    const caja = document.createElement("div");
    caja.className = "tarjeta-demo " + tipo.clase;

    const superior = document.createElement("div");
    superior.className = "tarjeta-demo-superior";

    const marca = document.createElement("span");
    marca.textContent = "🔥 BRASA";

    const red = document.createElement("span");
    red.textContent = tipo.nombre;

    superior.append(marca, red);

    const chip = document.createElement("div");
    chip.className = "tarjeta-demo-chip";

    const numero = document.createElement("div");
    numero.className = "tarjeta-demo-numero";
    numero.textContent = tipo.numero;

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
    eliminar.addEventListener("click", () =>
      eliminarTarjeta(tarjeta.id)
    );

    caja.append(superior, chip, numero, pie, eliminar);
    lista.appendChild(caja);
  }
}

function actualizarSelectorTarjetas() {
  const select = $("tarjeta-recarga");
  select.replaceChildren();

  if (!tarjetas.length) {
    const opcion = document.createElement("option");
    opcion.value = "";
    opcion.textContent = "Registra una tarjeta primero";
    select.appendChild(opcion);
    return;
  }

  for (const tarjeta of tarjetas) {
    const tipo = TIPOS_TARJETA[tarjeta.card_type];
    if (!tipo) continue;

    const opcion = document.createElement("option");
    opcion.value = tarjeta.id;
    opcion.textContent =
      tipo.nombre + " · •••• " + tipo.terminacion;

    select.appendChild(opcion);
  }
}

async function guardarTarjeta(evento) {
  evento.preventDefault();
  if (!usuarioActual || operacionEnProceso) return;

  const tipo = $("tipo-tarjeta").value;
  if (!TIPOS_TARJETA[tipo]) return;

  $("guardar-tarjeta").disabled = true;

  try {
    const { error } = await db.from("demo_cards")
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
    $("guardar-tarjeta").disabled = false;
  }
}

async function eliminarTarjeta(id) {
  if (operacionEnProceso) return;

  if (!window.confirm(
    "¿Eliminar esta tarjeta ficticia? " +
    "No se borrará tu saldo."
  )) return;

  const { error } = await db.from("demo_cards")
    .delete()
    .eq("id", id)
    .eq("user_id", usuarioActual.id);

  if (error) {
    mensaje(error.message);
    return;
  }

  await cargarTarjetas();
  mensaje("Tarjeta DEMO eliminada.");
}

function abrirTarjetas() {
  ocultarPaneles();
  $("panel-tarjetas").hidden = false;
  irA("panel-tarjetas");
}

// 9. RECARGAS
function llenarMontos() {
  const select = $("monto-recarga");
  select.replaceChildren();

  for (let monto = 100; monto <= 5000; monto += 100) {
    const op = document.createElement("option");
    op.value = monto;
    op.textContent = dinero(monto * 100);
    if (monto === 500) op.selected = true;
    select.appendChild(op);
  }
}

function actualizarResumenRecarga() {
  const monto = Number($("monto-recarga").value);
  const centavos = monto * 100;

  $("resumen-monto").textContent = dinero(centavos);
  $("resumen-comision").textContent = dinero(COMISION);
  $("resumen-total").textContent =
    dinero(centavos + COMISION);
}

function abrirRecarga() {
  if (!tarjetas.length) {
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
  const tarjeta = tarjetas.find(
    t => t.id === $("tarjeta-recarga").value
  );

  if (!Number.isInteger(monto) ||
      monto < 100 || monto > 5000 ||
      monto % 100 !== 0 || !tarjeta) {
    mensaje("Importe o tarjeta DEMO inválidos.");
    return;
  }

  const tipo = TIPOS_TARJETA[tarjeta.card_type];
  if (!tipo) return;

  const centavos = monto * 100;

  const confirmar = window.confirm(
    "RECARGA BRASA WALLET · DEMO\n\n" +
    "Tarjeta: " + tipo.nombre +
    " •••• " + tipo.terminacion + "\n" +
    "Recarga: " + dinero(centavos) + "\n" +
    "Comisión: " + dinero(COMISION) + "\n" +
    "TOTAL SIMULADO: " +
    dinero(centavos + COMISION) + "\n\n" +
    "No se cobrará dinero real.\n\n" +
    "¿Confirmar?"
  );

  if (!confirmar) return;

  bloquearOperaciones(true);
  mensaje("Procesando recarga DEMO...");

  let recargaConfirmada = false;

  try {
    const { data, error } = await db.rpc(
      "brasa_demo_topup",
      { p_amount_cents: centavos }
    );

    if (error) throw error;
    if (!data?.success) {
      throw new Error("No se recibió confirmación.");
    }

    recargaConfirmada = true;

    $("saldo").textContent =
      dinero(data.balance_cents);

    mostrarTicket({
      titulo: "¡Recarga registrada!",
      tipo: "Recarga DEMO",
      concepto: tipo.nombre + " •••• " + tipo.terminacion,
      importe: data.recharged_cents,
      comision: data.fee_cents,
      total: data.simulated_total_cents,
      saldo: data.balance_cents,
      folio: data.reference
    });

  } catch (error) {
    mensaje(
      "No se pudo completar o verificar la recarga: " +
      error.message +
      ". Revisa tu saldo antes de reintentar."
    );
  } finally {
    bloquearOperaciones(false);
  }

  if (recargaConfirmada) {
    await cargarSaldo();
  }
}

// 10. COMERCIOS Y QR
async function cargarComercios() {
  const { data, error } = await db
    .from("brasa_merchants")
    .select("slug, name, active")
    .eq("active", true)
    .order("name");

  if (error) {
    mensaje(
      "Error al cargar establecimientos: " +
      error.message
    );
    return;
  }

  comercios = data || [];

  const select = $("establecimiento");
  select.replaceChildren();

  const inicial = document.createElement("option");
  inicial.value = "";
  inicial.textContent = "Selecciona un establecimiento";
  select.appendChild(inicial);

  for (const comercio of comercios) {
    const op = document.createElement("option");
    op.value = comercio.slug;
    op.textContent = comercio.name;
    select.appendChild(op);
  }

  dibujarQR();
}

function urlComercio(slug) {
  const url = new URL(
    window.location.origin + window.location.pathname
  );
  url.searchParams.set("merchant", slug);
  return url.toString();
}

function dibujarQR() {
  const lista = $("lista-qr");
  lista.replaceChildren();

  for (const comercio of comercios) {
    const caja = document.createElement("div");
    caja.className = "qr-negocio";

    const titulo = document.createElement("h4");
    titulo.textContent = comercio.name;

    const contenedor = document.createElement("div");
    contenedor.className = "qr-imagen";

    const canvas = document.createElement("canvas");
    contenedor.appendChild(canvas);

    const enlace = document.createElement("a");
    enlace.href = urlComercio(comercio.slug);
    enlace.textContent = "Abrir enlace del establecimiento";

    caja.append(titulo, contenedor, enlace);
    lista.appendChild(caja);

    if (window.QRCode?.toCanvas) {
      window.QRCode.toCanvas(
        canvas,
        urlComercio(comercio.slug),
        {
          width: 185,
          margin: 3,
          errorCorrectionLevel: "M",
          color: {
            dark: "#21130d",
            light: "#ffffff"
          }
        },
        error => {
          if (error) {
            contenedor.textContent =
              "No se pudo generar el QR.";
          }
        }
      );
    } else {
      contenedor.textContent =
        "QR no disponible. Utiliza el enlace.";
    }
  }
}

function abrirPago(slug = "") {
  ocultarPaneles();
  $("panel-pago").hidden = false;

  if (slug && comercios.some(c => c.slug === slug)) {
    $("establecimiento").value = slug;
  }

  actualizarResumenPago();
  irA("panel-pago");
}

function actualizarResumenPago() {
  const slug = $("establecimiento").value;
  const comercio = comercios.find(c => c.slug === slug);

  // Validación de centavos para no generar
  // importes con decimales imprecisos.
  const texto = $("importe-pago").value.trim();
  const monto = Number(texto);
  const centavos = Math.round(monto * 100);

  const valido =
    texto !== "" &&
    Number.isFinite(monto) &&
    /^\d+(\.\d{1,2})?$/.test(texto) &&
    centavos >= 100 &&
    centavos <= 500000;

  $("pago-comercio").textContent =
    comercio?.name || "—";

  $("pago-importe").textContent =
    valido ? dinero(centavos) : "$0.00";

  $("pago-total").textContent =
    valido ? dinero(centavos) : "$0.00";

  $("confirmar-pago").disabled =
    !valido || !comercio || operacionEnProceso;
}

// 11. PAGOS
async function confirmarPago(evento) {
  evento.preventDefault();

  if (!usuarioActual || operacionEnProceso) return;

  const slug = $("establecimiento").value;
  const comercio = comercios.find(c => c.slug === slug);

  const texto = $("importe-pago").value.trim();
  const monto = Number(texto);
  const centavos = Math.round(monto * 100);

  if (!comercio ||
      !/^\d+(\.\d{1,2})?$/.test(texto) ||
      !Number.isFinite(monto) ||
      centavos < 100 ||
      centavos > 500000) {
    mensaje("Selecciona un negocio y un importe válido.");
    return;
  }

  const confirmar = window.confirm(
    "PAGO BRASA WALLET · DEMO\n\n" +
    "Establecimiento: " + comercio.name + "\n" +
    "Compra: " + dinero(centavos) + "\n" +
    "Comisión: $0.00\n\n" +
    "TOTAL A DESCONTAR: " + dinero(centavos) +
    "\n\nEsta compra es ficticia.\n\n" +
    "¿Confirmar pago?"
  );

  if (!confirmar) return;

  bloquearOperaciones(true);
  mensaje("Procesando pago DEMO...");

  let pagoConfirmado = false;

  try {
    const { data, error } = await db.rpc(
      "brasa_demo_pay",
      {
        p_merchant_slug: slug,
        p_amount_cents: centavos
      }
    );

    if (error) throw error;

    if (!data?.success) {
      throw new Error(
        "El servidor no confirmó el pago."
      );
    }

    pagoConfirmado = true;

    $("saldo").textContent =
      dinero(data.balance_cents);

    mostrarTicket({
      titulo: "¡Pago realizado!",
      tipo: "Compra DEMO",
      concepto: data.merchant_name,
      importe: -data.paid_cents,
      comision: 0,
      total: data.paid_cents,
      saldo: data.balance_cents,
      folio: data.reference
    });

    $("importe-pago").value = "";

    // Quitar el parámetro del QR después del pago
    // para no reabrirlo al actualizar la página.
    const url = new URL(window.location.href);
    url.searchParams.delete("merchant");
    window.history.replaceState({}, "", url);

  } catch (error) {
    mensaje(
      "Pago no completado o no verificado: " +
      error.message +
      ". Revisa el historial antes de reintentar."
    );
  } finally {
    bloquearOperaciones(false);
    actualizarResumenPago();
  }

  if (pagoConfirmado) {
    await cargarSaldo();
  }
}

// 12. COMPROBANTES
function mostrarTicket(info) {
  $("ticket-titulo").textContent = info.titulo;
  $("ticket-tipo").textContent = info.tipo;
  $("ticket-concepto").textContent = info.concepto;
  $("ticket-importe").textContent = dinero(info.importe);
  $("ticket-comision").textContent = dinero(info.comision);
  $("ticket-total").textContent = dinero(info.total);
  $("ticket-saldo").textContent = dinero(info.saldo);
  $("ticket-fecha").textContent = fechaLocal();
  $("ticket-folio").textContent = info.folio;

  ocultarPaneles();
  $("panel-comprobante").hidden = false;
  irA("panel-comprobante");

  mensaje("Operación DEMO registrada correctamente.");
}

// 13. CERRAR SESIÓN
async function cerrarSesion() {
  if (operacionEnProceso) return;

  const { error } = await db.auth.signOut();

  if (error) {
    mensaje(error.message);
    return;
  }

  mostrarAcceso();
  $("form-acceso").reset();
  mensaje("Sesión cerrada.");
}

// 14. EVENTOS
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

// 15. INICIAR APLICACIÓN
async function iniciarApp() {
  llenarMontos();
  actualizarResumenRecarga();
  actualizarResumenPago();
  await cargarUsuario();
}

iniciarApp();
