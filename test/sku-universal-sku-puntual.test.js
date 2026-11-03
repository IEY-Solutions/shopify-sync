// CA-14 — `--sku` (syncUnSku/procesarSku) por el mismo camino universal (R-19).
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca14-sku-puntual.md
// (A, B1/B2/B2'/B3, C, D1-D3, E1-E3, F1-F3, G, H, I, y la tabla de codigo de salida).
//
// Punto de entrada medido: main(argv, env, deps) con argv equivalente a
// `--sku <sku>`, env con DRY_RUN:"false", y deps.syncUnSku envolviendo
// syncUnSku(sku, qty, d) con `d` inyectado (sin red, sin flag de dry-run en
// argv: src/argv.js no lo acepta).
//
// Corre con: node --test test/sku-universal-sku-puntual.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { main } from "../src/main.js";
import { syncUnSku, ejecutarPar, rutaSnapshotPara } from "../src/sync.js";
import { resolverSku } from "../src/shopify.js";
import { conDirTemporal, sembrarLibreta, leerLibretaCruda, PAR_DOT, capturarConsola, LOCATION_DOT } from "./_helpers-clasificador.js";
import { SKU_5V, VARIANTES_5V, nodoExacto, nodoUniversal } from "./_helpers-sku-universal.js";

const T = "2026-11-03T12:00:00.000Z";
const [V1, V2, V3, V4, V5] = VARIANTES_5V;

// `syncUnSku` lee process.env.SHOPIFY_DOT_LOCATION_ID directamente (no via
// argv/env de main): hace falta fijarlo para que par.locationId no sea
// undefined en las mutaciones. Se restaura al terminar el archivo.
const LOCATION_DOT_PREVIO = process.env.SHOPIFY_DOT_LOCATION_ID;
process.env.SHOPIFY_DOT_LOCATION_ID = LOCATION_DOT;
process.on("exit", () => {
  if (LOCATION_DOT_PREVIO === undefined) delete process.env.SHOPIFY_DOT_LOCATION_ID;
  else process.env.SHOPIFY_DOT_LOCATION_ID = LOCATION_DOT_PREVIO;
});

// SKU real del grupo A4 (informe:224), control fuera de la lista curada (E).
const SKU_NO_CURADO = "IEY-COMBO-CARBON-VERDE-IP16E";
const V_16E = { variantId: "gid://shopify/ProductVariant/8040001", inventoryItemId: "gid://shopify/InventoryItem/9040001" };
const V_17E = { variantId: "gid://shopify/ProductVariant/8040002", inventoryItemId: "gid://shopify/InventoryItem/9040002" };

// -----------------------------------------------------------------------------
// depsSku — construye las dependencias inyectadas de syncUnSku, pinneadas al
// directorio temporal (rutaSnapshotPara("dot", dir)), y el deps.syncUnSku que
// main() invoca (src/main.js:117: solo (sku, qty), sin tercer parametro).
// -----------------------------------------------------------------------------
function depsSku({ dir, stock, resolverSkuUniversal, resolverSkuMock, setearStock, t = T }) {
  const d = {
    rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey, dir),
    getStockDeposito: async () => stock,
    resolverSkuUniversal,
    resolverSku: resolverSkuMock ?? (async () => null),
    setearStock: setearStock ?? (async () => {}),
    esDryRun: () => false,
    ahora: () => new Date(t),
  };
  return {
    syncUnSku: (sku, qty) => syncUnSku(sku, qty, d),
  };
}

// resolverSkuUniversal inyectado: responde siempre con los nodos dados (misma
// forma que QUERY_POR_SKU), sin red. Registra las llamadas (`.llamadas`) para
// comprobar la query exacta de R-2.
function resolverUniversalInyectado(nodos, { hasNextPage = false } = {}) {
  const llamadas = [];
  const fn = async (sku, locationId) => {
    llamadas.push({ sku, locationId });
    const exactos = nodos.filter((n) => n.sku === sku && n.inventoryItem?.id);
    // import dinamico para no duplicar la logica de conteo (R-7): es
    // exactamente la que ya usa src/shopify.js.
    const esperadas = (await import("../src/shopify.js")).variantesUniversales(sku);
    if (exactos.length !== esperadas) {
      const { ConteoVariantesUniversalError: Err } = await import("../src/shopify.js");
      throw new Err(sku, esperadas, exactos.length, hasNextPage);
    }
    return exactos.map((n) => ({
      variantId: n.id,
      inventoryItemId: n.inventoryItem.id,
      available: n.inventoryItem.inventoryLevel?.quantities?.find((q) => q.name === "available")?.quantity ?? null,
    }));
  };
  fn.llamadas = llamadas;
  return fn;
}

