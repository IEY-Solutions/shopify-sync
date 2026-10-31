// R-1/CA-1 — cuarto veredicto del juez (2026-10-29):
//
//   "CA-1 no cumple: El modo --sku (syncUnSku) sigue tomando la línea base de
//   la libreta legada .cache/last-sync.json. Desde la migración, ese archivo
//   ya no avanza [...] Con DRY_RUN=false eso escribe en la location real."
//
// INTERFAZ USADA (ya exportada por src/sync.js; no se inspecciono el cuerpo
// de syncUnSku para no mirar el fix en curso en paralelo — solo se uso lo que
// package.json ("sync:sku": "node src/index.js --sku") y el comentario de
// cabecera de src/index.js ya documentan como contrato publico: `--sku SKU
// --qty N` corre un SKU puntual con una cantidad de Contabilium fija, sin
// llamar a Contabilium de verdad):
//
//   syncUnSku(sku, manualQty = null) en src/sync.js.
//
// Este caso NO llama migrarLibretaLegada a mano, ni inspecciona que archivo
// lee syncUnSku por dentro: solo monta las DOS libretas reales en disco (la
// legada SNAPSHOT_PATH y la por-par rutaSnapshotPara("dot")) con baselines
// DISTINTOS y observa, por el efecto en la escritura real a Shopify (mockeada
// via fetch), cual de las dos uso. Por eso el caso detecta el bug descripto
// por el juez sin acoplarse a una implementacion interna concreta.
//
// Por que los dos baselines dan un resultado DISTINGUIBLE:
//   baseline LEGADO (congelado antes de la migracion):      contabilium = 10
//   baseline POR-PAR (avanzado por corridas del camino nuevo): contabilium = 15
//   Contabilium "ahora" (manualQty, no se lee la red real):     17
//   Shopify "ahora" (mockeado):                                 8
//
//   Si usa el baseline POR-PAR (correcto): delta = 17-15 = 2, nuevoValor = 8+2 = 10.
//   Si usa el baseline LEGADO (bug de CA-1): delta = 17-10 = 7, nuevoValor = 8+7 = 15.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  syncUnSku,
  guardarSnapshot,
  cargarLibretaCompleta,
  rutaSnapshotPara,
  ejecutarPar,
  SNAPSHOT_PATH,
} from "../src/sync.js";
import { construirPares } from "../src/pares.js";

// resolverSku() (src/shopify.js) NO es inyectable: antes de pegarle a Shopify
// mira si el SKU ya esta en este archivo real en disco. Si esta, toma el
// camino "cacheado" (solo GetLevel); si no, toma el camino "primera vez"
// (GetVariantBySku, que ademas escribe esta misma cache al terminar). Por eso
// esto NO es memoria de proceso: persiste entre corridas de `node --test`
// aunque sean procesos distintos, y es la causa real de que este caso
// dependiera de si se corrio antes `npm test` (que deja a este SKU cacheado
// para la proxima corrida aislada). Se respalda y limpia la entrada de este
// SKU en esa misma cache, igual que ya se hace con las dos libretas, para que
// el resultado sea el mismo SIEMPRE: aislado o dentro del glob completo.
const __dirname = dirname(fileURLToPath(import.meta.url));
const RUTA_CACHE_SKU = join(__dirname, "..", ".cache", "sku-map.json");

function leerCacheSku() {
  if (!existsSync(RUTA_CACHE_SKU)) return {};
  try {
    return JSON.parse(readFileSync(RUTA_CACHE_SKU, "utf-8"));
  } catch {
    return {};
  }
}

// -----------------------------------------------------------------------------
// syncUnSku no acepta `deps` (no es inyectable como ejecutarPar): lee las
// libretas reales por su ruta real en disco (.cache/). Por eso este caso
// escribe/restaura los archivos REALES, con backup y restore explicitos --
// no un directorio temporal, porque syncUnSku no toma ningun parametro de
// directorio.
// -----------------------------------------------------------------------------
function backupArchivo(ruta) {
  if (existsSync(ruta)) {
    return { existia: true, contenido: readFileSync(ruta, "utf-8") };
  }
  return { existia: false };
}

function restaurarArchivo(ruta, backup) {
  if (backup.existia) {
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, backup.contenido, "utf-8");
  } else if (existsSync(ruta)) {
    rmSync(ruta);
  }
}

