// CA-11 — Compuerta absoluta manual (ESCRITURA_ABSOLUTA) multi-variante (R-16,
// con R-18 bajo la compuerta y R-3/R-13/R-17 en la forma que toman ahi).
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca11-compuerta-absoluta.md
// SKU: APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E (SKU_5V), V1...V5 de
// _helpers-sku-universal.js. Par dot.
//
// Corre con: node --test test/sku-universal-compuerta-absoluta.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { evaluarCorridaMultiPar } from "../src/resultado.js";
import { claveConsumo } from "../src/clasificador-causa.js";
import { conDirTemporal, sembrarLibreta, leerLibretaCruda, PAR_DOT, DEPOSITO_DOT, capturarConsola } from "./_helpers-clasificador.js";
import { SKU_5V, VARIANTES_5V, nodoExacto } from "./_helpers-sku-universal.js";

const [V1, V2, V3, V4, V5] = VARIANTES_5V;
const T1 = "2026-11-03T12:00:00.000Z"; // ahora() de la corrida de la compuerta
const CORTE_VIEJO = "2020-01-01T00:00:00.000Z";
const REFERENCIA_CREDITO = "2026-11-03T06:00:00.000Z"; // anterior a T1 (condicion de consumo de la compuerta)

const K1_ID = 520001;
const K2_ID = 520002;
const K3_ID = 520003;
const K1 = claveConsumo(K1_ID, SKU_5V);
const K2 = claveConsumo(K2_ID, SKU_5V);
const K3 = claveConsumo(K3_ID, SKU_5V);

const COMPUERTA = new Set([SKU_5V]);

function registroVacio() {
  return { v: 1, ultimoRefrescoOk: null, diasCerrados: [], comprobantes: {} };
}

function registroConCredito({ incluirK3 = false, referenciaK3 = null } = {}) {
  const dia = "2026-11-03";
  const linea = (id, referencia) => ({
    estado: "ok",
    tipoFc: "FCB",
    inventario: DEPOSITO_DOT,
    notaCreditoShopify: false,
    dia,
    lineas: [{ comprobanteId: id, sku: SKU_5V, cantidad: 1, referencia }],
  });
  const comprobantes = {
    [String(K1_ID)]: linea(K1_ID, REFERENCIA_CREDITO),
    [String(K2_ID)]: linea(K2_ID, REFERENCIA_CREDITO),
  };
  if (incluirK3) comprobantes[String(K3_ID)] = linea(K3_ID, referenciaK3);
  return { v: 1, ultimoRefrescoOk: null, diasCerrados: [], comprobantes };
}

// tienda inyectada para las 5 variantes; `fallaInventoryItemId` hace que esa
// variante rechace al mutar.
function tiendaUniversal(availables, { fallaInventoryItemId = null, extra = [] } = {}) {
  const variantes = [V1, V2, V3, V4, V5];
  const nodos = variantes.map((v, i) => nodoExacto(v, SKU_5V, availables[i])).concat(extra);
  const t = {
    escrituras: [],
    async consultar() {
      return { productVariants: { edges: nodos.map((n) => ({ node: n })), pageInfo: { hasNextPage: false } } };
    },
    async setearStock(inventoryItemId, quantity, changeFromQuantity, locationId) {
      if (fallaInventoryItemId && inventoryItemId === fallaInventoryItemId) {
        throw new Error(`rechazo simulado de ${inventoryItemId}`);
      }
      t.escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    },
  };
  return t;
}

