// CA-5 — Linea `[UNIVERSAL]` (R-8, las 3 formas + sufijo ` [reintento]`) y las
// claves nuevas `universales`/`universales_pendientes` del `[RESUMEN]`. T09.
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca5-resumen.md
// (A a H).
//
// Corre con: node --test test/resumen-universales.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { ConteoVariantesUniversalError, variantesUniversales } from "../src/shopify.js";
import { conDirTemporal, sembrarLibreta, leerLibretaCruda, PAR_DOT, capturarConsola, lineaResumen, valorEnResumen, LOCATION_DOT } from "./_helpers-clasificador.js";
import { SKU_5V, SKU_2V, VARIANTES_5V, VARIANTES_2V, nodoExacto } from "./_helpers-sku-universal.js";
import { item, variante, tiendaFalsa, sembrarCacheSku, resolverInyectado, escriturasEn } from "./_helpers-cache-sku.js";

const T = "2026-11-03T12:00:00.000Z";

// SKU real de CA-4 A (duplicado NO curado, "con variante establecida").
const SKU_A4 = "IEY-COMBO-CARBON-VERDE-IP16E";

function tiendaUniversal(nodos, { hasNextPage = false } = {}) {
  const t = {
    nodos,
    escrituras: [],
    async consultar(_query, variables) {
      return { productVariants: { edges: t.nodos.map((n) => ({ node: n })), pageInfo: { hasNextPage } } };
    },
    async setearStock(inventoryItemId, quantity, changeFromQuantity, locationId) {
      t.escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    },
  };
  t.consultar = t.consultar.bind(t);
  t.setearStock = t.setearStock.bind(t);
  return t;
}

async function resolverUniversalCon(tienda, sku, locationId) {
  const data = await tienda.consultar(null, { query: `sku:"${sku}"`, locationId, first: 10 });
  const nodos = data.productVariants.edges.map((e) => e.node);
  const topeAlcanzado = data.productVariants.pageInfo.hasNextPage;
  const esperadas = variantesUniversales(sku);
  const exactos = nodos.filter((n) => n.sku === sku && n.inventoryItem?.id);
  if (exactos.length !== esperadas) throw new ConteoVariantesUniversalError(sku, esperadas, exactos.length, topeAlcanzado);
  return exactos.map((n) => ({
    variantId: n.id,
    inventoryItemId: n.inventoryItem.id,
    available: n.inventoryItem.inventoryLevel?.quantities?.find((q) => q.name === "available")?.quantity ?? null,
  }));
}

// deps sin ningun SKU duplicado (A, C, D, E, F, G): un unico SKU universal.
function depsSoloUniversal({ dir, tienda, stock, dryRun = false, t = T, fallaBusqueda = false }) {
  return {
    ...sync.DEPS_REALES,
    ahora: () => new Date(t),
    esDryRun: () => dryRun,
    getStockDeposito: async () => stock,
    rutaSnapshotPara: (stateKey) => sync.rutaSnapshotPara(stateKey, dir),
    cargarRegistroComprobantes: () => ({ v: 1, ultimoRefrescoOk: t, diasCerrados: [], comprobantes: {} }),
    guardarRegistroComprobantes: () => {},
    leerCacheSku: () => ({}),
    buscarComprobantes: fallaBusqueda ? async () => { throw new Error("Shopify HTTP 503: caido (simulado)"); } : async () => [],
    fetchComprobantesDetalle: async () => [],
    crearSesion: () => undefined,
    resolverSkuUniversal: async (sku, locationId) => resolverUniversalCon(tienda, sku, locationId),
    setearStock: tienda.setearStock,
  };
}

