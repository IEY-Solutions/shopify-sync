// index.js
// -----------------------------------------------------------------------------
// Punto de entrada del middleware. Carga el .env y elige el modo segun args:
//
//   node src/index.js --sku IEY-XXX           -> prueba 1 SKU (lee de Contabilium)
//   node src/index.js --sku IEY-XXX --qty 5   -> prueba 1 SKU con cantidad fija
//   node src/index.js                         -> sync INCREMENTAL, UNA vez (rapido)
//   node src/index.js --full                  -> sync COMPLETO, UNA vez (~26 min)
//   node src/index.js --cron                  -> incremental c/1 min + completo diario
// -----------------------------------------------------------------------------

import "dotenv/config"; // carga las variables del .env (requisito 2)
import cron from "node-cron";
import { syncUnSku, syncTodos } from "./sync.js";
import { evaluarCorrida, UMBRAL_ERROR_DEFECTO } from "./resultado.js";

// --- Parseo simple de argumentos de linea de comandos ---
const args = process.argv.slice(2);

function getFlag(nombre) {
  const i = args.indexOf(nombre);
  return i !== -1 ? args[i + 1] : null;
}

const sku = getFlag("--sku");
const qtyRaw = getFlag("--qty");
const esCron = args.includes("--cron");
const esFull = args.includes("--full");

// --- Modo 1: prueba de 1 SKU ---
if (sku) {
  const manualQty = qtyRaw !== null ? Number(qtyRaw) : null;
  if (manualQty !== null && !Number.isFinite(manualQty)) {
    console.error("El valor de --qty debe ser un numero entero.");
    process.exit(1);
  }
  syncUnSku(sku, manualQty).catch((err) => {
    console.error(`[FATAL] ${err.message}`);
    process.exit(1);
  });
}

// --- Modo 2: cron (requisito 14) ---
// Incremental cada 1 minuto (rapido) + reconciliacion completa diaria a las 04:00.
else if (esCron) {
  console.log(
    "[Cron] Incremental cada 1 min. (Reconciliacion --full diaria DESACTIVADA hasta tener el flujo inverso.) Ctrl+C para detener."
  );

  // Guard anti-solapamiento: una corrida (sobre todo la completa) puede tardar
  // mas que el intervalo. Si ya hay una en curso, salteamos el tick.
  let corriendo = false;

  async function correr(opciones) {
    if (corriendo) {
      console.warn("[Cron] Corrida anterior aun en curso, salteando este tick.");
      return;
    }
    corriendo = true;
    try {
      await syncTodos(opciones);
    } catch (err) {
      // Un fallo NO debe matar el cron: logueamos y esperamos el proximo tick.
      console.error(`[Cron][ERROR] ${err.message}`);
    } finally {
      corriendo = false;
    }
  }

  cron.schedule("*/1 * * * *", () => correr({ full: false })); // incremental cada minuto
  // Reconciliacion completa diaria: DESACTIVADA por ahora. Mientras no exista el
  // flujo inverso (ventas DOT -> Contabilium), un --full podria re-inflar en
  // Shopify stock ya vendido online desde DOT. Reactivar cuando ese flujo exista.
  // cron.schedule("0 4 * * *", () => correr({ full: true }));
  correr({ full: false }); // primera incremental inmediata
}

// --- Modo 3: sync una sola vez (incremental por default, completo con --full) ---
else {
  // El guardarrail vive en resultado.js para poder testearlo sin ejecutar este
  // archivo (que corre al importarse). Ver test/resultado.test.js.
  const UMBRAL_ERROR = Number(process.env.UMBRAL_ERROR ?? String(UMBRAL_ERROR_DEFECTO));

  syncTodos({ full: esFull })
    .then((r) => {
      const veredicto = evaluarCorrida(r, UMBRAL_ERROR);
      if (!veredicto.ok) {
        console.error(`[FALLO] ${veredicto.motivo}`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(`[FATAL] ${err.message}`);
      process.exit(1);
    });
}
