// CA-12 — Pendiente calculado con credito o con siembra: no se reintenta solo
// (R-17). Cubre los escenarios 1 a 4 de la evidencia (el 5, la compuerta de
// R-16, es T12 y queda fuera de alcance de este archivo).
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca12-pendiente-credito-siembra.md
// SKU: APPLYFIT-CLEAR-S24-S25 (SKU_2V), V1/V2 de _helpers-sku-universal.js.
//
// Corre con: node --test test/sku-universal-pendiente-credito-siembra.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { claveConsumo } from "../src/clasificador-causa.js";
import { conDirTemporal, sembrarLibreta, leerLibretaCruda, PAR_DOT, DEPOSITO_DOT, capturarConsola } from "./_helpers-clasificador.js";
import { SKU_2V, VARIANTES_2V, nodoExacto } from "./_helpers-sku-universal.js";

const T = "2026-11-03T12:00:00.000Z";
const CORTE_VIEJO = "2020-01-01T00:00:00.000Z"; // bien anterior: nada es pre-corte
const REFERENCIA_CREDITO = "2026-11-03T06:00:00.000Z"; // horas antes: siempre acreditable

const [V1, V2] = VARIANTES_2V;
const K1_ID = 510001;
const K2_ID = 510002;
const K1 = claveConsumo(K1_ID, SKU_2V);
const K2 = claveConsumo(K2_ID, SKU_2V);

// Registro de comprobantes con dos lineas Shopify/DOT acreditables de 1 unidad
// cada una (K1, K2), ya "registradas" (estado ok), sin consumir.
function registroConCredito() {
  const dia = "2026-11-03";
  const base = (id) => ({
    estado: "ok",
    tipoFc: "FCB",
    inventario: DEPOSITO_DOT,
    notaCreditoShopify: false,
    dia,
    lineas: [{ comprobanteId: id, sku: SKU_2V, cantidad: 1, referencia: REFERENCIA_CREDITO }],
  });
  return {
    v: 1,
    ultimoRefrescoOk: null,
    diasCerrados: [],
    comprobantes: { [String(K1_ID)]: base(K1_ID), [String(K2_ID)]: base(K2_ID) },
  };
}

function registroSinCredito() {
  return { v: 1, ultimoRefrescoOk: null, diasCerrados: [], comprobantes: {} };
}

// tienda inyectada: resuelve el SKU curado con los `available` que pida cada
// corrida; `fallaInventoryItemId` hace que ESA variante rechace al mutar.
function tiendaUniversal(availables, { fallaInventoryItemId = null } = {}) {
  const nodos = [V1, V2].map((v, i) => nodoExacto(v, SKU_2V, availables[i]));
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

function depsCon({ dir, tienda, stock, registro, t = T }) {
  return {
    ...sync.DEPS_REALES,
    ahora: () => new Date(t),
    esDryRun: () => false,
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

const L17 = `  [ERROR] dot/${SKU_2V}: pendiente universal requiere compuerta manual -> no se escribe`;

// ---------------------------------------------------------------- 1 — credito
test("CA-12 §1.1: credito +2 con fallo parcial -> pendiente marcado, SIN consumir el credito", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      corte: CORTE_VIEJO,
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId }, escritos: { [SKU_2V]: 5 } },
    });
    const tienda = tiendaUniversal([5, 5], { fallaInventoryItemId: V2.inventoryItemId });
    const stock = new Map([[SKU_2V, 10]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroConCredito() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.error, 1);
    assert.equal(res.universales, 0);
    assert.equal(res.universales_pendientes, 1);
    assert.equal(res.causa_venta_shopify, 0);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V1.inventoryItemId, 7, 5]]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.pendientes?.[SKU_2V]?.nuevoValor, 7);
    assert.equal(libreta.pendientes?.[SKU_2V]?.contabiliumObjetivo, 10);
    assert.equal(libreta.pendientes?.[SKU_2V]?.requiereCompuerta, true);
    assert.equal(libreta.contabilium[SKU_2V], 10);
    assert.equal(libreta.skus[SKU_2V], 10);
    assert.equal(libreta.escritos?.[SKU_2V], 5);
    assert.equal(libreta.destinos?.[SKU_2V], V1.inventoryItemId);
    assert.equal(libreta.consumos?.[K1], undefined, "el credito no se consumio");
    assert.equal(libreta.consumos?.[K2], undefined, "el credito no se consumio");

    assert.ok(
      lineas.some((l) => l.texto.startsWith(`  [ERROR] dot/${SKU_2V}:`)),
      "ERROR por la variante que fallo (R-5)"
    );
    assert.ok(
      lineas.some(
        (l) => l.texto === `  [UNIVERSAL] dot/${SKU_2V}: 2 variantes -> 7 PENDIENTE (escritas=1, ya_estaban=0, fallidas=1)`
      )
    );
    assert.equal(lineas.filter((l) => l.texto === L17).length, 1, "L17 exactamente una vez");
  });
});

