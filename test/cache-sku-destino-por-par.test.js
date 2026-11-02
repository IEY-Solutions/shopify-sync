// CA-8 / R-9 — `verificar-cache-sku`. Requisito agregado por el planificador
// (pedido: "Pensa si hace falta algo mas para que un delta calculado contra la
// variante vieja nunca se aplique a la nueva").
//
// La cache de SKUs es UNA para todos los pares y se reescribe al invalidarse;
// la linea base es POR PAR. Si solo resolverSku detecta el cambio de destino,
// quedan tres huecos donde un delta de la variante vieja se aplica a la nueva:
//   D1. la corrida que invalida termina en ambiguo/no_encontrado/error, y en una
//       corrida posterior el SKU se resuelve sin entrada en cache;
//   D2. dos pares en la misma corrida: el primero invalida y reescribe la cache,
//       y el segundo ve la cache "valida";
//   D3. el segundo par saltea el SKU por el atajo y lo resuelve dias despues.
// Por eso cada libreta guarda destinos[sku] = inventoryItemId de su baseline, y
// la linea base solo vale si el destino resuelto es el mismo. Una libreta
// anterior a esta feature se inicializa con la cache leida UNA vez al empezar
// la corrida (deps.leerCacheSku). Sin dato, se aplica el delta como hoy
// (invariante 1: nunca sembrar el catalogo entero por falta de dato).
// Interfaz: DISENO-INTERFAZ.md 4.3.
//
// Corre con: node --test test/cache-sku-destino-por-par.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as sync from "../src/sync.js";
import * as shopify from "../src/shopify.js";
import {
  conDirTemporal,
  llamadasVacias,
  reloj,
  sembrarLibreta,
  leerLibretaCruda,
  rutaLibreta,
  encierroVacio,
  capturarConsola,
  PAR_DOT,
  PAR_ISLA,
  DEPOSITO_DOT,
  DEPOSITO_ISLA,
  LOCATION_DOT,
  LOCATION_ISLA,
  HORA,
} from "./_helpers-clasificador.js";
import {
  item,
  tiendaFalsa,
  sembrarCacheSku,
  leerCacheSkuCruda,
  depsConCacheReal,
  escriturasEn,
  aislarShopify,
  prefijosLargos,
} from "./_helpers-cache-sku.js";

const T = "2026-11-03T12:00:00.000Z";
const tMs = new Date(T).getTime();
const iso = (ms) => new Date(ms).toISOString();

test("CA-8 D1: la corrida que invalida termina en ambiguo; cuando la persona deja X en una sola variante, la corrida siguiente SIEMBRA (no aplica el delta de la variante vieja)", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 10 }, contabilium: { "IEY-X": 10 } });
    sembrarCacheSku(dir, { "IEY-X": item(184) });
    const tienda = tiendaFalsa([
      { n: 184, sku: "IEY-RENOMBRADO", niveles: { [LOCATION_DOT]: 6 } },
      { n: 501, sku: "IEY-X", niveles: { [LOCATION_DOT]: 5 } },
      { n: 502, sku: "IEY-X", niveles: { [LOCATION_DOT]: 2 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-X", 8]])]]);
    const r = reloj(T);
    const deps = depsConCacheReal({ dir, tienda, reloj: r, stock, llamadas: llamadasVacias() });

    const res1 = await sync.ejecutarPar(PAR_DOT, deps);
    assert.equal(res1.ambiguo, 1, "corrida 1: X en dos variantes");
    assert.deepEqual(tienda.escrituras, []);
    assert.deepEqual(leerCacheSkuCruda(dir), {}, "la cache ya no recuerda la variante vieja");

    // La persona saca el SKU de la 502: X queda solo en la 501.
    tienda.renombrar(502, "IEY-X-BIS");
    r.fijar(iso(tMs + HORA));
    const res2 = await sync.ejecutarPar(PAR_DOT, deps);

    assert.deepEqual(
      escriturasEn(tienda, 501),
      [8],
      "absoluto 8: el baseline 10 era de la variante 184. Con delta seria 5 + (8 - 10) = 3"
    );
    assert.equal(res2.cache_invalidada, 1, "el destino de la libreta dejo de valer en esta corrida");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.destinos?.["IEY-X"], item(501));
    assert.equal(libreta.resembradoEn?.["IEY-X"], iso(tMs + HORA));

    // Ronda 2: la corrida siguiente a la siembra ya tiene destino y baseline de la
    // 501: aplica el DELTA, no otra siembra. Una venta online deja la 501 en 7 y
    // el mostrador baja Contabilium de 8 a 6.
    tienda.porNumero(501).niveles[LOCATION_DOT] = 7;
    stock.get(DEPOSITO_DOT).set("IEY-X", 6);
    r.fijar(iso(tMs + 2 * HORA));
    const res3 = await sync.ejecutarPar(PAR_DOT, deps);

    assert.deepEqual(escriturasEn(tienda, 501), [8, 5], "corrida 3: 7 + (6 - 8) = 5; otra siembra escribiria 6 y re-inflaria la venta online");
    assert.equal(res3.cache_invalidada, 0);
    assert.equal(leerLibretaCruda(dir, "dot").resembradoEn?.["IEY-X"], iso(tMs + HORA), "un delta no resiembra");
  });
});