// deps con un SKU universal (APPLYFIT-CLEAR-S24-S25 o SKU_5V) Y un SKU
// duplicado NO curado (SKU_A4) en la misma corrida (escenario A).
function depsMixto({ dir, universal, duplicado, stock, t = T }) {
  const rutaCache = sembrarCacheSku && undefined; // no-op, solo para legibilidad
  const resolverDuplicado = resolverInyectado(duplicado.tienda, dir);
  const idsUniversales = new Set(universal.tienda.nodos.map((n) => n.inventoryItem?.id).filter(Boolean));
  return {
    ...sync.DEPS_REALES,
    ahora: () => new Date(t),
    esDryRun: () => false,
    getStockDeposito: async () => stock,
    rutaSnapshotPara: (stateKey) => sync.rutaSnapshotPara(stateKey, dir),
    cargarRegistroComprobantes: () => ({ v: 1, ultimoRefrescoOk: t, diasCerrados: [], comprobantes: {} }),
    guardarRegistroComprobantes: () => {},
    leerCacheSku: () => ({}),
    buscarComprobantes: async () => [],
    fetchComprobantesDetalle: async () => [],
    crearSesion: () => undefined,
    resolverSkuUniversal: async (sku, locationId) => resolverUniversalCon(universal.tienda, sku, locationId),
    resolverSku: async (sku, locationId, ...resto) => resolverDuplicado(sku, locationId, resto[0]),
    setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      if (idsUniversales.has(inventoryItemId)) return universal.tienda.setearStock(inventoryItemId, quantity, changeFromQuantity, locationId);
      return duplicado.tienda.setearStock(inventoryItemId, quantity, changeFromQuantity, locationId);
    },
  };
}

const [V1, V2, V3, V4, V5] = VARIANTES_5V;
const [W1, W2] = VARIANTES_2V;

// A — universal confirmado (forma 1) + duplicado no universal, en la misma corrida.
test("CA-5 A: [UNIVERSAL] confirmado y [AVISO] de duplicado en la misma corrida, sin mezclar contadores", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10, [SKU_A4]: 2 },
      contabilium: { [SKU_2V]: 10, [SKU_A4]: 2 },
      extra: { destinos: { [SKU_2V]: W1.inventoryItemId, [SKU_A4]: item(9040001) } },
    });
    sembrarCacheSku(dir, { [SKU_A4]: item(9040001) });

    const universal = { tienda: tiendaUniversal(VARIANTES_2V.map((v) => nodoExacto(v, SKU_2V, 5))) };
    const duplicado = {
      tienda: tiendaFalsa([
        { n: 9040001, sku: SKU_A4, titulo: "16e", niveles: { [LOCATION_DOT]: 4 } },
        { n: 9040002, sku: SKU_A4, titulo: "17e", niveles: { [LOCATION_DOT]: 0 } },
      ]),
    };
    const stock = new Map([
      [SKU_2V, 12.6],
      [SKU_A4, 5],
    ]);
    const deps = depsMixto({ dir, universal, duplicado, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.ok(
      lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_2V}: 2 variantes -> 8 (escritas=2, ya_estaban=0)`),
      `falta la linea [UNIVERSAL]: ${JSON.stringify(lineas.map((l) => l.texto))}`
    );
    assert.ok(
      lineas.some(
        (l) =>
          l.texto ===
          `  [AVISO] dot/${SKU_A4}: 2 variantes de Shopify tienen el sku exacto -> se escribe en la variante establecida ${variante(9040001)}`
      )
    );
    assert.ok(!lineas.some((l) => l.texto.includes("[AVISO]") && l.texto.includes(SKU_2V)));
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]") && l.texto.includes(SKU_A4)));

    const [resumen] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(resumen.texto, "universales"), "1");
    assert.equal(valorEnResumen(resumen.texto, "universales_pendientes"), "0");
    assert.equal(valorEnResumen(resumen.texto, "duplicados"), "1");
    assert.equal(valorEnResumen(resumen.texto, "actualizado"), "2");
    assert.equal(valorEnResumen(resumen.texto, "total"), "2");
    assert.ok(!resumen.texto.includes("APPLYFIT") && !resumen.texto.includes("IEY-COMBO"));
  });
});

// B — corrida sin ningun caso: las dos claves en 0.
test("CA-5 B: sin universales ni duplicados, las dos claves nuevas en 0", async () => {
  await conDirTemporal(async (dir) => {
    const SKU = "FUNDA-TEST-UNICA";
    sembrarLibreta(dir, "dot", { skus: { [SKU]: 2 }, contabilium: { [SKU]: 2 }, extra: { destinos: { [SKU]: item(9060001) } } });
    sembrarCacheSku(dir, { [SKU]: item(9060001) });
    const duplicado = { tienda: tiendaFalsa([{ n: 9060001, sku: SKU, niveles: { [LOCATION_DOT]: 2 } }]) };
    const stock = new Map([[SKU, 3]]);
    const resolverDuplicado = resolverInyectado(duplicado.tienda, dir);
    const deps = {
      ...sync.DEPS_REALES,
      ahora: () => new Date(T),
      esDryRun: () => false,
      getStockDeposito: async () => stock,
      rutaSnapshotPara: (stateKey) => sync.rutaSnapshotPara(stateKey, dir),
      cargarRegistroComprobantes: () => ({ v: 1, ultimoRefrescoOk: T, diasCerrados: [], comprobantes: {} }),
      guardarRegistroComprobantes: () => {},
      leerCacheSku: () => ({}),
      buscarComprobantes: async () => [],
      fetchComprobantesDetalle: async () => [],
      crearSesion: () => undefined,
      resolverSku: async (sku, locationId, ...resto) => resolverDuplicado(sku, locationId, resto[0]),
      setearStock: duplicado.tienda.setearStock,
    };

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    const [resumen] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(resumen.texto, "universales"), "0");
    assert.equal(valorEnResumen(resumen.texto, "universales_pendientes"), "0");
    assert.equal(valorEnResumen(resumen.texto, "duplicados"), "0");
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));
  });
});

// S2: pendiente con desde=5 en las 5 variantes, baseline 10 (igual que
// sku-universal-pendiente.test.js, sembrarS2).
function sembrarS2(dir) {
  sembrarLibreta(dir, "dot", {
    skus: { [SKU_5V]: 10 },
    contabilium: { [SKU_5V]: 10 },
    extra: {
      destinos: { [SKU_5V]: V1.inventoryItemId },
      pendientes: {
        [SKU_5V]: {
          nuevoValor: 8,
          contabiliumObjetivo: 13,
          variantes: VARIANTES_5V.map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
        },
      },
    },
  });
}

// C — pendiente tras una mutacion fallida (forma 2).
test("CA-5 C: una mutacion fallida deja PENDIENTE (forma 2) y universales_pendientes=1", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { [SKU_5V]: 10 }, contabilium: { [SKU_5V]: 10 }, extra: { destinos: { [SKU_5V]: V1.inventoryItemId } } });
    const nodos = VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5));
    const tienda = tiendaUniversal(nodos);
    const real = tienda.setearStock;
    tienda.setearStock = async (inventoryItemId, ...resto) => {
      if (inventoryItemId === V3.inventoryItemId) throw new Error("rechazado por Shopify (simulado)");
      return real(inventoryItemId, ...resto);
    };
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsSoloUniversal({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.ok(
      lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 8 PENDIENTE (escritas=4, ya_estaban=0, fallidas=1)`),
      `falta la linea PENDIENTE exacta: ${JSON.stringify(lineas.map((l) => l.texto))}`
    );
    const [resumen] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(resumen.texto, "universales"), "0");
    assert.equal(valorEnResumen(resumen.texto, "universales_pendientes"), "1");
    assert.equal(valorEnResumen(resumen.texto, "error"), "1");
  });
});