test("CA-12 §1.2: la corrida siguiente, con la misma entrada marcada, no muta nada y repite L17", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      corte: CORTE_VIEJO,
      extra: {
        destinos: { [SKU_2V]: V1.inventoryItemId },
        escritos: { [SKU_2V]: 5 },
        pendientes: {
          [SKU_2V]: {
            nuevoValor: 7,
            contabiliumObjetivo: 10,
            requiereCompuerta: true,
            variantes: [
              { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 5 },
              { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 5 },
            ],
          },
        },
      },
    });
    // Mismo credito sin consumir, Contabilium 10, respuesta 7/5.
    const tienda = tiendaUniversal([7, 5]);
    const stock = new Map([[SKU_2V, 10]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroConCredito() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(tienda.escrituras, [], "cero mutaciones: ni reintento R-11 (7) ni credito doble (9)");
    assert.equal(res.error, 1);
    assert.equal(res.universales, 0);
    assert.equal(res.universales_pendientes, 1);
    assert.equal(lineas.filter((l) => l.texto === L17).length, 1);

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes?.[SKU_2V], {
      nuevoValor: 7,
      contabiliumObjetivo: 10,
      requiereCompuerta: true,
      variantes: [
        { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 5 },
        { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 5 },
      ],
    });
    assert.equal(libreta.contabilium[SKU_2V], 10);
    assert.equal(libreta.escritos?.[SKU_2V], 5);
    assert.equal(libreta.consumos?.[K1], undefined);
    assert.equal(libreta.consumos?.[K2], undefined);
  });
});

test("CA-12 §1.3: igual con --full", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      corte: CORTE_VIEJO,
      extra: {
        destinos: { [SKU_2V]: V1.inventoryItemId },
        escritos: { [SKU_2V]: 5 },
        pendientes: {
          [SKU_2V]: {
            nuevoValor: 7,
            contabiliumObjetivo: 10,
            requiereCompuerta: true,
            variantes: [
              { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 5 },
              { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 5 },
            ],
          },
        },
      },
    });
    const tienda = tiendaUniversal([7, 5]);
    const stock = new Map([[SKU_2V, 10]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroConCredito() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps, { full: true }));

    assert.deepEqual(tienda.escrituras, []);
    assert.equal(res.error, 1);
    assert.equal(lineas.filter((l) => l.texto === L17).length, 1);
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.pendientes?.[SKU_2V]?.requiereCompuerta, true);
  });
});

// ---------------------------------------------------------------- 2 — siembra
test("CA-12 §2.1: siembra con fallo parcial -> pendiente marcado, baseline/escrito/destinos siguen ausentes", async () => {
  await conDirTemporal(async (dir) => {
    // Sin libreta previa: baseline null (siembra).
    const tienda = tiendaUniversal([0, 0], { fallaInventoryItemId: V2.inventoryItemId });
    const stock = new Map([[SKU_2V, 6]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroSinCredito() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.error, 1);
    assert.equal(res.universales_pendientes, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V1.inventoryItemId, 6, 0]]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.pendientes?.[SKU_2V]?.nuevoValor, 6);
    assert.equal(libreta.pendientes?.[SKU_2V]?.contabiliumObjetivo, 6);
    assert.equal(libreta.pendientes?.[SKU_2V]?.requiereCompuerta, true);
    assert.equal(libreta.contabilium?.[SKU_2V], undefined);
    assert.equal(libreta.skus?.[SKU_2V], undefined);
    assert.equal(libreta.destinos?.[SKU_2V], undefined);
    assert.equal(libreta.escritos?.[SKU_2V], undefined);
    assert.equal(libreta.resembradoEn?.[SKU_2V], undefined);
    assert.equal(libreta.resembradoPor?.[SKU_2V], undefined);

    assert.ok(lineas.some((l) => l.texto.startsWith(`  [ERROR] dot/${SKU_2V}:`)));
    assert.ok(
      lineas.some(
        (l) => l.texto === `  [UNIVERSAL] dot/${SKU_2V}: 2 variantes -> 6 PENDIENTE (escritas=1, ya_estaban=0, fallidas=1)`
      )
    );
    assert.equal(lineas.filter((l) => l.texto === L17).length, 1);
  });
});

function sembrarPendienteSiembra(dir) {
  sembrarLibreta(dir, "dot", {
    skus: {},
    contabilium: null,
    extra: {
      pendientes: {
        [SKU_2V]: {
          nuevoValor: 6,
          contabiliumObjetivo: 6,
          requiereCompuerta: true,
          variantes: [
            { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 0 },
            { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 0 },
          ],
        },
      },
    },
  });
}

