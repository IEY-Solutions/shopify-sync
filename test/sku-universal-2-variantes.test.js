// CA-3 — SKU universal de 2 variantes (R-2, R-3, R-4, R-5, R-13, R-14).
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca3-dos-variantes.md
// (A, B, C, D, E, F, G).
//
// Corre con: node --test test/sku-universal-2-variantes.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { conDirTemporal, sembrarLibreta, leerLibretaCruda, PAR_DOT, capturarConsola } from "./_helpers-clasificador.js";
import { SKU_2V, VARIANTES_2V, nodoExacto, prefijoLargo } from "./_helpers-sku-universal.js";

const T = "2026-11-03T12:00:00.000Z";

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

const [V1, V2] = VARIANTES_2V;

test("CA-3 A: bootstrap iguales (5/5) con prefijo-largo y decimal de Contabilium (12.6 -> 8)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId } },
    });
    const nodos = [nodoExacto(V1, SKU_2V, 5), nodoExacto(V2, SKU_2V, 5), prefijoLargo(SKU_2V, 1, 2)];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_2V, 12.6]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.equal(res.error, 0);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]).sort(),
      [
        [V1.inventoryItemId, 8, 5],
        [V2.inventoryItemId, 8, 5],
      ].sort()
    );
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_2V], 12.6);
    assert.equal(libreta.skus[SKU_2V], 12.6);
    assert.equal(libreta.escritos?.[SKU_2V], 8);
    assert.deepEqual(libreta.pendientes ?? {}, {});
  });
});

test("CA-3 B: bootstrap divergente 5/0, nuevoValor 4", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId } },
    });
    const nodos = [nodoExacto(V1, SKU_2V, 5), nodoExacto(V2, SKU_2V, 0)];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_2V, 9]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]).sort(),
      [
        [V1.inventoryItemId, 4, 5],
        [V2.inventoryItemId, 4, 0],
      ].sort()
    );
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_2V], 9);
    assert.equal(libreta.escritos?.[SKU_2V], 4);
  });
});

test("CA-3 C: ventas individuales, escrito=6, respuesta 5/6, nuevoValor 4 nunca 5", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId }, escritos: { [SKU_2V]: 6 } },
    });
    const nodos = [nodoExacto(V1, SKU_2V, 5), nodoExacto(V2, SKU_2V, 6)];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_2V, 9]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.ok(tienda.escrituras.every((e) => e.quantity === 4), "nunca 5");
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.changeFromQuantity]).sort(),
      [
        [V1.inventoryItemId, 5],
        [V2.inventoryItemId, 6],
      ].sort()
    );
    assert.equal(leerLibretaCruda(dir, "dot").escritos?.[SKU_2V], 4);
  });
});

test("CA-3 D: piso 0 doble, Contabilium sin cambios (atajo bypaseado), escrito=1, respuesta 0/0 -> nuevoValor 0, sin mutaciones", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId }, escritos: { [SKU_2V]: 1 } },
    });
    const nodos = [nodoExacto(V1, SKU_2V, 0), nodoExacto(V2, SKU_2V, 0)];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_2V, 10]]); // igual a skus[sku]
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.saltado, 0, "bypass de R-14: hubo busqueda exacta, no se salteo por el atajo");
    assert.equal(res.sin_cambios, 1);
    assert.deepEqual(tienda.escrituras, []);
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.escritos?.[SKU_2V], 0);
    assert.equal(libreta.contabilium[SKU_2V], 10);
    assert.equal(libreta.skus[SKU_2V], 10);
    assert.deepEqual(libreta.pendientes ?? {}, {});
  });
});

test("CA-3 E: suba ignorada, escrito=5, respuesta 8/5 (V1 repuesta a mano), nuevoValor 5, solo V1 recibe mutacion", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId }, escritos: { [SKU_2V]: 5 } },
    });
    const nodos = [nodoExacto(V1, SKU_2V, 8), nodoExacto(V2, SKU_2V, 5)];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_2V, 10]]); // sin cambios
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.equal(tienda.escrituras.length, 1, "solo V1 recibe mutacion");
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V1.inventoryItemId, 5, 8]]
    );
    assert.ok(!tienda.escrituras.some((e) => e.quantity === 8 || e.changeFromQuantity === undefined));
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.escritos?.[SKU_2V], 5);
    assert.equal(libreta.contabilium[SKU_2V], 10);
    assert.deepEqual(libreta.pendientes ?? {}, {});
  });
});

