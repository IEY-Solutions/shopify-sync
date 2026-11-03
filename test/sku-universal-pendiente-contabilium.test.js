// CA-8 — Contabilium cambia mientras hay un pendiente de un SKU universal
// (R-12, y R-11/R-13 en el cierre).
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca8-pendiente-contabilium.md
// (cadena principal corridas 1 a 3, cadena espejo 2' a 3').
//
// Corre con: node --test test/sku-universal-pendiente-contabilium.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { conDirTemporal, sembrarLibreta, leerLibretaCruda, PAR_DOT } from "./_helpers-clasificador.js";
import { SKU_2V, VARIANTES_2V, nodoExacto } from "./_helpers-sku-universal.js";

const T = "2026-11-03T12:00:00.000Z";
const [V1, V2] = VARIANTES_2V;

function tiendaUniversal(nodos) {
  const t = {
    nodos,
    escrituras: [],
    async consultar(_query, variables) {
      return { productVariants: { edges: t.nodos.map((n) => ({ node: n })), pageInfo: { hasNextPage: false } } };
    },
    async setearStock(inventoryItemId, quantity, changeFromQuantity, locationId) {
      t.escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    },
  };
  t.consultar = t.consultar.bind(t);
  t.setearStock = t.setearStock.bind(t);
  return t;
}

function depsCon({ dir, tienda, stock, t = T }) {
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
    resolverSkuUniversal: async (sku, locationId) => {
      const data = await tienda.consultar(null, { query: `sku:"${sku}"`, locationId, first: 10 });
      const nodos = data.productVariants.edges.map((e) => e.node);
      const topeAlcanzado = data.productVariants.pageInfo.hasNextPage;
      const { ConteoVariantesUniversalError, variantesUniversales } = await import("../src/shopify.js");
      const esperadas = variantesUniversales(sku);
      const exactos = nodos.filter((n) => n.sku === sku && n.inventoryItem?.id);
      if (exactos.length !== esperadas) throw new ConteoVariantesUniversalError(sku, esperadas, exactos.length, topeAlcanzado);
      return exactos.map((n) => ({
        variantId: n.id,
        inventoryItemId: n.inventoryItem.id,
        available: n.inventoryItem.inventoryLevel?.quantities?.find((q) => q.name === "available")?.quantity ?? null,
      }));
    },
    setearStock: tienda.setearStock,
  };
}

// Estado inicial comun de la corrida 1: baseline/skus 10, destino V1, sin
// pendiente ni escrito.
function sembrarCorrida1(dir) {
  sembrarLibreta(dir, "dot", {
    skus: { [SKU_2V]: 10 },
    contabilium: { [SKU_2V]: 10 },
    extra: { destinos: { [SKU_2V]: V1.inventoryItemId } },
  });
}

test("corrida 1: nace el pendiente {8, 13, desde 5/5} y la mutacion de V2 falla", async () => {
  await conDirTemporal(async (dir) => {
    sembrarCorrida1(dir);
    const nodos = [nodoExacto(V1, SKU_2V, 5), nodoExacto(V2, SKU_2V, 5)];
    const tienda = tiendaUniversal(nodos);
    tienda.setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      tienda.escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      if (inventoryItemId === V2.inventoryItemId) throw new Error("rechazada");
    };
    const stock = new Map([[SKU_2V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.error, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V1.inventoryItemId, 8, 5],
        [V2.inventoryItemId, 8, 5],
      ]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes[SKU_2V], {
      nuevoValor: 8,
      contabiliumObjetivo: 13,
      variantes: [
        { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 5 },
        { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 5 },
      ],
    });
    assert.equal(libreta.contabilium[SKU_2V], 10);
    assert.equal(libreta.skus[SKU_2V], 10);
    assert.equal(libreta.escritos?.[SKU_2V], undefined);
  });
});

function sembrarS1(dir) {
  // Lo que dejo la corrida 1: pendiente {8, 13, desde 5/5}, baseline 10, skus 10, escrito 5.
  sembrarLibreta(dir, "dot", {
    skus: { [SKU_2V]: 10 },
    contabilium: { [SKU_2V]: 10 },
    extra: {
      destinos: { [SKU_2V]: V1.inventoryItemId },
      pendientes: {
        [SKU_2V]: {
          nuevoValor: 8,
          contabiliumObjetivo: 13,
          variantes: [
            { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 5 },
            { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 5 },
          ],
        },
      },
      escritos: { [SKU_2V]: 5 },
    },
  });
}

test("corrida 2: Contabilium ya en 15, el pendiente se cierra con contabiliumObjetivo (13), no con 15", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS1(dir);
    const nodos = [nodoExacto(V1, SKU_2V, 8), nodoExacto(V2, SKU_2V, 5)];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_2V, 15]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.equal(res.error, 0);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V2.inventoryItemId, 8, 5]]
    );
    assert.ok(!tienda.escrituras.some((e) => e.quantity === 10 || e.quantity === 13), "nunca el absoluto 10 ni 13");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_2V], 13, "contabiliumObjetivo, no el 15 de esta corrida");
    assert.equal(libreta.skus[SKU_2V], 13);
    assert.equal(libreta.escritos?.[SKU_2V], 8);
  });
});

test("corrida 3: Contabilium sigue en 15, el cambio que esperaba se aplica como delta normal (+2)", async () => {
  await conDirTemporal(async (dir) => {
    // Lo que dejo la corrida 2: sin pendiente, baseline 13, skus 13, escrito 8.
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 13 },
      contabilium: { [SKU_2V]: 13 },
      extra: { destinos: { [SKU_2V]: V2.inventoryItemId }, escritos: { [SKU_2V]: 8 } },
    });
    const nodos = [nodoExacto(V1, SKU_2V, 8), nodoExacto(V2, SKU_2V, 8)];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_2V, 15]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V1.inventoryItemId, 10, 8],
        [V2.inventoryItemId, 10, 8],
      ]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_2V], 15);
    assert.equal(libreta.skus[SKU_2V], 15);
    assert.equal(libreta.escritos?.[SKU_2V], 10);
    assert.deepEqual(libreta.pendientes ?? {}, {});
  });
});

test("corrida 2': Contabilium baja a 11 durante el pendiente, se cierra con 13, nunca con 6", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS1(dir);
    const nodos = [nodoExacto(V1, SKU_2V, 8), nodoExacto(V2, SKU_2V, 5)];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_2V, 11]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V2.inventoryItemId, 8, 5]]
    );
    assert.ok(!tienda.escrituras.some((e) => e.quantity === 6), "nunca 8 + 11 - 13 = 6");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.contabilium[SKU_2V], 13);
    assert.equal(libreta.skus[SKU_2V], 13);
    assert.equal(libreta.escritos?.[SKU_2V], 8);
  });
});

test("corrida 3': Contabilium sigue en 11, delta -2 aplicado contra el baseline 13", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 13 },
      contabilium: { [SKU_2V]: 13 },
      extra: { destinos: { [SKU_2V]: V2.inventoryItemId }, escritos: { [SKU_2V]: 8 } },
    });
    const nodos = [nodoExacto(V1, SKU_2V, 8), nodoExacto(V2, SKU_2V, 8)];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_2V, 11]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V1.inventoryItemId, 6, 8],
        [V2.inventoryItemId, 6, 8],
      ]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_2V], 11);
    assert.equal(libreta.escritos?.[SKU_2V], 6);
  });
});