// D — retoma del pendiente (forma 1 con ' [reintento]').
test("CA-5 D: al retomar un pendiente, [UNIVERSAL] confirmado lleva el sufijo ' [reintento]'", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS2(dir);
    const availables = [8, 8, 5, 8, 8];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsSoloUniversal({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.ok(
      lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 8 (escritas=1, ya_estaban=4) [reintento]`),
      `falta la linea exacta de reintento: ${JSON.stringify(lineas.map((l) => l.texto))}`
    );
    const [resumen] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(resumen.texto, "universales"), "1");
    assert.equal(valorEnResumen(resumen.texto, "universales_pendientes"), "0");
    assert.equal(valorEnResumen(resumen.texto, "actualizado"), "1");
  });
});

// E1 — DRY_RUN, forma 3 sin reintento.
test("CA-5 E1: DRY_RUN, forma 3 sin reintento; universales=0 por ser DRY_RUN", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { [SKU_5V]: 10 }, contabilium: { [SKU_5V]: 10 }, extra: { destinos: { [SKU_5V]: V1.inventoryItemId } } });
    const nodos = VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsSoloUniversal({ dir, tienda, stock, dryRun: true });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.ok(lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 8 (no se escribe, DRY_RUN=true)`));
    assert.deepEqual(tienda.escrituras, []);
    const [resumen] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(resumen.texto, "dry"), "1");
    assert.equal(valorEnResumen(resumen.texto, "universales"), "0");
    assert.equal(valorEnResumen(resumen.texto, "universales_pendientes"), "0");
  });
});

