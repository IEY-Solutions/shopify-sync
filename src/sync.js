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

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getStockDeposito, buscarComprobantes, fetchComprobantesDetalle, crearSesionContabilium } from "./contabilium.js";
import { resolverSku, setearStock, SkuAmbiguoError } from "./shopify.js";
import { esNoSincronizable } from "./no-sincronizables.js";
import { detectarAnomalias, formatearAnomalias } from "./anomalias.js";
import {
  MARGEN_ACREDITACION_MS,
  claveConsumo,
  creditoAcreditable,
  diaArgentina,
  esNotaCreditoShopify,
  lineasAcreditables,
  referenciaDeComprobante,
} from "./clasificador-causa.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// "Libreta" de lo ultimo que confirmamos en Shopify por cada SKU.
// La usa el sync incremental para saltear SKUs que no cambiaron, sin preguntarle
// a Shopify uno por uno (ahi estaba el cuello de botella de ~26 min).
export const SNAPSHOT_PATH = join(__dirname, "..", ".cache", "last-sync.json");

function esDryRun() {
  return String(process.env.DRY_RUN).toLowerCase() !== "false";
}

// Este repositorio es PUBLICO, y con el los logs de sus corridas de Actions (ver
// la doc de GitHub: "Read access to the repository is required" — en un repo
// publico eso lo tiene cualquiera). Una reconciliacion completa escribia 2.388
// lineas con SKU y cantidad, o sea el catalogo entero con su stock.
//
// Las lineas de "sin cambios" son el 95% de ese volumen y no aportan nada: el
// resumen ya dice cuantas fueron. Quedan detras de una variable, apagadas por
// defecto. Lo accionable -[SET], [DRY], [SKIP]- se sigue logueando siempre.
function esVerboso() {
  return String(process.env.LOG_VERBOSE).toLowerCase() === "true";
}

// Version del formato de la libreta. Se sube cuando una libreta vieja quedo
// semanticamente envenenada y no alcanza con seguir usandola.
//   v2: H5. Hasta v1 se anotaban como resueltos los 'no_encontrado' y
//       'no_activado'. Esos SKUs quedan salteados por el atajo del incremental
//       ANTES de llegar al codigo que los desanotaria, asi que no se reintentan
//       nunca. La unica forma de recuperarlos es descartar la libreta una vez.
export const SNAPSHOT_VERSION = 2;

// Decide si una libreta ya parseada sirve. Separada de la IO para poder
// testearla sin tocar el disco (test/libreta.test.js).
//   - devuelve el mapa de SKUs si la libreta esta vigente
//   - devuelve null si hay que DESCARTARLA y re-sembrar
export function parsearLibreta(crudo) {
  if (crudo && crudo.__v === SNAPSHOT_VERSION && crudo.skus) return crudo.skus;
  return null;
}

// El snapshot de Contabilium de la corrida anterior: SKU -> cantidad, TAL COMO
// lo devolvio Contabilium (no lo que quedo en Shopify). Es lo unico que permite
// detectar un SKU que DESAPARECE del deposito, porque el bucle del sync solo
// recorre lo que Contabilium devuelve hoy.
// Campo opcional: una libreta v2 vieja no lo tiene y eso no la invalida — la
// primera corrida tras el upgrade simplemente no compara.
export function parsearSnapshotContabilium(crudo) {
  if (crudo && crudo.__v === SNAPSHOT_VERSION && crudo.contabilium) return crudo.contabilium;
  return null;
}

