// CA-1 / R-1, R-3, R-5, R-7 — `verificar-cache-sku`.
//
// resolverSku(sku, locationId, { consultar, rutaCache }) verifica CADA
// resolucion contra Shopify en la misma llamada, tambien con acierto en cache:
// el inventoryItemId devuelto pertenece a una variante cuyo SKU es EXACTAMENTE
// el pedido (AGENTS.md, invariante 3). Una sola busqueda por llamada, sin
// GetLevel.
//
// Defecto que cubre: src/shopify.js:337-340 devolvia el id cacheado sin
// consultar Shopify. Interfaz: aceptacion/verificar-cache-sku/DISENO-INTERFAZ.md
// secciones 1 a 3.
//
// Corre con: node --test test/cache-sku-verificada.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as shopify from "../src/shopify.js";
import { conDirTemporal, LOCATION_DOT } from "./_helpers-clasificador.js";
import {
  SKU_APPLYFIT,
  SKU_PREFIJO,
  SKU_PREFIJO_LARGO,
  SKU_C08N_S26ULTRA,
  SKU_C08P_S26ULTRA,
  item,
  variante,
  tiendaFalsa,
  sembrarCacheSku,
  leerCacheSkuCruda,
  resolverInyectado,
  aislarShopify,
  prefijosLargos,
} from "./_helpers-cache-sku.js";

function controlesDeEntorno({ llamadasFetch, violacionesFs }) {
  assert.deepEqual(llamadasFetch, [], "resolverSku no sale a la red real: usa la consulta inyectada");
  assert.deepEqual(violacionesFs, [], "resolverSku no escribe dentro del repo (.cache/ real): usa rutaCache");
}

function unaBusquedaExacta(tienda, sku) {
  assert.equal(tienda.consultas.length, 1, `una sola consulta GraphQL por resolucion: ${JSON.stringify(tienda.consultas)}`);
  const [c] = tienda.consultas;
  assert.equal(c.tipo, "busqueda", "la consulta es la busqueda por SKU (GetVariantBySku), no GetLevel");
  assert.equal(c.variables.query, `sku:"${sku}"`, "busqueda exacta entre comillas");
  assert.equal(c.variables.locationId, LOCATION_DOT, "con la location del par");
  assert.ok(Number(c.variables.first) >= 10, "con first >= 10 (defensa H4 contra prefijos)");
}

test("CA-1: cache valida y SKU unico: devuelve el item cacheado con el available de la busqueda, una sola busqueda exacta y la cache intacta", async (t) => {
  const entorno = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    // El SKU largo aparece PRIMERO en la busqueda tokenizada.
    const tienda = tiendaFalsa([
      { n: 2, sku: SKU_PREFIJO_LARGO, niveles: { [LOCATION_DOT]: 3 } },
      { n: 1, sku: SKU_PREFIJO, niveles: { [LOCATION_DOT]: 7 } },
    ]);
    sembrarCacheSku(dir, { [SKU_PREFIJO]: item(1) });
    const r = await resolverInyectado(tienda, dir)(SKU_PREFIJO, LOCATION_DOT);
    controlesDeEntorno(entorno);
    unaBusquedaExacta(tienda, SKU_PREFIJO);
    assert.equal(r.inventoryItemId, item(1));
    assert.equal(r.available, 7, "el available sale de la misma busqueda");
    assert.equal(r.desdeCache, true);
    assert.equal(r.duplicados, 0, "el SKU prefijo-largo no es un duplicado: no es el mismo SKU exacto");
    assert.equal(r.cacheInvalidada, false);
    assert.equal(r.cambioDeDestino, false);
    assert.equal(r.variantId, variante(1), "ronda 2 (E1): el id de la variante del item devuelto");
    assert.equal(r.topeAlcanzado, false, "ronda 2 (E2): 2 coincidencias, por debajo del tope de 10");
    assert.deepEqual(leerCacheSkuCruda(dir), { [SKU_PREFIJO]: item(1) }, "una entrada valida no se reescribe");
  });
});

