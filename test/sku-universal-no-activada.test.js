// CA-13 — Variante universal no activada en la location del par (R-18, los
// dos casos: (a) todas null benigno, (b) algunas null error). Compuerta
// (A-3.2) fuera de alcance: eso es T12.
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca13-no-activada.md
// SKU: APPLYFIT-CLEAR-IP16PM-17PM (SKU_NO_ACTIVADA), V1/V2 de
// _helpers-sku-universal.js, par Galerias Pacifico (ids inventados del README).
//
// Corre con: node --test test/sku-universal-no-activada.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { evaluarCorrida, evaluarCorridaMultiPar } from "../src/resultado.js";
import { conDirTemporal, sembrarLibreta, leerLibretaCruda, PAR_DOT, capturarConsola } from "./_helpers-clasificador.js";
import { SKU_NO_ACTIVADA, VARIANTES_NO_ACTIVADA, nodoExacto } from "./_helpers-sku-universal.js";

const T = "2026-11-03T12:00:00.000Z";
const [V1, V2] = VARIANTES_NO_ACTIVADA;

// Par Galerias Pacifico con los datos inventados del README de la carpeta.
const PAR_GALERIAS = {
  nombre: "galerias-pacifico",
  stateKey: "galerias-pacifico",
  depositoId: "7100001",
  locationId: "gid://shopify/Location/7100000001",
  pendiente: false,
};

const L18_V2 = `  [ERROR] galerias-pacifico/${SKU_NO_ACTIVADA}: variante ${V2.variantId} no esta activada en la location del par, no se resuelve`;
const L18_V1 = `  [ERROR] galerias-pacifico/${SKU_NO_ACTIVADA}: variante ${V1.variantId} no esta activada en la location del par, no se resuelve`;

function tiendaUniversal(availables) {
  const nodos = [V1, V2].map((v, i) => nodoExacto(v, SKU_NO_ACTIVADA, availables[i]));
  const t = {
    escrituras: [],
    async consultar() {
      return { productVariants: { edges: nodos.map((n) => ({ node: n })), pageInfo: { hasNextPage: false } } };
    },
    async setearStock(inventoryItemId, quantity, changeFromQuantity, locationId) {
      t.escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    },
  };
  return t;
}

function depsCon({ dir, tienda, stock, t = T, dryRun = false }) {
  return {
    ...sync.DEPS_REALES,
    ahora: () => new Date(t),
    esDryRun: () => dryRun,
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

function asserComunB(res, lineas, libretaAntes, libretaDespues) {
  assert.equal(res.error, 1);
  assert.equal(res.no_activado, 0);
  assert.equal(res.actualizado, 0);
  assert.equal(res.universales, 0);
  assert.equal(res.universales_pendientes, 0);
  const l18 = lineas.filter((l) => l.texto === L18_V2);
  assert.equal(l18.length, 1, "L18 exactamente una vez");
  assert.ok(!lineas.some((l) => l.texto === L18_V1), "nunca L18 para la variante activada");
  assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));
  assert.ok(!lineas.some((l) => l.texto.includes("el item no esta activado en esa location")));
  assert.deepEqual(libretaDespues.contabilium?.[SKU_NO_ACTIVADA], libretaAntes.contabilium?.[SKU_NO_ACTIVADA]);
  assert.deepEqual(libretaDespues.skus?.[SKU_NO_ACTIVADA], libretaAntes.skus?.[SKU_NO_ACTIVADA]);
  assert.deepEqual(libretaDespues.destinos?.[SKU_NO_ACTIVADA], libretaAntes.destinos?.[SKU_NO_ACTIVADA]);
  assert.deepEqual(libretaDespues.escritos?.[SKU_NO_ACTIVADA], libretaAntes.escritos?.[SKU_NO_ACTIVADA]);
}

// ---------------------------------------------------------------- Caso (b)

test("B-1: siembra, baseline ausente, V1=5/V2=null -> error, cero mutaciones, baseline sigue ausente", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "galerias-pacifico", { skus: {}, contabilium: {} });
    const tienda = tiendaUniversal([5, null]);
    const stock = new Map([[SKU_NO_ACTIVADA, 3]]);
    const deps = depsCon({ dir, tienda, stock });
    const libretaAntes = leerLibretaCruda(dir, "galerias-pacifico");

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_GALERIAS, deps));

    assert.deepEqual(tienda.escrituras, []);
    const libretaDespues = leerLibretaCruda(dir, "galerias-pacifico");
    asserComunB(res, lineas, libretaAntes, libretaDespues);
    assert.equal(libretaDespues.contabilium?.[SKU_NO_ACTIVADA], undefined);
  });
});