test("CA-8 D2: dos pares en la misma corrida: el DOT invalida y reescribe la cache; la isla igual SIEMBRA en la variante nueva", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 5 }, contabilium: { "IEY-X": 5 } });
    sembrarLibreta(dir, "galerias-pacifico", { skus: { "IEY-X": 3 }, contabilium: { "IEY-X": 3 } });
    sembrarCacheSku(dir, { "IEY-X": item(700) });
    const tienda = tiendaFalsa([
      { n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 9, [LOCATION_ISLA]: 9 } },
      { n: 800, sku: "IEY-X", niveles: { [LOCATION_DOT]: 1, [LOCATION_ISLA]: 1 } },
    ]);
    const stock = new Map([
      [DEPOSITO_DOT, new Map([["IEY-X", 4]])],
      [DEPOSITO_ISLA, new Map([["IEY-X", 2]])],
    ]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const porPar = await sync.correrTodosLosPares([PAR_DOT, PAR_ISLA], deps);

    assert.deepEqual(escriturasEn(tienda, 800, LOCATION_DOT), [4], "DOT: siembra 4 en la variante nueva");
    assert.deepEqual(
      escriturasEn(tienda, 800, LOCATION_ISLA),
      [2],
      "isla: siembra 2. Si solo mirara la cache (ya reescrita por el DOT) aplicaria 1 + (2 - 3) = 0"
    );
    assert.deepEqual(escriturasEn(tienda, 700, LOCATION_DOT), []);
    assert.deepEqual(escriturasEn(tienda, 700, LOCATION_ISLA), []);
    assert.equal(porPar.dot.cache_invalidada, 1);
    assert.equal(porPar["galerias-pacifico"].cache_invalidada, 1, "la isla tambien ve que su destino dejo de valer");
    assert.equal(leerLibretaCruda(dir, "galerias-pacifico").destinos?.["IEY-X"], item(800));
  });
});