function depsCon({ dir, tienda, stock, registro, t = T1, dryRun = false }) {
  return {
    ...sync.DEPS_REALES,
    ahora: () => new Date(t),
    esDryRun: () => dryRun,
    getStockDeposito: async () => stock,
    rutaSnapshotPara: (stateKey) => sync.rutaSnapshotPara(stateKey, dir),
    rutaRegistroComprobantes: () => "ignorada-en-el-test",
    cargarRegistroComprobantes: () => registro,
    guardarRegistroComprobantes: () => {},
    leerCacheSku: () => ({}),
    buscarComprobantes: async () => [],
    fetchComprobantesDetalle: async () => [],
    crearSesion: () => undefined,
    resolverSkuUniversal: async (sku, locationId) => {
      const data = await tienda.consultar(null, { query: `sku:"${sku}"`, locationId, first: 10 });
      const nodos = data.productVariants.edges.map((e) => e.node);
      const { ConteoVariantesUniversalError, variantesUniversales } = await import("../src/shopify.js");
      const esperadas = variantesUniversales(sku);
      const exactos = nodos.filter((n) => n.sku === sku && n.inventoryItem?.id);
      if (exactos.length !== esperadas) throw new ConteoVariantesUniversalError(sku, esperadas, exactos.length, false);
      return exactos.map((n) => ({
        variantId: n.id,
        inventoryItemId: n.inventoryItem.id,
        available: n.inventoryItem.inventoryLevel?.quantities?.find((q) => q.name === "available")?.quantity ?? null,
      }));
    },
    setearStock: tienda.setearStock,
  };
}

function sembrarEstado1(dir, extra = {}) {
  sembrarLibreta(dir, "dot", {
    skus: { [SKU_5V]: 10 },
    contabilium: { [SKU_5V]: 10 },
    corte: CORTE_VIEJO,
    extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, escritos: { [SKU_5V]: 7 }, ...extra },
  });
}

const L17 = `  [ERROR] dot/${SKU_5V}: pendiente universal requiere compuerta manual -> no se escribe`;

// `main.js` imprime [COMPUERTA][ERROR] a partir del veredicto de
// evaluarCorridaMultiPar; `ejecutarPar`/`correrTodosLosPares` no lo imprimen
// (eso es solo-lectura de main.js para esta tarea). El test reconstruye el
// veredicto con el mismo resumen que devolvio la corrida.
function noAplicado(resumenPorPar, sku = SKU_5V, escrituraAbsoluta = COMPUERTA) {
  const v = evaluarCorridaMultiPar(resumenPorPar, undefined, { escrituraAbsoluta });
  return v.compuertaNoAplicados.includes(sku);
}

