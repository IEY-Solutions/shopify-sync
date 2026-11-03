// CA-9 — `escrito`, ventas individuales y bypass del atajo (R-4, R-13, R-14;
// y R-10 en los cierres).
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca9-ventas-individuales.md
// (cadena 1 -> 5, pasos sueltos 2b, 6, 7, 8, 9).
//
// Corre con: node --test test/sku-universal-ventas-individuales.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { conDirTemporal, sembrarLibreta, leerLibretaCruda, PAR_DOT, capturarConsola } from "./_helpers-clasificador.js";
import { SKU_5V, VARIANTES_5V, nodoExacto, nodoUniversal } from "./_helpers-sku-universal.js";

const T = "2026-11-03T12:00:00.000Z";
const [V1, V2, V3, V4, V5] = VARIANTES_5V;

// SKU de control fuera de la lista (AGENTS.md, ids inventados de la evidencia).
const SKU_CONTROL = "FUNDA-MAGSAFE-MATE-IPHONE16";
const CONTROL = {
  variantId: "gid://shopify/ProductVariant/8090001",
  inventoryItemId: "gid://shopify/InventoryItem/9090001",
};

function tiendaUniversal(nodos) {
  const t = {
    nodos,
    escrituras: [],
    consultas: [],
    async consultar(_query, variables) {
      t.consultas.push(variables);
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

function depsCon({ dir, tienda, stock, dry = false, t = T }) {
  return {
    ...sync.DEPS_REALES,
    ahora: () => new Date(t),
    esDryRun: () => dry,
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

function nodosUniversal(availables) {
  return VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
}

function nodoControl() {
  return nodoUniversal({ variantId: CONTROL.variantId, inventoryItemId: CONTROL.inventoryItemId, sku: SKU_CONTROL, available: 3 });
}

function sembrarBase(dir, extra) {
  sembrarLibreta(dir, "dot", {
    skus: { [SKU_5V]: 10, [SKU_CONTROL]: 3 },
    contabilium: { [SKU_5V]: 10, [SKU_CONTROL]: 3 },
    extra: {
      destinos: { [SKU_5V]: V1.inventoryItemId, [SKU_CONTROL]: CONTROL.inventoryItemId },
      ...extra,
    },
  });
}

test("paso 1: bootstrap sin escrito -> camino (b), nuevoValor 7, 4 mutaciones, escrito 7", async () => {
  await conDirTemporal(async (dir) => {
    sembrarBase(dir);
    const nodos = [...nodosUniversal([7, 0, 0, 0, 0]), nodoControl()];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([
      [SKU_5V, 10],
      [SKU_CONTROL, 3],
    ]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.equal(res.saltado, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V2.inventoryItemId, 7, 0],
        [V3.inventoryItemId, 7, 0],
        [V4.inventoryItemId, 7, 0],
        [V5.inventoryItemId, 7, 0],
      ]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.equal(libreta.skus[SKU_5V], 10);
    assert.equal(libreta.escritos?.[SKU_5V], 7);
    assert.deepEqual(libreta.pendientes ?? {}, {});
  });
});

function sembrarPaso1(dir) {
  sembrarBase(dir, { escritos: { [SKU_5V]: 7 } });
}

test("paso 2: venta online sin cambio en Contabilium -> hay busqueda (R-14), delta 0, escrito 6", async () => {
  await conDirTemporal(async (dir) => {
    sembrarPaso1(dir);
    const nodos = [...nodosUniversal([7, 6, 7, 7, 7]), nodoControl()];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([
      [SKU_5V, 10],
      [SKU_CONTROL, 3],
    ]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.saltado, 1, "solo el control se saltea");
    assert.equal(tienda.consultas.length, 1, "una sola busqueda, la del universal");
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V1.inventoryItemId, 6, 7],
        [V3.inventoryItemId, 6, 7],
        [V4.inventoryItemId, 6, 7],
        [V5.inventoryItemId, 6, 7],
      ]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 10, "no se mueve");
    assert.equal(libreta.skus[SKU_5V], 10);
    assert.equal(libreta.escritos?.[SKU_5V], 6);
    assert.deepEqual(libreta.pendientes ?? {}, {});
  });
});

function sembrarPaso2(dir) {
  sembrarBase(dir, { escritos: { [SKU_5V]: 6 } });
}

test("paso 3: sin cambios -> cero mutaciones, escrito y contabilium intactos, sin_cambios suma", async () => {
  await conDirTemporal(async (dir) => {
    sembrarPaso2(dir);
    const nodos = [...nodosUniversal([6, 6, 6, 6, 6]), nodoControl()];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([
      [SKU_5V, 10],
      [SKU_CONTROL, 3],
    ]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.sin_cambios, 2, "universal + control");
    assert.equal(res.saltado, 1, "solo el control");
    assert.deepEqual(tienda.escrituras, []);

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.escritos?.[SKU_5V], 6);
    assert.equal(libreta.contabilium[SKU_5V], 10);
    assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId, "sin mutaciones, el destino no se toca");
  });
});

