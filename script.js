
/* =========================================
   BRASA WALLET
   FESTIVAL DEL FUEGO · EL SABOR DE LA BRASA
   Versión DEMO · Sin dinero real
========================================= */

// =========================================
// 1. CONEXIÓN A SUPABASE
// =========================================

// URL del proyecto Brasa Wallet.
const SUPABASE_URL =
  "https://spauudjoiuyyepdoeybh.supabase.co";

// Clave pública utilizada anteriormente.
// Si Supabase rechaza la conexión, verifica
// que coincida con la clave Publishable del panel.
const SUPABASE_PUBLIC_KEY =
  "sb_publishable_iC0A7ougnKtYjs036m5J_A_v7SYdWlk";

const configurado =
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_PUBLIC_KEY.startsWith("sb_publishable_") &&
  typeof window.supabase !== "undefined";

const db = configurado
  ? window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLIC_KEY
    )
  : null;

// =========================================
// 2. ELEMENTOS Y VARIABLES
// =========================================

const $ = (id) => document.getElementById(id);

let modoRegistro = false;
let usuarioActual = null;
let recargaEnProceso = false;

const COMISION_CENTAVOS = 2000;
const MONTO_MINIMO = 100;
const MONTO_MAXIMO = 5000;
const INCREMENTO = 100;

// =========================================
// 3. FUNCIONES GENERALES
// =========================================

function formatoMoneda(centavos) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(Number(centavos || 0) / 100);
}

function mensaje(texto) {
  $("mensaje").textContent = texto;
}

function mostrarAcceso() {
  usuarioActual = null;

  $("pantalla-acceso").hidden = false;
  $("pantalla-wallet").hidden = true;
  $("panel-recarga").hidden = true;

  $("saldo").textContent = "$0.00";
  $("lista-movimientos").replaceChildren();
}

function mostrarWallet() {
  $("pantalla-acceso").hidden = true;
  $("pantalla-wallet").hidden = false;
}

// =========================================
// 4. REGISTRO E INICIO DE SESIÓN
// =========================================

function cambiarModo() {
  modoRegistro = !modoRegistro;

  $("campo-nombre").hidden = !modoRegistro;

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

  $("nombre").required = modoRegistro;

  mensaje("");
}

async function procesarAcceso(evento) {
  evento.preventDefault();

  if (!db) {
    mensaje(
      "No se pudo iniciar la conexión con Supabase."
    );
    return;
  }

  const correo = $("correo").value.trim();
  const contrasena = $("contrasena").value;
  const nombre = $("nombre").value.trim();

  const boton = $("boton-acceso");

  boton.disabled = true;
  mensaje("Procesando solicitud...");

  try {
    if (modoRegistro) {
      if (!nombre) {
        throw new Error(
          "Escribe tu nombre completo."
        );
      }

      const { data, error } =
        await db.auth.signUp({
          email: correo,
          password: contrasena,
          options: {
            data: {
              full_name: nombre
            },
            emailRedirectTo:
              window.location.origin +
              window.location.pathname
          }
        });

      if (error) {
        throw error;
      }

      if (!data.session) {
        mensaje(
          "Revisa tu correo electrónico y " +
          "confirma tu cuenta. Después inicia sesión."
        );
      } else {
        await cargarUsuario();
      }

    } else {
      const { error } =
        await db.auth.signInWithPassword({
          email: correo,
          password: contrasena
        });

      if (error) {
        throw error;
      }

      mensaje("");
      await cargarUsuario();
    }

  } catch (error) {
    mensaje(
      "No se pudo completar la solicitud: " +
      error.message
    );

  } finally {
    boton.disabled = false;
  }
}

// =========================================
// 5. CARGAR PERFIL
// =========================================

async function cargarUsuario() {
  if (!db) return;

  const { data, error } =
    await db.auth.getUser();

  if (error || !data.user) {
    mostrarAcceso();
    return;
  }

  usuarioActual = data.user;

  mostrarWallet();

  const { data: perfil, error: perfilError } =
    await db
      .from("profiles")
      .select("full_name")
      .eq("id", usuarioActual.id)
      .maybeSingle();

  if (perfilError) {
    mensaje(
      "No se pudo consultar el perfil: " +
      perfilError.message
    );
  }

  $("nombre-usuario").textContent =
    perfil?.full_name ||
    usuarioActual.user_metadata?.full_name ||
    "Visitante";

  await cargarSaldo();
}

// =========================================
// 6. CONSULTAR SALDO
// =========================================

