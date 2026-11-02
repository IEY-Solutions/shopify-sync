// CA-3 / R-3, R-4 — `verificar-cache-sku`.
//
// Acierto en cache pero el item cacheado ya NO tiene el SKU exacto (renombrado
// en Shopify o variante borrada): ejecutarPar nunca escribe en el item viejo,
// la entrada se invalida y el SKU se resuelve de cero. Si el destino cambio,
// la linea base de la libreta era de OTRA variante: esa corrida SIEMBRA el
// absoluto de Contabilium, con los efectos de cualquier siembra
// (resembradoEn[sku] = tInicioLectura, lineas previas consumidas con motivo
// "sembrado", sin credito; docs/contratos/clasificador-causa-comprobante.md R-7).
//
// Casos reales: las correcciones pendientes 1, 2, 3 y 9 de
// docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md (la persona no las
// puede aplicar hasta que esto se arregle). Interfaz: DISENO-INTERFAZ.md 3 y 4.
//
// Corre con: node --test test/cache-sku-renombre.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { evaluarCorrida } from "../src/resultado.js";
import {
  conDirTemporal,
  llamadasVacias,
  reloj,
  sembrarLibreta,
  sembrarRegistro,
  leerLibretaCruda,
  entradaShopify,
  resumenSearch,
  capturarConsola,
  lineaResumen,
  valorEnResumen,
  PAR_DOT,
  DEPOSITO_DOT,
  LOCATION_DOT,
  HORA,
  DIA,
} from "./_helpers-clasificador.js";
import {
  SKU_NEGRO_18PRO,
  SKU_AZUL_18PRO,
  SKU_C08N_S26ULTRA,
  SKU_C08P_S26ULTRA,
  SKU_Q2_18PRO,
  SKU_Q2_18PM,
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
const CORTE = iso(tMs - 2 * DIA);

test("CA-3 (a): X renombrado a Y en la variante V, con cache X -> V y X en ninguna otra variante: el stock de X no se escribe en V; Y se resuelve a V y se siembra con el valor de Y", async (t) => {
  const { violacionesFs, llamadasFetch } = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const X = SKU_C08N_S26ULTRA;
    const Y = SKU_C08P_S26ULTRA;
    sembrarLibreta(dir, "dot", { skus: { [X]: 5 }, contabilium: { [X]: 5 } });
    sembrarCacheSku(dir, { [X]: item(700) });
    // La persona aplico la correccion 3: la variante 700 ahora dice Y.
    const tienda = tiendaFalsa([{ n: 700, sku: Y, niveles: { [LOCATION_DOT]: 3 } }]);
    const stock = new Map([[DEPOSITO_DOT, new Map([[X, 4], [Y, 7]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(llamadasFetch, [], "sin red real");
    assert.deepEqual(violacionesFs, [], "sin escrituras en el repo");
    assert.deepEqual(
      escriturasEn(tienda, 700),
      [7],
      "solo la siembra de Y (7). Sin verificar, X escribiria 3 + (4 - 5) = 2 en V antes de que Y la resolviera"
    );
    assert.equal(res.no_encontrado, 1, "X ya no esta en Shopify");
    assert.equal(res.actualizado, 1, "Y sembrado");
    assert.equal(res.cache_invalidada, 1, "la entrada X -> V se invalido");
    const [resumen] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(resumen.texto, "cache_invalidada"), "1");

    assert.deepEqual(leerCacheSkuCruda(dir), { [Y]: item(700) }, "X sale de la cache; Y -> V entra");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[Y], 7, "baseline de Y sembrado");
    assert.equal(libreta.resembradoEn?.[Y], T, "la siembra de Y fija resembradoEn");
    assert.equal(libreta.contabilium[X], 5, "el baseline de X no avanza (no se escribio)");
    assert.equal(libreta.skus[X], undefined, "X sale del atajo para reintentarse (H5)");
  });
});

test("CA-3 (b), correccion real 9: X renombrado en V y X ahora solo en otra variante W: se escribe en W SEMBRANDO, sin delta ni credito; la venta online previa queda consumida como sembrado", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const X = SKU_NEGRO_18PRO; // cacheado en la variante equivocada (fila 184)
    const Y = SKU_AZUL_18PRO; // el SKU correcto de la fila 184
    sembrarLibreta(dir, "dot", { skus: { [X]: 10 }, contabilium: { [X]: 10 }, corte: CORTE });
    // Una venta online de X de hace 1 h, ya registrada y acreditable.
    sembrarRegistro(dir, {
      ultimoRefrescoOk: iso(tMs - 2 * HORA),
      comprobantes: [entradaShopify({ id: 901, sku: X, cantidad: 1, referencia: iso(tMs - HORA) })],
    });
    sembrarCacheSku(dir, { [X]: item(184) });
    const tienda = tiendaFalsa([
      { n: 184, sku: Y, titulo: "Combo carbon, Negro / iPhone 18 Pro", niveles: { [LOCATION_DOT]: 6 } },
      { n: 9184, sku: X, titulo: "Combo negro carbon, Negro / iPhone 18 Pro", niveles: { [LOCATION_DOT]: 1 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([[X, 8], [Y, 2]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias(), search: [resumenSearch(901)] });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.deepEqual(
      escriturasEn(tienda, 9184),
      [8],
      "absoluto de X en W. Con delta seria 1 + (8 - 10) + 1 = 0; con siembra mas credito, 9"
    );
    assert.deepEqual(escriturasEn(tienda, 184), [2], "en V solo la siembra de Y, nunca el stock de X");
    assert.equal(res.cache_invalidada, 1, "solo X se invalido (Y no tenia entrada)");
    assert.equal(res.causa_venta_shopify, 0, "una siembra no acredita");
    assert.deepEqual(leerCacheSkuCruda(dir), { [X]: item(9184), [Y]: item(184) });
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[X], 8, "baseline de X resembrado con el absoluto");
    assert.equal(libreta.resembradoEn?.[X], T, "resembradoEn[X] = tInicioLectura");
    assert.equal(libreta.resembradoPor?.[X], "sembrado");
    assert.equal(libreta.consumos?.[`901:${X}`]?.motivo, "sembrado", "la linea anterior a la siembra queda consumida y nunca se acredita");
  });
});

test("CA-3 (d): cache invalida y ahora X en dos variantes: ambiguo, no escribe nada y la entrada se borra", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 10 }, contabilium: { "IEY-X": 10 } });
    sembrarCacheSku(dir, { "IEY-X": item(184) });
    const tienda = tiendaFalsa([
      { n: 184, sku: "IEY-RENOMBRADO", niveles: { [LOCATION_DOT]: 6 } },
      { n: 501, sku: "IEY-X", niveles: { [LOCATION_DOT]: 1 } },
      { n: 502, sku: "IEY-X", niveles: { [LOCATION_DOT]: 2 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-X", 8]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(tienda.escrituras, [], "ni en el item viejo ni en uno de los dos elegido al azar");
    assert.equal(res.ambiguo, 1);
    assert.equal(res.cache_invalidada, 1);
    assert.equal(res.duplicados, 0, "duplicados cuenta solo la variante establecida con otras; aca no hay establecida");
    assert.ok(lineas.some((l) => l.texto.includes("[SKIP]") && l.texto.includes("IEY-X")), "el ambiguo se reporta como hoy");
    assert.deepEqual(leerCacheSkuCruda(dir), {});
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-X"], 10, "el baseline no avanza");
    assert.equal(libreta.skus["IEY-X"], undefined, "sale del atajo para reintentarse");
  });
});

