
/* =========================================
   BRASA WALLET · FESTIVAL DEL FUEGO
   Registro, sesión y consulta de saldo
   Todas las cantidades son DEMOSTRATIVAS
========================================= */

// PASO SIGUIENTE: sustituiremos estos valores
// con los datos públicos de nuestro Supabase.
const SUPABASE_URL = "PEGAR_URL_DEL_PROYECTO";
const SUPABASE_PUBLIC_KEY = "PEGAR_CLAVE_PUBLICA";

const configurado =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_PUBLIC_KEY.startsWith("PEGAR_");

const db = configurado
  ? window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLIC_KEY
    )
  : null;

const $ = (id) => document.getElementById(id);

let modoRegistro = false;
let usuarioActual = null;

function mensaje(texto) {
  $("mensaje").textContent = texto;
}

function formatoMoneda(centavos) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(Number(centavos || 0) / 100);
}

function mostrarAcceso() {
  usuarioActual = null;
  $("pantalla-acceso").hidden = false;
  $("pantalla-wallet").hidden = true;
  $("saldo").textContent = "$0.00";
  $("lista-movimientos").replaceChildren();
}

function mostrarWallet() {
  $("pantalla-acceso").hidden = true;
  $("pantalla-wallet").hidden = false;
}

function cambiarModo() {
  modoRegistro = !modoRegistro;

  $("campo-nombre").hidden = !modoRegistro;

  $("titulo-acceso").textContent =
    modoRegistro ? "Crear cuenta" : "Iniciar sesión";

  $("boton-acceso").textContent =
    modoRegistro ? "Registrarme" : "Iniciar sesión";

  $("cambiar-modo").textContent = modoRegistro
    ? "¿Ya tienes cuenta? Inicia sesión"
    : "¿No tienes cuenta? Regístrate";

  $("contrasena").autocomplete = modoRegistro
    ? "new-password"
    : "current-password";

  $("nombre").required = modoRegistro;

  mensaje("");
}

async function procesarAcceso(evento) {
  evento.preventDefault();

  if (!db) {
    mensaje("Falta configurar la conexión con Supabase.");
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
        throw new Error("Escribe tu nombre completo.");
      }

      const { data, error } = await db.auth.signUp({
        email: correo,
        password: contrasena,
        options: {
          data: { full_name: nombre }
        }
      });

      if (error) throw error;

      if (!data.session) {
        mensaje(
          "Revisa tu correo para confirmar tu cuenta. " +
          "Después regresa e inicia sesión."
        );
      } else {
        mensaje("Cuenta creada correctamente.");
        await cargarUsuario();
      }

    } else {
      const { error } =
        await db.auth.signInWithPassword({
          email: correo,
          password: contrasena
        });

      if (error) throw error;

      mensaje("");
      await cargarUsuario();
    }
  } catch (error) {
    mensaje("No se pudo completar: " + error.message);
  } finally {
    boton.disabled = false;
  }
}

async function cargarUsuario() {
  if (!db) return;

  const { data: userData, error: authError } =
    await db.auth.getUser();

  if (authError || !userData.user) {
    mostrarAcceso();
    return;
  }

  usuarioActual = userData.user;
  mostrarWallet();

  const { data: perfil, error: perfilError } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", usuarioActual.id)
    .maybeSingle();

  if (perfilError) {
    mensaje("Error al consultar el perfil: " +
      perfilError.message);
  }

  $("nombre-usuario").textContent =
    perfil?.full_name ||
    usuarioActual.user_metadata?.full_name ||
    "Visitante";

  await cargarSaldo();
}

async function cargarSaldo() {
  if (!db || !usuarioActual) return;

  const { data: wallet, error } = await db
    .from("wallets")
    .select("id, balance_cents")
    .eq("user_id", usuarioActual.id)
    .maybeSingle();

  if (error) {
    mensaje("Error al cargar saldo: " + error.message);
    return;
  }

  if (!wallet) {
    $("saldo").textContent = "No disponible";
    mensaje(
      "No encontramos tu monedero. " +
      "Revisaremos la creación de tu cuenta."
    );
    return;
  }

  $("saldo").textContent =
    formatoMoneda(wallet.balance_cents);

  await cargarMovimientos(wallet.id);
}

async function cargarMovimientos(walletId) {
  const { data, error } = await db
    .from("wallet_transactions")
    .select(
      "id, type, amount_cents, description, " +
      "merchant_name, created_at"
    )
    .eq("wallet_id", walletId)
    .order("created_at", { ascending: false })
    .limit(20);

  const lista = $("lista-movimientos");
  lista.replaceChildren();

  if (error) {
    mensaje("Error al cargar movimientos: " +
      error.message);
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

    const fecha = new Date(
      movimiento.created_at
    ).toLocaleString("es-MX");

    const detalle = document.createElement("p");
    detalle.textContent =
      movimiento.description + " · " + fecha;

    const importe = document.createElement("strong");
    const cantidad = Number(
      movimiento.amount_cents
    );

    importe.textContent =
      (cantidad > 0 ? "+" : "") +
      formatoMoneda(cantidad);

    elemento.append(detalle, importe);
    lista.appendChild(elemento);
  }
}

async function cerrarSesion() {
  if (!db) return;

  const { error } = await db.auth.signOut();

  if (error) {
    mensaje("No se pudo cerrar sesión: " + error.message);
    return;
  }

  mostrarAcceso();
  $("form-acceso").reset();
  mensaje("Sesión cerrada correctamente.");
}

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

$("btn-recargar").addEventListener("click", () => {
  mensaje(
    "Las recargas DEMO estarán disponibles " +
    "en la siguiente fase."
  );
});

$("btn-pagar").addEventListener("click", () => {
  mensaje(
    "Los pagos DEMO por QR estarán disponibles " +
    "en una fase posterior."
  );
});

$("btn-historial").addEventListener("click", async () => {
  await cargarSaldo();
  $("lista-movimientos").scrollIntoView({
    behavior: "smooth"
  });
});

async function iniciarApp() {
  if (!db) {
    mensaje(
      "Brasa Wallet está lista. " +
      "Falta conectar Supabase."
    );
    return;
  }

  await cargarUsuario();
}

iniciarApp();