test("CA-8 D3: la isla saltea X por el atajo en la corrida que invalida; dias despues, cuando X cambia en la isla, igual SIEMBRA", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 5 }, contabilium: { "IEY-X": 5 } });
    sembrarLibreta(dir, "galerias-pacifico", { skus: { "IEY-X": 3 }, contabilium: { "IEY-X": 3 } });
    sembrarCacheSku(dir, { "IEY-X": item(700) });
    const tienda = tiendaFalsa([
      { n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 9, [LOCATION_ISLA]: 9 } },
      { n: 800, sku: "IEY-X", niveles: { [LOCATION_DOT]: 1, [LOCATION_ISLA]: 1 } },
    ]);
    const stock = new Map([
      [DEPOSITO_DOT, new Map([["IEY-X", 4]])],
      [DEPOSITO_ISLA, new Map([["IEY-X", 3]])], // sin cambios: atajo
    ]);
    const r = reloj(T);
    const deps = depsConCacheReal({ dir, tienda, reloj: r, stock, llamadas: llamadasVacias() });

    const corrida1 = await sync.correrTodosLosPares([PAR_DOT, PAR_ISLA], deps);
    assert.equal(corrida1["galerias-pacifico"].saltado, 1, "corrida 1: la isla no resuelve X");
    assert.deepEqual(escriturasEn(tienda, 800, LOCATION_ISLA), []);
    assert.equal(
      leerLibretaCruda(dir, "galerias-pacifico").destinos?.["IEY-X"],
      item(700),
      "la libreta de la isla quedo inicializada con la cache del inicio de la corrida 1"
    );

    // Dias despues: se vende 1 en la isla. La cache ya dice X -> 800.
    r.fijar(iso(tMs + 72 * HORA));
    stock.get(DEPOSITO_ISLA).set("IEY-X", 2);
    await sync.correrTodosLosPares([PAR_DOT, PAR_ISLA], deps);

    assert.deepEqual(escriturasEn(tienda, 800, LOCATION_ISLA), [2], "siembra 2; con delta seria 1 + (2 - 3) = 0");
  });
});

test("CA-8 D4: los destinos se guardan con el baseline y ninguna escritura de 3 argumentos los borra", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 4, "IEY-B": 7 }, contabilium: { "IEY-A": 4, "IEY-B": 7 } });
    sembrarCacheSku(dir, { "IEY-A": item(1), "IEY-B": item(2) });
    const tienda = tiendaFalsa([
      { n: 1, sku: "IEY-A", niveles: { [LOCATION_DOT]: 4 } },
      { n: 2, sku: "IEY-B", niveles: { [LOCATION_DOT]: 7 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 3], ["IEY-B", 7]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    await sync.ejecutarPar(PAR_DOT, deps);
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.destinos?.["IEY-A"], item(1), "el SKU resuelto guarda su destino");
    assert.equal(libreta.destinos?.["IEY-B"], item(2), "el del atajo conserva el de la inicializacion");

    // syncUnSku con delta sobre IEY-A (guardarSnapshot de 3 argumentos).
    await sync.syncUnSku("IEY-A", 2, depsConCacheReal({ dir, tienda, reloj: reloj(T), stock: new Map(), llamadas: llamadasVacias(), encierro: encierroVacio() }));
    libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-A"], 2, "control: syncUnSku escribio");
    assert.equal(libreta.destinos?.["IEY-B"], item(2), "syncUnSku no borra destinos de otros SKUs");
    assert.equal(libreta.destinos?.["IEY-A"], item(1));

    // guardarSnapshot de 3 argumentos directo.
    sync.guardarSnapshot({ ...libreta.skus }, rutaLibreta(dir, "dot"), new Map(Object.entries(libreta.contabilium)));
    assert.deepEqual(leerLibretaCruda(dir, "dot").destinos, libreta.destinos, "una escritura de 3 argumentos conserva los destinos del disco");
  });
});

test("CA-8 D5: libreta anterior a esta feature con la cache valida aplica el DELTA (no siembra) y anota el destino; sin entrada en cache, tambien delta", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10, "IEY-B": 10 }, contabilium: { "IEY-A": 10, "IEY-B": 10 } });
    sembrarCacheSku(dir, { "IEY-A": item(1) }); // IEY-B sin entrada (cache perdida)
    const tienda = tiendaFalsa([
      { n: 1, sku: "IEY-A", niveles: { [LOCATION_DOT]: 5 } },
      { n: 2, sku: "IEY-B", niveles: { [LOCATION_DOT]: 5 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 8], ["IEY-B", 8]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.deepEqual(escriturasEn(tienda, 1), [3], "5 + (8 - 10) = 3, no el absoluto 8 (invariante 1)");
    assert.deepEqual(escriturasEn(tienda, 2), [3], "sin dato del destino: delta como hoy");
    assert.equal(res.cache_invalidada, 0);
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.destinos?.["IEY-A"], item(1));
    assert.equal(libreta.destinos?.["IEY-B"], item(2));
    assert.equal(libreta.resembradoEn?.["IEY-A"], undefined, "un delta no resiembra");
  });
});