test("CA-12 §2.2: corrida siguiente sobre el disco de 2.1 -> cero mutaciones, L17, baseline sigue ausente", async () => {
  await conDirTemporal(async (dir) => {
    sembrarPendienteSiembra(dir);
    const tienda = tiendaUniversal([6, 0]);
    const stock = new Map([[SKU_2V, 6]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroSinCredito() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(tienda.escrituras, [], "ningun mutar(V2, 6, 0)");
    assert.equal(res.error, 1);
    assert.equal(res.universales_pendientes, 1);
    assert.equal(lineas.filter((l) => l.texto === L17).length, 1);

    const libreta = leerLibretaCruda(dir, "dot");
    assert.ok(libreta.pendientes?.[SKU_2V], "la entrada marcada sigue sin cambios");
    assert.equal(libreta.contabilium?.[SKU_2V], undefined, "el baseline sigue ausente");
  });
});

test("CA-12 §2.3: con Contabilium cambiado (9) sobre el disco de 2.2, mismo resultado exacto: ni 9 ni 3", async () => {
  await conDirTemporal(async (dir) => {
    sembrarPendienteSiembra(dir);
    const tienda = tiendaUniversal([6, 0]);
    const stock = new Map([[SKU_2V, 9]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroSinCredito() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(tienda.escrituras, [], "ningun mutar con 9 (nueva siembra) ni con 3 (delta contra 6)");
    assert.equal(res.error, 1);
    assert.equal(lineas.filter((l) => l.texto === L17).length, 1);
    assert.equal(leerLibretaCruda(dir, "dot").contabilium?.[SKU_2V], undefined);
  });
});

// --------------------------------------------------------- 3 — resuelve normal
test("CA-12 §3: el estado de 1.1 SIN falla se resuelve normal, marcado igual antes de mutar, credito consumido una vez", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      corte: CORTE_VIEJO,
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId }, escritos: { [SKU_2V]: 5 } },
    });
    const tienda = tiendaUniversal([5, 5]); // sin falla
    const stock = new Map([[SKU_2V, 10]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroConCredito() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.error, 0);
    assert.equal(res.universales, 1);
    assert.equal(res.universales_pendientes, 0);
    assert.equal(res.causa_venta_shopify, 2);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]).sort(),
      [
        [V1.inventoryItemId, 7, 5],
        [V2.inventoryItemId, 7, 5],
      ].sort()
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {}, "el pendiente se cierra");
    assert.equal(libreta.contabilium[SKU_2V], 10);
    assert.equal(libreta.skus[SKU_2V], 10);
    assert.equal(libreta.escritos?.[SKU_2V], 7);
    assert.equal(libreta.destinos?.[SKU_2V], V1.inventoryItemId);
    assert.ok(libreta.consumos?.[K1], "K1 consumida");
    assert.ok(libreta.consumos?.[K2], "K2 consumida");
    assert.equal(libreta.consumos[K1].cantidad, 1);
    assert.equal(libreta.consumos[K2].cantidad, 1);

    assert.ok(
      lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_2V}: 2 variantes -> 7 (escritas=2, ya_estaban=0)`)
    );
    assert.ok(!lineas.some((l) => l.texto === L17), "nunca L17 en una resolucion sin marca manual");
  });
});

// --------------------------------------------------------- 4 — control sin R-17
test("CA-12 §4: sin credito ni siembra, el pendiente SIGUE siendo reintentable por R-11 (control)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      corte: CORTE_VIEJO,
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId }, escritos: { [SKU_2V]: 5 } },
    });
    // Corrida 4.1: credito 0, Contabilium 12, V2 rechaza.
    const tienda1 = tiendaUniversal([5, 5], { fallaInventoryItemId: V2.inventoryItemId });
    const stock1 = new Map([[SKU_2V, 12]]);
    const deps1 = depsCon({ dir, tienda: tienda1, stock: stock1, registro: registroSinCredito() });

    const { valor: res1, lineas: lineas1 } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps1));

    assert.equal(res1.error, 1);
    assert.ok(!lineas1.some((l) => l.texto === L17), "sin marca: nunca L17");
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.pendientes?.[SKU_2V]?.nuevoValor, 7);
    assert.equal(libreta.pendientes?.[SKU_2V]?.requiereCompuerta, undefined, "sin marca");
    assert.equal(libreta.contabilium[SKU_2V], 10, "no avanza todavia");
    assert.equal(libreta.escritos?.[SKU_2V], 5);

    // Corrida 4.2: mismo credito 0, Contabilium 12, respuesta 7/5. El
    // automatico de R-11 reintenta solo, sin pasar por T10.
    const tienda2 = tiendaUniversal([7, 5]);
    const stock2 = new Map([[SKU_2V, 12]]);
    const deps2 = depsCon({ dir, tienda: tienda2, stock: stock2, registro: registroSinCredito() });

    const { valor: res2, lineas: lineas2 } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps2));

    assert.equal(res2.error, 0);
    assert.equal(res2.universales, 1);
    assert.equal(res2.universales_pendientes, 0);
    assert.deepEqual(
      tienda2.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V2.inventoryItemId, 7, 5]],
      "una sola mutacion: R-11 (b)"
    );
    assert.ok(!lineas2.some((l) => l.texto === L17));
    assert.ok(
      lineas2.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_2V}: 2 variantes -> 7 (escritas=1, ya_estaban=1) [reintento]`)
    );

    libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_2V], 12);
    assert.equal(libreta.skus[SKU_2V], 12);
    assert.equal(libreta.escritos?.[SKU_2V], 7);
  });
});