// resolverSku REAL (src/shopify.js) con una consulta inyectada y una cache en
// disco (R-19, control de cache por el camino viejo de variante unica).
function resolverSkuConCache({ dir, nodos, hasNextPage = false, cacheInicial = null }) {
  const rutaCache = join(dir, "sku-map.json");
  if (cacheInicial) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(rutaCache, JSON.stringify(cacheInicial, null, 2), "utf-8");
  }
  const consultar = async () => ({
    productVariants: { edges: nodos.map((n) => ({ node: n })), pageInfo: { hasNextPage } },
  });
  return async (sku, locationId) => resolverSku(sku, locationId, { consultar, rutaCache });
}

function sembrarA(dir) {
  sembrarLibreta(dir, "dot", { skus: { [SKU_5V]: 10 }, contabilium: { [SKU_5V]: 10 } });
}

async function correrSku(sku, deps, qty = null) {
  return capturarConsola(() => main(["--sku", sku], { DRY_RUN: "false" }, deps));
}

// ----------------------------------------------------------------- A ---------
test("CA-14 A: sin entrada en cache, camino universal completo, salida 0", async () => {
  await conDirTemporal(async (dir) => {
    sembrarA(dir);
    const nodos = VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5));
    const resolverSkuUniversal = resolverUniversalInyectado(nodos);
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsSku({ dir, stock, resolverSkuUniversal, setearStock });

    const { valor: salida, lineas } = await correrSku(SKU_5V, deps);

    assert.equal(salida, 0);
    assert.ok(!lineas.some((l) => l.texto.includes("SKU ambiguo")));
    assert.ok(!lineas.some((l) => l.texto.startsWith("[FATAL]")));
    assert.equal(resolverSkuUniversal.llamadas.length, 1);
    assert.equal(resolverSkuUniversal.llamadas[0].sku, SKU_5V);

    assert.deepEqual(
      escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity, e.locationId]),
      VARIANTES_5V.map((v) => [v.inventoryItemId, 8, 5, LOCATION_DOT])
    );
    assert.ok(!escrituras.some((e) => e.quantity === 13), "sin siembra por cambio de destino: ningun mutar con 13");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_5V], 13);
    assert.equal(libreta.skus[SKU_5V], 13);
    assert.equal(libreta.escritos?.[SKU_5V], 8);
    assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId);

    const esperado = `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 8 (escritas=5, ya_estaban=0)`;
    assert.ok(lineas.some((l) => l.texto === esperado));
    assert.ok(!lineas.some((l) => l.texto.includes("[AVISO]")));
    assert.ok(!lineas.some((l) => l.texto.includes("[SET]")));
  });
});

// ----------------------------------------------------------------- B ---------
test("CA-14 B1: fallo parcial, queda pendiente, salida 1 con [FATAL]", async () => {
  await conDirTemporal(async (dir) => {
    sembrarA(dir);
    const nodos = VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5));
    const resolverSkuUniversal = resolverUniversalInyectado(nodos);
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      if (inventoryItemId === V3.inventoryItemId) throw new Error("rechazado");
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsSku({ dir, stock, resolverSkuUniversal, setearStock });

    const { valor: salida, lineas } = await correrSku(SKU_5V, deps);

    assert.equal(salida, 1);
    assert.ok(lineas.some((l) => l.texto.startsWith("[FATAL] ")));
    assert.deepEqual(
      escrituras.map((e) => e.inventoryItemId),
      [V1.inventoryItemId, V2.inventoryItemId, V4.inventoryItemId, V5.inventoryItemId]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.ok(libreta.pendientes?.[SKU_5V]);
    assert.equal(libreta.pendientes[SKU_5V].nuevoValor, 8);
    assert.equal(libreta.pendientes[SKU_5V].contabiliumObjetivo, 13);
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.equal(libreta.skus[SKU_5V], 10);
    assert.equal(libreta.escritos?.[SKU_5V], undefined);

    assert.ok(lineas.some((l) => l.texto.startsWith(`  [ERROR] dot/${SKU_5V}: `)));
    assert.ok(
      lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 8 PENDIENTE (escritas=4, ya_estaban=0, fallidas=1)`)
    );
  });
});

test("CA-14 B2: una segunda --sku sobre el disco de B1 resuelve el pendiente, salida 0", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: {
        pendientes: {
          [SKU_5V]: {
            nuevoValor: 8,
            contabiliumObjetivo: 13,
            variantes: VARIANTES_5V.map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
          },
        },
      },
    });
    const availables = [8, 8, 5, 8, 8];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const resolverSkuUniversal = resolverUniversalInyectado(nodos);
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsSku({ dir, stock, resolverSkuUniversal, setearStock });

    const { valor: salida, lineas } = await correrSku(SKU_5V, deps);

    assert.equal(salida, 0);
    assert.deepEqual(
      escrituras.map((e) => [e.inventoryItemId, e.quantity]),
      [[V3.inventoryItemId, 8]]
    );
    assert.ok(!escrituras.some((e) => e.quantity === 11));

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_5V], 13);
    assert.equal(libreta.skus[SKU_5V], 13);
    assert.equal(libreta.escritos?.[SKU_5V], 8);

    assert.ok(
      lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 8 (escritas=1, ya_estaban=4) [reintento]`)
    );
  });
});