// ------------------------------------------------------------------ 1
test("CA-11 §1: compuerta sin pendiente y sin credito -> absoluto en las 5, resiembra anotada, aplicado", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const tienda = tiendaUniversal([7, 0, 0, 0, 0]);
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroVacio() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA })
    );

    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V1.inventoryItemId, 12, 7],
        [V2.inventoryItemId, 12, 0],
        [V3.inventoryItemId, 12, 0],
        [V4.inventoryItemId, 12, 0],
        [V5.inventoryItemId, 12, 0],
      ]
    );
    assert.ok(!tienda.escrituras.some((e) => e.quantity === 9 || e.quantity === 2), "nunca el delta (9) ni el camino (c) (2)");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_5V], 12);
    assert.equal(libreta.skus[SKU_5V], 12);
    assert.equal(libreta.escritos?.[SKU_5V], 12);
    assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId);
    assert.equal(libreta.resembradoPor?.[SKU_5V], "absoluto");
    assert.equal(libreta.resembradoEn?.[SKU_5V], T1);

    assert.ok(
      lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 12 (escritas=5, ya_estaban=0)`)
    );
    assert.ok(!lineas.some((l) => l.texto.includes("[AVISO]") || l.texto.includes("[ERROR]")));

    assert.equal(res.actualizado, 1);
    assert.equal(res.error, 0);
    assert.equal(res.universales, 1);
    assert.equal(res.universales_pendientes, 0);
    assert.equal(noAplicado({ dot: res }), false, "aplicado");
  });
});

// ------------------------------------------------------------------ 1b / 1b'
test("CA-11 §1b: compuerta con credito activo K1/K2 -> sigue escribiendo 12 (sin credito), consumo 'absoluto' una vez por SKU", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const tienda = tiendaUniversal([7, 0, 0, 0, 0]);
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroConCredito() });

    const { valor: res } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA }));

    assert.ok(!tienda.escrituras.some((e) => e.quantity === 14), "el credito nunca se suma (14 = 12+2)");
    assert.deepEqual(tienda.escrituras.map((e) => e.quantity), [12, 12, 12, 12, 12]);

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_5V], 12);
    assert.equal(libreta.escritos?.[SKU_5V], 12);
    assert.equal(libreta.consumos?.[K1]?.motivo, "absoluto");
    assert.equal(libreta.consumos?.[K2]?.motivo, "absoluto");
    assert.equal(libreta.consumos[K1].cantidad, 1);
    assert.equal(libreta.consumos[K2].cantidad, 1);
    assert.equal(Object.keys(libreta.consumos ?? {}).length, 2, "exactamente 2 claves, nunca 'delta'");
    assert.equal(libreta.resembradoPor?.[SKU_5V], "absoluto");
    assert.equal(libreta.resembradoEn?.[SKU_5V], T1);

    assert.equal(res.causa_venta_shopify, 0);
    assert.equal(res.actualizado, 1);
    assert.equal(res.error, 0);
  });
});

test("CA-11 §1b': corrida automatica siguiente sobre el disco de 1b -> credito ya consumido da 0, cero mutaciones, nunca 14", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const tienda1 = tiendaUniversal([7, 0, 0, 0, 0]);
    const stock1 = new Map([[SKU_5V, 12]]);
    const registro = registroConCredito();
    await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, depsCon({ dir, tienda: tienda1, stock: stock1, registro }), { escrituraAbsoluta: COMPUERTA })
    );

    // Corrida automatica: mismo registro (K1/K2 ya consumidas), Contabilium 12, 12x5.
    const tienda2 = tiendaUniversal([12, 12, 12, 12, 12]);
    const stock2 = new Map([[SKU_5V, 12]]);
    const deps2 = depsCon({ dir, tienda: tienda2, stock: stock2, registro, t: "2026-11-03T12:30:00.000Z" });

    const { valor: res2 } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps2));

    assert.deepEqual(tienda2.escrituras, []);
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.consumos?.[K1]?.motivo, "absoluto");
    assert.equal(libreta.consumos?.[K2]?.motivo, "absoluto");
    assert.equal(res2.causa_venta_shopify, 0);
  });
});

// ------------------------------------------------------------------ 1d / 1d-ctrl
test("CA-11 §1d: linea de credito tardia K3 (referencia anterior a resembradoEn) no se acredita gracias a resembradoEn", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const tienda1 = tiendaUniversal([7, 0, 0, 0, 0]);
    const stock1 = new Map([[SKU_5V, 12]]);
    const registroInicial = registroConCredito();
    await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, depsCon({ dir, tienda: tienda1, stock: stock1, registro: registroInicial }), {
        escrituraAbsoluta: COMPUERTA,
      })
    );

    const T2 = "2026-11-03T13:00:00.000Z"; // posterior a T1 en mas que el margen
    const R3 = "2026-11-03T08:00:00.000Z"; // posterior al corte, anterior a T1
    const registroConK3 = registroConCredito({ incluirK3: true, referenciaK3: R3 });
    const tienda2 = tiendaUniversal([12, 12, 12, 12, 12]);
    const stock2 = new Map([[SKU_5V, 12]]);
    const deps2 = depsCon({ dir, tienda: tienda2, stock: stock2, registro: registroConK3, t: T2 });

    const { valor: res2 } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps2));

    assert.deepEqual(tienda2.escrituras, [], "cero mutaciones, en particular ningun 13 (12+1)");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.consumos?.[K3]?.motivo, "absoluto");
    assert.equal(libreta.consumos[K3].cantidad, 1);
    assert.equal(libreta.contabilium[SKU_5V], 12);
    assert.equal(libreta.escritos?.[SKU_5V], 12);
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(res2.error, 0);
    assert.equal(res2.causa_venta_shopify, 0);
    assert.equal(res2.universales_pendientes, 0);
  });
});

test("CA-11 1d-ctrl: sin resembradoEn, K3 se acredita y re-infla a 13 (la falla que R-16 evita)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const tienda1 = tiendaUniversal([7, 0, 0, 0, 0]);
    const stock1 = new Map([[SKU_5V, 12]]);
    const registroInicial = registroConCredito();
    await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, depsCon({ dir, tienda: tienda1, stock: stock1, registro: registroInicial }), {
        escrituraAbsoluta: COMPUERTA,
      })
    );

    // Se quita a mano resembradoPor/resembradoEn del disco.
    const cruda = leerLibretaCruda(dir, "dot");
    delete cruda.resembradoPor?.[SKU_5V];
    delete cruda.resembradoEn?.[SKU_5V];
    sync.guardarSnapshot(cruda.skus, sync.rutaSnapshotPara("dot", dir), cruda.contabilium, {
      corte: cruda.corte,
      consumos: cruda.consumos,
      resembradoEn: cruda.resembradoEn ?? {},
      resembradoPor: cruda.resembradoPor ?? {},
      destinos: cruda.destinos,
      pendientes: cruda.pendientes ?? {},
      escritos: cruda.escritos ?? {},
    });

    const T2 = "2026-11-03T13:00:00.000Z";
    const R3 = "2026-11-03T08:00:00.000Z";
    const registroConK3 = registroConCredito({ incluirK3: true, referenciaK3: R3 });
    const tienda2 = tiendaUniversal([12, 12, 12, 12, 12]);
    const stock2 = new Map([[SKU_5V, 12]]);
    const deps2 = depsCon({ dir, tienda: tienda2, stock: stock2, registro: registroConK3, t: T2 });

    await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps2));

    assert.ok(tienda2.escrituras.length > 0, "sin resembradoEn, K3 se acredita y hay al menos una mutacion");
    assert.ok(tienda2.escrituras.every((e) => e.quantity === 13), "todas las mutaciones llevan 13 (12+1)");
  });
});

// ------------------------------------------------------------------ 1c
test("CA-11 §1c: variantes que ya tienen el absoluto no reciben mutacion", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const tienda = tiendaUniversal([12, 0, 12, 0, 0]);
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroVacio() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA })
    );

    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V2.inventoryItemId, 12, 0],
        [V4.inventoryItemId, 12, 0],
        [V5.inventoryItemId, 12, 0],
      ]
    );
    assert.ok(
      lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 12 (escritas=3, ya_estaban=2)`)
    );
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 12);
    assert.equal(libreta.escritos?.[SKU_5V], 12);
    assert.equal(res.error, 0);
  });
});