test("R-7: conteo contra la cantidad esperada (2), no contra la cache/destinos conocidos", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId }, escritos: { [SKU_2V]: 5 } },
    });
    const nodos = [nodoExacto(V1, SKU_2V, 5)]; // falta V2
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_2V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.error, 1);
    assert.deepEqual(tienda.escrituras, []);
    assert.ok(lineas.some((l) => l.texto.startsWith(`  [ERROR] dot/${SKU_2V}:`)));
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_2V], 10, "baseline no avanza");
    assert.equal(libreta.escritos?.[SKU_2V], 5, "escrito no cambia");
  });
});

test("R-11 (T07): con una entrada pendiente ya existente, se reintenta el MISMO nuevoValor persistido", async () => {
  await conDirTemporal(async (dir) => {
    const pendienteExistente = {
      nuevoValor: 4,
      contabiliumObjetivo: 9,
      variantes: [
        { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 5 },
        { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 0 },
      ],
    };
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId }, pendientes: { [SKU_2V]: pendienteExistente } },
    });
    // Ambas variantes siguen en su `desde` (R-11 caso b): se reintenta el
    // mismo nuevoValor (4), nunca un delta ni un maximo (eso es T06/R-4).
    const nodos = [nodoExacto(V1, SKU_2V, 5), nodoExacto(V2, SKU_2V, 0)];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_2V, 9]]);
    const deps = depsCon({ dir, tienda, stock });

    await sync.ejecutarPar(PAR_DOT, deps);

    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]).sort(),
      [
        [V1.inventoryItemId, 4, 5],
        [V2.inventoryItemId, 4, 0],
      ].sort()
    );
    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {}, "el pendiente se cierra al reintentar con exito");
    assert.equal(libreta.contabilium[SKU_2V], 9, "el baseline avanza al contabiliumObjetivo persistido");
    assert.equal(libreta.escritos?.[SKU_2V], 4);
  });
});

// Par Galerias Pacifico de la seccion F (ids inventados, exclusivos del escenario).
const PAR_GALERIAS_F = {
  nombre: "galerias-pacifico",
  stateKey: "galerias-pacifico",
  depositoId: "7100001",
  locationId: "gid://shopify/Location/7100000001",
  pendiente: false,
};

test("CA-3 F: dos pares en la misma corrida, el par Galerias Pacifico escribe en SU location, nunca en la del DOT", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId }, escritos: { [SKU_2V]: 5 } },
    });
    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_2V]: 4 },
      contabilium: { [SKU_2V]: 4 },
      extra: { destinos: { [SKU_2V]: V1.inventoryItemId }, escritos: { [SKU_2V]: 2 } },
    });

    const nodosPorLocation = {
      [PAR_DOT.locationId]: [nodoExacto(V1, SKU_2V, 5), nodoExacto(V2, SKU_2V, 5)],
      [PAR_GALERIAS_F.locationId]: [nodoExacto(V1, SKU_2V, 2), nodoExacto(V2, SKU_2V, 1)],
    };
    const escrituras = [];
    const deps = {
      ...sync.DEPS_REALES,
      ahora: () => new Date(T),
      esDryRun: () => false,
      getStockDeposito: async (depositoId) => {
        if (depositoId === PAR_DOT.depositoId) return new Map([[SKU_2V, 10]]);
        if (depositoId === PAR_GALERIAS_F.depositoId) return new Map([[SKU_2V, 3]]);
        throw new Error(`depositoId inesperado: ${depositoId}`);
      },
      rutaSnapshotPara: (stateKey) => sync.rutaSnapshotPara(stateKey, dir),
      cargarRegistroComprobantes: () => ({ v: 1, ultimoRefrescoOk: T, diasCerrados: [], comprobantes: {} }),
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

    const { valor: porPar, lineas } = await capturarConsola(() => sync.correrTodosLosPares([PAR_DOT, PAR_GALERIAS_F], deps));

    // DOT: referencia 5, delta 0, nuevoValor 5. Ninguna mutacion.
    assert.equal(porPar.dot.actualizado, 0);
    assert.equal(porPar.dot.sin_cambios, 1);

    // Galerias: referencia 1, delta -1, nuevoValor 0. 2 mutaciones, SOLO en su location.
    assert.equal(porPar["galerias-pacifico"].actualizado, 1);

    assert.equal(escrituras.length, 2, "exactamente 2 mutaciones en toda la corrida");
    assert.ok(
      escrituras.every((e) => e.locationId === PAR_GALERIAS_F.locationId),
      "ninguna mutacion con el locationId del DOT"
    );
    assert.deepEqual(
      escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]).sort(),
      [
        [V1.inventoryItemId, 0, 2],
        [V2.inventoryItemId, 0, 1],
      ].sort()
    );

    const libretaDot = leerLibretaCruda(dir, "dot");
    assert.equal(libretaDot.escritos?.[SKU_2V], 5);
    assert.equal(libretaDot.contabilium[SKU_2V], 10);
    assert.deepEqual(libretaDot.pendientes ?? {}, {});

    const libretaGalerias = leerLibretaCruda(dir, "galerias-pacifico");
    assert.equal(libretaGalerias.contabilium[SKU_2V], 3);
    assert.equal(libretaGalerias.escritos?.[SKU_2V], 0);
    assert.deepEqual(libretaGalerias.pendientes ?? {}, {});
    assert.equal(libretaGalerias.destinos?.[SKU_2V], V1.inventoryItemId);
    assert.equal(libretaDot.destinos?.[SKU_2V], V1.inventoryItemId);

    // Nota: el log `[UNIVERSAL]` (R-8) no esta implementado todavia (T09, ver
    // src/sync.js:1142); esta prueba se limita a las mutaciones y las libretas.
    void lineas;
  });
});