async function cargarSaldo() {
  if (!db || !usuarioActual) return;

  const { data: wallet, error } =
    await db
      .from("wallets")
      .select("id, balance_cents")
      .eq("user_id", usuarioActual.id)
      .maybeSingle();

  if (error) {
    mensaje(
      "Error al consultar el saldo: " +
      error.message
    );
    return;
  }

  if (!wallet) {
    $("saldo").textContent = "No disponible";
    mensaje(
      "No encontramos tu monedero digital."
    );
    return;
  }

  $("saldo").textContent =
    formatoMoneda(wallet.balance_cents);

  await cargarMovimientos(wallet.id);
}

// =========================================
// 7. HISTORIAL DE MOVIMIENTOS
// =========================================

async function cargarMovimientos(walletId) {
  const { data, error } =
    await db
      .from("wallet_transactions")
      .select(
        "id, type, amount_cents, " +
        "description, merchant_name, created_at"
      )
      .eq("wallet_id", walletId)
      .order("created_at", {
        ascending: false
      })
      .limit(30);

  const lista = $("lista-movimientos");
  lista.replaceChildren();

  if (error) {
    mensaje(
      "Error al cargar el historial: " +
      error.message
    );
    return;
  }

  if (!data || data.length === 0) {
    const vacio = document.createElement("p");

    vacio.textContent =
      "Todavía no tienes movimientos.";

    lista.appendChild(vacio);
    return;
  }

  for (const movimiento of data) {
    const elemento = document.createElement("div");
    elemento.className = "movimiento-item";

    const detalle = document.createElement("p");

    const fecha = new Date(
      movimiento.created_at
    ).toLocaleString("es-MX", {
      dateStyle: "short",
      timeStyle: "short"
    });

    detalle.textContent =
      movimiento.description +
      " · " +
      fecha;

    const importe = document.createElement("strong");

    const cantidad =
      Number(movimiento.amount_cents);

    importe.textContent =
      (cantidad > 0 ? "+" : "") +
      formatoMoneda(cantidad);

    elemento.append(detalle, importe);

    lista.appendChild(elemento);
  }
}

// =========================================
// 8. FORMULARIO DE RECARGAS
// =========================================

function abrirRecarga() {
  $("panel-recarga").hidden = false;

  actualizarResumenRecarga();

  $("panel-recarga").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  mensaje("");
}

function cerrarRecarga() {
  if (recargaEnProceso) return;

  $("panel-recarga").hidden = true;
  mensaje("");
}

function montoValido(monto) {
  return (
    Number.isInteger(monto) &&
    monto >= MONTO_MINIMO &&
    monto <= MONTO_MAXIMO &&
    monto % INCREMENTO === 0
  );
}

function actualizarResumenRecarga() {
  const monto =
    Number($("monto-recarga").value);

  if (!montoValido(monto)) {
    $("confirmar-recarga").disabled = true;

    mensaje(
      "Selecciona un importe válido " +
      "entre $100 y $5,000."
    );

    return;
  }

  $("confirmar-recarga").disabled =
    recargaEnProceso;

  const montoCentavos = monto * 100;

  $("resumen-monto").textContent =
    formatoMoneda(montoCentavos);

  $("resumen-comision").textContent =
    formatoMoneda(COMISION_CENTAVOS);

  $("resumen-total").textContent =
    formatoMoneda(
      montoCentavos + COMISION_CENTAVOS
    );
}

// =========================================
// 9. CONFIRMAR RECARGA DEMO
// =========================================