// ------------------------------------------------------------------ 2
test("CA-11 §2: compuerta sobre un pendiente trabado por R-11(c) -> descarta el viejo, escribe el absoluto en las 5", async () => {
  await conDirTemporal(async (dir) => {
    const pendienteViejo = {
      nuevoValor: 8,
      contabiliumObjetivo: 13,
      variantes: [V1, V2, V3, V4, V5].map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
    };
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      corte: CORTE_VIEJO,
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, pendientes: { [SKU_5V]: pendienteViejo } },
    });
    const tienda = tiendaUniversal([8, 8, 4, 8, 8]);
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroVacio() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA })
    );

    assert.ok(!lineas.some((l) => l.texto.includes("cambio durante un pendiente universal")), "no evalua la entrada vieja");
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V1.inventoryItemId, 12, 8],
        [V2.inventoryItemId, 12, 8],
        [V3.inventoryItemId, 12, 4],
        [V4.inventoryItemId, 12, 8],
        [V5.inventoryItemId, 12, 8],
      ]
    );
    assert.ok(!tienda.escrituras.some((e) => e.quantity === 8), "ninguna lleva el nuevoValor del pendiente viejo");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_5V], 12);
    assert.equal(libreta.escritos?.[SKU_5V], 12);
    assert.equal(res.error, 0);
    assert.equal(res.universales, 1);
    assert.equal(res.universales_pendientes, 0);
  });
});