test("B-2: bootstrap, baseline 4 sin escrito, V1=5/V2=null -> error, cero mutaciones", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: { destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId } },
    });
    const tienda = tiendaUniversal([5, null]);
    const stock = new Map([[SKU_NO_ACTIVADA, 3]]);
    const deps = depsCon({ dir, tienda, stock });
    const libretaAntes = leerLibretaCruda(dir, "galerias-pacifico");

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_GALERIAS, deps));

    assert.deepEqual(tienda.escrituras, []);
    const libretaDespues = leerLibretaCruda(dir, "galerias-pacifico");
    asserComunB(res, lineas, libretaAntes, libretaDespues);
    assert.equal(libretaDespues.contabilium?.[SKU_NO_ACTIVADA], 4);
  });
});

test("B-3: camino normal, baseline 4, escrito 5, V1=5/V2=null -> error, cero mutaciones", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: { destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId }, escritos: { [SKU_NO_ACTIVADA]: 5 } },
    });
    const tienda = tiendaUniversal([5, null]);
    const stock = new Map([[SKU_NO_ACTIVADA, 3]]);
    const deps = depsCon({ dir, tienda, stock });
    const libretaAntes = leerLibretaCruda(dir, "galerias-pacifico");

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_GALERIAS, deps));

    assert.deepEqual(tienda.escrituras, []);
    const libretaDespues = leerLibretaCruda(dir, "galerias-pacifico");
    asserComunB(res, lineas, libretaAntes, libretaDespues);
    assert.equal(libretaDespues.escritos?.[SKU_NO_ACTIVADA], 5);
  });
});

test("B-4: DRY_RUN sobre el estado de B-3 -> cero mutaciones, cero guardar, error=1, dry=0", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: { destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId }, escritos: { [SKU_NO_ACTIVADA]: 5 } },
    });
    const tienda = tiendaUniversal([5, null]);
    const stock = new Map([[SKU_NO_ACTIVADA, 3]]);
    const deps = depsCon({ dir, tienda, stock, dryRun: true });
    const libretaAntes = leerLibretaCruda(dir, "galerias-pacifico");

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_GALERIAS, deps));

    assert.deepEqual(tienda.escrituras, []);
    assert.equal(res.dry, 0);
    const libretaDespues = leerLibretaCruda(dir, "galerias-pacifico");
    asserComunB(res, lineas, libretaAntes, libretaDespues);
    assert.ok(!lineas.some((l) => l.texto.includes("[DRY]")));
  });
});

test("B-5: entrada pendiente previa, V1=4 (ya en nuevoValor)/V2=null -> error, pendiente intacto", async () => {
  await conDirTemporal(async (dir) => {
    const pendienteExistente = {
      nuevoValor: 4,
      contabiliumObjetivo: 3,
      variantes: [
        { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 5 },
        { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 5 },
      ],
    };
    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: {
        destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId },
        escritos: { [SKU_NO_ACTIVADA]: 5 },
        pendientes: { [SKU_NO_ACTIVADA]: pendienteExistente },
      },
    });
    const tienda = tiendaUniversal([4, null]);
    const stock = new Map([[SKU_NO_ACTIVADA, 3]]);
    const deps = depsCon({ dir, tienda, stock });
    const libretaAntes = leerLibretaCruda(dir, "galerias-pacifico");

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_GALERIAS, deps));

    assert.deepEqual(tienda.escrituras, []);
    assert.ok(lineas.some((l) => l.texto === L18_V2));
    assert.ok(!lineas.some((l) => l.texto === L18_V1));
    const libretaDespues = leerLibretaCruda(dir, "galerias-pacifico");
    assert.deepEqual(libretaDespues.pendientes?.[SKU_NO_ACTIVADA], pendienteExistente, "la entrada pendiente no se toca");
    assert.equal(libretaDespues.contabilium?.[SKU_NO_ACTIVADA], 4);
    assert.equal(libretaDespues.escritos?.[SKU_NO_ACTIVADA], 5);
    assert.equal(libretaDespues.destinos?.[SKU_NO_ACTIVADA], V1.inventoryItemId);
    assert.equal(res.error, 1);
    assert.equal(res.universales, 0);
    assert.equal(res.universales_pendientes, 1);
    void libretaAntes;
  });
});