// --------------------------------------------------- 5 — la compuerta cierra una entrada marcada
test("CA-12 §5: la compuerta de R-16 descarta la entrada marcada y la cierra con el absoluto, consume K1/K2 con motivo absoluto", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      corte: CORTE_VIEJO,
      extra: {
        destinos: { [SKU_2V]: V1.inventoryItemId },
        escritos: { [SKU_2V]: 5 },
        pendientes: {
          [SKU_2V]: {
            nuevoValor: 7,
            contabiliumObjetivo: 10,
            requiereCompuerta: true,
            variantes: [
              { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 5 },
              { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 5 },
            ],
          },
        },
      },
    });
    const tienda = tiendaUniversal([7, 5]);
    const stock = new Map([[SKU_2V, 10]]);
    const deps = depsCon({ dir, tienda, stock, registro: registroConCredito() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: new Set([SKU_2V]) })
    );

    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V1.inventoryItemId, 10, 7],
        [V2.inventoryItemId, 10, 5],
      ]
    );
    assert.ok(!tienda.escrituras.some((e) => e.quantity === 7), "nunca el nuevoValor de la entrada marcada");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_2V], 10);
    assert.equal(libreta.skus[SKU_2V], 10);
    assert.equal(libreta.escritos?.[SKU_2V], 10);
    assert.equal(libreta.destinos?.[SKU_2V], V1.inventoryItemId);
    assert.equal(libreta.consumos?.[K1]?.motivo, "absoluto");
    assert.equal(libreta.consumos?.[K2]?.motivo, "absoluto");
    assert.equal(libreta.consumos[K1].cantidad, 1);
    assert.equal(libreta.consumos[K2].cantidad, 1);
    assert.equal(libreta.resembradoPor?.[SKU_2V], "absoluto");
    assert.ok(libreta.resembradoEn?.[SKU_2V]);

    assert.ok(lineas.some((l) => l.texto === `  [UNIVERSAL] dot/${SKU_2V}: 2 variantes -> 10 (escritas=2, ya_estaban=0)`));
    assert.ok(!lineas.some((l) => l.texto === L17));
    assert.equal(res.error, 0);
    assert.equal(res.universales, 1);
    assert.equal(res.universales_pendientes, 0);
    assert.equal(res.causa_venta_shopify, 0);
    assert.ok(!res.compuertaSkus || res.compuertaSkus.aplicados.includes(SKU_2V));
  });
});

test("CA-12 §5': corrida automatica sobre el disco de 5 -> credito ya consumido, cero mutaciones, nunca 12", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      corte: CORTE_VIEJO,
      extra: {
        destinos: { [SKU_2V]: V1.inventoryItemId },
        escritos: { [SKU_2V]: 5 },
        pendientes: {
          [SKU_2V]: {
            nuevoValor: 7,
            contabiliumObjetivo: 10,
            requiereCompuerta: true,
            variantes: [
              { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 5 },
              { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 5 },
            ],
          },
        },
      },
    });
    const registro = registroConCredito();
    const tienda1 = tiendaUniversal([7, 5]);
    const stock1 = new Map([[SKU_2V, 10]]);
    await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, depsCon({ dir, tienda: tienda1, stock: stock1, registro }), {
        escrituraAbsoluta: new Set([SKU_2V]),
      })
    );

    const tienda2 = tiendaUniversal([10, 10]);
    const stock2 = new Map([[SKU_2V, 10]]);
    const deps2 = depsCon({ dir, tienda: tienda2, stock: stock2, registro });

    const { valor: res2 } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps2));

    assert.deepEqual(tienda2.escrituras, [], "cero mutaciones, en particular ninguna con 12 (10+2)");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.consumos?.[K1]?.motivo, "absoluto");
    assert.equal(libreta.consumos?.[K2]?.motivo, "absoluto");
    assert.equal(res2.causa_venta_shopify, 0);
    assert.equal(res2.universales_pendientes, 0);
  });
});
