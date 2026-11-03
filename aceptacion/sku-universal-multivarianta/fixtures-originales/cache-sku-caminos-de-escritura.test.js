// CA-5 / R-6 — `verificar-cache-sku`.
//
// TODA escritura de stock se apoya en la verificacion de la misma corrida:
// ejecutarPar en el modo por defecto (CA-3) y en --full, la compuerta manual
// (escrituraAbsoluta) y syncUnSku (modo --sku). Interfaz: DISENO-INTERFAZ.md 4.
//
// syncUnSku corre encerrado como en test/compuerta-manual-absoluta.test.js:
// depsFake con encierro sobre un directorio temporal, la guardia de escrituras
// del repo y un fetch que lanza.
//
// Corre con: node --test test/cache-sku-caminos-de-escritura.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import {
  conDirTemporal,
  llamadasVacias,
  reloj,
  sembrarLibreta,
  leerLibretaCruda,
  encierroVacio,
  capturarConsola,
  PAR_DOT,
  DEPOSITO_DOT,
  LOCATION_DOT,
} from "./_helpers-clasificador.js";
import {
  SKU_APPLYFIT,
  item,
  variante,
  lineasDeAviso,
  tiendaFalsa,
  sembrarCacheSku,
  leerCacheSkuCruda,
  depsConCacheReal,
  escriturasEn,
  aislarShopify,
} from "./_helpers-cache-sku.js";

const T = "2026-11-03T12:00:00.000Z";

// -------------------------------------------------------------------- syncUnSku
test("CA-5 (f): syncUnSku con cache renombrada (X -> V, V ahora dice Y) y X en ninguna variante: no escribe en V ni avanza la libreta", async (t) => {
  const { violacionesFs, llamadasFetch } = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 6 }, contabilium: { "IEY-X": 12 } });
    sembrarCacheSku(dir, { "IEY-X": item(700) });
    const tienda = tiendaFalsa([{ n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 3 } }]);
    const encierro = encierroVacio();
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock: new Map(), llamadas: llamadasVacias(), encierro });

    const { lineas } = await capturarConsola(() => sync.syncUnSku("IEY-X", 14, deps));

    assert.deepEqual(llamadasFetch, [], "sin red real");
    assert.deepEqual(violacionesFs, [], "sin escrituras en el repo");
    assert.deepEqual(encierro.violaciones, [], "la libreta sale del directorio temporal");
    assert.equal(tienda.busquedas().length, 1, "syncUnSku verifico contra Shopify");
    assert.deepEqual(tienda.escrituras, [], "sin verificar escribiria 3 + (14 - 12) = 5 en la variante que ahora es IEY-Y");
    assert.deepEqual(leerCacheSkuCruda(dir), {}, "la entrada invalida se borra");
    assert.equal(leerLibretaCruda(dir, "dot").contabilium["IEY-X"], 12, "sin escritura, el baseline no avanza");
    // Ronda 2: procesarSku (syncUnSku y syncTodos) cuenta inventoryItemId null como
    // no_encontrado, nunca como no_activado (la compuerta tolera no_activado, R-15
    // del clasificador). Los mensajes son los de hoy, src/sync.js:336 y :345.
    assert.ok(
      lineas.some((l) => l.texto.includes("[SKIP] IEY-X: no existe en Shopify")),
      `procesarSku informa no_encontrado: ${JSON.stringify(lineas.map((l) => l.texto))}`
    );
    assert.ok(!lineas.some((l) => l.texto.includes("no esta activado")), "nunca como no_activado");
  });
});

test("CA-5 (f): syncUnSku con cache renombrada y X ahora unico en W: SIEMBRA el absoluto en W y guarda resembradoEn", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 6 }, contabilium: { "IEY-X": 12 } });
    sembrarCacheSku(dir, { "IEY-X": item(700) });
    const tienda = tiendaFalsa([
      { n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 3 } },
      { n: 800, sku: "IEY-X", niveles: { [LOCATION_DOT]: 1 } },
    ]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock: new Map(), llamadas: llamadasVacias(), encierro: encierroVacio() });

    await sync.syncUnSku("IEY-X", 14, deps);

    assert.deepEqual(escriturasEn(tienda, 800), [14], "absoluto en W; con delta seria 1 + (14 - 12) = 3");
    assert.deepEqual(escriturasEn(tienda, 700), [], "nada en V");
    assert.deepEqual(leerCacheSkuCruda(dir), { "IEY-X": item(800) });
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-X"], 14);
    assert.equal(libreta.resembradoEn?.["IEY-X"], T, "una siembra de syncUnSku guarda resembradoEn (contrato del clasificador, R-7)");
  });
});

test("CA-5 (f): syncUnSku con cache valida y duplicados: aplica el delta en la variante establecida", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { [SKU_APPLYFIT]: 10 }, contabilium: { [SKU_APPLYFIT]: 10 } });
    sembrarCacheSku(dir, { [SKU_APPLYFIT]: item(1701) });
    const tienda = tiendaFalsa([
      { n: 1301, sku: SKU_APPLYFIT, niveles: { [LOCATION_DOT]: 2 } },
      { n: 1701, sku: SKU_APPLYFIT, niveles: { [LOCATION_DOT]: 4 } },
    ]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock: new Map(), llamadas: llamadasVacias(), encierro: encierroVacio() });

    await sync.syncUnSku(SKU_APPLYFIT, 9, deps);

    assert.deepEqual(escriturasEn(tienda, 1701), [3], "4 + (9 - 10) = 3 en la 17e");
    assert.deepEqual(escriturasEn(tienda, 1301), []);
  });
});