test("CA-14 B2': Contabilium 15 en vez de 13, mismo resultado (R-12), salida 0", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: {
        pendientes: {
          [SKU_5V]: {
            nuevoValor: 8,
            contabiliumObjetivo: 13,
            variantes: VARIANTES_5V.map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
          },
        },
      },
    });
    const availables = [8, 8, 5, 8, 8];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const resolverSkuUniversal = resolverUniversalInyectado(nodos);
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[SKU_5V, 15]]);
    const deps = depsSku({ dir, stock, resolverSkuUniversal, setearStock });

    const { valor: salida } = await correrSku(SKU_5V, deps);

    assert.equal(salida, 0);
    assert.deepEqual(escrituras.map((e) => e.quantity), [8]);

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 13, "cierra con el contabiliumObjetivo persistido, no con 15");
    assert.equal(libreta.skus[SKU_5V], 13);
  });
});

test("CA-14 B3: una corrida completa (ejecutarPar) sobre el disco de B1 retoma el mismo pendiente", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: {
        pendientes: {
          [SKU_5V]: {
            nuevoValor: 8,
            contabiliumObjetivo: 13,
            variantes: VARIANTES_5V.map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
          },
        },
      },
    });
    const availables = [8, 8, 5, 8, 8];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const escrituras = [];
    const sync = await import("../src/sync.js");
    const deps = {
      ...sync.DEPS_REALES,
      ahora: () => new Date(T),
      esDryRun: () => false,
      getStockDeposito: async () => new Map([[SKU_5V, 13]]),
      rutaSnapshotPara: (stateKey) => sync.rutaSnapshotPara(stateKey, dir),
      cargarRegistroComprobantes: () => ({ v: 1, ultimoRefrescoOk: T, diasCerrados: [], comprobantes: {} }),
      guardarRegistroComprobantes: () => {},
      leerCacheSku: () => ({}),
      buscarComprobantes: async () => [],
      fetchComprobantesDetalle: async () => [],
      crearSesion: () => undefined,
      resolverSkuUniversal: async (sku) => {
        const exactos = nodos.filter((n) => n.sku === sku);
        return exactos.map((n) => ({
          variantId: n.id,
          inventoryItemId: n.inventoryItem.id,
          available: n.inventoryItem.inventoryLevel?.quantities?.find((q) => q.name === "available")?.quantity ?? null,
        }));
      },
      setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
        escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      },
    };

    const { valor: res, lineas } = await capturarConsola(() => ejecutarPar(PAR_DOT, deps));

    assert.equal(res.actualizado, 1);
    assert.equal(res.universales, 1);
    assert.deepEqual(escrituras.map((e) => e.quantity), [8]);
    assert.ok(lineas.some((l) => l.texto.includes("[reintento]")));
    assert.ok(lineas.some((l) => l.texto.startsWith("[RESUMEN] dot")));
  });
});