test("B-6: en el par DOT (todo activado) la misma corrida sigue camino (c), Galerias sigue en error", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: { destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId }, escritos: { [SKU_NO_ACTIVADA]: 5 } },
    });
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: { destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId }, escritos: { [SKU_NO_ACTIVADA]: 5 } },
    });

    const nodosPorLocation = {
      [PAR_GALERIAS.locationId]: [nodoExacto(V1, SKU_NO_ACTIVADA, 5), nodoExacto(V2, SKU_NO_ACTIVADA, null)],
      [PAR_DOT.locationId]: [nodoExacto(V1, SKU_NO_ACTIVADA, 5), nodoExacto(V2, SKU_NO_ACTIVADA, 5)],
    };
    const escrituras = [];
    const deps = {
      ...sync.DEPS_REALES,
      ahora: () => new Date(T),
      esDryRun: () => false,
      getStockDeposito: async (depositoId) => {
        if (depositoId === PAR_DOT.depositoId) return new Map([[SKU_NO_ACTIVADA, 3]]);
        if (depositoId === PAR_GALERIAS.depositoId) return new Map([[SKU_NO_ACTIVADA, 3]]);
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

    const { valor: porPar, lineas } = await capturarConsola(() => sync.correrTodosLosPares([PAR_DOT, PAR_GALERIAS], deps));

    assert.equal(porPar["galerias-pacifico"].error, 1);
    assert.ok(lineas.some((l) => l.texto === L18_V2));
    assert.ok(!escrituras.some((e) => e.locationId === PAR_GALERIAS.locationId), "ninguna mutacion en Galerias");

    assert.equal(porPar.dot.actualizado, 1);
    assert.ok(
      lineas.some(
        (l) => l.texto === `  [UNIVERSAL] dot/${SKU_NO_ACTIVADA}: 2 variantes -> 4 (escritas=2, ya_estaban=0)`
      )
    );
    assert.deepEqual(
      escrituras
        .filter((e) => e.locationId === PAR_DOT.locationId)
        .map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity])
        .sort(),
      [
        [V1.inventoryItemId, 4, 5],
        [V2.inventoryItemId, 4, 5],
      ].sort()
    );

    const libretaGalerias = leerLibretaCruda(dir, "galerias-pacifico");
    assert.equal(libretaGalerias.escritos?.[SKU_NO_ACTIVADA], 5, "Galerias no avanza: el caso (b) sigue error");
    const libretaDot = leerLibretaCruda(dir, "dot");
    assert.equal(libretaDot.contabilium?.[SKU_NO_ACTIVADA], 3);
    assert.equal(libretaDot.escritos?.[SKU_NO_ACTIVADA], 4);
  });
});

// ---------------------------------------------------------------- Caso (a)

function asserComunA(res, lineas, libretaAntes, libretaDespues) {
  assert.equal(res.error, 0);
  assert.equal(res.no_activado, 1);
  assert.equal(res.actualizado, 0);
  assert.equal(res.universales, 0);
  assert.ok(!lineas.some((l) => l.texto === L18_V1));
  assert.ok(!lineas.some((l) => l.texto === L18_V2));
  assert.ok(!lineas.some((l) => l.texto.startsWith("  [ERROR]") && l.texto.includes(SKU_NO_ACTIVADA)));
  assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));
  assert.deepEqual(libretaDespues.contabilium?.[SKU_NO_ACTIVADA], libretaAntes.contabilium?.[SKU_NO_ACTIVADA]);
  assert.deepEqual(libretaDespues.skus?.[SKU_NO_ACTIVADA], libretaAntes.skus?.[SKU_NO_ACTIVADA]);
  assert.deepEqual(libretaDespues.destinos?.[SKU_NO_ACTIVADA], libretaAntes.destinos?.[SKU_NO_ACTIVADA]);
  assert.deepEqual(libretaDespues.escritos?.[SKU_NO_ACTIVADA], libretaAntes.escritos?.[SKU_NO_ACTIVADA]);
}

