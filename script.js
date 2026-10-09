
/* ==========================================
   BRASA WALLET
   Festival del Fuego · El Sabor de la Brasa
   Tarjetas, recargas e historial DEMO
========================================== */

// ==========================================
// 1. CONEXIÓN CON SUPABASE
// ==========================================

const SUPABASE_URL =
  "https://spauudjoiuyyepdoeybh.supabase.co";

// Clave pública transcrita anteriormente.
// Si falla la conexión, cotejar con Supabase.
const SUPABASE_PUBLIC_KEY =
  "sb_publishable_iC0A7ougnKtYjs036m5J_A_v7SYdWlk";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLIC_KEY
);

// ==========================================
// 2. VARIABLES
// ==========================================

const $ = (id) => document.getElementById(id);

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
let recargaEnProceso = false;
let tarjetas = [];

// ==========================================
// 3. FUNCIONES GENERALES
// ==========================================

function dinero(centavos) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(Number(centavos || 0) / 100);
}

function mensaje(texto) {
  $("mensaje").textContent = texto;
}

function ocultarPaneles() {
  $("panel-tarjetas").hidden = true;
  $("panel-recarga").hidden = true;
  $("panel-comprobante").hidden = true;
}

function mostrarAcceso() {
  usuarioActual = null;
  tarjetas = [];

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

function irA(id) {
  $(id).scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function fechaLocal(valor) {
  return new Date(valor).toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

// ==========================================
// 4. REGISTRO E INICIO DE SESIÓN
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

  mensaje("Procesando solicitud...");

  try {
    const email = $("correo").value.trim();
    const password = $("contrasena").value;

    if (modoRegistro) {
      const nombre = $("nombre").value.trim();

      if (!nombre) {
        throw new Error(
          "Escribe tu nombre completo."
        );
      }

      const { data, error } =
        await db.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: nombre
            },
            emailRedirectTo:
              window.location.origin +
              window.location.pathname
          }
        });

      if (error) throw error;

      if (!data.session) {
        mensaje(
          "Revisa tu correo y confirma tu cuenta. " +
          "Después inicia sesión."
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
    mensaje(
      "No se pudo completar: " +
      error.message
    );
  } finally {
    boton.disabled = false;
  }
}

// ==========================================
// 5. USUARIO Y SALDO
// ==========================================

async function cargarUsuario() {
  const { data, error } =
    await db.auth.getUser();

  if (error || !data.user) {
    mostrarAcceso();
    return;
  }

  usuarioActual = data.user;
  mostrarWallet();

  const { data: perfil } =
    await db.from("profiles")
      .select("full_name")
      .eq("id", usuarioActual.id)
      .maybeSingle();

  $("nombre-usuario").textContent =
    perfil?.full_name ||
    usuarioActual.user_metadata?.full_name ||
    "Visitante";

  await cargarSaldo();
  await cargarTarjetas();
}

async function cargarSaldo() {
  if (!usuarioActual) return;

  const { data: wallet, error } =
    await db.from("wallets")
      .select("id, balance_cents")
      .eq("user_id", usuarioActual.id)
      .maybeSingle();

  if (error) {
    mensaje(
      "Error al cargar saldo: " +
      error.message
    );
    return;
  }

  if (!wallet) {
    $("saldo").textContent = "No disponible";
    mensaje("No se encontró tu monedero.");
    return;
  }

  $("saldo").textContent =
    dinero(wallet.balance_cents);

  await cargarHistorial(wallet.id);
}

// ==========================================
// 6. HISTORIAL
// ==========================================

async function cargarHistorial(walletId) {
  const { data, error } =
    await db.from("wallet_transactions")
      .select(
        "id, type, amount_cents, " +
        "description, created_at, reference"
      )
      .eq("wallet_id", walletId)
      .order("created_at", {
        ascending: false
      })
      .limit(40);

  const lista = $("lista-movimientos");
  lista.replaceChildren();

  if (error) {
    mensaje(
      "Error al cargar historial: " +
      error.message
    );
    return;
  }

  if (!data || data.length === 0) {
    const aviso = document.createElement("p");

    aviso.textContent =
      "Todavía no tienes movimientos.";

    lista.appendChild(aviso);
    return;
  }

  for (const mov of data) {
    const fila = document.createElement("div");
    fila.className = "movimiento-item";

    const detalle = document.createElement("p");
    detalle.textContent =
      mov.description +
      " · " +
      fechaLocal(mov.created_at);

    const importe = document.createElement("strong");
    const valor = Number(mov.amount_cents);

    importe.textContent =
      (valor > 0 ? "+" : "") +
      dinero(valor);

    fila.append(detalle, importe);
    lista.appendChild(fila);
  }
}

// ==========================================
// 7. CONSULTAR TARJETAS DEMO
// ==========================================

async function cargarTarjetas() {
  if (!usuarioActual) return;

  const { data, error } =
    await db.from("demo_cards")
      .select("id, card_type, created_at")
      .eq("user_id", usuarioActual.id)
      .order("created_at", {
        ascending: true
      });

  if (error) {
    mensaje(
      "Error al cargar tarjetas: " +
      error.message
    );
    return;
  }

  tarjetas = data || [];

  dibujarTarjetas();
  actualizarSelectorTarjetas();
}

function dibujarTarjetas() {
  const lista = $("lista-tarjetas");
  lista.replaceChildren();

  if (tarjetas.length === 0) {
    const aviso = document.createElement("p");
    aviso.className = "secundario";

    aviso.textContent =
      "Todavía no tienes tarjetas DEMO.";

    lista.appendChild(aviso);
    return;
  }

  for (const tarjeta of tarjetas) {
    const tipo = TIPOS_TARJETA[tarjeta.card_type];
    if (!tipo) continue;

    const visual = document.createElement("div");
    visual.className =
      "tarjeta-demo " + tipo.clase;

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

    const titular = document.createElement("span");
    titular.textContent = "TARJETA FICTICIA";

    const vigencia = document.createElement("span");
    vigencia.textContent = "SIN VENCIMIENTO";

    pie.append(titular, vigencia);

    const eliminar = document.createElement("button");
    eliminar.type = "button";
    eliminar.className = "eliminar-tarjeta";
    eliminar.textContent = "Eliminar tarjeta DEMO";

    eliminar.addEventListener("click", () => {
      eliminarTarjeta(tarjeta.id);
    });

    visual.append(
      superior,
      chip,
      numero,
      pie,
      eliminar
    );

    lista.appendChild(visual);
  }
}

function actualizarSelectorTarjetas() {
  const select = $("tarjeta-recarga");
  select.replaceChildren();

  if (tarjetas.length === 0) {
    const opcion = document.createElement("option");

    opcion.value = "";
    opcion.textContent =
      "Primero registra una tarjeta DEMO";

    select.appendChild(opcion);
    return;
  }

  for (const tarjeta of tarjetas) {
    const tipo = TIPOS_TARJETA[tarjeta.card_type];
    if (!tipo) continue;

    const opcion = document.createElement("option");

    opcion.value = tarjeta.id;

    opcion.textContent =
      tipo.nombre +
      " · •••• " +
      tipo.terminacion;

    select.appendChild(opcion);
  }
}

// ==========================================
// 8. REGISTRAR TARJETA DEMO
// ==========================================

async function guardarTarjeta(evento) {
  evento.preventDefault();

  if (!usuarioActual) return;

  const tipo = $("tipo-tarjeta").value;

  if (!TIPOS_TARJETA[tipo]) {
    mensaje("Selecciona una tarjeta válida.");
    return;
  }

  const boton = $("guardar-tarjeta");
  boton.disabled = true;

  try {
    const { error } =
      await db.from("demo_cards")
        .insert({
          user_id: usuarioActual.id,
          card_type: tipo
        });

    if (error) {
      if (error.code === "23505") {
        throw new Error(
          "Esa tarjeta DEMO ya está registrada."
        );
      }

      throw error;
    }

    await cargarTarjetas();

    mensaje("Tarjeta DEMO registrada.");

  } catch (error) {
    mensaje(error.message);

  } finally {
    boton.disabled = false;
  }
}

async function eliminarTarjeta(id) {
  if (!usuarioActual) return;

  const confirmar = window.confirm(
    "¿Eliminar esta tarjeta ficticia?\n\n" +
    "No se borrará tu saldo ni tu historial."
  );

  if (!confirmar) return;

  const { error } =
    await db.from("demo_cards")
      .delete()
      .eq("id", id)
      .eq("user_id", usuarioActual.id);

  if (error) {
    mensaje(
      "No se pudo eliminar: " +
      error.message
    );
    return;
  }

  await cargarTarjetas();
  mensaje("Tarjeta DEMO eliminada.");
}

// ==========================================
// 9. ABRIR Y CERRAR PANELES
// ==========================================

function ocultarPaneles() {
  $("panel-tarjetas").hidden = true;
  $("panel-recarga").hidden = true;
  $("panel-comprobante").hidden = true;
}

function irA(id) {
  $(id).scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function abrirTarjetas() {
  ocultarPaneles();

  $("panel-tarjetas").hidden = false;

  cargarTarjetas();
  irA("panel-tarjetas");
}

function abrirRecarga() {
  if (tarjetas.length === 0) {
    abrirTarjetas();

    mensaje(
      "Primero registra una tarjeta ficticia " +
      "para poder recargar."
    );

    return;
  }

  ocultarPaneles();
  actualizarResumen();

  $("panel-recarga").hidden = false;

  mensaje("");
  irA("panel-recarga");
}

// ==========================================
// 10. MONTOS Y COMISIÓN
// ==========================================

function llenarMontos() {
  const select = $("monto-recarga");
  select.replaceChildren();

  for (let monto = 100; monto <= 5000; monto += 100) {
    const opcion = document.createElement("option");

    opcion.value = String(monto);
    opcion.textContent = dinero(monto * 100);

    if (monto === 500) {
      opcion.selected = true;
    }

    select.appendChild(opcion);
  }
}

function montoValido(monto) {
  return (
    Number.isInteger(monto) &&
    monto >= 100 &&
    monto <= 5000 &&
    monto % 100 === 0
  );
}

function actualizarResumen() {
  const monto = Number($("monto-recarga").value);

  if (!montoValido(monto)) {
    $("confirmar-recarga").disabled = true;
    return;
  }

  const centavos = monto * 100;

  $("resumen-monto").textContent =
    dinero(centavos);

  $("resumen-comision").textContent =
    dinero(COMISION);

  $("resumen-total").textContent =
    dinero(centavos + COMISION);

  $("confirmar-recarga").disabled =
    recargaEnProceso;
}

// ==========================================
// 11. CONFIRMAR RECARGA DEMO
// ==========================================

async function confirmarRecarga(evento) {
  evento.preventDefault();

  if (!usuarioActual || recargaEnProceso) return;

  const monto = Number($("monto-recarga").value);

  if (!montoValido(monto)) {
    mensaje("Selecciona un importe válido.");
    return;
  }

  const tarjetaId = $("tarjeta-recarga").value;

  const tarjeta = tarjetas.find(
    (t) => t.id === tarjetaId
  );

  if (!tarjeta) {
    mensaje("Selecciona una tarjeta registrada.");
    return;
  }

  const info = TIPOS_TARJETA[tarjeta.card_type];

  if (!info) {
    mensaje("Tarjeta DEMO no válida.");
    return;
  }

  const centavos = monto * 100;
  const total = centavos + COMISION;

  const confirmado = window.confirm(
    "BRASA WALLET · PAGO DEMO\n\n" +
    "Tarjeta: " + info.nombre +
    " · " + info.terminacion + "\n\n" +
    "Recarga: " + dinero(centavos) + "\n" +
    "Comisión: " + dinero(COMISION) + "\n" +
    "Total: " + dinero(total) + "\n\n" +
    "NO se cobrará dinero real.\n\n" +
    "¿Confirmar recarga ficticia?"
  );

  if (!confirmado) return;

  recargaEnProceso = true;

  const boton = $("confirmar-recarga");
  boton.disabled = true;
  boton.textContent = "Procesando pago DEMO...";

  mensaje("Registrando recarga ficticia...");

  try {
    // Abonar mediante la función SQL
    // que ya configuramos en Supabase.
    const { data, error } =
      await db.rpc("brasa_demo_topup", {
        p_amount_cents: centavos
      });

    if (error) throw error;

    if (!data?.success) {
      throw new Error(
        "Supabase no confirmó la recarga."
      );
    }

    $("saldo").textContent =
      dinero(data.balance_cents);

    // Preparar el comprobante.
    $("ticket-monto").textContent =
      dinero(data.recharged_cents);

    $("ticket-comision").textContent =
      dinero(data.fee_cents);

    $("ticket-total").textContent =
      dinero(data.simulated_total_cents);

    $("ticket-tarjeta").textContent =
      info.nombre + " · " + info.terminacion;

    $("ticket-fecha").textContent =
      fechaLocal(new Date());

    $("ticket-folio").textContent =
      data.reference;

    ocultarPaneles();

    $("panel-comprobante").hidden = false;
    irA("panel-comprobante");

    mensaje(
      "Recarga DEMO registrada correctamente."
    );

    // Consultar movimientos nuevos.
    // No repetir la recarga si falla la lectura.
    await cargarSaldo();

  } catch (error) {
    mensaje(
      "No se pudo completar o verificar " +
      "la recarga: " + error.message +
      ". Revisa tu saldo e historial " +
      "antes de volver a intentarlo."
    );

  } finally {
    recargaEnProceso = false;

    boton.disabled = false;
    boton.textContent = "Confirmar pago DEMO";
  }
}

// ==========================================
// 12. CERRAR SESIÓN
// ==========================================

async function cerrarSesion() {
  if (recargaEnProceso) return;

  const { error } = await db.auth.signOut();

  if (error) {
    mensaje(
      "Error al cerrar sesión: " +
      error.message
    );
    return;
  }

  mostrarAcceso();

  $("form-acceso").reset();

  mensaje("Sesión cerrada correctamente.");
}

// ==========================================
// 13. EVENTOS
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
    if (!recargaEnProceso) {
      $("panel-recarga").hidden = true;
    }
  }
);

$("monto-recarga").addEventListener(
  "change", actualizarResumen
);

$("form-recarga").addEventListener(
  "submit", confirmarRecarga
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

$("btn-pagar").addEventListener(
  "click", () => {
    mensaje(
      "Los pagos por QR estarán disponibles " +
      "en nuestra siguiente fase."
    );
  }
);

// ==========================================
// 14. INICIAR BRASA WALLET
// ==========================================

async function iniciarApp() {
  llenarMontos();
  actualizarResumen();

  await cargarUsuario();
}

iniciarApp();