test("CA-1: syncUnSku (modo --sku) usa el baseline de la libreta POR-PAR del DOT, no la legada", async (t) => {
  const SKU = "TEST-CA1-BASELINE-POR-PAR-UNICO";
  const LOCATION_DOT = "gid://shopify/Location/83342655574";

  const rutaLegada = SNAPSHOT_PATH;
  const rutaPorPar = rutaSnapshotPara("dot");

  const backupLegado = backupArchivo(rutaLegada);
  const backupPorPar = backupArchivo(rutaPorPar);
  const backupCacheSku = backupArchivo(RUTA_CACHE_SKU);

  // Forzamos el camino "primera vez" (GetVariantBySku) borrando SOLO la
  // entrada de este SKU de prueba de la cache real -- no tocamos las entradas
  // de otros SKUs que pueda haber ahi.
  {
    const cacheSku = leerCacheSku();
    delete cacheSku[SKU];
    mkdirSync(dirname(RUTA_CACHE_SKU), { recursive: true });
    writeFileSync(RUTA_CACHE_SKU, JSON.stringify(cacheSku, null, 2), "utf-8");
  }

  const envPrevio = {
    DRY_RUN: process.env.DRY_RUN,
    SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION,
    SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
    SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
    SHOPIFY_DOT_LOCATION_ID: process.env.SHOPIFY_DOT_LOCATION_ID,
  };
  const fetchOriginal = globalThis.fetch;

  t.after(() => {
    restaurarArchivo(rutaLegada, backupLegado);
    restaurarArchivo(rutaPorPar, backupPorPar);
    restaurarArchivo(RUTA_CACHE_SKU, backupCacheSku);
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(envPrevio)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // CA-1 solo importa porque con DRY_RUN=false esto escribe de verdad.
  process.env.DRY_RUN = "false";
  process.env.SHOPIFY_STORE_DOMAIN = "tienda-fake.myshopify.com";
  process.env.SHOPIFY_API_VERSION = "2026-04";
  process.env.SHOPIFY_CLIENT_ID = "id-fake";
  process.env.SHOPIFY_CLIENT_SECRET = "secret-fake";
  process.env.SHOPIFY_DOT_LOCATION_ID = LOCATION_DOT;

  // Legado: la ultima vez que el camino viejo escribio este SKU, Contabilium
  // decia 10 -- y ese archivo ya NO avanza desde la migracion (R-11).
  guardarSnapshot({ [SKU]: 5 }, rutaLegada, new Map([[SKU, 10]]));
  // Por-par del DOT: avanzado por varias corridas del camino nuevo, Contabilium
  // ya decia 15 la ultima vez que ejecutarPar corrio este SKU.
  guardarSnapshot({ [SKU]: 9 }, rutaPorPar, new Map([[SKU, 15]]));

  const llamadasSetearStock = [];

  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("/oauth/access_token")) {
      return { ok: true, json: async () => ({ access_token: "tok-fake", expires_in: 86400 }) };
    }
    const body = JSON.parse(opts.body);

    if (body.query.includes("GetVariantBySku")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            productVariants: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/ProductVariant/CA1-1",
                    sku: SKU,
                    product: { id: "gid://shopify/Product/CA1-1", title: "Fixture CA-1" },
                    inventoryItem: {
                      id: "gid://shopify/InventoryItem/CA1-1",
                      inventoryLevel: {
                        quantities: [{ name: "available", quantity: 8 }],
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
      };
    }

    // Defensivo: aunque arriba forzamos el camino "primera vez" limpiando la
    // cache de SKU en disco, resolverSku() podria tomar el camino "cacheado"
    // (solo GetLevel, sin GetVariantBySku) si algo deja una entrada previa de
    // este SKU. Respondemos tambien esta query para que el mock cubra
    // CUALQUIER combinacion de llamadas que syncUnSku/resolverSku puedan
    // hacer en este escenario, no solo la que esperamos que use.
    if (body.query.includes("GetLevel")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            inventoryItem: {
              inventoryLevel: {
                quantities: [{ name: "available", quantity: 8 }],
              },
            },
          },
        }),
      };
    }

    if (body.query.includes("InventorySet")) {
      llamadasSetearStock.push(body.variables.input);
      return { ok: true, json: async () => ({ data: { inventorySetQuantities: { userErrors: [] } } }) };
    }

    throw new Error("fetch inesperado en el test CA-1: " + body.query.slice(0, 80));
  };

  // Contabilium "ahora" dice 17 para este SKU -- se lo damos a mano (modo
  // manual --qty), para no depender de la red real de Contabilium y aislar
  // exclusivamente cual LIBRETA (cual baseline) usa syncUnSku.
  await syncUnSku(SKU, 17);

  assert.equal(
    llamadasSetearStock.length,
    1,
    "con DRY_RUN=false y un delta distinto de cero tiene que escribir exactamente una vez"
  );
  const quantity = llamadasSetearStock[0].quantities[0].quantity;
  assert.equal(
    quantity,
    10,
    "tiene que usar el baseline de la libreta POR-PAR (15): 17-15=2, nuevoValor=8+2=10. " +
      "Si usara el baseline LEGADO (10, congelado desde antes de la migracion): " +
      "17-10=7, nuevoValor=8+7=15 -- ese 15 es exactamente el bug que describe el 4to veredicto del juez."
  );
});

