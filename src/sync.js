// sync.js
// -----------------------------------------------------------------------------
// Orquesta la sincronizacion: Contabilium (fuente de verdad) -> Shopify (espejo).
//
// Reglas de negocio:
//   - DRY_RUN=true: muestra que HARIA, pero no escribe en Shopify (requisito 11).
//   - Si el SKU no existe en Shopify: loguea y sigue (requisito 16).
//   - Si el stock ya coincide: no escribe (evita writes inutiles).
//   - Si el item no esta activado en la location DOT: loguea y saltea (seguro).
//   - Si Contabilium falla: NO se actualiza nada en Shopify (requisito 15).
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getStockDeposito } from "./contabilium.js";
import { resolverSku, setearStock, SkuAmbiguoError } from "./shopify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// "Libreta" de lo ultimo que confirmamos en Shopify por cada SKU.
// La usa el sync incremental para saltear SKUs que no cambiaron, sin preguntarle
// a Shopify uno por uno (ahi estaba el cuello de botella de ~26 min).
const SNAPSHOT_PATH = join(__dirname, "..", ".cache", "last-sync.json");

function esDryRun() {
  return String(process.env.DRY_RUN).toLowerCase() !== "false";
}

// Version del formato de la libreta. Se sube cuando una libreta vieja quedo
// semanticamente envenenada y no alcanza con seguir usandola.
//   v2: H5. Hasta v1 se anotaban como resueltos los 'no_encontrado' y
//       'no_activado'. Esos SKUs quedan salteados por el atajo del incremental
//       ANTES de llegar al codigo que los desanotaria, asi que no se reintentan
//       nunca. La unica forma de recuperarlos es descartar la libreta una vez.
const SNAPSHOT_VERSION = 2;

function cargarSnapshot() {
  try {
    if (!existsSync(SNAPSHOT_PATH)) return {};
    const crudo = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));
    if (crudo && crudo.__v === SNAPSHOT_VERSION && crudo.skus) return crudo.skus;
    console.warn(
      "[libreta] formato viejo o envenenado por H5: se descarta y se re-siembra " +
        "(esta corrida no escribe nada nuevo por eso, solo re-verifica contra Shopify)."
    );
    return {};
  } catch {
    /* archivo corrupto -> empezar con libreta vacia */
  }
  return {};
}