// ------------------------------------------------------------------ 3 (3.1-3.3)
test("CA-11 §3: compuerta con fallo parcial, no reintento automatico, cierre con compuerta nuevamente", async () => {
  await conDirTemporal(async (dir) => {
    // 3.1
    sembrarEstado1(dir);
    const registro = registroConCredito();
    const tienda1 = tiendaUniversal([7, 0, 0, 0, 0], { fallaInventoryItemId: V4.inventoryItemId });
    const stock1 = new Map([[SKU_5V, 12]]);
    const deps1 = depsCon({ dir, tienda: tienda1, stock: stock1, registro });

    const { valor: res1, lineas: lineas1 } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps1, { escrituraAbsoluta: COMPUERTA })
    );

    assert.deepEqual(
      tienda1.escrituras.map((e) => [e.inventoryItemId, e.quantity]),
      [
        [V1.inventoryItemId, 12],
        [V2.inventoryItemId, 12],
        [V3.inventoryItemId, 12],
        [V5.inventoryItemId, 12],
      ]
    );
    let libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes?.[SKU_5V], {
      nuevoValor: 12,
      contabiliumObjetivo: 12,
      requiereCompuerta: true,
      variantes: [V1, V2, V3, V4, V5].map((v, i) => ({
        variantId: v.variantId,
        inventoryItemId: v.inventoryItemId,
        desde: [7, 0, 0, 0, 0][i],
      })),
    });
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.equal(libreta.escritos?.[SKU_5V], 7);
    assert.equal(libreta.consumos?.[K1], undefined, "el credito no se marca si la compuerta no termina");
    assert.equal(libreta.consumos?.[K2], undefined);
    assert.ok(lineas1.some((l) => l.texto.startsWith(`  [ERROR] dot/${SKU_5V}: `)));
    assert.ok(
      lineas1.some(
        (l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 12 PENDIENTE (escritas=4, ya_estaban=0, fallidas=1)`
      )
    );
    assert.equal(noAplicado({ dot: res1 }), true, "no aplicado");
    assert.equal(res1.error, 1);
    assert.equal(res1.universales, 0);
    assert.equal(res1.universales_pendientes, 1);

    // 3.2, automatica, sobre el disco de 3.1.
    const tienda2 = tiendaUniversal([12, 12, 12, 0, 12]);
    const stock2 = new Map([[SKU_5V, 12]]);
    const deps2 = depsCon({ dir, tienda: tienda2, stock: stock2, registro });

    const { valor: res2, lineas: lineas2 } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps2));

    assert.deepEqual(tienda2.escrituras, [], "ninguna mutacion: la entrada marcada no se reintenta sola");
    libreta = leerLibretaCruda(dir, "dot");
    assert.ok(libreta.pendientes?.[SKU_5V], "sigue marcada, sin cambios");
    assert.equal(libreta.consumos?.[K1], undefined);
    assert.equal(libreta.consumos?.[K2], undefined);
    assert.equal(lineas2.filter((l) => l.texto === L17).length, 1);
    assert.equal(res2.error, 1);
    assert.equal(res2.universales_pendientes, 1);
    assert.equal(res2.universales, 0);

    // 3.3, con compuerta, sobre el disco de 3.2.
    const tienda3 = tiendaUniversal([12, 12, 12, 0, 12]);
    const stock3 = new Map([[SKU_5V, 12]]);
    const deps3 = depsCon({ dir, tienda: tienda3, stock: stock3, registro, t: "2026-11-03T14:00:00.000Z" });

    const { valor: res3, lineas: lineas3 } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps3, { escrituraAbsoluta: COMPUERTA })
    );

    assert.deepEqual(
      tienda3.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V4.inventoryItemId, 12, 0]]
    );
    libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_5V], 12);
    assert.equal(libreta.escritos?.[SKU_5V], 12);
    assert.equal(libreta.consumos?.[K1]?.motivo, "absoluto");
    assert.equal(libreta.consumos?.[K2]?.motivo, "absoluto");
    assert.equal(libreta.consumos[K1].cantidad, 1);
    assert.equal(libreta.resembradoPor?.[SKU_5V], "absoluto");
    assert.equal(libreta.resembradoEn?.[SKU_5V], "2026-11-03T14:00:00.000Z");
    assert.ok(
      lineas3.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 12 (escritas=1, ya_estaban=4)`)
    );
    assert.equal(res3.universales, 1);
    assert.equal(res3.universales_pendientes, 0);
  });
});