// E2 — DRY_RUN, forma 3 con reintento.
test("CA-5 E2: DRY_RUN al retomar un pendiente, forma 3 con ' [reintento]'; universales_pendientes=1", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS2(dir);
    const availables = [8, 8, 5, 8, 8];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsSoloUniversal({ dir, tienda, stock, dryRun: true });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.ok(
      lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 8 (no se escribe, DRY_RUN=true) [reintento]`)
    );
    assert.deepEqual(tienda.escrituras, []);
    assert.ok(leerLibretaCruda(dir, "dot").pendientes?.[SKU_5V], "la libreta en disco no cambia, sigue con el pendiente");
    const [resumen] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(resumen.texto, "universales"), "0");
    assert.equal(valorEnResumen(resumen.texto, "universales_pendientes"), "1");
  });
});

// F — excepcion del ADR 0001: [UNIVERSAL] nombra el SKU aunque cuente en causa_desconocida.
test("CA-5 F: con el clasificador en fallo, [UNIVERSAL] nombra igual el SKU y ninguna linea 'desconocid' lo nombra", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      corte: "2026-10-01T00:00:00.000Z",
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, escritos: { [SKU_5V]: 5 } },
    });
    const availables = [5, 5, 5, 4, 5];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 9]]);
    const deps = depsSoloUniversal({ dir, tienda, stock, fallaBusqueda: true });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.ok(lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 3 (escritas=5, ya_estaban=0)`));
    for (const l of lineas) {
      if (/desconocid/i.test(l.texto)) assert.ok(!l.texto.includes(SKU_5V));
    }
  });
});

// G — universales cuenta SKUs, no variantes.
test("CA-5 G: universales cuenta SKUs (1), no variantes (5)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { [SKU_5V]: 10 }, contabilium: { [SKU_5V]: 10 }, extra: { destinos: { [SKU_5V]: V1.inventoryItemId } } });
    const nodos = VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsSoloUniversal({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    const [resumen] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(resumen.texto, "universales"), "1");
    assert.equal(valorEnResumen(resumen.texto, "actualizado"), "1");
  });
});

// H — el prefijo <par>/<sku> es obligatorio en [UNIVERSAL] y en los [ERROR] nuevos.
test("CA-5 H: toda linea [UNIVERSAL] o [ERROR] nueva lleva el prefijo dot/<sku>", async () => {
  const lineasTodas = [];

  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { [SKU_5V]: 10 }, contabilium: { [SKU_5V]: 10 }, extra: { destinos: { [SKU_5V]: V1.inventoryItemId } } });
    const nodos = VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsSoloUniversal({ dir, tienda, stock });
    const { lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));
    lineasTodas.push(...lineas);
  });

  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { [SKU_5V]: 10 }, contabilium: { [SKU_5V]: 10 }, extra: { destinos: { [SKU_5V]: V1.inventoryItemId } } });
    const nodos = VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5));
    const tienda = tiendaUniversal(nodos);
    const real = tienda.setearStock;
    tienda.setearStock = async (inventoryItemId, ...resto) => {
      if (inventoryItemId === V3.inventoryItemId) throw new Error("rechazado por Shopify (simulado)");
      return real(inventoryItemId, ...resto);
    };
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsSoloUniversal({ dir, tienda, stock });
    const { lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));
    lineasTodas.push(...lineas);
  });

  for (const l of lineasTodas) {
    if (l.texto.startsWith("  [UNIVERSAL] ")) assert.ok(l.texto.startsWith(`  [UNIVERSAL] dot/`), `linea sin prefijo: "${l.texto}"`);
    if (l.texto.startsWith("  [ERROR] ") && l.texto.includes(SKU_5V)) {
      assert.ok(l.texto.startsWith(`  [ERROR] dot/${SKU_5V}: `), `linea sin prefijo: "${l.texto}"`);
    }
  }
  assert.ok(!lineasTodas.some((l) => l.texto.startsWith("  [UNIVERSAL] APPLYFIT-")));
  assert.ok(!lineasTodas.some((l) => l.texto.startsWith("  [ERROR] APPLYFIT-")));
});
