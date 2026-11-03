// CA-2 — SKU universal de 5 variantes (R-2, R-3, R-4, R-5, R-7, R-9, R-13, R-14).
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca2-cinco-variantes.md
// (A, A', B, C, D, D2, E, F1-F4, I, I'). La linea `[UNIVERSAL]` y las claves del
// `[RESUMEN]` son de T09 (tasks/T06-camino-universal-ejecutarpar.md): este
// archivo no las exige.
//
// Corre con: node --test test/sku-universal-5-variantes.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { conDirTemporal, sembrarLibreta, leerLibretaCruda, PAR_DOT, capturarConsola } from "./_helpers-clasificador.js";
import { SKU_5V, VARIANTES_5V, VARIANTE_5V_EXTRA, nodoExacto, prefijoLargo } from "./_helpers-sku-universal.js";

const T = "2026-11-03T12:00:00.000Z";

// Tienda minima solo para este camino: responde la busqueda exacta con los
// nodos dados; registra las escrituras; soporta DEPS_REALES encaje.
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

const [V1, V2, V3, V4, V5] = VARIANTES_5V;

test("CA-2 A: bootstrap, iguales (5/5/5/5/5) con un prefijo-largo, nunca toca P1 ni siembra, destino al mas chico", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId } },
    });
    const nodos = [
      nodoExacto(V1, SKU_5V, 5),
      nodoExacto(V2, SKU_5V, 5),
      nodoExacto(V3, SKU_5V, 5),
      nodoExacto(V4, SKU_5V, 5),
      nodoExacto(V5, SKU_5V, 5),
      prefijoLargo(SKU_5V, 1),
    ];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.equal(res.error, 0);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]).sort(),
      [
        [V1.inventoryItemId, 8, 5],
        [V2.inventoryItemId, 8, 5],
        [V3.inventoryItemId, 8, 5],
        [V4.inventoryItemId, 8, 5],
        [V5.inventoryItemId, 8, 5],
      ].sort()
    );
    assert.ok(!tienda.escrituras.some((e) => e.inventoryItemId.includes("901990")), "nunca escribe en P1");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 13);
    assert.equal(libreta.skus[SKU_5V], 13);
    assert.equal(libreta.escritos?.[SKU_5V], 8);
    assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId, "el mas chico de las 5");
    assert.deepEqual(libreta.pendientes ?? {}, {}, "sin pendiente al final");
    assert.equal(libreta.resembradoPor?.[SKU_5V], undefined, "no hay siembra");
  });
});

test("CA-2 A': camino normal con escrito=5 da el mismo resultado que A", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, escritos: { [SKU_5V]: 5 } },
    });
    const nodos = [1, 2, 3, 4, 5].map((_, i) => nodoExacto(VARIANTES_5V[i], SKU_5V, 5));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.equal(leerLibretaCruda(dir, "dot").escritos?.[SKU_5V], 8);
  });
});

test("CA-2 B: bootstrap divergente 7/0/0/0/0 (caso real), nuevoValor 6, changeFromQuantity por variante", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId } },
    });
    const availables = [7, 0, 0, 0, 0];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 9]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]).sort(),
      [
        [V1.inventoryItemId, 6, 7],
        [V2.inventoryItemId, 6, 0],
        [V3.inventoryItemId, 6, 0],
        [V4.inventoryItemId, 6, 0],
        [V5.inventoryItemId, 6, 0],
      ].sort()
    );
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 9);
    assert.equal(libreta.escritos?.[SKU_5V], 6);
  });
});

test("CA-2 C: siembra con contabilium decimal (8.6), escribe entero 9, resembradoPor=sembrado", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: {}, contabilium: {} });
    const availables = [7, 0, 0, 0, 0];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 8.6]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.ok(tienda.escrituras.every((e) => e.quantity === 9), "todas en 9, entero; nunca 8.6 ni 8");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 8.6);
    assert.equal(libreta.skus[SKU_5V], 8.6);
    assert.equal(libreta.escritos?.[SKU_5V], 9);
    assert.equal(libreta.resembradoPor?.[SKU_5V], "sembrado");
  });
});