// ------------------------------------------------------------------ 4 / 4b
test("CA-11 §4: conteo distinto del esperado bajo la compuerta -> cero guardar, cero mutaciones, no aplicado", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const tienda = tiendaUniversal([7, 0, 0, 0]).consultar; // placeholder, se reemplaza abajo
    void tienda;
    const nodos4 = [V1, V2, V3, V4].map((v, i) => nodoExacto(v, SKU_5V, [7, 0, 0, 0][i]));
    const t = {
      escrituras: [],
      async consultar() {
        return { productVariants: { edges: nodos4.map((n) => ({ node: n })), pageInfo: { hasNextPage: false } } };
      },
      async setearStock(inventoryItemId, quantity, changeFromQuantity, locationId) {
        t.escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      },
    };
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda: t, stock, registro: registroVacio() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA })
    );

    assert.deepEqual(t.escrituras, []);
    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.equal(libreta.escritos?.[SKU_5V], 7);
    assert.ok(lineas.some((l) => l.texto.startsWith(`  [ERROR] dot/${SKU_5V}: `)));
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));
    assert.equal(noAplicado({ dot: res }), true);
    assert.equal(res.error, 1);
  });
});

test("CA-11 §4b: 6 exactas (una de mas) -> mismo resultado que 4", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const V6 = { variantId: "gid://shopify/ProductVariant/8010006", inventoryItemId: "gid://shopify/InventoryItem/9010006" };
    const nodos = [V1, V2, V3, V4, V5].map((v, i) => nodoExacto(v, SKU_5V, [7, 0, 0, 0, 0][i])).concat(nodoExacto(V6, SKU_5V, 0));
    const t = {
      escrituras: [],
      async consultar() {
        return { productVariants: { edges: nodos.map((n) => ({ node: n })), pageInfo: { hasNextPage: false } } };
      },
      async setearStock(inventoryItemId, quantity, changeFromQuantity, locationId) {
        t.escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      },
    };
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda: t, stock, registro: registroVacio() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA })
    );

    assert.deepEqual(t.escrituras, []);
    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.ok(lineas.some((l) => l.texto.startsWith(`  [ERROR] dot/${SKU_5V}: `)));
    assert.equal(noAplicado({ dot: res }), true);
    assert.equal(res.error, 1);
  });
});

// ------------------------------------------------------------------ 5 / 5b / 5b-i / 5b-ii / 5c / 5d
const L18_V5 = `  [ERROR] dot/${SKU_5V}: variante ${V5.variantId} no esta activada en la location del par, no se resuelve`;

test("CA-11 §5: caso (b) de R-18 bajo la compuerta -> error, cero mutaciones, no aplicado, no esta en noActivados", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const tienda = tiendaUniversal([7, 0, 0, 0, null]);
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroVacio() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA })
    );

    assert.deepEqual(tienda.escrituras, []);
    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.equal(libreta.escritos?.[SKU_5V], 7);
    assert.equal(lineas.filter((l) => l.texto === L18_V5).length, 1);
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));
    assert.equal(noAplicado({ dot: res }), true);
    assert.equal(res.error, 1);
    assert.equal(res.no_activado, 0);
    assert.deepEqual(res.compuertaSkus.noActivados, []);
    assert.deepEqual(res.compuertaSkus.aplicados, []);
  });
});

test("CA-11 §5b: caso (a) de R-18 bajo la compuerta -> benigno, no_activado, no error", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const tienda = tiendaUniversal([null, null, null, null, null]);
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroVacio() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA })
    );

    assert.deepEqual(tienda.escrituras, []);
    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.equal(libreta.escritos?.[SKU_5V], 7);
    assert.ok(!lineas.some((l) => l.texto.includes("[ERROR]")));
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));
    assert.equal(res.error, 0);
    assert.equal(res.no_activado, 1);
    assert.equal(res.actualizado, 0);
    assert.equal(res.universales, 0);
    assert.equal(res.universales_pendientes, 0);
    assert.deepEqual(res.compuertaSkus.noActivados, [SKU_5V]);
    assert.deepEqual(res.compuertaSkus.aplicados, []);
  });
});