test("paso 4: ventas individuales despues del bypass -> referencia 5, delta -1, nuevoValor 4", async () => {
  await conDirTemporal(async (dir) => {
    sembrarPaso2(dir);
    const nodos = [...nodosUniversal([6, 6, 5, 6, 6]), nodoControl()];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([
      [SKU_5V, 9],
      [SKU_CONTROL, 3],
    ]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V1.inventoryItemId, 4, 6],
        [V2.inventoryItemId, 4, 6],
        [V3.inventoryItemId, 4, 5],
        [V4.inventoryItemId, 4, 6],
        [V5.inventoryItemId, 4, 6],
      ]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 9);
    assert.equal(libreta.skus[SKU_5V], 9);
    assert.equal(libreta.escritos?.[SKU_5V], 4);
  });
});

test("paso 5: el control fuera de la lista nunca tiene busqueda ni mutacion mientras Contabilium no cambia", async () => {
  await conDirTemporal(async (dir) => {
    sembrarPaso1(dir);
    const nodos = [...nodosUniversal([7, 6, 7, 7, 7]), nodoControl()];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([
      [SKU_5V, 10],
      [SKU_CONTROL, 3],
    ]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.saltado, 1);
    assert.equal(res.sin_cambios, 1, "el control cuenta sin_cambios tambien (CA-1)");
    assert.equal(tienda.consultas.length, 1, "la unica busqueda es la del universal");
    assert.ok(!tienda.escrituras.some((e) => e.inventoryItemId === CONTROL.inventoryItemId));

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.escritos?.[SKU_CONTROL], undefined);
    assert.equal(libreta.pendientes?.[SKU_CONTROL], undefined);
  });
});

test("paso 2b: suba y venta en la misma corrida, delta 0, V1 repuesta a mano no consume referencia", async () => {
  await conDirTemporal(async (dir) => {
    sembrarPaso1(dir);
    const nodos = [...nodosUniversal([8, 6, 7, 7, 7]), nodoControl()];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([
      [SKU_5V, 10],
      [SKU_CONTROL, 3],
    ]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V1.inventoryItemId, 6, 8],
        [V3.inventoryItemId, 6, 7],
        [V4.inventoryItemId, 6, 7],
        [V5.inventoryItemId, 6, 7],
      ]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.escritos?.[SKU_5V], 6);
  });
});