test("CA-2 D: ventas individuales, una venta online en V4 (4/5/5/5/5 -> ref IP14 en 1a posicion de la tabla), nuevoValor 3 nunca 4", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, escritos: { [SKU_5V]: 5 } },
    });
    const availables = [5, 5, 5, 4, 5]; // V4 vendida online
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 9]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.ok(tienda.escrituras.every((e) => e.quantity === 3), "nunca 4, que re-inflaria la venta online");
    assert.deepEqual(
      tienda.escrituras.map((e) => e.changeFromQuantity).sort((a, b) => a - b),
      [4, 5, 5, 5, 5]
    );
    assert.equal(leerLibretaCruda(dir, "dot").escritos?.[SKU_5V], 3);
  });
});

test("CA-2 D2: dos ventas online en variantes distintas (4/4/5/5/5), nuevoValor 2", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, escritos: { [SKU_5V]: 5 } },
    });
    const availables = [4, 4, 5, 5, 5];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 9]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.ok(tienda.escrituras.every((e) => e.quantity === 2));
    assert.equal(leerLibretaCruda(dir, "dot").escritos?.[SKU_5V], 2);
  });
});

test("CA-2 E: una de las 5 mutaciones falla (V3): pendiente intacto, baseline/destino/escrito SIN avanzar, error", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId } },
    });
    const nodos = VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5));
    const tienda = tiendaUniversal(nodos);
    const real = tienda.setearStock;
    tienda.setearStock = async (inventoryItemId, ...resto) => {
      if (inventoryItemId === V3.inventoryItemId) throw new Error("rechazado por Shopify (simulado)");
      return real(inventoryItemId, ...resto);
    };
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.error, 1);
    assert.equal(res.actualizado, 0);
    const errores = lineas.filter((l) => l.texto.startsWith(`  [ERROR] dot/${SKU_5V}:`));
    assert.equal(errores.length, 1);

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 10, "baseline no avanza");
    assert.equal(libreta.skus[SKU_5V], 10);
    assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId, "destino sin cambios");
    assert.equal(libreta.escritos?.[SKU_5V], undefined, "escrito no avanza");
    assert.ok(libreta.pendientes?.[SKU_5V], "la entrada pendiente queda");
    assert.equal(libreta.pendientes[SKU_5V].nuevoValor, 8);
    assert.equal(libreta.pendientes[SKU_5V].contabiliumObjetivo, 13);
    assert.equal(libreta.pendientes[SKU_5V].variantes.length, 5);

    // Las que si tuvieron exito NO se revierten.
    assert.deepEqual(tienda.escrituras.filter((e) => e.quantity === 8).map((e) => e.inventoryItemId).sort(), [
      V1.inventoryItemId,
      V2.inventoryItemId,
      V4.inventoryItemId,
      V5.inventoryItemId,
    ].sort());
  });
});

// F: conteo contra la cantidad ESPERADA (5), no contra la cache/destinos.
async function correrF({ dir, nodos, hasNextPage = false }) {
  sembrarLibreta(dir, "dot", {
    skus: { [SKU_5V]: 10 },
    contabilium: { [SKU_5V]: 10 },
    extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, escritos: { [SKU_5V]: 5 } },
  });
  const tienda = tiendaUniversal(nodos, { hasNextPage });
  const stock = new Map([[SKU_5V, 13]]);
  const deps = depsCon({ dir, tienda, stock });
  const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));
  return { res, lineas, tienda };
}

test("CA-2 F1: tope alcanzado con 3 de 5 exactas -> error, cero mutaciones", async () => {
  await conDirTemporal(async (dir) => {
    const nodos = [nodoExacto(V1, SKU_5V, 5), nodoExacto(V2, SKU_5V, 5), nodoExacto(V3, SKU_5V, 5), ...Array.from({ length: 7 }, (_, i) => prefijoLargo(SKU_5V, i + 1))];
    const { res, lineas, tienda } = await correrF({ dir, nodos, hasNextPage: true });
    assert.equal(res.error, 1);
    assert.deepEqual(tienda.escrituras, []);
    assert.ok(lineas.some((l) => l.texto.startsWith(`  [ERROR] dot/${SKU_5V}:`)));
    assert.deepEqual(leerLibretaCruda(dir, "dot").pendientes ?? {}, {});
  });
});