async function confirmarRecarga(evento) {
  evento.preventDefault();

  if (!db || !usuarioActual || recargaEnProceso) {
    return;
  }

  const monto =
    Number($("monto-recarga").value);

  if (!montoValido(monto)) {
    mensaje(
      "La recarga debe ser de $100 a $5,000 " +
      "en incrementos de $100."
    );
    return;
  }

  const montoCentavos = monto * 100;

  const totalCentavos =
    montoCentavos + COMISION_CENTAVOS;

  const confirmado = window.confirm(
    "BRASA WALLET · RECARGA DEMO\n\n" +
    "Saldo a recibir: " +
    formatoMoneda(montoCentavos) + "\n" +
    "Comisión: " +
    formatoMoneda(COMISION_CENTAVOS) + "\n" +
    "Total simulado: " +
    formatoMoneda(totalCentavos) + "\n\n" +
    "Esta operación no utiliza dinero real.\n\n" +
    "¿Confirmas la recarga de demostración?"
  );

  if (!confirmado) return;

  recargaEnProceso = true;

  const boton = $("confirmar-recarga");

  boton.disabled = true;
  boton.textContent = "Procesando recarga...";

  mensaje(
    "Registrando recarga de demostración..."
  );

  try {
    // Supabase ejecuta la función SQL
    // que creamos anteriormente.
    const { data, error } =
      await db.rpc(
        "brasa_demo_topup",
        {
          p_amount_cents: montoCentavos
        }
      );

    if (error) {
      throw error;
    }

    if (!data?.success) {
      throw new Error(
        "Supabase no confirmó la recarga."
      );
    }

    // Actualizar saldo visual con el valor
    // devuelto por la base de datos.
    $("saldo").textContent =
      formatoMoneda(data.balance_cents);

    $("panel-recarga").hidden = true;

    // Mostrar comprobante.
    mensaje(
      "¡Recarga DEMO exitosa! " +
      "Saldo abonado: " +
      formatoMoneda(data.recharged_cents) +
      ". Comisión simulada: " +
      formatoMoneda(data.fee_cents) +
      ". Folio: " +
      data.reference
    );

    // Actualizar historial sin repetir recarga.
    const { data: wallet, error: walletError } =
      await db
        .from("wallets")
        .select("id")
        .eq("user_id", usuarioActual.id)
        .maybeSingle();

    if (!walletError && wallet) {
      const { data: movimientos } =
        await db
          .from("wallet_transactions")
          .select(
            "id, type, amount_cents, " +
            "description, merchant_name, created_at"
          )
          .eq("wallet_id", wallet.id)
          .order("created_at", {
            ascending: false
          })
          .limit(30);

      if (movimientos) {
        const lista =
          $("lista-movimientos");

        lista.replaceChildren();

        for (const movimiento of movimientos) {
          const elemento =
            document.createElement("div");

          elemento.className =
            "movimiento-item";

          const detalle =
            document.createElement("p");

          const fecha = new Date(
            movimiento.created_at
          ).toLocaleString("es-MX");

          detalle.textContent =
            movimiento.description +
            " · " +
            fecha;

          const importe =
            document.createElement("strong");

          const cantidad =
            Number(movimiento.amount_cents);

          importe.textContent =
            (cantidad > 0 ? "+" : "") +
            formatoMoneda(cantidad);

          elemento.append(detalle, importe);
          lista.appendChild(elemento);
        }
      }
    }

  } catch (error) {
    mensaje(
      "No se pudo completar o verificar " +
      "la recarga: " +
      error.message +
      ". Consulta tu saldo e historial " +
      "antes de volver a intentarlo."
    );

  } finally {
    recargaEnProceso = false;

    boton.disabled = false;

    boton.textContent =
      "Confirmar recarga DEMO";
  }
}

// =========================================
// 10. CERRAR SESIÓN
// =========================================

async function cerrarSesion() {
  if (!db || recargaEnProceso) return;

  const { error } = await db.auth.signOut();

  if (error) {
    mensaje(
      "No se pudo cerrar sesión: " +
      error.message
    );

    return;
  }

  mostrarAcceso();
  $("form-acceso").reset();

  mensaje(
    "Sesión cerrada correctamente."
  );
}

// =========================================
// 11. BOTONES Y EVENTOS
// =========================================

$("form-acceso").addEventListener(
  "submit",
  procesarAcceso
);

$("cambiar-modo").addEventListener(
  "click",
  cambiarModo
);

$("cerrar-sesion").addEventListener(
  "click",
  cerrarSesion
);

$("btn-recargar").addEventListener(
  "click",
  abrirRecarga
);

$("cerrar-recarga").addEventListener(
  "click",
  cerrarRecarga
);

$("monto-recarga").addEventListener(
  "change",
  actualizarResumenRecarga
);

$("form-recarga").addEventListener(
  "submit",
  confirmarRecarga
);

$("btn-pagar").addEventListener(
  "click",
  () => {
    mensaje(
      "Los pagos por QR estarán disponibles " +
      "en la siguiente fase."
    );
  }
);

$("btn-historial").addEventListener(
  "click",
  async () => {
    await cargarSaldo();

    $("lista-movimientos").scrollIntoView({
      behavior: "smooth"
    });
  }
);

// =========================================
// 12. INICIAR BRASA WALLET
// =========================================

async function iniciarApp() {
  if (!db) {
    mensaje(
      "No se pudo iniciar Supabase. " +
      "Revisa la conexión."
    );

    return;
  }

  await cargarUsuario();
  actualizarResumenRecarga();
}

iniciarApp();