test("A-1: camino (c), null/null -> no_activado benigno, sin error, libreta sin cambios, ok:false por corrida vacia", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: { destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId }, escritos: { [SKU_NO_ACTIVADA]: 5 } },
    });
    const tienda = tiendaUniversal([null, null]);
    const stock = new Map([[SKU_NO_ACTIVADA, 3]]);
    const deps = depsCon({ dir, tienda, stock });
    const libretaAntes = leerLibretaCruda(dir, "galerias-pacifico");

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_GALERIAS, deps));

    assert.deepEqual(tienda.escrituras, []);
    const libretaDespues = leerLibretaCruda(dir, "galerias-pacifico");
    asserComunA(res, lineas, libretaAntes, libretaDespues);
    const v = evaluarCorrida(res);
    assert.equal(v.ok, false);
    assert.match(v.motivo, /la corrida no sincronizo ni verifico ningun SKU de 1\./);
  });
});

test("A-2.1: baseline ausente, null/null -> no_activado benigno, baseline sigue ausente", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "galerias-pacifico", { skus: {}, contabilium: {} });
    const tienda = tiendaUniversal([null, null]);
    const stock = new Map([[SKU_NO_ACTIVADA, 3]]);
    const deps = depsCon({ dir, tienda, stock });
    const libretaAntes = leerLibretaCruda(dir, "galerias-pacifico");

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_GALERIAS, deps));

    assert.deepEqual(tienda.escrituras, []);
    const libretaDespues = leerLibretaCruda(dir, "galerias-pacifico");
    asserComunA(res, lineas, libretaAntes, libretaDespues);
    assert.equal(libretaDespues.contabilium?.[SKU_NO_ACTIVADA], undefined);
    const v = evaluarCorrida(res);
    assert.equal(v.ok, false);
  });
});

test("A-2.2: baseline 4 sin escrito, null/null -> no_activado benigno, libreta sin cambios", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: { destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId } },
    });
    const tienda = tiendaUniversal([null, null]);
    const stock = new Map([[SKU_NO_ACTIVADA, 3]]);
    const deps = depsCon({ dir, tienda, stock });
    const libretaAntes = leerLibretaCruda(dir, "galerias-pacifico");

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_GALERIAS, deps));

    assert.deepEqual(tienda.escrituras, []);
    const libretaDespues = leerLibretaCruda(dir, "galerias-pacifico");
    asserComunA(res, lineas, libretaAntes, libretaDespues);
    assert.equal(libretaDespues.contabilium?.[SKU_NO_ACTIVADA], 4);
  });
});

test("A-3.1: el universal en null/null en Galerias y un SKU de control S2 -> Galerias ok:true, DOT ok:true, sin tolerancia entre pares", async () => {
  await conDirTemporal(async (dir) => {
    const S2 = "FUNDA-MAGSAFE-MATE-IPHONE16";
    const S2_VARIANT = "gid://shopify/ProductVariant/8090001";
    const S2_ITEM = "gid://shopify/InventoryItem/9090001";

    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_NO_ACTIVADA]: 4, [S2]: 6 },
      contabilium: { [SKU_NO_ACTIVADA]: 4, [S2]: 6 },
      extra: { destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId, [S2]: S2_ITEM }, escritos: { [SKU_NO_ACTIVADA]: 5 } },
    });
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: { destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId }, escritos: { [SKU_NO_ACTIVADA]: 5 } },
    });

    const nodosPorLocation = {
      [PAR_GALERIAS.locationId]: [
        nodoExacto(V1, SKU_NO_ACTIVADA, null),
        nodoExacto(V2, SKU_NO_ACTIVADA, null),
      ],
      [PAR_DOT.locationId]: [nodoExacto(V1, SKU_NO_ACTIVADA, 5), nodoExacto(V2, SKU_NO_ACTIVADA, 5)],
    };
    const escrituras = [];
    const deps = {
      ...sync.DEPS_REALES,
      ahora: () => new Date(T),
      esDryRun: () => false,
      getStockDeposito: async (depositoId) => {
        if (depositoId === PAR_DOT.depositoId) return new Map([[SKU_NO_ACTIVADA, 3]]);
        if (depositoId === PAR_GALERIAS.depositoId) return new Map([[SKU_NO_ACTIVADA, 3], [S2, 6]]);
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
      // El atajo del incremental de S2 (no universal) busca directo por esta via.
      buscarVariantePorSku: async (sku) => {
        if (sku !== S2) throw new Error(`sku inesperado: ${sku}`);
        return { variantId: S2_VARIANT, inventoryItemId: S2_ITEM, available: 6 };
      },
      setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
        escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      },
    };

    const porPar = await sync.correrTodosLosPares([PAR_DOT, PAR_GALERIAS], deps);
    const v = evaluarCorridaMultiPar(porPar);

    assert.equal(porPar["galerias-pacifico"].no_activado, 1);
    assert.equal(porPar["galerias-pacifico"].error, 0);
    assert.equal(v.detalle["galerias-pacifico"].ok, true);
    assert.equal(v.detalle.dot.ok, true);
    assert.equal(v.ok, true);

    assert.ok(!escrituras.some((e) => e.locationId === PAR_GALERIAS.locationId));
  });
});