// -----------------------------------------------------------------------------
// CA-1 — 5to veredicto del juez (2026-10-29):
//
//   "CA-1 no cumple: [...] syncUnSku [...] escribe pero no persiste la
//   libreta [...] en la corrida siguiente [...] vuelve a aplicar el mismo
//   delta [...] Ningun comando de CA-1 ejercita ese camino."
//
// El caso anterior (arriba) ya demuestra que syncUnSku LEE el baseline
// correcto (por-par), pero nunca confirma que, despues de escribir, ese
// mismo archivo por-par haya quedado ACTUALIZADO con el nuevo valor de
// Contabilium. Si syncUnSku escribe en Shopify pero no llama a
// guardarSnapshot (o lo llama con el valor viejo) sobre rutaSnapshotPara("dot"),
// la libreta queda vieja: la "corrida siguiente" (acá simulada con
// ejecutarPar, el camino real de produccion) volveria a ver el baseline
// desactualizado, a calcular el mismo delta distinto de cero, y a reescribir
// en Shopify un valor que ya estaba escrito -- el bug exacto que describe el
// juez.
//
// Este caso NO inspecciona el cuerpo de syncUnSku: solo lee el archivo real
// en disco despues de la llamada (mismo patron que el resto de este archivo)
// y despues ejercita ejecutarPar (ya usado como interfaz publica por
// test/orquestacion-pares.test.js) con deps fake para simular "la corrida
// siguiente" sin red real.
// -----------------------------------------------------------------------------