// Ronda 3 (N-2): `destinos: null` en el archivo crudo se trata como `{}` (DISENO
// 0 y 4.3) y se inicializa por SKU. Una implementacion que solo inicialice si
// "falta la clave" la veria presente y no inicializaria nada; una que haga
// Object.keys(destinos) o destinos[sku] sobre null lanzaria.
test("CA-8 D5b (ronda 3): libreta con destinos null se trata como {} y se inicializa por SKU: el escenario D1 sobre X SIEMBRA", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 10 }, contabilium: { "IEY-X": 10 }, extra: { destinos: null } });
    sembrarCacheSku(dir, { "IEY-X": item(184) });
    const tienda = tiendaFalsa([
      { n: 184, sku: "IEY-RENOMBRADO", niveles: { [LOCATION_DOT]: 6 } },
      { n: 501, sku: "IEY-X", niveles: { [LOCATION_DOT]: 5 } },
      { n: 502, sku: "IEY-X", niveles: { [LOCATION_DOT]: 2 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-X", 8]])]]);
    const r = reloj(T);
    const deps = depsConCacheReal({ dir, tienda, reloj: r, stock, llamadas: llamadasVacias() });

    const res1 = await sync.ejecutarPar(PAR_DOT, deps);
    assert.equal(res1.ambiguo, 1, "corrida 1: X en dos variantes");
    assert.equal(leerLibretaCruda(dir, "dot").destinos?.["IEY-X"], item(184), "destinos null: X toma la cache del inicio de la corrida");

    tienda.renombrar(502, "IEY-X-BIS");
    r.fijar(iso(tMs + HORA));
    await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(escriturasEn(tienda, 501), [8], "siembra 8; con delta seria 5 + (8 - 10) = 3");
  });
});

test("CA-8 D6: syncUnSku respeta el destino de la libreta aunque la cache se haya perdido: X en otra variante -> siembra", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { "IEY-X": 12 },
      contabilium: { "IEY-X": 12 },
      extra: { destinos: { "IEY-X": item(700) } },
    });
    const tienda = tiendaFalsa([
      { n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 3 } },
      { n: 800, sku: "IEY-X", niveles: { [LOCATION_DOT]: 1 } },
    ]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock: new Map(), llamadas: llamadasVacias(), encierro: encierroVacio() });

    await sync.syncUnSku("IEY-X", 14, deps);

    assert.deepEqual(escriturasEn(tienda, 800), [14], "absoluto: el baseline 12 era de la variante 700. Con delta seria 1 + (14 - 12) = 3");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.destinos?.["IEY-X"], item(800));
    assert.equal(libreta.resembradoEn?.["IEY-X"], T);
  });
});

test("CA-8 D7: DEPS_REALES cablea leerCacheSku, que lee la cache de una ruta y tolera archivo ausente o corrupto", async (t) => {
  aislarShopify(t);
  assert.equal(typeof sync.DEPS_REALES.leerCacheSku, "function", "DEPS_REALES.leerCacheSku");
  assert.equal(typeof shopify.leerCacheSku, "function", "src/shopify.js exporta leerCacheSku(ruta)");
  await conDirTemporal(async (dir) => {
    assert.deepEqual(shopify.leerCacheSku(join(dir, "no-existe.json")), {});
    sembrarCacheSku(dir, { "IEY-A": item(1) });
    assert.deepEqual(shopify.leerCacheSku(join(dir, "sku-map.json")), { "IEY-A": item(1) });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "corrupta.json"), "{ no es json", "utf-8");
    assert.deepEqual(shopify.leerCacheSku(join(dir, "corrupta.json")), {});
  });
});

// -----------------------------------------------------------------------------
// Ronda 2 (02/11/2026, arreglo tras revisor-alcance)
// -----------------------------------------------------------------------------