test("paso 6: el cierre de un pendiente deja escrito (R-13, R-10)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarBase(dir, {
      escritos: { [SKU_5V]: 5 },
      pendientes: {
        [SKU_5V]: {
          nuevoValor: 8,
          contabiliumObjetivo: 13,
          variantes: VARIANTES_5V.map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
        },
      },
    });
    const nodos = [...nodosUniversal([8, 8, 8, 8, 5]), nodoControl()];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([
      [SKU_5V, 13],
      [SKU_CONTROL, 3],
    ]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V5.inventoryItemId, 8, 5]]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {});
    assert.equal(libreta.escritos?.[SKU_5V], 8);
    assert.equal(libreta.contabilium[SKU_5V], 13);
    assert.equal(libreta.skus[SKU_5V], 13);
  });
});

test("paso 7: un fallo parcial no toca escrito (R-13)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarPaso2(dir);
    const nodos = [...nodosUniversal([6, 6, 6, 6, 6]), nodoControl()];
    const tienda = tiendaUniversal(nodos);
    tienda.setearStock = async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      tienda.escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      if (inventoryItemId === V5.inventoryItemId) throw new Error("rechazada");
    };
    const stock = new Map([
      [SKU_5V, 9],
      [SKU_CONTROL, 3],
    ]);
    const deps = depsCon({ dir, tienda, stock });

    const { valor: res } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.error, 1);

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.escritos?.[SKU_5V], 6, "sin cambios");
    assert.deepEqual(libreta.pendientes[SKU_5V], {
      nuevoValor: 5,
      contabiliumObjetivo: 9,
      variantes: VARIANTES_5V.map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 6 })),
    });
    assert.equal(libreta.contabilium[SKU_5V], 10, "baseline no avanza, sigue en lo que dejo el paso 2");
  });
});

for (const [etiqueta, escritoInvalido] of [
  ["8a", -3],
  ["8b", 2.5],
]) {
  test(`paso ${etiqueta}: escrito mal formado (${escritoInvalido}) se descarta, usa bootstrap, [ERROR] y el resto de la libreta no se invalida`, async () => {
    await conDirTemporal(async (dir) => {
      sembrarBase(dir, { escritos: { [SKU_5V]: escritoInvalido } });
      const nodos = [...nodosUniversal([6, 6, 5, 6, 6]), nodoControl()];
      const tienda = tiendaUniversal(nodos);
      const stock = new Map([
        [SKU_5V, 9],
        [SKU_CONTROL, 3],
      ]);
      const deps = depsCon({ dir, tienda, stock });

      const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

      assert.ok(
        lineas.some((l) => l.texto === `[ERROR] ${PAR_DOT.nombre}/${SKU_5V}: escrito mal formado, se descarta`),
        "R-8: el [ERROR] del escrito mal formado lleva el prefijo <par>/<sku> (formato fijado por T05)"
      );
      assert.equal(res.actualizado, 1);
      assert.deepEqual(
        tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
        [
          [V1.inventoryItemId, 5, 6],
          [V2.inventoryItemId, 5, 6],
          [V4.inventoryItemId, 5, 6],
          [V5.inventoryItemId, 5, 6],
        ]
      );

      const libreta = leerLibretaCruda(dir, "dot");
      assert.equal(libreta.escritos?.[SKU_5V], 5);
      assert.equal(libreta.contabilium[SKU_5V], 9);
      assert.equal(libreta.skus?.[SKU_CONTROL], 3, "el control conserva su baseline, el resto de la libreta no se invalida");
    });
  });
}

test("paso 9: DRY_RUN no persiste escrito ni muta nada", async () => {
  await conDirTemporal(async (dir) => {
    sembrarPaso2(dir);
    const nodos = [...nodosUniversal([6, 6, 5, 6, 6]), nodoControl()];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([
      [SKU_5V, 9],
      [SKU_CONTROL, 3],
    ]);
    const deps = depsCon({ dir, tienda, stock, dry: true });

    await sync.ejecutarPar(PAR_DOT, deps);

    assert.deepEqual(tienda.escrituras, []);
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.escritos?.[SKU_5V], 6, "sigue en lo que tenia antes");
    assert.equal(libreta.contabilium[SKU_5V], 10);
  });
});