test("CA-1: cache valida con otras variantes del mismo SKU exacto (caso real APPLYFIT, 5 variantes): variante establecida, duplicados = 4, sin SkuAmbiguoError", async (t) => {
  const entorno = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa([
      { n: 1301, sku: SKU_APPLYFIT, titulo: "iPhone 13", niveles: { [LOCATION_DOT]: 2 } },
      { n: 1302, sku: SKU_APPLYFIT, titulo: "iPhone 13 Pro", niveles: { [LOCATION_DOT]: 0 } },
      { n: 1401, sku: SKU_APPLYFIT, titulo: "iPhone 14", niveles: { [LOCATION_DOT]: 1 } },
      { n: 1601, sku: SKU_APPLYFIT, titulo: "iPhone 16e", niveles: { [LOCATION_DOT]: 3 } },
      { n: 1701, sku: SKU_APPLYFIT, titulo: "iPhone 17e", niveles: { [LOCATION_DOT]: 4 } },
    ]);
    sembrarCacheSku(dir, { [SKU_APPLYFIT]: item(1701) });
    const r = await resolverInyectado(tienda, dir)(SKU_APPLYFIT, LOCATION_DOT);
    controlesDeEntorno(entorno);
    unaBusquedaExacta(tienda, SKU_APPLYFIT);
    assert.equal(r.inventoryItemId, item(1701), "la 17e, la variante en la que el sync venia escribiendo");
    assert.equal(r.available, 4);
    assert.equal(r.duplicados, 4, "las OTRAS variantes con el mismo SKU exacto");
    assert.equal(r.variantId, variante(1701), "ronda 2 (E1): el [AVISO] nombra esta variante; resolverSku la devuelve");
    assert.equal(r.cacheInvalidada, false);
    assert.equal(r.cambioDeDestino, false);
    assert.deepEqual(leerCacheSkuCruda(dir), { [SKU_APPLYFIT]: item(1701) });
  });
});

test("CA-1: cache renombrada en Shopify (X -> Y en la misma variante) y X en ninguna otra: no devuelve el item viejo, invalida la entrada y reporta la invalidacion", async (t) => {
  const entorno = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa([{ n: 700, sku: SKU_C08P_S26ULTRA, niveles: { [LOCATION_DOT]: 3 } }]);
    sembrarCacheSku(dir, { [SKU_C08N_S26ULTRA]: item(700), OTRO: item(5) });
    const r = await resolverInyectado(tienda, dir)(SKU_C08N_S26ULTRA, LOCATION_DOT);
    controlesDeEntorno(entorno);
    unaBusquedaExacta(tienda, SKU_C08N_S26ULTRA);
    assert.ok(r !== null && typeof r === "object", "con invalidacion, no_encontrado se devuelve como objeto (DISENO 3), no como null");
    assert.equal(r.inventoryItemId, null, "NUNCA el item viejo: esa variante ya tiene otro SKU");
    assert.equal(r.cacheInvalidada, true);
    assert.equal(r.inventoryItemIdAnterior, item(700));
    assert.deepEqual(leerCacheSkuCruda(dir), { OTRO: item(5) }, "la entrada invalida se borra; las demas quedan");
  });
});

test("CA-1: el item cacheado aparece en la busqueda pero con un SKU prefijo-largo (cache envenenada de la era H4): se invalida", async (t) => {
  const entorno = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa([
      { n: 2, sku: SKU_PREFIJO_LARGO, niveles: { [LOCATION_DOT]: 3 } },
      { n: 1, sku: SKU_PREFIJO, niveles: { [LOCATION_DOT]: 7 } },
    ]);
    sembrarCacheSku(dir, { [SKU_PREFIJO]: item(2) });
    const r = await resolverInyectado(tienda, dir)(SKU_PREFIJO, LOCATION_DOT);
    controlesDeEntorno(entorno);
    unaBusquedaExacta(tienda, SKU_PREFIJO);
    assert.equal(r.inventoryItemId, item(1), "aparecer en los edges no alcanza: el sku del nodo tiene que ser el pedido");
    assert.equal(r.cacheInvalidada, true);
    assert.equal(r.cambioDeDestino, true);
    assert.equal(r.inventoryItemIdAnterior, item(2));
    assert.deepEqual(leerCacheSkuCruda(dir), { [SKU_PREFIJO]: item(1) });
  });
});