// Inicializacion POR SKU, no por libreta. Si la marca de "libreta migrada" fuera
// el campo `destinos` entero, un `--sku` corrido antes del primer cron (que anota
// destinos[A]) dejaria la libreta "nueva" y D1 se reabriria para todos los demas
// SKUs: X quedaria sin destino conocido y la corrida 2 aplicaria el delta.
//
// Ronda 3 (bloqueante B-1): D8 se parte en dos. D8a siembra la libreta con el
// campo `destinos` YA presente y parcial (A si, X no), sin depender de que
// syncUnSku lo escriba: una inicializacion "por libreta" (solo si falta el campo)
// no inicializa X y falla. D8b fija que syncUnSku anota destinos[sku] tambien en
// el camino del delta (DISENO 4.2) y despues recorre el escenario real.
function escenarioD8(dir) {
  sembrarCacheSku(dir, { "IEY-A": item(1), "IEY-X": item(184) });
  return tiendaFalsa([
    { n: 1, sku: "IEY-A", niveles: { [LOCATION_DOT]: 4 } },
    { n: 184, sku: "IEY-RENOMBRADO", niveles: { [LOCATION_DOT]: 6 } },
    { n: 501, sku: "IEY-X", niveles: { [LOCATION_DOT]: 5 } },
    { n: 502, sku: "IEY-X", niveles: { [LOCATION_DOT]: 2 } },
  ]);
}

// Corridas 1 y 2 de D1 sobre X, con A en el atajo (Contabilium A = `contabA`).
async function d1SobreX({ dir, tienda, r, contabA }) {
  const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", contabA], ["IEY-X", 8]])]]);
  const deps = depsConCacheReal({ dir, tienda, reloj: r, stock, llamadas: llamadasVacias() });
  const res1 = await sync.ejecutarPar(PAR_DOT, deps);
  assert.equal(res1.ambiguo, 1, "corrida 1: X en dos variantes");
  assert.equal(
    leerLibretaCruda(dir, "dot").destinos?.["IEY-X"],
    item(184),
    "X no tenia entrada en destinos: toma la cache del inicio de la corrida aunque A ya tuviera la suya (inicializacion por SKU)"
  );
  assert.equal(leerLibretaCruda(dir, "dot").destinos?.["IEY-A"], item(1), "el destino de A se conserva");

  // Corrida 2: X queda solo en la 501.
  tienda.renombrar(502, "IEY-X-BIS");
  r.fijar(iso(tMs + HORA));
  await sync.ejecutarPar(PAR_DOT, deps);
  assert.deepEqual(escriturasEn(tienda, 501), [8], "siembra 8; con delta seria 5 + (8 - 10) = 3");
}

test("CA-8 D8a (ronda 3): libreta con el campo destinos YA presente y parcial (A si, X no): X igual toma su destino de la cache del inicio y el escenario D1 sobre X SIEMBRA", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { "IEY-A": 4, "IEY-X": 10 },
      contabilium: { "IEY-A": 4, "IEY-X": 10 },
      extra: { destinos: { "IEY-A": item(1) } }, // el campo existe; X no tiene entrada
    });
    const tienda = escenarioD8(dir);
    await d1SobreX({ dir, tienda, r: reloj(T), contabA: 4 });
  });
});

test("CA-8 D8b (ronda 3): un syncUnSku con delta sobre A (libreta legada, sin destinos) anota destinos[A]; despues el escenario D1 sobre X igual SIEMBRA", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 4, "IEY-X": 10 }, contabilium: { "IEY-A": 4, "IEY-X": 10 } });
    const tienda = escenarioD8(dir);
    const r = reloj(T);

    // La persona prueba `--sku IEY-A` antes del primer cron con esta feature.
    await sync.syncUnSku("IEY-A", 3, depsConCacheReal({ dir, tienda, reloj: r, stock: new Map(), llamadas: llamadasVacias(), encierro: encierroVacio() }));
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-A"], 3, "control: syncUnSku escribio el delta de A");
    assert.deepEqual(escriturasEn(tienda, 1), [3], "control: delta 4 + (3 - 4) = 3 en la establecida");
    assert.equal(
      libreta.destinos?.["IEY-A"],
      item(1),
      "DISENO 4.2: si avanza el baseline, syncUnSku anota destinos[sku], tambien en el camino del delta"
    );
    assert.equal(libreta.resembradoEn?.["IEY-A"], undefined, "un delta no resiembra");

    await d1SobreX({ dir, tienda, r, contabA: 3 });
  });
});