// ----------------------------------------------------------------- C ---------
test("CA-14 C: con escrito guardado, camino (c) por --sku, salida 0", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, escritos: { [SKU_5V]: 5 } },
    });
    const availables = [4, 5, 5, 5, 5];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const resolverSkuUniversal = resolverUniversalInyectado(nodos);
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[SKU_5V, 9]]);
    const deps = depsSku({ dir, stock, resolverSkuUniversal, setearStock });

    const { valor: salida, lineas } = await correrSku(SKU_5V, deps);

    assert.equal(salida, 0);
    assert.deepEqual(
      escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V1.inventoryItemId, 3, 4],
        [V2.inventoryItemId, 3, 5],
        [V3.inventoryItemId, 3, 5],
        [V4.inventoryItemId, 3, 5],
        [V5.inventoryItemId, 3, 5],
      ]
    );
    assert.ok(!escrituras.some((e) => e.changeFromQuantity === 4 && e.inventoryItemId !== V1.inventoryItemId));

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 9);
    assert.equal(libreta.skus[SKU_5V], 9);
    assert.equal(libreta.escritos?.[SKU_5V], 3);
    assert.deepEqual(libreta.pendientes ?? {}, {});

    assert.ok(lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 3 (escritas=5, ya_estaban=0)`));
  });
});

// ----------------------------------------------------------------- D ---------
// Cada subcaso tiene que probar algo DISTINGUIBLE, no solo coincidir por
// casualidad (revision importante 4). La prueba: si el SKU curado pasara por
// el camino VIEJO de `resolverSku` (verificar-cache-sku) con esta misma
// respuesta de Shopify (5 variantes exactas) y esta misma caché, el resultado
// SERIA distinto segun el subcaso (D1/D2 -> SkuAmbiguoError porque hay 5
// coincidencias exactas sin caché valida; D3 -> resuelve a la variante
// cacheada V4, no a V1). `resolverSkuUniversal` ignora la caché (R-2) y da
// SIEMPRE el mismo resultado (las 5 variantes, destino V1): este test
// demuestra ambas cosas, no solo la segunda.
for (const [nombre, cacheInicial, viejoCaminoEsperado] of [
  ["D1 sin entrada", {}, "ambiguo"],
  ["D2 entrada vencida", { [SKU_5V]: "gid://shopify/InventoryItem/9010099" }, "ambiguo"],
  ["D3 entrada presente en una sola", { [SKU_5V]: V4.inventoryItemId }, "establecida-v4"],
]) {
  test(`CA-14 ${nombre}: nunca SkuAmbiguoError para un SKU curado, salida 0 (y el camino viejo con la misma cache SI daria otro resultado)`, async () => {
    await conDirTemporal(async (dir) => {
      sembrarA(dir);
      const nodos = VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5));

      // Prueba de que la caché, SI se usara (camino viejo), cambiaria el
      // resultado segun el subcaso: la misma respuesta/cache, pasada por
      // `resolverSku` (no `resolverSkuUniversal`).
      const consultarViejo = async () => ({
        productVariants: { edges: nodos.map((n) => ({ node: n })), pageInfo: { hasNextPage: false } },
      });
      const rutaCacheProbe = join(dir, "probe-sku-map.json");
      if (Object.keys(cacheInicial).length > 0) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(rutaCacheProbe, JSON.stringify(cacheInicial, null, 2), "utf-8");
      } else {
        writeFileSync(rutaCacheProbe, "{}", "utf-8");
      }
      if (viejoCaminoEsperado === "ambiguo") {
        await assert.rejects(
          () => resolverSku(SKU_5V, LOCATION_DOT, { consultar: consultarViejo, rutaCache: rutaCacheProbe }),
          /SkuAmbiguoError|ambiguo/i,
          "si se usara la cache (camino viejo), 5 coincidencias exactas sin entrada valida -> SkuAmbiguoError"
        );
      } else {
        const viejo = await resolverSku(SKU_5V, LOCATION_DOT, { consultar: consultarViejo, rutaCache: rutaCacheProbe });
        assert.equal(
          viejo.inventoryItemId,
          V4.inventoryItemId,
          "si se usara la cache (camino viejo), escribiria en la variante establecida V4, no en V1"
        );
      }

      const resolverSkuUniversal = resolverUniversalInyectado(nodos);
      const escrituras = [];
      const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
        escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      };
      const stock = new Map([[SKU_5V, 13]]);
      // La caché del camino universal nunca se toca (R-2): no se wirea aca
      // (el deps real no tiene rutaCache para resolverSkuUniversal).
      const deps = depsSku({ dir, stock, resolverSkuUniversal, setearStock });

      const { valor: salida, lineas } = await correrSku(SKU_5V, deps);

      assert.equal(salida, 0);
      assert.ok(!lineas.some((l) => l.texto.includes("SKU ambiguo")));
      assert.ok(!lineas.some((l) => l.texto.includes("[AVISO]")), "resolverSkuUniversal nunca emite el AVISO de duplicados");
      assert.deepEqual(
        escrituras.map((e) => e.inventoryItemId),
        VARIANTES_5V.map((v) => v.inventoryItemId)
      );
      assert.ok(!escrituras.some((e) => e.inventoryItemId === "gid://shopify/InventoryItem/9010099"));
      assert.ok(
        !escrituras.some((e) => e.inventoryItemId === V4.inventoryItemId && escrituras.length === 1),
        "a diferencia del camino viejo en D3, no escribe SOLO en V4"
      );

      const libreta = leerLibretaCruda(dir, "dot");
      assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId, "siempre V1 (el mas chico), nunca el de la cache");
    });
  });
}

// ----------------------------------------------------------------- E ---------
test("CA-14 E1: SKU no curado con variante establecida, comportamiento de hoy, salida 0", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_NO_CURADO]: 2 },
      contabilium: { [SKU_NO_CURADO]: 2 },
      extra: { destinos: { [SKU_NO_CURADO]: V_16E.inventoryItemId } },
    });
    const nodos = [
      nodoUniversal({ ...V_16E, sku: SKU_NO_CURADO, available: 4, titulo: "Combo Carbon Verde" }),
      nodoUniversal({ ...V_17E, sku: SKU_NO_CURADO, available: 0, titulo: "Combo Carbon Verde" }),
    ];
    const resolverSkuMock = resolverSkuConCache({ dir, nodos, cacheInicial: { [SKU_NO_CURADO]: V_16E.inventoryItemId } });
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[SKU_NO_CURADO, 5]]);
    const deps = depsSku({ dir, stock, resolverSkuMock, setearStock });

    const { valor: salida, lineas } = await correrSku(SKU_NO_CURADO, deps);

    assert.equal(salida, 0);
    assert.deepEqual(
      escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity, e.locationId]),
      [[V_16E.inventoryItemId, 7, 4, LOCATION_DOT]]
    );
    assert.ok(!escrituras.some((e) => e.inventoryItemId === V_17E.inventoryItemId));

    assert.ok(
      lineas.some(
        (l) =>
          l.texto ===
          `  [AVISO] ${SKU_NO_CURADO}: 2 variantes de Shopify tienen el sku exacto -> se escribe en la variante establecida ${V_16E.variantId}`
      )
    );
    assert.ok(lineas.some((l) => l.texto === `  [SET] ${SKU_NO_CURADO}: 4 -> 7 (actualizado en Shopify)`));
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_NO_CURADO], 5);
    assert.equal(libreta.skus[SKU_NO_CURADO], 5);
    assert.equal(libreta.destinos?.[SKU_NO_CURADO], V_16E.inventoryItemId);
    assert.equal(libreta.escritos?.[SKU_NO_CURADO], undefined);
  });
});

test("CA-14 E2: SKU no curado sin variante establecida, SKU ambiguo de siempre, salida 0", async () => {
  await conDirTemporal(async (dir) => {
    const nodos = [
      nodoUniversal({ ...V_16E, sku: SKU_NO_CURADO, available: 4, titulo: "Combo Carbon Verde" }),
      nodoUniversal({ ...V_17E, sku: SKU_NO_CURADO, available: 0, titulo: "Combo Carbon Verde" }),
    ];
    const resolverSkuMock = resolverSkuConCache({ dir, nodos, cacheInicial: null });
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[SKU_NO_CURADO, 5]]);
    const deps = depsSku({ dir, stock, resolverSkuMock, setearStock });

    const { valor: salida, lineas } = await correrSku(SKU_NO_CURADO, deps);

    assert.equal(salida, 0);
    assert.deepEqual(escrituras, []);
    assert.ok(
      lineas.some(
        (l) =>
          l.texto ===
          `  [SKIP] ${SKU_NO_CURADO}: SKU ambiguo: 2 variantes de Shopify tienen el sku exacto "${SKU_NO_CURADO}" -> no se escribe`
      )
    );
    assert.ok(lineas.some((l) => l.texto === `      - ${V_16E.variantId} — Combo Carbon Verde`));
    assert.ok(lineas.some((l) => l.texto === `      - ${V_17E.variantId} — Combo Carbon Verde`));

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta, null, "ningun guardar de la libreta (solo se guarda si actualizado/sin_cambios)");
  });
});

test("CA-14 E3: fallo de escritura fuera de la lista, codigo de salida de siempre (0), sin [FATAL]", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_NO_CURADO]: 2 },
      contabilium: { [SKU_NO_CURADO]: 2 },
      extra: { destinos: { [SKU_NO_CURADO]: V_16E.inventoryItemId } },
    });
    const nodos = [
      nodoUniversal({ ...V_16E, sku: SKU_NO_CURADO, available: 4, titulo: "Combo Carbon Verde" }),
      nodoUniversal({ ...V_17E, sku: SKU_NO_CURADO, available: 0, titulo: "Combo Carbon Verde" }),
    ];
    const resolverSkuMock = resolverSkuConCache({ dir, nodos, cacheInicial: { [SKU_NO_CURADO]: V_16E.inventoryItemId } });
    const setearStock = async () => {
      throw new Error("rechazado");
    };
    const stock = new Map([[SKU_NO_CURADO, 5]]);
    const deps = depsSku({ dir, stock, resolverSkuMock, setearStock });

    const { valor: salida, lineas } = await correrSku(SKU_NO_CURADO, deps);

    assert.equal(salida, 0);
    assert.ok(!lineas.some((l) => l.texto.startsWith("[FATAL]")));
    assert.ok(lineas.some((l) => l.texto.startsWith(`  [ERROR] ${SKU_NO_CURADO}: fallo al escribir en Shopify -> `)));
  });
});

// ----------------------------------------------------------------- F ---------
test("CA-14 F1: extension de un curado, nunca el camino universal (SKU ambiguo)", async () => {
  await conDirTemporal(async (dir) => {
    const skuF1 = `${SKU_5V}-P1`;
    const p1 = { variantId: "gid://shopify/ProductVariant/8019901", inventoryItemId: "gid://shopify/InventoryItem/9019901" };
    const p1b = { variantId: "gid://shopify/ProductVariant/8019902", inventoryItemId: "gid://shopify/InventoryItem/9019902" };
    const nodos = [
      nodoUniversal({ ...p1, sku: skuF1, available: 3, titulo: "ApplyFit P1" }),
      nodoUniversal({ ...p1b, sku: skuF1, available: 3, titulo: "ApplyFit P1" }),
    ];
    const resolverSkuMock = resolverSkuConCache({ dir, nodos, cacheInicial: null });
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[skuF1, 4]]);
    const deps = depsSku({ dir, stock, resolverSkuMock, setearStock });

    const { valor: salida, lineas } = await correrSku(skuF1, deps);

    assert.equal(salida, 0);
    assert.deepEqual(escrituras, []);
    assert.ok(!escrituras.some((e) => e.quantity === 4));
    assert.ok(
      lineas.some(
        (l) =>
          l.texto === `  [SKIP] ${skuF1}: SKU ambiguo: 2 variantes de Shopify tienen el sku exacto "${skuF1}" -> no se escribe`
      )
    );
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta, null);
  });
});

test("CA-14 F2: recorte de un curado (sin -17E), variante unica de hoy, nunca universal", async () => {
  await conDirTemporal(async (dir) => {
    const skuF2 = "APPLYFIT-CLEAR-IP13-13PRO-14-16E";
    const r1 = { variantId: "gid://shopify/ProductVariant/8019911", inventoryItemId: "gid://shopify/InventoryItem/9019911" };
    sembrarLibreta(dir, "dot", {
      skus: { [skuF2]: 2 },
      contabilium: { [skuF2]: 2 },
      extra: { destinos: { [skuF2]: r1.inventoryItemId } },
    });
    const nodos = [
      nodoUniversal({ ...r1, sku: skuF2, available: 2, titulo: "R1" }),
      ...VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5)),
    ];
    const resolverSkuMock = resolverSkuConCache({ dir, nodos, cacheInicial: { [skuF2]: r1.inventoryItemId } });
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[skuF2, 3]]);
    const deps = depsSku({ dir, stock, resolverSkuMock, setearStock });

    const { valor: salida, lineas } = await correrSku(skuF2, deps);

    assert.equal(salida, 0);
    assert.deepEqual(
      escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity, e.locationId]),
      [[r1.inventoryItemId, 3, 2, LOCATION_DOT]]
    );
    assert.ok(!escrituras.some((e) => VARIANTES_5V.some((v) => v.inventoryItemId === e.inventoryItemId)));

    assert.ok(lineas.some((l) => l.texto === `  [SET] ${skuF2}: 2 -> 3 (actualizado en Shopify)`));
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));
    assert.ok(!lineas.some((l) => l.texto.includes("[AVISO]")));

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[skuF2], 3);
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.escritos?.[SKU_5V], undefined);
  });
});

// ----------------------------------------------------------------- G ---------
test("CA-14 G: entrada marcada requiere compuerta, --sku no la resuelve, salida 1", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: {
        destinos: { [SKU_5V]: V1.inventoryItemId },
        escritos: { [SKU_5V]: 5 },
        pendientes: {
          [SKU_5V]: {
            nuevoValor: 8,
            contabiliumObjetivo: 13,
            variantes: VARIANTES_5V.map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
            requiereCompuerta: true,
          },
        },
      },
    });
    const availables = [8, 8, 5, 8, 8];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const resolverSkuUniversal = resolverUniversalInyectado(nodos);
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsSku({ dir, stock, resolverSkuUniversal, setearStock });

    const { valor: salida, lineas } = await correrSku(SKU_5V, deps);

    assert.deepEqual(escrituras, []);
    assert.ok(!escrituras.some((e) => e.inventoryItemId === V3.inventoryItemId));
    assert.equal(
      lineas.filter((l) => l.texto === `  [ERROR] dot/${SKU_5V}: pendiente universal requiere compuerta manual -> no se escribe`).length,
      1
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.equal(libreta.skus[SKU_5V], 10);
    assert.equal(libreta.escritos?.[SKU_5V], 5);
    assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId);

    assert.equal(salida, 1);
    assert.ok(lineas.some((l) => l.texto.startsWith("[FATAL] ")));
  });
});

// ----------------------------------------------------------------- H ---------
test("CA-14 H: variante no activada, caso (b), salida 1", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, escritos: { [SKU_5V]: 5 } },
    });
    const nodos = [
      nodoExacto(V1, SKU_5V, 5),
      nodoExacto(V2, SKU_5V, 5),
      nodoExacto(V3, SKU_5V, 5),
      nodoExacto(V4, SKU_5V, 5),
      nodoExacto(V5, SKU_5V, null),
    ];
    const resolverSkuUniversal = resolverUniversalInyectado(nodos);
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[SKU_5V, 9]]);
    const deps = depsSku({ dir, stock, resolverSkuUniversal, setearStock });

    const { valor: salida, lineas } = await correrSku(SKU_5V, deps);

    assert.deepEqual(escrituras, []);
    assert.equal(
      lineas.filter(
        (l) =>
          l.texto ===
          `  [ERROR] dot/${SKU_5V}: variante ${V5.variantId} no esta activada en la location del par, no se resuelve`
      ).length,
      1
    );
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));
    for (const v of [V1, V2, V3, V4]) {
      assert.ok(!lineas.some((l) => l.texto.includes(`variante ${v.variantId} no esta activada`)));
    }

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.equal(libreta.skus[SKU_5V], 10);
    assert.equal(libreta.escritos?.[SKU_5V], 5);
    assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId);

    assert.equal(salida, 1);
    assert.ok(lineas.some((l) => l.texto.startsWith("[FATAL] ")));
  });
});

// ----------------------------------------------------------------- I ---------
test("CA-14 I: las 5 variantes no activadas, caso (a) benigno, salida 0", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, escritos: { [SKU_5V]: 5 } },
    });
    const nodos = VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, null));
    const resolverSkuUniversal = resolverUniversalInyectado(nodos);
    const escrituras = [];
    const setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    };
    const stock = new Map([[SKU_5V, 9]]);
    const deps = depsSku({ dir, stock, resolverSkuUniversal, setearStock });

    const { valor: salida, lineas } = await correrSku(SKU_5V, deps);

    assert.deepEqual(escrituras, []);
    assert.ok(!lineas.some((l) => l.texto.includes("no esta activada en la location del par, no se resuelve")));
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.equal(libreta.skus[SKU_5V], 10);
    assert.equal(libreta.escritos?.[SKU_5V], 5);
    assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId);

    assert.equal(salida, 0);
    assert.ok(!lineas.some((l) => l.texto.startsWith("[FATAL]")));
  });
});