test("CA-1: cache invalida y X unico en otra variante W: devuelve W con cambioDeDestino, actualiza la cache y no repite la busqueda", async (t) => {
  const entorno = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa([
      { n: 184, sku: "IEY-OTRO-SKU", niveles: { [LOCATION_DOT]: 6 } },
      { n: 9184, sku: "IEY-X", niveles: { [LOCATION_DOT]: 1 } },
    ]);
    sembrarCacheSku(dir, { "IEY-X": item(184) });
    const r = await resolverInyectado(tienda, dir)("IEY-X", LOCATION_DOT);
    controlesDeEntorno(entorno);
    unaBusquedaExacta(tienda, "IEY-X");
    assert.equal(r.inventoryItemId, item(9184));
    assert.equal(r.available, 1);
    assert.equal(r.desdeCache, false);
    assert.equal(r.duplicados, 0);
    assert.equal(r.cacheInvalidada, true);
    assert.equal(r.cambioDeDestino, true);
    assert.equal(r.inventoryItemIdAnterior, item(184));
    assert.deepEqual(leerCacheSkuCruda(dir), { "IEY-X": item(9184) });
  });
});

test("CA-1: cache invalida y ahora X en dos variantes: SkuAmbiguoError con cacheInvalidada, y la entrada se borra", async (t) => {
  const entorno = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa([
      { n: 184, sku: "IEY-OTRO-SKU", niveles: { [LOCATION_DOT]: 6 } },
      { n: 501, sku: "IEY-X", niveles: { [LOCATION_DOT]: 1 } },
      { n: 502, sku: "IEY-X", niveles: { [LOCATION_DOT]: 2 } },
    ]);
    sembrarCacheSku(dir, { "IEY-X": item(184) });
    let error = null;
    try {
      await resolverInyectado(tienda, dir)("IEY-X", LOCATION_DOT);
    } catch (e) {
      error = e;
    }
    controlesDeEntorno(entorno);
    unaBusquedaExacta(tienda, "IEY-X");
    assert.ok(error instanceof shopify.SkuAmbiguoError, `tiene que lanzar SkuAmbiguoError, lanzo: ${error}`);
    assert.equal(error.candidatos.length, 2);
    assert.equal(error.cacheInvalidada, true);
    assert.equal(error.inventoryItemIdAnterior, item(184));
    assert.deepEqual(leerCacheSkuCruda(dir), {}, "ni el item viejo ni uno elegido al azar");
  });
});

test("CA-1: sin entrada en cache, igual que hoy: unico se usa y se cachea; dos es ambiguo sin cachear; ninguno (ni un prefijo-largo) es null", async (t) => {
  const entorno = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa([
      { n: 1, sku: "IEY-UNICO", niveles: { [LOCATION_DOT]: 5 } },
      { n: 2, sku: "IEY-DOBLE", niveles: { [LOCATION_DOT]: 1 } },
      { n: 3, sku: "IEY-DOBLE", niveles: { [LOCATION_DOT]: 1 } },
      { n: 4, sku: SKU_PREFIJO_LARGO, niveles: { [LOCATION_DOT]: 9 } },
    ]);
    const resolver = resolverInyectado(tienda, dir);

    const unico = await resolver("IEY-UNICO", LOCATION_DOT);
    assert.equal(unico.inventoryItemId, item(1));
    assert.equal(unico.available, 5);
    assert.equal(unico.desdeCache, false);
    assert.equal(unico.cacheInvalidada, false);
    assert.equal(unico.cambioDeDestino, false);
    assert.equal(unico.duplicados, 0);
    assert.deepEqual(leerCacheSkuCruda(dir), { "IEY-UNICO": item(1) });

    let error = null;
    try {
      await resolver("IEY-DOBLE", LOCATION_DOT);
    } catch (e) {
      error = e;
    }
    assert.ok(error instanceof shopify.SkuAmbiguoError, `dos variantes sin cache: ambiguo, como hoy (lanzo: ${error})`);
    assert.ok(!error.cacheInvalidada, "sin entrada previa no hubo invalidacion");
    assert.deepEqual(leerCacheSkuCruda(dir), { "IEY-UNICO": item(1) }, "un ambiguo no se cachea");

    assert.equal(await resolver("IEY-NO-EXISTE", LOCATION_DOT), null, "sin coincidencias y sin cache: null, como hoy");
    assert.equal(await resolver(SKU_PREFIJO, LOCATION_DOT), null, "solo el prefijo-largo: no es el SKU pedido");
    controlesDeEntorno(entorno);
    assert.equal(tienda.busquedas().length, 4, "una busqueda por resolucion");
    assert.equal(tienda.consultas.length, 4, "y ninguna otra consulta");
  });
});