// `destinos` va en cada checkpoint, junto con su baseline (patron de
// test/libreta-ledger-checkpoint.test.js:85-117). Si solo fuera en el guardado
// final, una corrida cortada dejaria baseline nuevo con destino viejo y la
// siguiente volveria a sembrar encima de una escritura que ya quedo.
test("CA-8 D9 (ronda 2): destinos se guarda tambien en el checkpoint: con el guardado final fallido, en disco quedan destinos[X] = W y su baseline", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { "IEY-X": 10 },
      contabilium: { "IEY-X": 10 },
      extra: { destinos: { "IEY-X": item(700) } },
    });
    sembrarCacheSku(dir, { "IEY-X": item(700) });
    const tienda = tiendaFalsa([
      { n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 3 } },
      { n: 800, sku: "IEY-X", niveles: { [LOCATION_DOT]: 1 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-X", 7]])]]);
    // Ronda 3 (N-3): no se cuentan los guardados. Falla TODO guardado posterior al
    // primero que lleve el baseline de la siembra (contabilium X = 7), incluido el
    // final. Un guardado previo de inicializacion (X todavia en 10) pasa.
    let siembraGuardada = false;
    const deps = depsConCacheReal({
      dir,
      tienda,
      reloj: reloj(T),
      stock,
      llamadas: llamadasVacias(),
      guardarSnapshotEnvoltorio: (real) => (...args) => {
        if (siembraGuardada) throw new Error("ENOSPC simulado en un guardado posterior al checkpoint de la siembra");
        const c = args[2];
        const x = c instanceof Map ? c.get("IEY-X") : c?.["IEY-X"];
        if (x === 7) siembraGuardada = true;
        return real(...args);
      },
    });

    await assert.rejects(() => sync.ejecutarPar(PAR_DOT, deps, { checkpointCada: 1 }), /ENOSPC simulado/);

    assert.deepEqual(escriturasEn(tienda, 800), [7], "control: la siembra quedo escrita en Shopify");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-X"], 7, "el checkpoint guardo el baseline");
    assert.equal(libreta.destinos?.["IEY-X"], item(800), "y en la MISMA escritura, el destino W");
    assert.equal(libreta.resembradoEn?.["IEY-X"], T);
  });
});

// Decision del orquestador (ronda 2): si la libreta conoce el destino, manda la
// libreta. Se siembra si y solo si ese destino difiere del item resuelto, sin
// importar la marca cambioDeDestino de resolverSku.
test("CA-8 D10 (ronda 2): manda la libreta: destinos[X] = W, la cache apuntaba a V y hoy X resuelve a W: delta, NO siembra", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { "IEY-X": 10 },
      contabilium: { "IEY-X": 10 },
      extra: { destinos: { "IEY-X": item(800) } },
    });
    sembrarCacheSku(dir, { "IEY-X": item(700) });
    const tienda = tiendaFalsa([
      { n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 9 } },
      { n: 800, sku: "IEY-X", niveles: { [LOCATION_DOT]: 4 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-X", 9]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.deepEqual(
      escriturasEn(tienda, 800),
      [3],
      "4 + (9 - 10) = 3: el baseline 10 ES de W. Sembrar (por cambioDeDestino del resolver) escribiria 9"
    );
    assert.deepEqual(escriturasEn(tienda, 700), []);
    assert.equal(res.cache_invalidada, 1, "la entrada de la cache (V) si dejo de valer (R-8)");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.destinos?.["IEY-X"], item(800));
    assert.equal(libreta.resembradoEn?.["IEY-X"], undefined, "un delta no resiembra");
    assert.deepEqual(leerCacheSkuCruda(dir), { "IEY-X": item(800) });
  });
});