// Variantes de la seccion G: ids de distinta cantidad de digitos, exclusivas
// de este escenario, para que el orden numerico y el lexicografico den distinto.
const W1 = { variantId: "gid://shopify/ProductVariant/8031000", inventoryItemId: "gid://shopify/InventoryItem/1000000" };
const W2 = { variantId: "gid://shopify/ProductVariant/8031001", inventoryItemId: "gid://shopify/InventoryItem/999999" };

test("CA-3 G: destinos[sku] se fija al numero de gid mas chico (999999 < 1000000), no al string mas chico", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_2V]: 10 },
      contabilium: { [SKU_2V]: 10 },
      extra: { destinos: { [SKU_2V]: W2.inventoryItemId }, escritos: { [SKU_2V]: 5 } },
    });

    // G1: respuesta en el orden W1, W2 (999999 llega segunda, y es mas chica
    // como string la primera: "...1000000" < "...999999").
    const nodosG1 = [nodoExacto(W1, SKU_2V, 5), nodoExacto(W2, SKU_2V, 5)];
    const tienda1 = tiendaUniversal(nodosG1);
    const stock1 = new Map([[SKU_2V, 9]]);
    const deps1 = depsCon({ dir, tienda: tienda1, stock: stock1 });

    const res1 = await sync.ejecutarPar(PAR_DOT, deps1);

    assert.equal(res1.actualizado, 1);
    assert.deepEqual(
      tienda1.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]).sort(),
      [
        [W1.inventoryItemId, 4, 5],
        [W2.inventoryItemId, 4, 5],
      ].sort()
    );
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_2V], 9);
    assert.equal(libreta.escritos?.[SKU_2V], 4);
    assert.equal(
      libreta.destinos?.[SKU_2V],
      W2.inventoryItemId,
      "999999 es numericamente mas chico, nunca 1000000 pese a ser el primero de la respuesta y el mas chico como string"
    );

    // G2: misma libreta, respuesta en el orden W2, W1, ambas ya en 4, sin cambios.
    const nodosG2 = [nodoExacto(W2, SKU_2V, 4), nodoExacto(W1, SKU_2V, 4)];
    const tienda2 = tiendaUniversal(nodosG2);
    const stock2 = new Map([[SKU_2V, 9]]);
    const deps2 = depsCon({ dir, tienda: tienda2, stock: stock2 });

    const { valor: res2, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps2));

    assert.deepEqual(tienda2.escrituras, [], "sin cambios: ninguna mutacion");
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")), "ninguna linea [UNIVERSAL]");
    assert.equal(res2.sin_cambios, 1);

    libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.destinos?.[SKU_2V], W2.inventoryItemId, "sigue en 999999");
    assert.equal(libreta.resembradoPor?.[SKU_2V], undefined, "resembradoPor no se escribe");
  });
});
