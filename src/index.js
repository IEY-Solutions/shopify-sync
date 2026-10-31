// index.js
// -----------------------------------------------------------------------------
// Punto de entrada del middleware. Carga el .env y elige el modo segun args:
//
//   node src/index.js --sku IEY-XXX           -> prueba 1 SKU (lee de Contabilium)
//   node src/index.js --sku IEY-XXX --qty 5   -> prueba 1 SKU con cantidad fija
//   node src/index.js                         -> sync INCREMENTAL, UNA vez (rapido)
//   node src/index.js --full                  -> sync COMPLETO, UNA vez (~26 min)
//   node src/index.js --cron                  -> incremental c/1 min + completo diario
//   node src/index.js --locations             -> diagnostico READ-ONLY del riesgo 1
// -----------------------------------------------------------------------------

import "dotenv/config"; // carga las variables del .env (requisito 2)
import cron from "node-cron";
import { syncUnSku, correrTodosLosPares } from "./sync.js";
import { evaluarCorridaMultiPar, UMBRAL_ERROR_DEFECTO } from "./resultado.js";
import { construirPares } from "./pares.js";

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
const esLocations = args.includes("--locations");

// --- Modo 0: diagnostico de locations (SOLO LECTURA) ---
// Cierra el riesgo 1: sobre que location escribe la integracion nativa 25020.
// No importa setearStock ni emite una sola mutation.
if (esLocations) {
  const { diagnosticarLocations, resumirCoincidencias } = await import("./diagnostico-locations.js");
  diagnosticarLocations()
    .then((r) => {
      if (!r.concluyente) {
        console.error("[FALLO] el diagnostico no pudo leer ninguna fila comparable.");
        process.exit(1);
      }
      console.log("\n--- Coincidencias por location ---");
      for (const c of resumirCoincidencias(r.filas)) {
        const marca = c.locationId === r.locationDot ? "  <-- location DOT" : "";
        console.log(
          `  ${c.location}: coincide con CENTRAL en ${c.comoCentral}/${c.total}, ` +
            `con DOT en ${c.comoDot}/${c.total}${marca}`
        );
      }
      console.log("\n=== Fin diagnostico (0 escrituras) ===\n");
    })
    .catch((err) => {
      console.error(`[FATAL] ${err.message}`);
      process.exit(1);
    });
}

// --- Modo 1: prueba de 1 SKU ---
else if (sku) {
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

  async function correr() {
    if (corriendo) {
      console.warn("[Cron] Corrida anterior aun en curso, salteando este tick.");
      return;
    }
    corriendo = true;
    try {
      await correrTodosLosPares(construirPares(process.env));
    } catch (err) {
      // Un fallo NO debe matar el cron: logueamos y esperamos el proximo tick.
      console.error(`[Cron][ERROR] ${err.message}`);
    } finally {
      corriendo = false;
    }
  }

  cron.schedule("*/1 * * * *", () => correr()); // incremental cada minuto
  // Reconciliacion completa diaria: DESACTIVADA por ahora. Mientras no exista el
  // flujo inverso (ventas DOT -> Contabilium), un --full podria re-inflar en
  // Shopify stock ya vendido online desde DOT. Reactivar cuando ese flujo exista.
  // cron.schedule("0 4 * * *", () => correrTodosLosPares(construirPares(process.env), DEPS_REALES, { full: true }));
  correr(); // primera incremental inmediata
}

// --- Modo 3: reconciliacion completa, multi-par (R-2/R-9/R-12) ---
// --full fuerza full:true en TODOS los pares declarados via el mismo camino
// que el modo por defecto (correrTodosLosPares/ejecutarPar), no el legado
// syncTodos de un solo deposito.
else if (esFull) {
  const UMBRAL_ERROR = Number(process.env.UMBRAL_ERROR ?? String(UMBRAL_ERROR_DEFECTO));
  correrTodosLosPares(construirPares(process.env), undefined, { full: true })
    .then((porPar) => {
      const veredicto = evaluarCorridaMultiPar(porPar, UMBRAL_ERROR);
      for (const [stateKey, d] of Object.entries(veredicto.detalle)) {
        if (d.pendiente) console.warn(`[PENDIENTE] par "${stateKey}": ${d.motivo}`);
        else if (!d.ok) console.error(`[FALLO] par "${stateKey}": ${d.motivo}`);
      }
      if (!veredicto.ok) {
        console.error(`[FALLO] ${veredicto.motivo}`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(`[FATAL] ${err.message}`);
      process.exit(1);
    });
} else {
  // El guardarrail vive en resultado.js para poder testearlo sin ejecutar este
  // archivo (que corre al importarse). Ver test/resultado.test.js.
  const UMBRAL_ERROR = Number(process.env.UMBRAL_ERROR ?? String(UMBRAL_ERROR_DEFECTO));

  correrTodosLosPares(construirPares(process.env))
    .then((porPar) => {
      const veredicto = evaluarCorridaMultiPar(porPar, UMBRAL_ERROR);
      for (const [stateKey, d] of Object.entries(veredicto.detalle)) {
        if (d.pendiente) console.warn(`[PENDIENTE] par "${stateKey}": ${d.motivo}`);
        else if (!d.ok) console.error(`[FALLO] par "${stateKey}": ${d.motivo}`);
      }
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