test("A-4: con pendiente previo, null/null -> no_activado benigno, pendiente intacto, universales_pendientes=1", async () => {
  await conDirTemporal(async (dir) => {
    const pendienteExistente = {
      nuevoValor: 4,
      contabiliumObjetivo: 3,
      variantes: [
        { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 5 },
        { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 5 },
      ],
    };
    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: {
        destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId },
        escritos: { [SKU_NO_ACTIVADA]: 5 },
        pendientes: { [SKU_NO_ACTIVADA]: pendienteExistente },
      },
    });
    const tienda = tiendaUniversal([null, null]);
    const stock = new Map([[SKU_NO_ACTIVADA, 3]]);
    const deps = depsCon({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_GALERIAS, deps));

    assert.deepEqual(tienda.escrituras, []);
    assert.ok(!lineas.some((l) => l.texto === L18_V1));
    assert.ok(!lineas.some((l) => l.texto === L18_V2));
    const libretaDespues = leerLibretaCruda(dir, "galerias-pacifico");
    assert.deepEqual(libretaDespues.pendientes?.[SKU_NO_ACTIVADA], pendienteExistente, "la entrada pendiente no se toca");
    assert.equal(libretaDespues.contabilium?.[SKU_NO_ACTIVADA], 4);
    assert.equal(libretaDespues.escritos?.[SKU_NO_ACTIVADA], 5);
    assert.equal(res.error, 0);
    assert.equal(res.no_activado, 1);
    assert.equal(res.universales, 0);
    assert.equal(res.universales_pendientes, 1);
  });
});

test("A-4': la corrida siguiente con las variantes reactivadas retoma el pendiente con sus propios valores", async () => {
  await conDirTemporal(async (dir) => {
    const pendienteExistente = {
      nuevoValor: 4,
      contabiliumObjetivo: 3,
      variantes: [
        { variantId: V1.variantId, inventoryItemId: V1.inventoryItemId, desde: 5 },
        { variantId: V2.variantId, inventoryItemId: V2.inventoryItemId, desde: 5 },
      ],
    };
    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: {
        destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId },
        escritos: { [SKU_NO_ACTIVADA]: 5 },
        pendientes: { [SKU_NO_ACTIVADA]: pendienteExistente },
      },
    });
    const tienda = tiendaUniversal([4, 5]);
    const stock = new Map([[SKU_NO_ACTIVADA, 3]]);
    const deps = depsCon({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_GALERIAS, deps));

    assert.deepEqual(tienda.escrituras, [
      { inventoryItemId: V2.inventoryItemId, quantity: 4, changeFromQuantity: 5, locationId: PAR_GALERIAS.locationId },
    ]);
    assert.ok(
      lineas.some(
        (l) =>
          l.texto ===
          `  [UNIVERSAL] galerias-pacifico/${SKU_NO_ACTIVADA}: 2 variantes -> 4 (escritas=1, ya_estaban=1) [reintento]`
      )
    );
    const libretaDespues = leerLibretaCruda(dir, "galerias-pacifico");
    assert.deepEqual(libretaDespues.pendientes ?? {}, {}, "el pendiente se cierra");
    assert.equal(libretaDespues.contabilium?.[SKU_NO_ACTIVADA], 3);
    assert.equal(libretaDespues.skus?.[SKU_NO_ACTIVADA], 3);
    assert.equal(libretaDespues.escritos?.[SKU_NO_ACTIVADA], 4);
    assert.equal(res.error, 0);
    assert.equal(res.no_activado, 0);
  });
});