test("CA-3, correcciones reales 1 y 2 (par invertido): P y M intercambian variantes; cada uno se siembra en su variante nueva", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const P = SKU_Q2_18PRO;
    const M = SKU_Q2_18PM;
    sembrarLibreta(dir, "dot", { skus: { [P]: 1, [M]: 2 }, contabilium: { [P]: 1, [M]: 2 } });
    // Antes de la correccion: la fila 5 (18 Pro Max) tenia P y la fila 4 (18 Pro) tenia M.
    sembrarCacheSku(dir, { [P]: item(5), [M]: item(4) });
    // La persona invierte los SKUs.
    const tienda = tiendaFalsa([
      { n: 4, sku: P, titulo: "Negro / iPhone 18 Pro", niveles: { [LOCATION_DOT]: 2 } },
      { n: 5, sku: M, titulo: "Negro / iPhone 18 Pro Max", niveles: { [LOCATION_DOT]: 5 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([[P, 3], [M, 4]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.deepEqual(escriturasEn(tienda, 4), [3], "P sembrado en la fila 4 (sin verificar: M escribiria 2 + (4 - 2) = 4 aca)");
    assert.deepEqual(escriturasEn(tienda, 5), [4], "M sembrado en la fila 5 (sin verificar: P escribiria 5 + (3 - 1) = 7 aca)");
    assert.equal(res.cache_invalidada, 2);
    assert.deepEqual(leerCacheSkuCruda(dir), { [P]: item(4), [M]: item(5) });
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.resembradoEn?.[P], T);
    assert.equal(libreta.resembradoEn?.[M], T);
  });
});

// -----------------------------------------------------------------------------
// Ronda 2 (02/11/2026, arreglo tras revisor-alcance)
// -----------------------------------------------------------------------------

// Decision E2 del orquestador: con la busqueda en el tope y la establecida fuera
// de las coincidencias visibles, no se invalida, no se siembra y no se escribe;
// es `error` con una linea [ERROR]. Un solo SKU en tope no pone la corrida en
// rojo por si mismo: rige el umbral de errores de siempre (5%, src/resultado.js:15).
test("CA-3 (ronda 2, tope): ejecutarPar con 11 coincidencias y la establecida fuera del tope: no escribe en ninguna, cuenta error con [ERROR], no invalida y la corrida de 25 SKUs no queda en rojo", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    // 24 SKUs que el atajo saltea (sin cambios) + IEY-X, que se resuelve porque
    // no esta en `skus` (H5), sin delta: total 25, 1 error = 4% <= 5%.
    const quietos = Array.from({ length: 24 }, (_, i) => `IEY-Q-${String(i + 1).padStart(2, "0")}`);
    const skus = Object.fromEntries(quietos.map((s) => [s, 1]));
    sembrarLibreta(dir, "dot", { skus, contabilium: { ...skus, "IEY-X": 10 } });
    sembrarCacheSku(dir, { "IEY-X": item(1) });
    const tienda = tiendaFalsa([
      { n: 2, sku: "IEY-X", niveles: { [LOCATION_DOT]: 3 } }, // W: otra con el SKU exacto, visible
      ...prefijosLargos("IEY-X", 10, 9, { [LOCATION_DOT]: 1 }),
      { n: 1, sku: "IEY-X", niveles: { [LOCATION_DOT]: 5 } }, // la establecida, coincidencia 11
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([...quietos.map((s) => [s, 1]), ["IEY-X", 10]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(tienda.busquedas().length, 1, "IEY-X se busco una vez; los 24 quietos van por el atajo");
    assert.equal(Number(tienda.busquedas()[0].variables.first), 10, "first: 10 (decision E2: no se sube)");
    assert.deepEqual(tienda.escrituras, [], "ni en la establecida (no verificada) ni en W (invalidar y sembrar ahi seria adivinar)");
    assert.equal(res.error, 1);
    assert.equal(res.cache_invalidada, 0, "no se invalido");
    assert.equal(res.saltado, 24);
    assert.ok(lineas.some((l) => l.texto.includes("[ERROR] dot/IEY-X:")), "error visible con [ERROR] <par>/<sku>:");
    assert.deepEqual(leerCacheSkuCruda(dir), { "IEY-X": item(1) }, "la cache queda intacta");
    assert.equal(leerLibretaCruda(dir, "dot").contabilium["IEY-X"], 10, "el baseline no avanza");
    assert.equal(evaluarCorrida(res).ok, true, "1 de 25 en error (4%): no pone la corrida en rojo por si solo");
  });
});

// Una siembra por cambio de destino no es un delta: no suma causa_desconocida
// aunque el clasificador este en `fallo` (causa_desconocida cuenta solo deltas no
// sembrados, docs/contratos/clasificador-causa-comprobante.md, DISENO 6).
test("CA-3 (ronda 2): con la busqueda de comprobantes caida, una siembra por cambio de destino no suma causa_desconocida", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 10 }, contabilium: { "IEY-X": 10 }, corte: CORTE });
    sembrarCacheSku(dir, { "IEY-X": item(700) });
    const tienda = tiendaFalsa([
      { n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 9 } },
      { n: 800, sku: "IEY-X", niveles: { [LOCATION_DOT]: 1 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-X", 8]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias(), fallaBusqueda: true });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.clasificador, "fallo", "control: el delta de IEY-X disparo el refresco y la busqueda cayo");
    assert.deepEqual(escriturasEn(tienda, 800), [8], "siembra el absoluto en la variante nueva");
    assert.equal(res.cache_invalidada, 1);
    assert.equal(res.causa_desconocida, 0, "una siembra no es un delta sin explicar");
  });
});