test("CA-11 §5b-i: tolerancia entre pares de la compuerta (no activado en dot, aplicado en galerias)", async () => {
  await conDirTemporal(async (dir) => {
    const PAR_GALERIAS = {
      nombre: "galerias-pacifico",
      stateKey: "galerias-pacifico",
      depositoId: "7100001",
      locationId: "gid://shopify/Location/7100000001",
      pendiente: false,
    };
    sembrarEstado1(dir);
    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, escritos: { [SKU_5V]: 7 } },
    });

    const nodosPorLocation = {
      [PAR_DOT.locationId]: [V1, V2, V3, V4, V5].map((v, i) => nodoExacto(v, SKU_5V, [null, null, null, null, null][i])),
      [PAR_GALERIAS.locationId]: [V1, V2, V3, V4, V5].map((v, i) => nodoExacto(v, SKU_5V, [7, 0, 0, 0, 0][i])),
    };
    const escrituras = [];
    const deps = {
      ...sync.DEPS_REALES,
      ahora: () => new Date(T1),
      esDryRun: () => false,
      getStockDeposito: async (depositoId) => {
        if (depositoId === PAR_DOT.depositoId) return new Map([[SKU_5V, 12]]);
        if (depositoId === PAR_GALERIAS.depositoId) return new Map([[SKU_5V, 12]]);
        throw new Error(`depositoId inesperado: ${depositoId}`);
      },
      rutaSnapshotPara: (stateKey) => sync.rutaSnapshotPara(stateKey, dir),
      cargarRegistroComprobantes: () => registroVacio(),
      guardarRegistroComprobantes: () => {},
      leerCacheSku: () => ({}),
      buscarComprobantes: async () => [],
      fetchComprobantesDetalle: async () => [],
      crearSesion: () => undefined,
      resolverSkuUniversal: async (sku, locationId) => {
        const nodos = nodosPorLocation[locationId];
        if (!nodos) throw new Error(`locationId inesperado: ${locationId}`);
        const { ConteoVariantesUniversalError, variantesUniversales } = await import("../src/shopify.js");
        const esperadas = variantesUniversales(sku);
        const exactos = nodos.filter((n) => n.sku === sku && n.inventoryItem?.id);
        if (exactos.length !== esperadas) throw new ConteoVariantesUniversalError(sku, esperadas, exactos.length, false);
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

    const { valor: porPar, lineas } = await capturarConsola(() =>
      sync.correrTodosLosPares([PAR_DOT, PAR_GALERIAS], deps, { escrituraAbsoluta: COMPUERTA })
    );

    assert.equal(noAplicado({ dot: porPar.dot, "galerias-pacifico": porPar["galerias-pacifico"] }), false, "tolerado: aplicado en galerias");
    assert.equal(porPar.dot.no_activado, 1);
    assert.equal(porPar.dot.error, 0);
    assert.equal(porPar["galerias-pacifico"].actualizado, 1);
    assert.ok(escrituras.some((e) => e.locationId === PAR_GALERIAS.locationId && e.quantity === 12));
    assert.ok(!escrituras.some((e) => e.locationId === PAR_DOT.locationId));
  });
});