test("CA-1: con cache presente, si la busqueda falla, resolverSku falla: no cae al item cacheado ni a GetLevel, y la cache queda intacta", async (t) => {
  const entorno = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa([{ n: 1, sku: "IEY-X", niveles: { [LOCATION_DOT]: 5 } }]);
    tienda.fallarBusqueda = true;
    sembrarCacheSku(dir, { "IEY-X": item(1) });
    await assert.rejects(resolverInyectado(tienda, dir)("IEY-X", LOCATION_DOT), /503/);
    controlesDeEntorno(entorno);
    assert.equal(tienda.busquedas().length, 1, "la verificacion se intento con la consulta inyectada");
    assert.equal(tienda.consultas.filter((c) => c.tipo === "nivel").length, 0, "sin GetLevel: un id sin verificar no se usa");
    assert.deepEqual(leerCacheSkuCruda(dir), { "IEY-X": item(1) }, "un fallo de red no invalida la cache");
  });
});

// -----------------------------------------------------------------------------
// Ronda 2 (02/11/2026), decision E2 del orquestador: tope de candidatos.
// La busqueda trae como maximo `first: 10` nodos (no se sube, por costo). Si
// Shopify avisa que quedaron coincidencias afuera (pageInfo.hasNextPage) y la
// variante establecida no esta entre las coincidencias exactas visibles, NO se
// sabe si fue renombrada: no se invalida, no se siembra y no se escribe; es un
// error visible. Escenario: 11 variantes coinciden con sku:"IEY-X"; entre las
// 10 visibles hay OTRA con el SKU exacto (W, n=2), y la cacheada (n=1) quedo
// afuera. Una implementacion que invalide sembraria en W (Duda 5 del contrato).
// -----------------------------------------------------------------------------
test("CA-1 (ronda 2, tope): con 11 coincidencias y la variante cacheada fuera de las 10 visibles, rechaza sin invalidar, sin GetLevel y con la cache intacta", async (t) => {
  assert.match(QUERY_POR_SKU_TEXTO(), /pageInfo\s*\{[^}]*\bhasNextPage\b/, "QUERY_POR_SKU pide pageInfo { hasNextPage }");
  const entorno = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa([
      { n: 2, sku: "IEY-X", niveles: { [LOCATION_DOT]: 3 } },
      ...prefijosLargos("IEY-X", 10, 9, { [LOCATION_DOT]: 1 }),
      { n: 1, sku: "IEY-X", niveles: { [LOCATION_DOT]: 5 } }, // la establecida, coincidencia 11
    ]);
    sembrarCacheSku(dir, { "IEY-X": item(1) });
    let error = null;
    try {
      await resolverInyectado(tienda, dir)("IEY-X", LOCATION_DOT);
    } catch (e) {
      error = e;
    }
    controlesDeEntorno(entorno);
    unaBusquedaExacta(tienda, "IEY-X");
    assert.equal(Number(tienda.consultas[0].variables.first), 10, "first: 10, no se sube por costo (decision E2)");
    assert.ok(error instanceof Error, `con la establecida fuera del tope, resolverSku lanza (devolvio sin lanzar o lanzo: ${error})`);
    assert.ok(!(error instanceof shopify.SkuAmbiguoError), "no es un ambiguo: es un error (no se sabe que paso con la establecida)");
    assert.equal(error.topeAlcanzado, true, "el error dice que se llego al tope");
    assert.ok(!error.cacheInvalidada, "no se invalida: la establecida puede seguir teniendo el SKU");
    assert.deepEqual(leerCacheSkuCruda(dir), { "IEY-X": item(1) }, "la cache queda intacta (ni borrada ni apuntando a W)");
  });
});