function guardarSnapshot(snap) {
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  const payload = { __v: SNAPSHOT_VERSION, skus: snap };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

// -----------------------------------------------------------------------------
// procesarSku — sincroniza UN solo SKU contra Shopify
// -----------------------------------------------------------------------------
// Recibe el SKU y el stock objetivo (lo que dice Contabilium).
// Devuelve un string con el resultado, para contar al final.
async function procesarSku(sku, stockObjetivo) {
  const dryRun = esDryRun();

  let info;
  try {
    info = await resolverSku(sku);
  } catch (err) {
    // H4: mas de una variante con el sku exacto. Elegir una seria elegir al azar.
    if (err instanceof SkuAmbiguoError) {
      console.warn(`  [SKIP] ${sku}: ${err.message} -> no se escribe`);
      return "ambiguo";
    }
    console.error(`  [ERROR] ${sku}: fallo al consultar Shopify -> ${err.message}`);
    return "error";
  }

  // Requisito 16: SKU no existe en Shopify -> loguear y continuar
  if (!info) {
    console.warn(`  [SKIP] ${sku}: no existe en Shopify`);
    return "no_encontrado";
  }

  const { inventoryItemId, available } = info;

  // Item no activado en la location DOT: no podemos setear sin activarlo antes.
  if (available === null) {
    console.warn(
      `  [SKIP] ${sku}: el item no esta activado en la location DOT ` +
        `(activalo en Shopify para esa ubicacion antes de sincronizar)`
    );
    return "no_activado";
  }

  // Sin cambios: el stock de Shopify ya coincide con Contabilium
  if (available === stockObjetivo) {
    console.log(`  [OK] ${sku}: sin cambios (stock = ${stockObjetivo})`);
    return "sin_cambios";
  }

  // Hay que actualizar
  if (dryRun) {
    console.log(
      `  [DRY] ${sku}: actualizaria ${available} -> ${stockObjetivo} (no se escribe, DRY_RUN=true)`
    );
    return "dry";
  }

  try {
    await setearStock(inventoryItemId, stockObjetivo, available);
    console.log(`  [SET] ${sku}: ${available} -> ${stockObjetivo} (actualizado en Shopify)`);
    return "actualizado";
  } catch (err) {
    console.error(`  [ERROR] ${sku}: fallo al escribir en Shopify -> ${err.message}`);
    return "error";
  }
}

// -----------------------------------------------------------------------------
// syncUnSku — prueba manual de UN SKU (requisito 13)
// -----------------------------------------------------------------------------
// Si pasas manualQty, usa ese numero y NO consulta Contabilium (test puro de
// Shopify). Si no, lee el stock real del SKU desde el deposito DOT.
export async function syncUnSku(sku, manualQty = null) {
  const skuNorm = sku.trim().toUpperCase();
  console.log(`\n=== Sync de 1 SKU: ${skuNorm} (DRY_RUN=${esDryRun()}) ===`);

  let objetivo;
  if (manualQty !== null) {
    objetivo = manualQty;
    console.log(`[Manual] Usando cantidad fija ${objetivo} (sin consultar Contabilium)`);
  } else {
    const stock = await getStockDeposito(); // si falla, lanza y no tocamos Shopify
    if (!stock.has(skuNorm)) {
      console.warn(`[SKIP] ${skuNorm}: no aparece en el deposito DOT de Contabilium`);
      return;
    }
    objetivo = stock.get(skuNorm);
    console.log(`[Contabilium] Stock DOT de ${skuNorm} = ${objetivo}`);
  }

  await procesarSku(skuNorm, objetivo);
  console.log(`=== Fin ===\n`);
}

// -----------------------------------------------------------------------------
// syncTodos — sincroniza el deposito DOT (requisito 14, via cron)
// -----------------------------------------------------------------------------
// Dos modos:
//   - INCREMENTAL (default): compara Contabilium contra la "libreta" local y solo
//     toca Shopify para los SKUs cuyo stock cambio. Rapido (~lo que tarda leer
//     Contabilium). Ideal para correr seguido (cron cada 1 min).
//   - COMPLETO (full=true): revisa los 2480 SKUs contra Shopify, ignorando la
//     libreta. Lento (~26 min) pero exacto. Sirve de reconciliacion (1 vez/dia)
//     para corregir cualquier desvio que el incremental no haya visto.
//
// La libreta solo se persiste cuando NO es dry-run (asi refleja lo realmente
// escrito en Shopify).
export async function syncTodos({ full = false } = {}) {
  const inicio = Date.now();
  const modo = full ? "COMPLETO" : "INCREMENTAL";
  console.log(`\n=== Sync ${modo} deposito DOT (DRY_RUN=${esDryRun()}) ===`);

  // Si Contabilium falla, lanza aca y Shopify queda intacto (requisito 15).
  const stock = await getStockDeposito();

  // En incremental partimos de la libreta existente; en completo la reconstruimos.
  const snapshotPrevio = full ? {} : cargarSnapshot();
  const snapshotNuevo = { ...snapshotPrevio };

  const contadores = {
    actualizado: 0,
    dry: 0,
    sin_cambios: 0,
    no_encontrado: 0,
    no_activado: 0,
    error: 0,
    ambiguo: 0,
    saltado: 0, // incremental: sin cambios desde la ultima vez (no se consulto Shopify)
  };

  for (const [sku, cantidad] of stock) {
    // Atajo del incremental: si la libreta ya dice este valor, no tocamos Shopify.
    if (!full && snapshotPrevio[sku] === cantidad) {
      contadores.saltado++;
      continue;
    }

    const resultado = await procesarSku(sku, cantidad);
    contadores[resultado] = (contadores[resultado] ?? 0) + 1;

    // H5: solo se anota lo que quedo REALMENTE sincronizado en Shopify.
    // Antes tambien se anotaba 'no_encontrado' y 'no_activado', asi que un SKU
    // que todavia no existia en Shopify quedaba marcado como resuelto y el
    // incremental no lo reintentaba nunca, aunque despues se creara el producto.
    // Tampoco se anota 'error' (para reintentarlo) ni 'dry'.
    if (resultado === "actualizado" || resultado === "sin_cambios") {
      snapshotNuevo[sku] = cantidad;
    } else if (snapshotNuevo[sku] !== undefined) {
      // Si estaba anotado de una corrida vieja (libreta envenenada por H5),
      // lo sacamos para que vuelva a intentarse en la proxima pasada.
      delete snapshotNuevo[sku];
    }
  }

  // Solo persistimos la libreta si escribimos de verdad (no en dry-run).
  if (!esDryRun()) guardarSnapshot(snapshotNuevo);

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`\n--- Resumen ${modo} (${seg}s) ---`);
  console.log(`  Total SKUs Contabilium : ${stock.size}`);
  if (!full) console.log(`  Saltados (sin cambios) : ${contadores.saltado}`);
  console.log(`  Actualizados           : ${contadores.actualizado}`);
  console.log(`  Simulados (DRY)        : ${contadores.dry}`);
  console.log(`  Sin cambios (Shopify)  : ${contadores.sin_cambios}`);
  console.log(`  No encontrados Shopify : ${contadores.no_encontrado}`);
  console.log(`  No activados en DOT    : ${contadores.no_activado}`);
  console.log(`  Ambiguos (no escritos) : ${contadores.ambiguo ?? 0}`);
  console.log(`  Errores                : ${contadores.error}`);
  console.log(`=== Fin sync ${modo.toLowerCase()} ===\n`);

  return { ...contadores, total: stock.size };
}
