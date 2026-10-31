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
import { esNoSincronizable } from "./no-sincronizables.js";
import { detectarAnomalias, formatearAnomalias } from "./anomalias.js";

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

// Lee la libreta cruda una sola vez y devuelve las dos partes.
export function cargarLibretaCompleta(ruta = SNAPSHOT_PATH) {
  try {
    if (!existsSync(ruta)) return { skus: {}, contabilium: null };
    const crudo = JSON.parse(readFileSync(ruta, "utf-8"));
    return {
      skus: parsearLibreta(crudo) ?? {},
      contabilium: parsearSnapshotContabilium(crudo),
    };
  } catch {
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

export function guardarSnapshot(snap, ruta = SNAPSHOT_PATH, contabilium = null) {
  // H3: en un runner limpio .cache/ no existe y writeFileSync tira ENOENT.
  mkdirSync(dirname(ruta), { recursive: true });
  const payload = { __v: SNAPSHOT_VERSION, skus: snap };
  if (contabilium) payload.contabilium = Object.fromEntries(contabilium);
  writeFileSync(ruta, JSON.stringify(payload, null, 2), "utf-8");
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
async function procesarSku(sku, stockObjetivo, baseline, locationId = process.env.SHOPIFY_DOT_LOCATION_ID) {
  const dryRun = esDryRun();

  let info;
  try {
    info = await resolverSku(sku, locationId);
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
    await setearStock(inventoryItemId, nuevoValor, available, locationId);
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

  // R-11: el DOT ya no vive en el SNAPSHOT_PATH legado, sino en su libreta
  // por-par. Leer el legado aca reintroduce el bug de CA-1: con DRY_RUN=false
  // escribiria contra una base que ya no avanza desde la migracion.
  const ruta = rutaSnapshotPara("dot");
  const libreta = cargarLibretaCompleta(ruta);
  const baseline = libreta.contabilium?.[skuNorm] ?? null;
  const resultado = await procesarSku(skuNorm, objetivo, baseline);

  // CA-1: igual que ejecutarPar, solo se anota lo REALMENTE sincronizado en
  // Shopify (R-7). Sin esto, la corrida siguiente vuelve a ver un baseline
  // viejo y reaplica el mismo delta sobre un Shopify que ya lo tenia.
  if (resultado === "actualizado" || resultado === "sin_cambios") {
    const snapshotNuevo = { ...libreta.skus, [skuNorm]: objetivo };
    const contabiliumNuevo = new Map(Object.entries(libreta.contabilium ?? {}));
    contabiliumNuevo.set(skuNorm, objetivo);
    guardarSnapshot(snapshotNuevo, ruta, contabiliumNuevo);
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
const DEPS_REALES = {
  getStockDeposito,
  resolverSku,
  setearStock,
  cargarLibretaCompleta,
  guardarSnapshot,
  rutaSnapshotPara,
  esDryRun,
  SNAPSHOT_PATH,
  migrarLibretaLegada,
};

export async function ejecutarPar(par, deps = DEPS_REALES, { full = false, checkpointCada = CHECKPOINT_CADA } = {}) {
  if (par.pendiente) {
    return { pendiente: true, motivo: `par "${par.nombre}": depositoId/locationId sin confirmar` };
  }

  // Nota: la libreta se lee ANTES de awaitear getStockDeposito a proposito.
  // Varios tests de este repo (patron conDirTemporal) hacen IO sincronica de
  // seteo sobre un directorio temporal y lo borran en un `finally` que corre
  // tan pronto el primer `await` de esta funcion le devuelve el control al
  // caller -- si la lectura de la libreta quedara detras de un `await`,
  // llegaria tarde: el directorio ya podria estar borrado.
  const ruta = deps.rutaSnapshotPara(par.stateKey);
  const libreta = deps.cargarLibretaCompleta(ruta);
  const stock = await deps.getStockDeposito(par.depositoId);

  const snapshotPrevio = libreta.skus;
  const snapshotNuevo = { ...snapshotPrevio };
  const planDry = [];

  // H3/R-13: el baseline de `contabilium` solo avanza para SKUs REALMENTE
  // resueltos en esta pasada (actualizado/sin_cambios/dry). Un SKU no
  // alcanzado todavia (interrupcion) o resuelto como no_encontrado,
  // no_activado, ambiguo o error conserva su baseline previo intacto --
  // nunca se le asigna uno nuevo a partir del valor de Contabilium que
  // todavia no se escribio de verdad.
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

  let procesados = 0;

  for (const [sku, cantidad] of stock) {
    if (esNoSincronizable(sku)) {
      contadores.no_sincronizable++;
      continue;
    }

    if (!full && snapshotPrevio[sku] === cantidad) {
      // CA-1: el atajo incremental no es una categoria aparte de "sin
      // cambios" -- es la MISMA conclusion (Contabilium no cambio desde la
      // ultima vez que se confirmo contra Shopify), llegada sin pagar el
      // costo de una consulta a Shopify. Si solo contara como "saltado", una
      // corrida que escribio por otra vía (p.ej. syncUnSku) y deja la
      // libreta ya al dia se reportaria con sin_cambios=0 en la corrida
      // siguiente, aunque no haya nada pendiente ni se haya reescrito nada.
      contadores.saltado++;
      contadores.sin_cambios++;
      continue;
    }

    const baseline = libreta.contabilium?.[sku] ?? null;

    let info;
    let resultado;
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
        const { nuevoValor } = calcularEscritura({
          baseline,
          contabiliumActual: cantidad,
          shopifyActual: available,
        });

        if (available === nuevoValor) {
          resultado = "sin_cambios";
        } else if (deps.esDryRun ? deps.esDryRun() : false) {
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

    // H5: solo se anota lo REALMENTE sincronizado en Shopify (R-7).
    if (resultado === "actualizado" || resultado === "sin_cambios") {
      snapshotNuevo[sku] = cantidad;
    } else if (snapshotNuevo[sku] !== undefined) {
      delete snapshotNuevo[sku];
    }

    if (resultado === "actualizado" || resultado === "sin_cambios" || resultado === "dry") {
      contabiliumNuevo.set(sku, cantidad);
    }

    procesados++;
    if (!(deps.esDryRun ? deps.esDryRun() : false) && procesados % checkpointCada === 0) {
      deps.guardarSnapshot(snapshotNuevo, ruta, contabiliumNuevo);
    }
  }

  if (!(deps.esDryRun ? deps.esDryRun() : false)) deps.guardarSnapshot(snapshotNuevo, ruta, contabiliumNuevo);

  return { ...contadores, total: stock.size, planDry };
}

// -----------------------------------------------------------------------------
// correrTodosLosPares — orquesta ejecutarPar() para cada par declarado en la
// configuracion (R-2). Antes de arrancar con el par "dot", migra su libreta
// legada (R-11) si corresponde. Devuelve { [stateKey]: resumen }.
// -----------------------------------------------------------------------------
export async function correrTodosLosPares(pares, deps = DEPS_REALES, opciones = {}) {
  const parDot = pares.find((p) => p.stateKey === "dot");
  if (parDot) {
    deps.migrarLibretaLegada(deps.SNAPSHOT_PATH, deps.rutaSnapshotPara(parDot.stateKey));
  }

  const porPar = {};
  for (const par of pares) {
    porPar[par.stateKey] = await ejecutarPar(par, deps, opciones);
  }
  return porPar;
}