// ---------------------------------------------------------------- A-3.2 (T12)
test("A-3.2: compuerta sobre el SKU -> aplicado en DOT, tolerado en Galerias (noActivados), sin [COMPUERTA][ERROR]", async () => {
  await conDirTemporal(async (dir) => {
    const S2 = "FUNDA-MAGSAFE-MATE-IPHONE16";
    const S2_VARIANT = "gid://shopify/ProductVariant/8090001";
    const S2_ITEM = "gid://shopify/InventoryItem/9090001";

    sembrarLibreta(dir, "galerias-pacifico", {
      skus: { [SKU_NO_ACTIVADA]: 4, [S2]: 6 },
      contabilium: { [SKU_NO_ACTIVADA]: 4, [S2]: 6 },
      extra: { destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId, [S2]: S2_ITEM }, escritos: { [SKU_NO_ACTIVADA]: 5 } },
    });
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_NO_ACTIVADA]: 4 },
      contabilium: { [SKU_NO_ACTIVADA]: 4 },
      extra: { destinos: { [SKU_NO_ACTIVADA]: V1.inventoryItemId }, escritos: { [SKU_NO_ACTIVADA]: 5 } },
    });

    const nodosPorLocation = {
      [PAR_GALERIAS.locationId]: [nodoExacto(V1, SKU_NO_ACTIVADA, null), nodoExacto(V2, SKU_NO_ACTIVADA, null)],
      [PAR_DOT.locationId]: [nodoExacto(V1, SKU_NO_ACTIVADA, 5), nodoExacto(V2, SKU_NO_ACTIVADA, 5)],
    };
    const escrituras = [];
    const deps = {
      ...sync.DEPS_REALES,
      ahora: () => new Date(T),
      esDryRun: () => false,
      getStockDeposito: async (depositoId) => {
        if (depositoId === PAR_DOT.depositoId) return new Map([[SKU_NO_ACTIVADA, 3]]);
        if (depositoId === PAR_GALERIAS.depositoId) return new Map([[SKU_NO_ACTIVADA, 3], [S2, 6]]);
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
      buscarVariantePorSku: async (sku) => {
        if (sku !== S2) throw new Error(`sku inesperado: ${sku}`);
        return { variantId: S2_VARIANT, inventoryItemId: S2_ITEM, available: 6 };
      },
      setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
        escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      },
    };

    const { valor: porPar, lineas } = await capturarConsola(() =>
      sync.correrTodosLosPares([PAR_DOT, PAR_GALERIAS], deps, { escrituraAbsoluta: new Set([SKU_NO_ACTIVADA]) })
    );
    const v = evaluarCorridaMultiPar(porPar, undefined, { escrituraAbsoluta: new Set([SKU_NO_ACTIVADA]) });

    assert.deepEqual(v.compuertaNoAplicados, []);
    assert.ok(!lineas.some((l) => l.texto.includes("[COMPUERTA][ERROR]")));
    assert.deepEqual(
      escrituras
        .filter((e) => e.locationId === PAR_DOT.locationId)
        .map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity])
        .sort(),
      [
        [V1.inventoryItemId, 3, 5],
        [V2.inventoryItemId, 3, 5],
      ].sort()
    );
    assert.ok(!escrituras.some((e) => e.locationId === PAR_GALERIAS.locationId));
    assert.deepEqual(porPar["galerias-pacifico"].compuertaSkus.noActivados, [SKU_NO_ACTIVADA]);
    assert.ok(!porPar["galerias-pacifico"].compuertaSkus.aplicados.includes(SKU_NO_ACTIVADA));
    assert.ok(porPar.dot.compuertaSkus.aplicados.includes(SKU_NO_ACTIVADA));
    assert.equal(v.detalle["galerias-pacifico"].ok, true, "ok por S2, igual que A-3.1");
    assert.equal(v.ok, true);
  });
});