test("CA-1: despues de escribir, syncUnSku deja la libreta POR-PAR actualizada, y la corrida siguiente (ejecutarPar) no repite el delta", async (t) => {
  const SKU = "TEST-CA1-PERSISTE-LIBRETA-UNICO";
  const LOCATION_DOT = "gid://shopify/Location/83342655574";
  const DEPOSITO_DOT = "127356";
  const CONTABILIUM_AHORA = 20;
  const SHOPIFY_ANTES = 5;

  const rutaLegada = SNAPSHOT_PATH;
  const rutaPorPar = rutaSnapshotPara("dot");

  const backupLegado = backupArchivo(rutaLegada);
  const backupPorPar = backupArchivo(rutaPorPar);
  const backupCacheSku = backupArchivo(RUTA_CACHE_SKU);

  {
    const cacheSku = leerCacheSku();
    delete cacheSku[SKU];
    mkdirSync(dirname(RUTA_CACHE_SKU), { recursive: true });
    writeFileSync(RUTA_CACHE_SKU, JSON.stringify(cacheSku, null, 2), "utf-8");
  }

  const envPrevio = {
    DRY_RUN: process.env.DRY_RUN,
    SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION,
    SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
    SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
    SHOPIFY_DOT_LOCATION_ID: process.env.SHOPIFY_DOT_LOCATION_ID,
  };
  const fetchOriginal = globalThis.fetch;

  t.after(() => {
    restaurarArchivo(rutaLegada, backupLegado);
    restaurarArchivo(rutaPorPar, backupPorPar);
    restaurarArchivo(RUTA_CACHE_SKU, backupCacheSku);
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(envPrevio)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  process.env.DRY_RUN = "false";
  process.env.SHOPIFY_STORE_DOMAIN = "tienda-fake.myshopify.com";
  process.env.SHOPIFY_API_VERSION = "2026-04";
  process.env.SHOPIFY_CLIENT_ID = "id-fake";
  process.env.SHOPIFY_CLIENT_SECRET = "secret-fake";
  process.env.SHOPIFY_DOT_LOCATION_ID = LOCATION_DOT;

  // Sin baseline previo para este SKU (ni legado ni por-par): es la primera
  // vez real que se escribe, asi que se trata como "sembrado" (ver R-7, ya
  // cubierto en test/orquestacion-pares.test.js) y escribe el absoluto de
  // Contabilium.
  const llamadasSetearStock = [];

  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("/oauth/access_token")) {
      return { ok: true, json: async () => ({ access_token: "tok-fake", expires_in: 86400 }) };
    }
    const body = JSON.parse(opts.body);

    if (body.query.includes("GetVariantBySku")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            productVariants: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/ProductVariant/CA1-2",
                    sku: SKU,
                    product: { id: "gid://shopify/Product/CA1-2", title: "Fixture CA-1 persistencia" },
                    inventoryItem: {
                      id: "gid://shopify/InventoryItem/CA1-2",
                      inventoryLevel: {
                        quantities: [{ name: "available", quantity: SHOPIFY_ANTES }],
                      },
                    },
                  },
                },
              ],
            },
          },
        }),
      };
    }

    if (body.query.includes("GetLevel")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            inventoryItem: {
              inventoryLevel: {
                quantities: [{ name: "available", quantity: SHOPIFY_ANTES }],
              },
            },
          },
        }),
      };
    }

    if (body.query.includes("InventorySet")) {
      llamadasSetearStock.push(body.variables.input);
      return { ok: true, json: async () => ({ data: { inventorySetQuantities: { userErrors: [] } } }) };
    }

    throw new Error("fetch inesperado en el test CA-1 (persistencia): " + body.query.slice(0, 80));
  };

  // Paso 1: syncUnSku escribe, con Contabilium "ahora" = 20 (sembrado: sin
  // baseline previo, escribe el absoluto).
  await syncUnSku(SKU, CONTABILIUM_AHORA);

  assert.equal(
    llamadasSetearStock.length,
    1,
    "primera escritura real para este SKU: tiene que escribir exactamente una vez"
  );
  assert.equal(llamadasSetearStock[0].quantities[0].quantity, CONTABILIUM_AHORA);

  // Paso 2: la libreta POR-PAR del DOT, leida del disco real (sin inspeccionar
  // el cuerpo de syncUnSku), tiene que haber quedado actualizada con el nuevo
  // valor de Contabilium, tanto en `skus` como en `contabilium` -- es la unica
  // forma de que la corrida siguiente no vea un baseline viejo.
  const libretaTrasEscritura = cargarLibretaCompleta(rutaPorPar);
  assert.equal(
    libretaTrasEscritura.skus[SKU],
    CONTABILIUM_AHORA,
    "la libreta por-par tiene que quedar con el valor nuevo en 'skus' tras escribir con exito"
  );
  assert.equal(
    libretaTrasEscritura.contabilium?.[SKU],
    CONTABILIUM_AHORA,
    "la libreta por-par tiene que quedar con el valor nuevo en 'contabilium' (el baseline) " +
      "tras escribir con exito -- si no, la corrida siguiente repite el mismo delta"
  );

  // Paso 3: "la corrida siguiente" -- se simula con ejecutarPar (el camino
  // real de produccion, ya usado como interfaz publica por
  // test/orquestacion-pares.test.js), con el MISMO stock de Contabilium (sin
  // cambios) y deps fake que leen/escriben la libreta real por su ruta real
  // (rutaSnapshotPara("dot") sin override, igual que syncUnSku). Si el paso 2
  // fallara (libreta no actualizada), esta corrida veria el baseline viejo
  // (ausente) y volveria a tratar el SKU como sembrado, reescribiendo en
  // Shopify -- el bug exacto que describe el 5to veredicto.
  const [dot] = construirPares({
    CONTABILIUM_DOT_DEPOSITO_ID: DEPOSITO_DOT,
    SHOPIFY_DOT_LOCATION_ID: LOCATION_DOT,
  });

  const llamadasSetearStockCorridaSiguiente = [];
  const depsCorridaSiguiente = {
    cargarLibretaCompleta: (ruta) => cargarLibretaCompleta(ruta),
    guardarSnapshot: (snap, ruta, contabilium) => guardarSnapshot(snap, ruta, contabilium),
    rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey),
    getStockDeposito: async () => new Map([[SKU, CONTABILIUM_AHORA]]),
    resolverSku: async () => ({
      inventoryItemId: "gid://shopify/InventoryItem/CA1-2",
      available: CONTABILIUM_AHORA, // Shopify ya tiene el valor que syncUnSku escribio.
    }),
    setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      llamadasSetearStockCorridaSiguiente.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    },
  };

  const resultadoCorridaSiguiente = await ejecutarPar(dot, depsCorridaSiguiente);

  assert.equal(
    llamadasSetearStockCorridaSiguiente.length,
    0,
    "la corrida siguiente NO puede volver a escribir: si la libreta quedo actualizada en el " +
      "paso 2, el baseline (20) contra Contabilium ahora (20) da delta 0 (sin_cambios)"
  );
  assert.equal(
    resultadoCorridaSiguiente.sin_cambios,
    1,
    "tiene que resolver como sin_cambios, no reaplicar el delta ya escrito"
  );
  assert.equal(resultadoCorridaSiguiente.actualizado ?? 0, 0);
});
