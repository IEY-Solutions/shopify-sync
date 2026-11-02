// main.js
// -----------------------------------------------------------------------------
// Cableado del proceso, importable SIN efectos (R-13, DISENO-INTERFAZ 7.1).
//
//   node src/index.js --sku IEY-XXX           -> prueba 1 SKU (lee de Contabilium)
//   node src/index.js --sku IEY-XXX --qty 5   -> prueba 1 SKU con cantidad fija
//   node src/index.js                         -> sync INCREMENTAL, UNA vez (rapido)
//   node src/index.js --full                  -> sync COMPLETO, UNA vez
//   node src/index.js --cron                  -> incremental c/1 min
//   node src/index.js --locations             -> diagnostico READ-ONLY del riesgo 1
//
// La compuerta manual (ESCRITURA_ABSOLUTA) llega SOLO por entorno, y en el modo
// por defecto y en --full se le pasa a correrTodosLosPares.
//
// Importar este modulo no carga el .env, no lee process.env ni process.argv, no
// llama process.exit y no carga node-cron (solo con import() en el modo cron).
// `argv` y `env` son los unicos origenes de datos. Devuelve el codigo de salida:
// 2 ante un error de uso, 0/1 segun el veredicto, null en --cron (sigue vivo).
// -----------------------------------------------------------------------------

import { resolverModo, ErrorDeUso } from "./argv.js";
import { syncUnSku, correrTodosLosPares } from "./sync.js";
import { evaluarCorridaMultiPar, UMBRAL_ERROR_DEFECTO } from "./resultado.js";
import { construirPares } from "./pares.js";

function umbralDe(env) {
  const n = Number(env?.UMBRAL_ERROR ?? String(UMBRAL_ERROR_DEFECTO));
  return Number.isFinite(n) ? n : UMBRAL_ERROR_DEFECTO;
}

function describirAlcance(escrituraAbsoluta) {
  if (!escrituraAbsoluta) return "apagada";
  if (escrituraAbsoluta === "todos") return "todos los SKUs";
  return `${escrituraAbsoluta.size} SKU(s)`;
}

async function correrYEvaluar(d, env, opciones) {
  try {
    const porPar = await d.correrTodosLosPares(d.construirPares(env), undefined, opciones);
    const veredicto = d.evaluarCorridaMultiPar(porPar, umbralDe(env), {
      escrituraAbsoluta: opciones.escrituraAbsoluta,
    });
    // R-15: una sola linea, despues de las escrituras y las libretas. Un doble
    // inyectado puede no traer la lista: se trata como vacia.
    const noAplicados = veredicto?.compuertaNoAplicados ?? [];
    if (noAplicados.length > 0) {
      console.error(
        `[COMPUERTA][ERROR] ${noAplicados.length} SKU(s) de ESCRITURA_ABSOLUTA no quedaron aplicados: ${noAplicados.join(", ")}`
      );
    }
    for (const [stateKey, det] of Object.entries(veredicto?.detalle ?? {})) {
      if (det.pendiente) console.warn(`[PENDIENTE] par "${stateKey}": ${det.motivo}`);
      else if (!det.ok) console.error(`[FALLO] par "${stateKey}": ${det.motivo}`);
    }
    if (!veredicto?.ok) {
      console.error(`[FALLO] ${veredicto?.motivo ?? "veredicto ausente"}`);
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(`[FATAL] ${err.message}`);
    return 1;
  }
}

export async function main(argv, env, deps = {}) {
  let modo;
  try {
    modo = resolverModo(argv, env ?? {});
  } catch (err) {
    if (err instanceof ErrorDeUso) {
      console.error(`[USO] ${err.message}`);
      return err.codigoSalida;
    }
    throw err;
  }

  const d = {
    correrTodosLosPares: deps.correrTodosLosPares ?? correrTodosLosPares,
    construirPares: deps.construirPares ?? construirPares,
    evaluarCorridaMultiPar: deps.evaluarCorridaMultiPar ?? evaluarCorridaMultiPar,
    syncUnSku: deps.syncUnSku ?? syncUnSku,
  };

  if (modo.escrituraAbsoluta && (modo.modo === "incremental" || modo.modo === "full")) {
    console.warn(`[COMPUERTA] escritura absoluta activa en esta corrida: ${describirAlcance(modo.escrituraAbsoluta)}`);
  }

  // --- Modo 0: diagnostico de locations (SOLO LECTURA) ---
  if (modo.modo === "locations") {
    try {
      const { diagnosticarLocations, resumirCoincidencias } = await import("./diagnostico-locations.js");
      const r = await diagnosticarLocations();
      if (!r.concluyente) {
        console.error("[FALLO] el diagnostico no pudo leer ninguna fila comparable.");
        return 1;
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
      return 0;
    } catch (err) {
      console.error(`[FATAL] ${err.message}`);
      return 1;
    }
  }

  // --- Modo 1: prueba de 1 SKU ---
  if (modo.modo === "sku") {
    try {
      await d.syncUnSku(modo.sku, modo.qty);
      return 0;
    } catch (err) {
      console.error(`[FATAL] ${err.message}`);
      return 1;
    }
  }

  // --- Modo 2: cron (incremental cada minuto) ---
  if (modo.modo === "cron") {
    if (modo.escrituraAbsoluta) {
      // Una compuerta en cada tick reescribiria el absoluto cada minuto.
      console.warn("[Cron] ESCRITURA_ABSOLUTA se ignora en --cron: la compuerta es para una corrida puntual.");
    }
    const { default: cron } = await import("node-cron");
    console.log(
      "[Cron] Incremental cada 1 min. (Reconciliacion --full diaria DESACTIVADA hasta tener el flujo inverso.) Ctrl+C para detener."
    );
    let corriendo = false;
    const correr = async () => {
      if (corriendo) {
        console.warn("[Cron] Corrida anterior aun en curso, salteando este tick.");
        return;
      }
      corriendo = true;
      try {
        await d.correrTodosLosPares(d.construirPares(env));
      } catch (err) {
        console.error(`[Cron][ERROR] ${err.message}`);
      } finally {
        corriendo = false;
      }
    };
    cron.schedule("*/1 * * * *", () => correr());
    correr();
    return null;
  }

  // --- Modo 3: reconciliacion completa, multi-par ---
  if (modo.modo === "full") {
    return correrYEvaluar(d, env, { full: true, escrituraAbsoluta: modo.escrituraAbsoluta });
  }

  // --- Modo por defecto: incremental, multi-par ---
  return correrYEvaluar(d, env, { escrituraAbsoluta: modo.escrituraAbsoluta });
}