// Campos de contabilidad del clasificador (R-7/R-8/R-11), opcionales en una
// libreta v2: una libreta vieja que no los trae no queda invalidada.
//   corte         — instante desde el que el par lleva cuentas (primera corrida)
//   consumos      — "<comprobanteId>:<sku>" -> { cantidad, motivo, referencia, en }
//   resembradoEn  — sku -> ISO del tInicioLectura de la corrida que escribio el absoluto
//   resembradoPor — sku -> "absoluto" | "sembrado" (motivo para consumos tardios)
function esObjetoPlano(x) {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function parsearContabilidad(crudo) {
  const vigente = crudo && crudo.__v === SNAPSHOT_VERSION;
  return {
    corte: vigente && typeof crudo.corte === "string" ? crudo.corte : null,
    consumos: vigente && esObjetoPlano(crudo.consumos) ? crudo.consumos : {},
    resembradoEn: vigente && esObjetoPlano(crudo.resembradoEn) ? crudo.resembradoEn : {},
    resembradoPor: vigente && esObjetoPlano(crudo.resembradoPor) ? crudo.resembradoPor : {},
  };
}

// Lee la libreta cruda una sola vez y devuelve todas sus partes.
// `ultimaCorridaExitosa` (diseño viejo) se retiro (D-7): no se lee ni se copia.
export function cargarLibretaCompleta(ruta = SNAPSHOT_PATH) {
  try {
    if (!existsSync(ruta)) {
      return { skus: {}, contabilium: null, corte: null, consumos: {}, resembradoEn: {}, resembradoPor: {} };
    }
    const crudo = JSON.parse(readFileSync(ruta, "utf-8"));
    return {
      skus: parsearLibreta(crudo) ?? {},
      contabilium: parsearSnapshotContabilium(crudo),
      ...parsearContabilidad(crudo),
    };
  } catch {
    // Archivo corrupto: mismo shape de siempre (test/libreta.test.js lo congela).
    return { skus: {}, contabilium: null };
  }
}

export function cargarSnapshot(ruta = SNAPSHOT_PATH) {
  try {
    if (!existsSync(ruta)) return {};
    const skus = parsearLibreta(JSON.parse(readFileSync(ruta, "utf-8")));
    if (skus) return skus;
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

// guardarSnapshot — UNA escritura con baseline y contabilidad juntos (R-8).
//   contabilidad = { corte, consumos, resembradoEn, resembradoPor } | null
//   - dada: se escriben esos campos en el MISMO writeFileSync que skus/contabilium.
//   - null (llamadas de 3 argumentos: syncUnSku sin siembra, syncTodos): se
//     CONSERVAN los que ya hay en disco. Nunca se borran.
export function guardarSnapshot(snap, ruta = SNAPSHOT_PATH, contabilium = null, contabilidad = null) {
  // H3: en un runner limpio .cache/ no existe y writeFileSync tira ENOENT.
  mkdirSync(dirname(ruta), { recursive: true });
  const payload = { __v: SNAPSHOT_VERSION, skus: snap };
  if (contabilium) payload.contabilium = contabilium instanceof Map ? Object.fromEntries(contabilium) : { ...contabilium };

  let c = contabilidad;
  if (!c) {
    const previa = cargarLibretaCompleta(ruta);
    c = {
      corte: previa.corte ?? null,
      consumos: previa.consumos ?? {},
      resembradoEn: previa.resembradoEn ?? {},
      resembradoPor: previa.resembradoPor ?? {},
    };
  }
  if (c.corte) payload.corte = c.corte;
  if (esObjetoPlano(c.consumos) && Object.keys(c.consumos).length > 0) payload.consumos = c.consumos;
  if (esObjetoPlano(c.resembradoEn) && Object.keys(c.resembradoEn).length > 0) payload.resembradoEn = c.resembradoEn;
  if (esObjetoPlano(c.resembradoPor) && Object.keys(c.resembradoPor).length > 0) payload.resembradoPor = c.resembradoPor;
  writeFileSync(ruta, JSON.stringify(payload, null, 2), "utf-8");
}

// -----------------------------------------------------------------------------
// Registro (cache) de comprobantes de la CUENTA — .cache/comprobantes.json (R-8)
// -----------------------------------------------------------------------------
// Compartido por todos los pares: un comprobante es de la cuenta, no del par.
// Forma: DISENO-INTERFAZ.md seccion 3. Dato de solo lectura: se guarda tambien
// en DRY_RUN.
export const REGISTRO_VERSION = 1;

export function registroVacio() {
  return { v: REGISTRO_VERSION, ultimoRefrescoOk: null, diasCerrados: [], comprobantes: {} };
}

export function rutaRegistroComprobantes(dirCache = join(__dirname, "..", ".cache")) {
  return join(dirCache, "comprobantes.json");
}

export function cargarRegistroComprobantes(ruta = rutaRegistroComprobantes()) {
  try {
    if (!existsSync(ruta)) return registroVacio();
    const crudo = JSON.parse(readFileSync(ruta, "utf-8"));
    if (!esObjetoPlano(crudo) || crudo.v !== REGISTRO_VERSION) return registroVacio();
    return {
      v: REGISTRO_VERSION,
      ultimoRefrescoOk: typeof crudo.ultimoRefrescoOk === "string" ? crudo.ultimoRefrescoOk : null,
      diasCerrados: Array.isArray(crudo.diasCerrados) ? crudo.diasCerrados.filter((d) => typeof d === "string") : [],
      comprobantes: esObjetoPlano(crudo.comprobantes) ? crudo.comprobantes : {},
    };
  } catch {
    return registroVacio(); // corrupto: se reconstruye (los consumos viven en la libreta)
  }
}

export function guardarRegistroComprobantes(registro, ruta = rutaRegistroComprobantes()) {
  mkdirSync(dirname(ruta), { recursive: true });
  const tmp = `${ruta}.tmp`;
  writeFileSync(tmp, JSON.stringify(registro, null, 2), "utf-8");
  renameSync(tmp, ruta);
}

// Cada cuantos SKUs procesados se persiste la libreta a mitad de corrida.
// Antes se persistia UNA sola vez, al final: un fallo a los 7 minutos tiraba los
// 7 minutos y la corrida siguiente volvia a empezar de cero. El paso de cache de
// GitHub Actions corre con `if: always()`, asi que levanta el checkpoint aunque
// el job muera por timeout. ~13 escrituras en una corrida completa de 2.562.
const CHECKPOINT_CADA = 200;

// -----------------------------------------------------------------------------
// rutaSnapshotPara — ruta de la libreta de UN par (R-3)
// -----------------------------------------------------------------------------
// Antes habia un solo SNAPSHOT_PATH global; con multi-par cada stateKey tiene
// su archivo, para que la base de un par nunca se lea ni se pise con la de
// otro.
export function rutaSnapshotPara(stateKey, dirCache = join(__dirname, "..", ".cache")) {
  return join(dirCache, `last-sync.${stateKey}.json`);
}

// -----------------------------------------------------------------------------
// migrarLibretaLegada — primera corrida del par DOT tras este deploy: la
// libreta nueva por-par (rutaSnapshotPara("dot", ...)) no existe todavia,
// pero el legado SNAPSHOT_PATH (.cache/last-sync.json) si tiene la base real
// de las corridas anteriores. Sin esto, el primer run del DOT resiembra todo
// (sembrado:true por SKU) y pierde la deteccion de desaparecidos de una
// corrida a la otra.
//   - rutaNueva ya existe (tiene su propio progreso, migrado o generado
//     organicamente): NO se toca. Nunca se pisa progreso nuevo con el legado.
//   - rutaNueva no existe y rutaLegada tampoco: no hay nada que migrar
//     (deploy en un ambiente sin libreta previa, p.ej. CI limpio).
//   - rutaNueva no existe y rutaLegada si: se copia el contenido crudo tal
//     cual (mismo __v/schema, no cambia nada mas) y se devuelve true.
// Devuelve true si migro, false si no hizo nada (en ninguno de los dos casos
// "false" es un error).
// CA-12: el `contabilium` legado se grababa con el stock completo de
// Contabilium, incluidos los SKU que nunca se escribieron de verdad en
// Shopify (no_encontrado, no_activado, error, ambiguo o todavia no
// alcanzados por un checkpoint). Una entrada de `contabilium[sku]` solo es
// confiable si ese mismo SKU tiene tambien entrada en `skus[sku]`: eso es lo
// unico que certifica una escritura (o un "sin_cambios" ya correcto) real
// contra Shopify en esa corrida (mismo criterio que usa ejecutarPar al
// construir snapshotNuevo). El resto se descarta: ese SKU arranca "sembrado"
// la proxima vez que se resuelva, en vez de heredar un baseline falso (mismo
// incumplimiento de R-7 que esto reemplaza).
export function migrarLibretaLegada(rutaLegada, rutaNueva) {
  if (existsSync(rutaNueva)) return false;
  if (!existsSync(rutaLegada)) return false;
  mkdirSync(dirname(rutaNueva), { recursive: true });

  const crudo = JSON.parse(readFileSync(rutaLegada, "utf-8"));
  const skus = parsearLibreta(crudo) ?? {};
  const contabilium = parsearSnapshotContabilium(crudo);
  if (contabilium) {
    const filtrado = Object.fromEntries(
      Object.entries(contabilium).filter(([sku]) => Object.prototype.hasOwnProperty.call(skus, sku))
    );
    crudo.contabilium = filtrado;
  }

  writeFileSync(rutaNueva, JSON.stringify(crudo, null, 2), "utf-8");
  return true;
}

// -----------------------------------------------------------------------------
// calcularEscritura — decide que valor escribir en Shopify SIN escribir nada.
// -----------------------------------------------------------------------------
// Pura, sin IO (R-1, ADR 0001). NUNCA escribe el absoluto de Contabilium
// salvo en el caso "sembrado" (no hay baseline: primera vez que se ve el SKU
// en este par).
//   baseline          — lo que Contabilium decia en la corrida ANTERIOR para
//                        este SKU en este par (null si es la primera vez; NO
//                        confundir con 0, que es un valor real).
//   contabiliumActual — lo que Contabilium dice AHORA.
//   shopifyActual      — lo que Shopify tiene AHORA en la location de este par.
export function calcularEscritura({ baseline, contabiliumActual, shopifyActual }) {
  if (baseline === null || baseline === undefined) {
    return { nuevoValor: Math.round(contabiliumActual), delta: null, sembrado: true };
  }
  const delta = contabiliumActual - baseline;
  return { nuevoValor: Math.round(shopifyActual + delta), delta, sembrado: false };
}

// -----------------------------------------------------------------------------
// armarPlanDeEscritura — por SKU, calcula la escritura (via calcularEscritura)
// y la amarra a la location/par que la origino. No llama a Shopify (R-2/R-4).
// -----------------------------------------------------------------------------
export function armarPlanDeEscritura(par, stockPorSku, baselinePorSku, shopifyPorSku) {
  const plan = [];
  for (const [sku, contabiliumActual] of stockPorSku) {
    if (!shopifyPorSku.has(sku)) continue; // no encontrado/no activado: no se planea nada
    const { nuevoValor, delta, sembrado } = calcularEscritura({
      baseline: baselinePorSku.get(sku) ?? null,
      contabiliumActual,
      shopifyActual: shopifyPorSku.get(sku),
    });
    plan.push({ sku, par: par.nombre, locationId: par.locationId, nuevoValor, delta, sembrado });
  }
  return plan;
}

// -----------------------------------------------------------------------------
// procesarSku — sincroniza UN solo SKU contra Shopify
// -----------------------------------------------------------------------------
// Recibe el SKU, el stock objetivo (lo que dice Contabilium), el baseline
// (lo que Contabilium decia la corrida anterior, null si no hay) y el
// locationId del par al que pertenece. Devuelve un string con el resultado,
// para contar al final.
// `d` son las dependencias de Shopify y del modo (por defecto, las reales):
// syncUnSku las recibe inyectadas (DISENO-INTERFAZ 4.2).
async function procesarSku(
  sku,
  stockObjetivo,
  baseline,
  locationId = process.env.SHOPIFY_DOT_LOCATION_ID,
  d = { resolverSku, setearStock, esDryRun }
) {
  const dryRun = d.esDryRun();

  let info;
  try {
    info = await d.resolverSku(sku, locationId);
  } catch (err) {
    // H4: mas de una variante con el sku exacto. Elegir una seria elegir al azar.
    if (err instanceof SkuAmbiguoError) {
      console.warn(`  [SKIP] ${sku}: ${err.message} -> no se escribe`);
      // Nombrar las variantes: es lo que permite deduplicarlas sin adivinar.
      for (const linea of err.detalle()) console.warn(linea);
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

  // R-1/ADR 0001: nunca escribir el absoluto de Contabilium. Se calcula el
  // delta contra la linea base (null si es la primera vez que se ve el SKU).
  const { nuevoValor } = calcularEscritura({
    baseline: baseline ?? null,
    contabiliumActual: stockObjetivo,
    shopifyActual: available,
  });

  // Sin cambios: el stock de Shopify ya coincide con el valor calculado
  if (available === nuevoValor) {
    if (esVerboso()) console.log(`  [OK] ${sku}: sin cambios (stock = ${nuevoValor})`);
    return "sin_cambios";
  }

  // Hay que actualizar
  if (dryRun) {
    console.log(
      `  [DRY] ${sku}: actualizaria ${available} -> ${nuevoValor} (no se escribe, DRY_RUN=true)`
    );
    return "dry";
  }

  try {
    await d.setearStock(inventoryItemId, nuevoValor, available, locationId);
    console.log(`  [SET] ${sku}: ${available} -> ${nuevoValor} (actualizado en Shopify)`);
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
//
// `deps` es opcional y parcial (DISENO-INTERFAZ 4.2): cada clave que falta toma
// el valor real. TODA la E/S de disco pasa por `deps`, con UNA ruta: la de
// d.rutaSnapshotPara("dot"), explicita en la lectura y en la escritura.
//
// Si el SKU no tiene baseline, escribe el absoluto (siembra) y guarda
// resembradoEn[sku] = tInicioLectura en la MISMA escritura que el baseline
// (R-7): la corrida siguiente de ejecutarPar consume las lineas anteriores con
// motivo "sembrado". Con baseline aplica un delta y conserva corte, consumos y
// resembradoEn tal como estan en disco.
export async function syncUnSku(sku, manualQty = null, deps = {}) {
  const d = {
    rutaSnapshotPara,
    cargarLibretaCompleta,
    guardarSnapshot,
    getStockDeposito,
    resolverSku,
    setearStock,
    esDryRun,
    ahora: () => new Date(),
    ...deps,
  };
  const tInicioLectura = d.ahora();
  const skuNorm = sku.trim().toUpperCase();
  console.log(`\n=== Sync de 1 SKU: ${skuNorm} (DRY_RUN=${d.esDryRun()}) ===`);

  let objetivo;
  if (manualQty !== null) {
    objetivo = manualQty;
    console.log(`[Manual] Usando cantidad fija ${objetivo} (sin consultar Contabilium)`);
  } else {
    const stock = await d.getStockDeposito(null); // si falla, lanza y no tocamos Shopify
    if (!stock.has(skuNorm)) {
      console.warn(`[SKIP] ${skuNorm}: no aparece en el deposito DOT de Contabilium`);
      return;
    }
    objetivo = stock.get(skuNorm);
    console.log(`[Contabilium] Stock DOT de ${skuNorm} = ${objetivo}`);
  }

  // R-11: el DOT vive en su libreta por-par, nunca en el SNAPSHOT_PATH legado.
  const ruta = d.rutaSnapshotPara("dot");
  const libreta = d.cargarLibretaCompleta(ruta);
  const baseline = libreta.contabilium?.[skuNorm] ?? null;
  const resultado = await procesarSku(skuNorm, objetivo, baseline, process.env.SHOPIFY_DOT_LOCATION_ID, d);

  // CA-1: solo se anota lo REALMENTE sincronizado en Shopify (R-7).
  if (resultado === "actualizado" || resultado === "sin_cambios") {
    const snapshotNuevo = { ...libreta.skus, [skuNorm]: objetivo };
    const contabiliumNuevo = new Map(Object.entries(libreta.contabilium ?? {}));
    contabiliumNuevo.set(skuNorm, objetivo);
    if (baseline === null) {
      // Siembra: resembradoEn en la misma escritura, armado desde lo CARGADO.
      d.guardarSnapshot(snapshotNuevo, ruta, contabiliumNuevo, {
        corte: libreta.corte ?? null,
        consumos: { ...(libreta.consumos ?? {}) },
        resembradoEn: { ...(libreta.resembradoEn ?? {}), [skuNorm]: tInicioLectura.toISOString() },
        resembradoPor: { ...(libreta.resembradoPor ?? {}), [skuNorm]: "sembrado" },
      });
    } else {
      // Delta: 3 argumentos, conserva corte/consumos/resembradoEn del disco.
      d.guardarSnapshot(snapshotNuevo, ruta, contabiliumNuevo);
    }
  }
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

  // La libreta trae dos cosas: lo confirmado en Shopify y el snapshot de
  // Contabilium de la corrida anterior. El segundo se lee SIEMPRE, tambien en
  // --full: la deteccion de anomalias no depende del modo.
  const libreta = cargarLibretaCompleta();
  const snapshotPrevio = full ? {} : libreta.skus;
  const snapshotNuevo = { ...snapshotPrevio };

  const anomalias = detectarAnomalias(libreta.contabilium, stock);

  const contadores = {
    actualizado: 0,
    dry: 0,
    sin_cambios: 0,
    no_encontrado: 0,
    no_activado: 0,
    error: 0,
    ambiguo: 0,
    no_sincronizable: 0, // conceptos de facturacion, no mercaderia (AC-16)
    saltado: 0, // incremental: sin cambios desde la ultima vez (no se consulto Shopify)
  };

  // Cuenta solo los SKUs que realmente pasaron por Shopify: los salteados por el
  // atajo del incremental no cambian la libreta, asi que no ameritan checkpoint.
  let procesados = 0;

  for (const [sku, cantidad] of stock) {
    // Conceptos de facturacion (comisiones, envios): no son mercaderia y nunca
    // van a existir en Shopify. Se descartan ANTES de consultar, asi no gastan
    // una query ni ensucian el conteo de "no encontrado" en cada corrida.
    if (esNoSincronizable(sku)) {
      contadores.no_sincronizable++;
      continue;
    }

    // Atajo del incremental: si la libreta ya dice este valor, no tocamos Shopify.
    if (!full && snapshotPrevio[sku] === cantidad) {
      contadores.saltado++;
      continue;
    }

    const baseline = libreta.contabilium?.[sku] ?? null;
    const resultado = await procesarSku(sku, cantidad, baseline);
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

    // Checkpoint: la libreta parcial es segura porque solo anota lo que quedo
    // CONFIRMADO en Shopify, asi que lo unico que provoca es que la corrida
    // siguiente vuelva a verificar el resto.
    procesados++;
    if (!esDryRun() && procesados % CHECKPOINT_CADA === 0) {
      guardarSnapshot(snapshotNuevo, undefined, stock);
      console.log(`  [checkpoint] libreta persistida tras ${procesados} SKUs procesados`);
    }
  }

  // Solo persistimos la libreta si escribimos de verdad (no en dry-run).
  if (!esDryRun()) guardarSnapshot(snapshotNuevo, undefined, stock);

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`\n--- Resumen ${modo} (${seg}s) ---`);
  console.log(`  Total SKUs Contabilium : ${stock.size}`);
  if (!full) console.log(`  Saltados (sin cambios) : ${contadores.saltado}`);
  console.log(`  Actualizados           : ${contadores.actualizado}`);
  console.log(`  Simulados (DRY)        : ${contadores.dry}`);
  console.log(`  Sin cambios (Shopify)  : ${contadores.sin_cambios}`);
  console.log(`  No encontrados Shopify : ${contadores.no_encontrado}`);
  console.log(`  No sincronizables      : ${contadores.no_sincronizable} (conceptos de facturacion, esperado)`);
  console.log(`  No activados en DOT    : ${contadores.no_activado}`);
  console.log(`  Ambiguos (no escritos) : ${contadores.ambiguo ?? 0}`);
  console.log(`  Errores                : ${contadores.error}`);

  // Lo que el sistema hacia en silencio hasta ahora.
  const lineas = formatearAnomalias(anomalias);
  if (lineas.length > 0) {
    console.log("");
    for (const l of lineas) console.warn(l);
  }

  console.log(`=== Fin sync ${modo.toLowerCase()} ===\n`);

  return {
    ...contadores,
    total: stock.size,
    desaparecidos: anomalias.desaparecidos.length,
    puestos_en_cero: anomalias.puestosEnCero.length,
  };
}

// -----------------------------------------------------------------------------
// ejecutarPar — orquesta UN par de punta a punta: Contabilium -> Shopify -> libreta.
// -----------------------------------------------------------------------------
// Nunca lee ni escribe nada fuera del depositoId/locationId de ESTE par (R-2,
// R-3, R-4). Un par `pendiente` (R-9) corta ANTES de llamar cualquier
// dependencia: esa es la primera linea de la funcion, no una rama entre varias.
export const DEPS_REALES = {
  getStockDeposito,
  resolverSku,
  setearStock,
  cargarLibretaCompleta,
  guardarSnapshot,
  rutaSnapshotPara,
  esDryRun,
  SNAPSHOT_PATH,
  migrarLibretaLegada,
  buscarComprobantes,
  fetchComprobantesDetalle,
  crearSesion: () => crearSesionContabilium(),
  ahora: () => new Date(),
  rutaRegistroComprobantes,
  cargarRegistroComprobantes,
  guardarRegistroComprobantes,
};

// Parametros del clasificador (D-6).
export const TOPE_DETALLES_DEFECTO = 60;
const LOOKBACK_MAX_DIAS = 7; // dias consultados como maximo, hoy incluido
const RETENCION_SIN_LINEAS_DIAS = 7;
const RETENCION_CON_LINEAS_DIAS = 30;
const RETENCION_CONSUMOS_DIAS = 30;
const MAX_ERRORES_DEFINITIVOS = 3;
const DIA_MS = 24 * 60 * 60 * 1000;

// escrituraAbsolutaAlcanzaA — R-6/R-7. `escrituraAbsoluta` es
// null (apagado) | "todos" | Set<string> de SKUs ya normalizados a mayusculas.
function escrituraAbsolutaAlcanzaA(sku, escrituraAbsoluta) {
  if (!escrituraAbsoluta) return false;
  if (escrituraAbsoluta === "todos") return true;
  return escrituraAbsoluta.has(sku);
}

// Dias calendario ART entre dos "YYYY-MM-DD" (hoy - dia). NaN si alguno es invalido.
function diasEntre(hoy, dia) {
  const a = Date.parse(`${hoy}T00:00:00.000Z`);
  const b = Date.parse(`${dia}T00:00:00.000Z`);
  return Math.round((a - b) / DIA_MS);
}

function sumarDias(dia, n) {
  return new Date(Date.parse(`${dia}T00:00:00.000Z`) + n * DIA_MS).toISOString().slice(0, 10);
}

function antiguedadDiasDeIso(hoy, iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return NaN;
  return diasEntre(hoy, diaArgentina(t));
}

// Poda del registro (R-8), con la regla de dias calendario ART contra el `dia`
// guardado en cada entrada. Devuelve las entradas borradas.
function podarRegistro(registro, tInicioLectura) {
  const hoy = diaArgentina(tInicioLectura);
  const podadas = [];
  for (const [clave, e] of Object.entries(registro.comprobantes)) {
    const conLineas = Array.isArray(e?.lineas) && e.lineas.length > 0;
    const limite = conLineas ? RETENCION_CON_LINEAS_DIAS : RETENCION_SIN_LINEAS_DIAS;
    const antig = typeof e?.dia === "string" ? diasEntre(hoy, e.dia) : NaN;
    if (!Number.isFinite(antig) || antig > limite) {
      podadas.push(e);
      delete registro.comprobantes[clave];
    }
  }
  registro.diasCerrados = registro.diasCerrados.filter((d) => {
    const antig = diasEntre(hoy, d);
    return Number.isFinite(antig) && antig <= RETENCION_SIN_LINEAS_DIAS;
  });
  return podadas;
}

// Poda de consumos (R-8, seccion 4): SOLO si el comprobante ya no esta en la
// cache Y la referencia tiene mas de 30 dias ART. Las dos condiciones.
function podarConsumos(consumos, registro, tInicioLectura) {
  const hoy = diaArgentina(tInicioLectura);
  for (const [clave, c] of Object.entries(consumos)) {
    const id = clave.split(":")[0];
    if (Object.prototype.hasOwnProperty.call(registro.comprobantes, id)) continue;
    const antig = antiguedadDiasDeIso(hoy, c?.referencia);
    if (Number.isFinite(antig) && antig > RETENCION_CONSUMOS_DIAS) delete consumos[clave];
  }
}

// Lineas Shopify del deposito del par, de los comprobantes `ok` del registro.
function lineasDelPar(registro, depositoId) {
  const lineas = [];
  for (const e of Object.values(registro.comprobantes)) {
    if (!e || e.estado !== "ok" || !Array.isArray(e.lineas)) continue;
    if (String(e.inventario) !== String(depositoId)) continue;
    for (const l of e.lineas) lineas.push(l);
  }
  return lineas;
}

function contarEstado(registro, estado) {
  let n = 0;
  for (const e of Object.values(registro.comprobantes)) if (e?.estado === estado) n++;
  return n;
}

// Rango de dias ART que consulta el refresco (R-9).
function rangoDelRefresco(registro, tInicioLectura) {
  const hoy = diaArgentina(tInicioLectura);
  const ayer = sumarDias(hoy, -1);
  const limite = sumarDias(hoy, -(LOOKBACK_MAX_DIAS - 1));
  let desde;
  const ultimo = registro.ultimoRefrescoOk ? new Date(registro.ultimoRefrescoOk) : null;
  if (!ultimo || Number.isNaN(ultimo.getTime())) {
    desde = ayer;
  } else {
    const diaUltimo = diaArgentina(ultimo);
    if (diaUltimo >= hoy) desde = hoy;
    else desde = diaUltimo < limite ? limite : diaUltimo;
  }
  return { fechaDesde: desde, fechaHasta: hoy };
}

// Registra el detalle leido de un comprobante (pasa a `ok`). El `dia` se
// recalcula con la referencia del comprobante (ronda 4).
function registrarDetalle(entrada, detalle) {
  const inventario = detalle?.Inventario === null || detalle?.Inventario === undefined ? null : String(detalle.Inventario);
  entrada.estado = "ok";
  entrada.tipoFc = detalle?.TipoFc ?? entrada.tipoFc ?? null;
  entrada.inventario = inventario;
  entrada.lineas = inventario === null ? [] : lineasAcreditables(detalle, inventario);
  entrada.notaCreditoShopify = inventario === null ? false : esNotaCreditoShopify(detalle, inventario);
  const ref = referenciaDeComprobante(detalle);
  if (ref) entrada.dia = diaArgentina(ref);
}

// refrescarRegistro — UN refresco por corrida (R-3/R-9). Nunca lanza: devuelve
// { estado, error, pedidos, registrados }.
async function refrescarRegistro({ deps, registro, sesion, tInicioLectura, topeDetalles }) {
  const out = { estado: "ok", error: null, pedidos: 0, registrados: [] };
  const fallar = (msg) => {
    out.estado = "fallo";
    if (!out.error) out.error = msg;
  };
  const tIso = tInicioLectura.toISOString();
  const hoy = diaArgentina(tInicioLectura);
  const rango = rangoDelRefresco(registro, tInicioLectura);

  let resumenes = null;
  try {
    resumenes = await deps.buscarComprobantes(rango, sesion);
    if (!Array.isArray(resumenes)) throw new Error("buscarComprobantes no devolvio una lista");
  } catch (err) {
    fallar(err?.message ?? String(err));
    resumenes = null;
  }

  if (resumenes) {
    registro.ultimoRefrescoOk = tIso;
    const cerrados = new Set(registro.diasCerrados);
    for (let dia = rango.fechaDesde; dia < hoy; dia = sumarDias(dia, 1)) cerrados.add(dia);
    registro.diasCerrados = [...cerrados].sort();

    const pendientesViejos = Object.values(registro.comprobantes)
      .filter((e) => e?.estado === "pendiente")
      .map((e) => Number(e.id))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const nuevos = [];
    for (const r of resumenes) {
      const id = Number(r?.Id);
      if (!Number.isFinite(id)) continue;
      const clave = String(id);
      if (registro.comprobantes[clave]) continue;
      const base = { id, dia: hoy, tipoFc: r?.TipoFc ?? null, intentos: 0, vistoEn: tIso, inventario: null, notaCreditoShopify: false, lineas: [] };
      if (r?.TipoFc === "COT") {
        registro.comprobantes[clave] = { ...base, estado: "ok" }; // descartado por /search, sin detalle
      } else {
        registro.comprobantes[clave] = { ...base, estado: "pendiente", intentosDefinitivos: 0 };
        nuevos.push(id);
      }
    }

    const tope = Number.isFinite(topeDetalles) && topeDetalles >= 0 ? Math.floor(topeDetalles) : TOPE_DETALLES_DEFECTO;
    const aPedir = [...pendientesViejos, ...nuevos].slice(0, tope);
    if (aPedir.length > 0) {
      out.pedidos = aPedir.length;
      let resultados = null;
      try {
        resultados = await deps.fetchComprobantesDetalle(aPedir, sesion);
        if (!Array.isArray(resultados)) throw new Error("fetchComprobantesDetalle no devolvio una lista");
      } catch (err) {
        fallar(err?.message ?? String(err));
        resultados = null;
      }
      const porId = new Map();
      for (const r of resultados ?? []) if (r && Number.isFinite(Number(r.id))) porId.set(Number(r.id), r);
      for (const id of aPedir) {
        const e = registro.comprobantes[String(id)];
        if (!e) continue;
        const r = porId.get(id);
        if (r?.ok) {
          registrarDetalle(e, r.detalle);
          delete e.intentosDefinitivos;
          out.registrados.push(e);
          continue;
        }
        e.intentos = (Number(e.intentos) || 0) + 1;
        if (r?.definitivo === true) e.intentosDefinitivos = (Number(e.intentosDefinitivos) || 0) + 1;
        if ((Number(e.intentosDefinitivos) || 0) >= MAX_ERRORES_DEFINITIVOS) {
          e.estado = "ilegible"; // no se vuelve a pedir; se cuenta, no deja la corrida en rojo
          continue;
        }
        e.estado = "pendiente";
        fallar(r ? `comprobante ${id}: ${r.error ?? "error sin detalle"}` : `comprobante ${id}: sin resultado del detalle`);
      }
    }
    if (out.estado === "ok" && contarEstado(registro, "pendiente") > 0) out.estado = "parcial";
  }
  return out;
}

// La contabilidad de un par en memoria (lo cargado + lo de esta corrida).
function nuevaContabilidad(libreta, tInicioLectura) {
  return {
    corte: libreta.corte ?? tInicioLectura.toISOString(),
    consumos: { ...(libreta.consumos ?? {}) },
    resembradoEn: { ...(libreta.resembradoEn ?? {}) },
    resembradoPor: { ...(libreta.resembradoPor ?? {}) },
  };
}

// Paso 5 (y otra vez despues del refresco): lineas anteriores al corte ->
// "pre-corte"; lineas de un SKU resembrado anteriores a resembradoEn[sku] ->
// "absoluto"/"sembrado". Devuelve las unidades marcadas pre-corte.
function aplicarCortes(contab, lineas, enIso) {
  const corteMs = new Date(contab.corte).getTime();
  let preCorte = 0;
  for (const l of lineas) {
    const clave = claveConsumo(l.comprobanteId, l.sku);
    if (Object.prototype.hasOwnProperty.call(contab.consumos, clave)) continue;
    const ref = new Date(l.referencia).getTime();
    if (!Number.isFinite(ref)) continue;
    if (ref < corteMs) {
      contab.consumos[clave] = { cantidad: l.cantidad, motivo: "pre-corte", referencia: l.referencia, en: enIso };
      preCorte += l.cantidad;
      continue;
    }
    const resembrado = contab.resembradoEn[l.sku];
    if (resembrado && ref < new Date(resembrado).getTime()) {
      const motivo = contab.resembradoPor[l.sku] === "sembrado" ? "sembrado" : "absoluto";
      contab.consumos[clave] = { cantidad: l.cantidad, motivo, referencia: l.referencia, en: enIso };
    }
  }
  return preCorte;
}

function pendientesSinConsumir(lineas, consumos) {
  let n = 0;
  for (const l of lineas) if (!Object.prototype.hasOwnProperty.call(consumos, claveConsumo(l.comprobanteId, l.sku))) n += l.cantidad;
  return n;
}

// Contexto de UNA corrida: sesion, registro y refresco compartidos por los pares.
function nuevaCorrida(deps) {
  return { deps, sesion: undefined, sesionCreada: false, registro: null, rutaRegistro: null, refresco: null, podadas: [] };
}

function sesionDe(ctx) {
  if (!ctx.sesionCreada) {
    ctx.sesionCreada = true;
    ctx.sesion = typeof ctx.deps.crearSesion === "function" ? ctx.deps.crearSesion() : undefined;
  }
  return ctx.sesion;
}

// Carga sincronica del registro (antes del primer await, como la libreta).
function registroDe(ctx) {
  if (!ctx.registro) {
    const d = ctx.deps;
    ctx.rutaRegistro = typeof d.rutaRegistroComprobantes === "function" ? d.rutaRegistroComprobantes() : null;
    ctx.registro =
      ctx.rutaRegistro && typeof d.cargarRegistroComprobantes === "function"
        ? d.cargarRegistroComprobantes(ctx.rutaRegistro)
        : registroVacio();
    if (!Array.isArray(ctx.registro.diasCerrados)) ctx.registro.diasCerrados = [];
    if (!esObjetoPlano(ctx.registro.comprobantes)) ctx.registro.comprobantes = {};
  }
  return ctx.registro;
}

export async function ejecutarPar(par, deps = DEPS_REALES, opciones = {}) {
  return ejecutarParEnCorrida(par, deps, opciones, null);
}

async function ejecutarParEnCorrida(
  par,
  deps,
  {
    full = false,
    checkpointCada = CHECKPOINT_CADA,
    escrituraAbsoluta = null,
    margenAcreditacionMs = MARGEN_ACREDITACION_MS,
    topeDetalles = TOPE_DETALLES_DEFECTO,
  } = {},
  corrida
) {
  if (par.pendiente) {
    return { pendiente: true, motivo: `par "${par.nombre}": depositoId/locationId sin confirmar` };
  }
  const ctx = corrida ?? nuevaCorrida(deps);
  const esDry = () => (deps.esDryRun ? deps.esDryRun() : false);

  // Nota: la libreta (y el registro) se leen ANTES del primer await a
  // proposito. Varios tests (patron conDirTemporal) borran el directorio
  // temporal en un `finally` que puede correr apenas esta funcion cede el control.
  const ruta = deps.rutaSnapshotPara(par.stateKey);
  const libreta = deps.cargarLibretaCompleta(ruta);
  const registro = registroDe(ctx);
  const sesion = sesionDe(ctx);

  // R-9: tInicioLectura ANTES de leer el stock.
  const tInicioLectura = typeof deps.ahora === "function" ? deps.ahora() : new Date();
  const tIso = tInicioLectura.toISOString();

  // La cache se poda tambien AL CARGARSE (ronda 4), antes de mirar creditos.
  ctx.podadas.push(...podarRegistro(registro, tInicioLectura));

  const stock = await deps.getStockDeposito(par.depositoId, sesion);

  const contab = nuevaContabilidad(libreta, tInicioLectura);
  const consumosIniciales = { ...contab.consumos };
  podarConsumos(contab.consumos, registro, tInicioLectura);

  let creditosPreCorte = aplicarCortes(contab, lineasDelPar(registro, par.depositoId), tIso);

  // R-3: refresco solo si algun SKU con baseline tiene delta, o si queda
  // credito sin consumir en el deposito del par. Un SKU sembrado no dispara.
  let hayDelta = false;
  for (const [sku, cantidad] of stock) {
    if (esNoSincronizable(sku)) continue;
    const base = libreta.contabilium?.[sku];
    if (base !== undefined && base !== null && cantidad !== base) {
      hayDelta = true;
      break;
    }
  }
  const requiereRefresco = hayDelta || pendientesSinConsumir(lineasDelPar(registro, par.depositoId), contab.consumos) > 0;

  let clasificador = "no_requerido";
  let comprobantesPedidos = 0;
  let notasCredito = 0;
  if (requiereRefresco) {
    let hizoElRefresco = false;
    if (!ctx.refresco) {
      hizoElRefresco = true;
      const r = await refrescarRegistro({ deps, registro, sesion, tInicioLectura, topeDetalles });
      ctx.podadas.push(...podarRegistro(registro, tInicioLectura));
      if (ctx.rutaRegistro && typeof deps.guardarRegistroComprobantes === "function") {
        try {
          deps.guardarRegistroComprobantes(registro, ctx.rutaRegistro);
        } catch (err) {
          r.estado = "fallo";
          r.error = r.error ?? `no se pudo guardar el registro de comprobantes: ${err?.message ?? err}`;
        }
      }
      ctx.refresco = r;
      if (r.estado === "fallo") {
        // Una vez por corrida (R-12), sin SKUs.
        console.error(`[CLASIFICADOR][ERROR] ${par.nombre}: ${r.error}`);
      }
    }
    clasificador = ctx.refresco.estado;
    if (hizoElRefresco) comprobantesPedidos = ctx.refresco.pedidos;
    for (const e of ctx.refresco.registrados) {
      if (e.notaCreditoShopify && String(e.inventario) === String(par.depositoId)) notasCredito++;
    }
    podarConsumos(contab.consumos, registro, tInicioLectura);
    creditosPreCorte += aplicarCortes(contab, lineasDelPar(registro, par.depositoId), tIso);
  }

  // Lineas del par por SKU (match EXACTO de SKU, invariante 3).
  const lineasPorSku = new Map();
  for (const l of lineasDelPar(registro, par.depositoId)) {
    if (!lineasPorSku.has(l.sku)) lineasPorSku.set(l.sku, []);
    lineasPorSku.get(l.sku).push(l);
  }

  const snapshotPrevio = libreta.skus;
  const snapshotNuevo = { ...snapshotPrevio };
  const planDry = [];

  // H3/R-13: el baseline de `contabilium` solo avanza para SKUs REALMENTE
  // resueltos en esta pasada (actualizado/sin_cambios/dry).
  const contabiliumNuevo = new Map(Object.entries(libreta.contabilium ?? {}));

  const contadores = {
    actualizado: 0,
    dry: 0,
    sin_cambios: 0,
    no_encontrado: 0,
    no_activado: 0,
    error: 0,
    ambiguo: 0,
    no_sincronizable: 0,
    saltado: 0,
  };
  let causaVentaShopify = 0;
  let causaDesconocida = 0;
  const clasificadorIncompleto = clasificador === "fallo" || clasificador === "parcial";

  const contabilidadParaGuardar = () => ({
    corte: contab.corte,
    consumos: contab.consumos,
    resembradoEn: contab.resembradoEn,
    resembradoPor: contab.resembradoPor,
  });

  let procesados = 0;

  // R-15 (DISENO 6.1): que SKUs alcanzo la compuerta manual en este par y como
  // terminaron. El cruce entre pares lo hace evaluarCorridaMultiPar.
  const compuertaSkus = { pedidos: [], aplicados: [], noActivados: [] };

  for (const [sku, cantidad] of stock) {
    if (escrituraAbsolutaAlcanzaA(sku, escrituraAbsoluta)) compuertaSkus.pedidos.push(sku);
    if (esNoSincronizable(sku)) {
      contadores.no_sincronizable++;
      continue;
    }

    const alcanzaAbsoluta = escrituraAbsolutaAlcanzaA(sku, escrituraAbsoluta);
    const baseline = libreta.contabilium?.[sku] ?? null;
    const sembrado = baseline === null;
    const lineasSku = lineasPorSku.get(sku) ?? [];
    const credito =
      alcanzaAbsoluta || sembrado
        ? { credito: 0, claves: [] }
        : creditoAcreditable({ lineas: lineasSku, consumos: contab.consumos, tInicioLectura, margenMs: margenAcreditacionMs });

    if (!alcanzaAbsoluta && !full && snapshotPrevio[sku] === cantidad && credito.credito === 0) {
      // CA-1: el atajo incremental es la MISMA conclusion que "sin cambios".
      contadores.saltado++;
      contadores.sin_cambios++;
      continue;
    }

    let info;
    let resultado;
    let motivoAbsoluto = null;
    try {
      info = await deps.resolverSku(sku, par.locationId);
    } catch (err) {
      if (err instanceof SkuAmbiguoError) {
        console.warn(`  [SKIP] ${par.nombre}/${sku}: ${err.message} -> no se escribe`);
        for (const linea of err.detalle()) console.warn(linea);
        resultado = "ambiguo";
      } else {
        console.error(`  [ERROR] ${par.nombre}/${sku}: fallo al consultar Shopify -> ${err.message}`);
        resultado = "error";
      }
      info = null;
    }

    if (resultado === undefined) {
      if (!info) {
        console.warn(`  [SKIP] ${par.nombre}/${sku}: no existe en Shopify`);
        resultado = "no_encontrado";
      } else if (info.available === null) {
        console.warn(`  [SKIP] ${par.nombre}/${sku}: el item no esta activado en esa location`);
        resultado = "no_activado";
      } else {
        const { inventoryItemId, available } = info;

        let nuevoValor;
        if (alcanzaAbsoluta || sembrado) {
          // R-7: compuerta manual o primera vez del SKU: el absoluto.
          nuevoValor = Math.round(cantidad);
          motivoAbsoluto = alcanzaAbsoluta ? "absoluto" : "sembrado";
        } else {
          // R-5: regla contable. Nunca el absoluto (invariante 1).
          const delta = cantidad - baseline;
          nuevoValor = Math.round(available + delta + credito.credito);
          if (clasificadorIncompleto && delta + credito.credito !== 0) causaDesconocida++;
        }

        if (available === nuevoValor) {
          resultado = "sin_cambios";
        } else if (esDry()) {
          planDry.push({ sku, par: par.nombre, locationId: par.locationId, actual: available, nuevoValor });
          console.log(
            `  [DRY] ${par.nombre}/${sku}: actualizaria ${available} -> ${nuevoValor} (no se escribe, DRY_RUN=true)`
          );
          resultado = "dry";
        } else {
          try {
            await deps.setearStock(inventoryItemId, nuevoValor, available, par.locationId);
            console.log(`  [SET] ${par.nombre}/${sku}: ${available} -> ${nuevoValor}`);
            resultado = "actualizado";
          } catch (err) {
            console.error(`  [ERROR] ${par.nombre}/${sku}: fallo al escribir en Shopify -> ${err.message}`);
            resultado = "error";
          }
        }
      }
    }

    contadores[resultado] = (contadores[resultado] ?? 0) + 1;
    if (alcanzaAbsoluta) {
      if (resultado === "actualizado" || resultado === "sin_cambios" || resultado === "dry") {
        compuertaSkus.aplicados.push(sku);
      } else if (resultado === "no_activado") {
        compuertaSkus.noActivados.push(sku);
      }
    }

    // H5: solo se anota lo REALMENTE sincronizado en Shopify (R-7).
    if (resultado === "actualizado" || resultado === "sin_cambios") {
      snapshotNuevo[sku] = cantidad;
    } else if (snapshotNuevo[sku] !== undefined) {
      delete snapshotNuevo[sku];
    }

    // Baseline y consumo avanzan JUNTOS, y solo para SKUs resueltos (R-8). En
    // DRY_RUN se calculan en memoria pero nunca se persisten.
    if (resultado === "actualizado" || resultado === "sin_cambios" || resultado === "dry") {
      contabiliumNuevo.set(sku, cantidad);
      if (motivoAbsoluto) {
        contab.resembradoEn[sku] = tIso;
        contab.resembradoPor[sku] = motivoAbsoluto;
        for (const l of lineasSku) {
          const clave = claveConsumo(l.comprobanteId, l.sku);
          if (Object.prototype.hasOwnProperty.call(contab.consumos, clave)) continue;
          if (new Date(l.referencia).getTime() < tInicioLectura.getTime()) {
            contab.consumos[clave] = { cantidad: l.cantidad, motivo: motivoAbsoluto, referencia: l.referencia, en: tIso };
          }
        }
      } else if (credito.credito > 0) {
        for (const clave of credito.claves) {
          const l = lineasSku.find((x) => claveConsumo(x.comprobanteId, x.sku) === clave);
          contab.consumos[clave] = { cantidad: l.cantidad, motivo: "delta", referencia: l.referencia, en: tIso };
        }
        causaVentaShopify += credito.credito;
      }
    }

    procesados++;
    if (!esDry() && procesados % checkpointCada === 0) {
      deps.guardarSnapshot(snapshotNuevo, ruta, contabiliumNuevo, contabilidadParaGuardar());
    }
  }

  if (!esDry()) deps.guardarSnapshot(snapshotNuevo, ruta, contabiliumNuevo, contabilidadParaGuardar());

  // Unidades del par podadas de la cache sin haberse consumido (30 dias).
  let creditosVencidos = 0;
  const vistas = new Set();
  for (const e of ctx.podadas) {
    if (!e || vistas.has(e.id)) continue;
    vistas.add(e.id);
    if (String(e.inventario) !== String(par.depositoId) || !Array.isArray(e.lineas)) continue;
    for (const l of e.lineas) {
      const clave = claveConsumo(l.comprobanteId, l.sku);
      if (!(clave in consumosIniciales) && !(clave in contab.consumos)) creditosVencidos += l.cantidad;
    }
  }

  const resumen = {
    ...contadores,
    total: stock.size,
    clasificador,
    causa_venta_shopify: causaVentaShopify,
    causa_desconocida: clasificadorIncompleto ? causaDesconocida : 0,
    creditos_pendientes: pendientesSinConsumir(lineasDelPar(registro, par.depositoId), contab.consumos),
    creditos_pre_corte: creditosPreCorte,
    creditos_vencidos: creditosVencidos,
    notas_credito_shopify: notasCredito,
    comprobantes_pedidos: comprobantesPedidos,
    comprobantes_pendientes: contarEstado(registro, "pendiente"),
    comprobantes_ilegibles: contarEstado(registro, "ilegible"),
    compuerta_pedidos: compuertaSkus.pedidos.length,
    compuerta_aplicados: compuertaSkus.aplicados.length,
  };

  // R-12: un resumen por par, sin SKUs (repo y logs publicos).
  const texto = Object.entries(resumen)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`[RESUMEN] ${par.nombre}: ${texto}`);

  return { ...resumen, planDry, compuertaSkus };
}

// -----------------------------------------------------------------------------
// correrTodosLosPares — orquesta ejecutarPar() para cada par declarado en la
// configuracion (R-2). Antes de arrancar con el par "dot", migra su libreta
// legada (R-11) si corresponde. Una sesion de Contabilium, un registro y como
// maximo un refresco por corrida, compartidos por todos los pares (R-1/R-3).
// Devuelve { [stateKey]: resumen }.
// -----------------------------------------------------------------------------
export async function correrTodosLosPares(pares, deps = DEPS_REALES, opciones = {}) {
  const parDot = pares.find((p) => p.stateKey === "dot");
  if (parDot) {
    deps.migrarLibretaLegada(deps.SNAPSHOT_PATH, deps.rutaSnapshotPara(parDot.stateKey));
  }

  const ctx = nuevaCorrida(deps);
  if (pares.some((p) => !p.pendiente)) sesionDe(ctx);

  const porPar = {};
  for (const par of pares) {
    porPar[par.stateKey] = await ejecutarParEnCorrida(par, deps, opciones, ctx);
  }
  return porPar;
}