test("CA-2 F2: tope alcanzado pero con las 5 exactas -> no es error, se procesa normal", async () => {
  await conDirTemporal(async (dir) => {
    const nodos = [...VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5)), ...Array.from({ length: 5 }, (_, i) => prefijoLargo(SKU_5V, i + 1))];
    const { res, tienda } = await correrF({ dir, nodos, hasNextPage: true });
    assert.equal(res.error, 0);
    assert.equal(res.actualizado, 1);
    assert.equal(tienda.escrituras.length, 5);
    assert.ok(tienda.escrituras.every((e) => e.quantity === 8));
  });
});

test("CA-2 F3: sin tope, 4 de 5 exactas (falta V5) -> error, no escribe 8 en V1-V4", async () => {
  await conDirTemporal(async (dir) => {
    const nodos = [V1, V2, V3, V4].map((v) => nodoExacto(v, SKU_5V, 5));
    const { res, tienda } = await correrF({ dir, nodos, hasNextPage: false });
    assert.equal(res.error, 1);
    assert.deepEqual(tienda.escrituras, []);
  });
});

test("CA-2 F4: sin tope, 6 de 5 exactas (sobra V6) -> error, no escribe 8 en ninguna de las 6", async () => {
  await conDirTemporal(async (dir) => {
    const nodos = [...VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 5)), nodoExacto(VARIANTE_5V_EXTRA, SKU_5V, 5)];
    const { res, tienda } = await correrF({ dir, nodos, hasNextPage: false });
    assert.equal(res.error, 1);
    assert.deepEqual(tienda.escrituras, []);
  });
});

test("CA-2 I: destino heredado (V4, no el mas chico) se actualiza sin siembra; escribe el delta -1, nunca el absoluto 9", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V4.inventoryItemId }, escritos: { [SKU_5V]: 5 } },
    });
    const nodos = [V4, V1, V2, V3, V5].map((v) => nodoExacto(v, SKU_5V, 5));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 9]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.equal(res.error, 0);
    assert.ok(tienda.escrituras.every((e) => e.quantity === 4), "nunca 9 (el absoluto que escribiria un cambioDeDestino)");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId, "el mas chico, distinto del heredado V4");
    assert.equal(libreta.escritos?.[SKU_5V], 4);
    assert.equal(libreta.resembradoPor?.[SKU_5V], undefined, "ninguna siembra");
    assert.equal(libreta.resembradoEn?.[SKU_5V], undefined);
  });
});

test("CA-2 I': igual que I pero sin escrito guardado (primera corrida tras desplegar): mismo resultado via bootstrap", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V4.inventoryItemId } },
    });
    const nodos = [V4, V1, V2, V3, V5].map((v) => nodoExacto(v, SKU_5V, 5));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 9]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.ok(tienda.escrituras.every((e) => e.quantity === 4));
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId);
    assert.equal(libreta.escritos?.[SKU_5V], 4);
    assert.equal(libreta.resembradoPor?.[SKU_5V], undefined);
  });
});

test("R-14: el bypass del atajo resuelve el curado aunque Contabilium no cambio, incluso en --full", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 13 },
      contabilium: { [SKU_5V]: 13 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId }, escritos: { [SKU_5V]: 8 } },
    });
    const nodos = VARIANTES_5V.map((v) => nodoExacto(v, SKU_5V, 8)); // sin cambios
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]); // Contabilium sin cambios
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.saltado, 0, "el atajo no aplica a un curado");
    assert.equal(res.sin_cambios, 1, "las 5 ya estaban en nuevoValor");
    assert.deepEqual(tienda.escrituras, []);
    assert.equal(leerLibretaCruda(dir, "dot").escritos?.[SKU_5V], 8);
  });
});