test("CA-1 (ronda 2, tope): llegar al tope no es error por si solo: sin entrada, o con la cacheada visible, devuelve la coincidencia con topeAlcanzado", async (t) => {
  const entorno = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa([
      { n: 2, sku: "IEY-X", niveles: { [LOCATION_DOT]: 3 } },
      ...prefijosLargos("IEY-X", 10, 10, { [LOCATION_DOT]: 1 }),
    ]);
    const resolver = resolverInyectado(tienda, dir);

    const sinEntrada = await resolver("IEY-X", LOCATION_DOT);
    assert.equal(sinEntrada.inventoryItemId, item(2), "sin entrada en cache: la unica coincidencia exacta visible, como hoy (R-5)");
    assert.equal(sinEntrada.topeAlcanzado, true);
    assert.equal(sinEntrada.variantId, variante(2));

    sembrarCacheSku(dir, { "IEY-X": item(2) });
    const visible = await resolver("IEY-X", LOCATION_DOT);
    assert.equal(visible.inventoryItemId, item(2), "la establecida esta entre las visibles: se usa");
    assert.equal(visible.desdeCache, true);
    assert.equal(visible.topeAlcanzado, true);
    assert.equal(visible.cacheInvalidada, false);
    controlesDeEntorno(entorno);
    assert.equal(tienda.busquedas().length, 2, "una busqueda por resolucion");
    assert.equal(tienda.consultas.length, 2, "ninguna otra consulta");
  });
});

// -----------------------------------------------------------------------------
// Ronda 3 (02/11/2026, importante I-1 de revisor-alcance): la regla del tope no
// depende de cuantas coincidencias exactas visibles haya. Con tope y la
// establecida fuera de las exactas visibles, sean 0, 1 o varias, no se sabe que
// paso con ella: no se invalida. Una implementacion que solo aplique el tope con
// un candidato unico caeria en R-3 con 2 o mas (SkuAmbiguoError y entrada
// borrada) o con 0 (no_encontrado y entrada borrada), y perderia la establecida.
// -----------------------------------------------------------------------------
async function afirmarRechazoPorTope(t, armarTienda) {
  const entorno = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa(armarTienda());
    sembrarCacheSku(dir, { "IEY-X": item(1) });
    let error = null;
    let devuelto;
    try {
      devuelto = await resolverInyectado(tienda, dir)("IEY-X", LOCATION_DOT);
    } catch (e) {
      error = e;
    }
    controlesDeEntorno(entorno);
    unaBusquedaExacta(tienda, "IEY-X");
    assert.equal(Number(tienda.consultas[0].variables.first), 10, "first: 10, no se sube por costo (decision E2)");
    assert.ok(error instanceof Error, `con la establecida fuera del tope, resolverSku lanza (devolvio ${JSON.stringify(devuelto)}, lanzo ${error})`);
    assert.ok(!(error instanceof shopify.SkuAmbiguoError), "no es un ambiguo: la establecida puede seguir teniendo el SKU fuera del tope");
    assert.equal(error.topeAlcanzado, true, "el error dice que se llego al tope");
    assert.ok(!error.cacheInvalidada, "no se invalida");
    assert.deepEqual(leerCacheSkuCruda(dir), { "IEY-X": item(1) }, "la cache queda intacta (ni borrada ni reescrita)");
  });
}

test("CA-1 (ronda 3, tope): DOS coincidencias exactas visibles distintas de la establecida, que quedo fuera de las 10: rechaza por tope, no es SkuAmbiguoError y la cache queda intacta", async (t) => {
  await afirmarRechazoPorTope(t, () => [
    { n: 2, sku: "IEY-X", niveles: { [LOCATION_DOT]: 3 } },
    { n: 3, sku: "IEY-X", niveles: { [LOCATION_DOT]: 4 } },
    ...prefijosLargos("IEY-X", 10, 8, { [LOCATION_DOT]: 1 }),
    { n: 1, sku: "IEY-X", niveles: { [LOCATION_DOT]: 5 } }, // la establecida, coincidencia 11
  ]);
});

test("CA-1 (ronda 3, tope): CERO coincidencias exactas visibles (solo prefijos largos) y la establecida fuera de las 10: rechaza por tope, no da no_encontrado y la cache queda intacta", async (t) => {
  await afirmarRechazoPorTope(t, () => [
    ...prefijosLargos("IEY-X", 10, 10, { [LOCATION_DOT]: 1 }),
    { n: 1, sku: "IEY-X", niveles: { [LOCATION_DOT]: 5 } }, // la establecida, coincidencia 11
  ]);
});

// El texto de la consulta, leido del modulo (namespace) para que su ausencia sea
// un fallo de este test y no un error de import de todo el archivo.
function QUERY_POR_SKU_TEXTO() {
  return String(shopify.QUERY_POR_SKU ?? "");
}