// ---------------------------------------------------------------------- --full
test("CA-5 (g): en --full la verificacion es la misma: un SKU sin cambios con cache renombrada no se resuelve contra el item viejo, y uno con duplicados escribe en la establecida", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { "IEY-QUIETO": 5, [SKU_APPLYFIT]: 10 },
      contabilium: { "IEY-QUIETO": 5, [SKU_APPLYFIT]: 10 },
    });
    sembrarCacheSku(dir, { "IEY-QUIETO": item(700), [SKU_APPLYFIT]: item(1701) });
    const tienda = tiendaFalsa([
      { n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 3 } },
      { n: 1301, sku: SKU_APPLYFIT, niveles: { [LOCATION_DOT]: 2 } },
      { n: 1701, sku: SKU_APPLYFIT, niveles: { [LOCATION_DOT]: 4 } },
    ]);
    // IEY-QUIETO no cambio en Contabilium: el incremental lo saltearia; --full no.
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-QUIETO", 5], [SKU_APPLYFIT, 9]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const res = await sync.ejecutarPar(PAR_DOT, deps, { full: true });

    assert.deepEqual(escriturasEn(tienda, 700), [], "nada en la variante que ahora es IEY-Y");
    assert.equal(res.no_encontrado, 1, "IEY-QUIETO ya no esta en Shopify: sin verificar seria sin_cambios contra el item viejo");
    assert.equal(res.sin_cambios, 0);
    assert.equal(res.cache_invalidada, 1);
    assert.deepEqual(escriturasEn(tienda, 1701), [3]);
    assert.deepEqual(escriturasEn(tienda, 1301), []);
    assert.equal(res.duplicados, 1);
    assert.equal(leerLibretaCruda(dir, "dot").skus["IEY-QUIETO"], undefined, "sale del atajo");
  });
});

// ------------------------------------------------------------------- compuerta
test("CA-5 (g): la compuerta (escrituraAbsoluta) con cache renombrada escribe el absoluto en la variante que HOY tiene el SKU, nunca en la vieja", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 10 }, contabilium: { "IEY-X": 10 } });
    sembrarCacheSku(dir, { "IEY-X": item(700) });
    const tienda = tiendaFalsa([
      { n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 3 } },
      { n: 800, sku: "IEY-X", niveles: { [LOCATION_DOT]: 1 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-X", 7]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const res = await sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: new Set(["IEY-X"]) });

    assert.deepEqual(escriturasEn(tienda, 800), [7]);
    assert.deepEqual(escriturasEn(tienda, 700), [], "el absoluto de X no va a la variante que ahora es IEY-Y");
    assert.deepEqual(res.compuertaSkus.aplicados, ["IEY-X"]);
    assert.equal(res.cache_invalidada, 1);
    assert.equal(leerLibretaCruda(dir, "dot").resembradoPor?.["IEY-X"], "absoluto", "la compuerta conserva su motivo");
  });
});

test("CA-5 (g): la compuerta con cache renombrada y X en ninguna variante no escribe y no cuenta como aplicada", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 10 }, contabilium: { "IEY-X": 10 } });
    sembrarCacheSku(dir, { "IEY-X": item(700) });
    const tienda = tiendaFalsa([{ n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 3 } }]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-X", 7]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const res = await sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: new Set(["IEY-X"]) });

    assert.deepEqual(tienda.escrituras, [], "sin verificar escribiria 7 en la variante que ahora es IEY-Y");
    assert.equal(res.no_encontrado, 1);
    assert.deepEqual(res.compuertaSkus.aplicados, [], "no aplicada: la corrida queda en rojo por R-15 del clasificador");
  });
});

// Ronda 2: la compuerta con duplicados y cache valida sigue la decision de la
// persona ("Seguir en la variante establecida y avisar"): el absoluto va a la
// establecida y el [AVISO] sale igual.
test("CA-5 (g, ronda 2): la compuerta con duplicados y cache valida escribe el absoluto en la establecida y emite el [AVISO]", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { [SKU_APPLYFIT]: 10 }, contabilium: { [SKU_APPLYFIT]: 10 } });
    sembrarCacheSku(dir, { [SKU_APPLYFIT]: item(1701) });
    const tienda = tiendaFalsa([
      { n: 1301, sku: SKU_APPLYFIT, niveles: { [LOCATION_DOT]: 2 } },
      { n: 1701, sku: SKU_APPLYFIT, niveles: { [LOCATION_DOT]: 4 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([[SKU_APPLYFIT, 9]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() =>
      sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: new Set([SKU_APPLYFIT]) })
    );

    assert.deepEqual(escriturasEn(tienda, 1701), [9], "el absoluto 9 en la establecida (con delta seria 3)");
    assert.deepEqual(escriturasEn(tienda, 1301), [], "nada en la otra variante");
    assert.deepEqual(res.compuertaSkus.aplicados, [SKU_APPLYFIT]);
    assert.equal(res.ambiguo, 0);
    assert.equal(res.duplicados, 1);
    const avisos = lineasDeAviso(lineas, "dot", SKU_APPLYFIT);
    assert.equal(avisos.length, 1);
    assert.ok(avisos[0].texto.includes(variante(1701)));
    assert.equal(leerLibretaCruda(dir, "dot").resembradoPor?.[SKU_APPLYFIT], "absoluto");
  });
});