// Decision E2 del orquestador aplicada al destino de la libreta: si el destino
// difiere del resuelto, no aparece en la respuesta y la busqueda llego al tope,
// no se sabe si fue renombrado o quedo afuera: no se siembra ni se escribe.
test("CA-8 D11 (ronda 2, tope): el destino de la libreta no aparece y la busqueda llego al tope: error con [ERROR], sin escribir y con el destino conservado", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    // Sin entrada en cache (cache perdida). IEY-X no esta en `skus` (H5), asi que
    // se resuelve aunque no tenga delta.
    sembrarLibreta(dir, "dot", { skus: {}, contabilium: { "IEY-X": 10 }, extra: { destinos: { "IEY-X": item(1) } } });
    const tienda = tiendaFalsa([
      { n: 2, sku: "IEY-X", niveles: { [LOCATION_DOT]: 3 } },
      ...prefijosLargos("IEY-X", 10, 9, { [LOCATION_DOT]: 1 }),
      { n: 1, sku: "IEY-X-ZZ", niveles: { [LOCATION_DOT]: 5 } }, // el destino de la libreta, coincidencia 11
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-X", 10]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(tienda.busquedas().length, 1, "IEY-X se busco");
    assert.deepEqual(tienda.escrituras, [], "sembrar 10 en la 2 seria adivinar: el destino 1 quedo fuera del tope");
    assert.equal(res.error, 1);
    assert.equal(res.sin_cambios, 0, "tampoco un delta contra la 2 (3 + 0 = 3, sin_cambios)");
    assert.ok(lineas.some((l) => l.texto.includes("[ERROR] dot/IEY-X:")), "error visible");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.destinos?.["IEY-X"], item(1), "el destino se conserva");
    assert.equal(libreta.contabilium["IEY-X"], 10, "el baseline no avanza");
  });
});

// Ronda 3 (N-4): DISENO 4.2, syncUnSku aplica "la misma regla (incluido el
// tope)". Con el destino de la libreta fuera de las 10 visibles y la busqueda en
// el tope, syncUnSku no siembra ni aplica un delta contra la otra variante
// visible: informa el error y conserva destino y baseline.
test("CA-8 D12 (ronda 3, tope en syncUnSku): el destino de la libreta no aparece y la busqueda llego al tope: [ERROR], sin escribir y con destino y baseline conservados", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    // Sin cache (perdida): manda el destino de la libreta.
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 10 }, contabilium: { "IEY-X": 10 }, extra: { destinos: { "IEY-X": item(1) } } });
    const tienda = tiendaFalsa([
      { n: 2, sku: "IEY-X", niveles: { [LOCATION_DOT]: 3 } },
      ...prefijosLargos("IEY-X", 10, 9, { [LOCATION_DOT]: 1 }),
      { n: 1, sku: "IEY-X-ZZ", niveles: { [LOCATION_DOT]: 5 } }, // el destino de la libreta, coincidencia 11
    ]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock: new Map(), llamadas: llamadasVacias(), encierro: encierroVacio() });

    // --sku IEY-X --qty 9: una siembra escribiria 9 en la 2; un delta, 3 + (9 - 10) = 2.
    const { lineas } = await capturarConsola(() => sync.syncUnSku("IEY-X", 9, deps));

    assert.equal(tienda.busquedas().length, 1, "IEY-X se busco con la consulta inyectada");
    assert.deepEqual(tienda.escrituras, [], "ni siembra ni delta: el destino 1 quedo fuera del tope");
    assert.ok(
      lineas.some((l) => l.texto.includes("[ERROR]") && l.texto.includes("IEY-X")),
      `error visible con [ERROR] y el SKU: ${JSON.stringify(lineas.map((l) => l.texto))}`
    );
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.destinos?.["IEY-X"], item(1), "el destino se conserva");
    assert.equal(libreta.contabilium["IEY-X"], 10, "el baseline no avanza");
    assert.equal(libreta.resembradoEn?.["IEY-X"], undefined, "no hubo siembra");
  });
});