test("CA-11 §5b-ii: un solo par con el universal null x5 -> no aplicado, igual que el control no universal", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const tienda = tiendaUniversal([null, null, null, null, null]);
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroVacio() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA })
    );

    // Control: SKU no universal, no_activado, en el mismo par, sin compuerta sobre este.
    const SKU_CTRL = "FUNDA-MAGSAFE-MATE-IPHONE16";
    sembrarLibreta(dir, "dot-ctrl", {
      skus: { [SKU_CTRL]: 10 },
      contabilium: { [SKU_CTRL]: 10 },
      extra: { destinos: { [SKU_CTRL]: "gid://shopify/InventoryItem/9090001" } },
    });
    const PAR_CTRL = { nombre: "dot-ctrl", stateKey: "dot-ctrl", depositoId: "ctrl", locationId: PAR_DOT.locationId, pendiente: false };
    const depsCtrl = {
      ...sync.DEPS_REALES,
      ahora: () => new Date(T1),
      esDryRun: () => false,
      getStockDeposito: async () => new Map([[SKU_CTRL, 12]]),
      rutaSnapshotPara: (stateKey) => sync.rutaSnapshotPara(stateKey, dir),
      cargarRegistroComprobantes: () => registroVacio(),
      guardarRegistroComprobantes: () => {},
      leerCacheSku: () => ({}),
      buscarComprobantes: async () => [],
      fetchComprobantesDetalle: async () => [],
      crearSesion: () => undefined,
      resolverSku: async () => ({ inventoryItemId: "gid://shopify/InventoryItem/9090001", variantId: "gid://shopify/ProductVariant/8090001", available: null, duplicados: 0 }),
    };
    const { valor: resCtrl, lineas: lineasCtrl } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_CTRL, depsCtrl, { escrituraAbsoluta: new Set([SKU_CTRL]) })
    );

    assert.equal(noAplicado({ dot: res }), true, "el universal no aplicado en ningun par");
    assert.equal(noAplicado({ "dot-ctrl": resCtrl }, SKU_CTRL, new Set([SKU_CTRL])), true, "el control tambien queda no aplicado");
    assert.equal(res.error, 0, "R-18 no agrega error");
    assert.equal(resCtrl.error, 0, "igual al control");
  });
});

test("CA-11 §5c: caso (b) con un pendiente previo -> no reemplaza, pendiente intacto", async () => {
  await conDirTemporal(async (dir) => {
    const pendienteViejo = {
      nuevoValor: 8,
      contabiliumObjetivo: 13,
      variantes: [V1, V2, V3, V4, V5].map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
    };
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      corte: CORTE_VIEJO,
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, pendientes: { [SKU_5V]: pendienteViejo } },
    });
    const tienda = tiendaUniversal([8, 8, 4, 8, null]);
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroVacio() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA })
    );

    assert.deepEqual(tienda.escrituras, []);
    assert.equal(lineas.filter((l) => l.texto.includes("no esta activada en la location del par")).length, 1);
    assert.equal(noAplicado({ dot: res }), true);
    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes?.[SKU_5V], pendienteViejo, "no se reemplazo: no paso los controles");
    assert.equal(res.error, 1);
  });
});

test("CA-11 §5d: caso (a) con un pendiente previo -> no_activado benigno, pendiente intacto", async () => {
  await conDirTemporal(async (dir) => {
    const pendienteViejo = {
      nuevoValor: 8,
      contabiliumObjetivo: 13,
      variantes: [V1, V2, V3, V4, V5].map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
    };
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      corte: CORTE_VIEJO,
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, pendientes: { [SKU_5V]: pendienteViejo } },
    });
    const tienda = tiendaUniversal([null, null, null, null, null]);
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroVacio() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA })
    );

    assert.deepEqual(tienda.escrituras, []);
    assert.ok(!lineas.some((l) => l.texto.includes("no esta activada en la location del par")));
    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes?.[SKU_5V], pendienteViejo, "no se toca ni se descarta");
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.equal(res.error, 0);
    assert.equal(res.no_activado, 1);
  });
});

// ------------------------------------------------------------------ 6
test("CA-11 §6: DRY_RUN con la compuerta -> cero eventos, ningun credito consumido", async () => {
  await conDirTemporal(async (dir) => {
    sembrarEstado1(dir);
    const tienda = tiendaUniversal([7, 0, 0, 0, 0]);
    const stock = new Map([[SKU_5V, 12]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroConCredito(), dryRun: true });
    const libretaAntes = leerLibretaCruda(dir, "dot");

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: COMPUERTA })
    );

    assert.deepEqual(tienda.escrituras, []);
    const libretaDespues = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libretaDespues, libretaAntes, "ninguna persistencia");
    assert.ok(
      lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_5V}: 5 variantes -> 12 (no se escribe, DRY_RUN=true)`)
    );
    assert.equal(res.dry, 1);
    assert.equal(res.universales, 0);
    assert.equal(res.universales_pendientes, 0);
  });
});
