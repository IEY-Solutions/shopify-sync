// CA-7 / R-8 — `verificar-cache-sku`.
//
// Visibilidad (invariante 5): el [RESUMEN] de cada par suma `duplicados` y
// `cache_invalidada`, SIEMPRE (tambien en 0), junto a las claves que ya tenia
// (clasificador y compuerta), sin nombrar SKUs (repo y logs publicos).
// ejecutarPar devuelve los dos contadores como numeros. Interfaz:
// DISENO-INTERFAZ.md 5.
//
// Corre con: node --test test/cache-sku-resumen.test.js
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
  capturarConsola,
  lineaResumen,
  valorEnResumen,
  CLAVES_NUEVAS_RESUMEN,
  PAR_DOT,
  DEPOSITO_DOT,
  LOCATION_DOT,
} from "./_helpers-clasificador.js";
import {
  SKU_APPLYFIT,
  SKU_C08N_S26ULTRA,
  SKU_C08P_S26ULTRA,
  item,
  tiendaFalsa,
  sembrarCacheSku,
  depsConCacheReal,
  aislarShopify,
} from "./_helpers-cache-sku.js";

const T = "2026-11-03T12:00:00.000Z";
const CLAVES_PREVIAS = [
  "actualizado",
  "dry",
  "sin_cambios",
  "no_encontrado",
  "no_activado",
  "error",
  "ambiguo",
  "no_sincronizable",
  "saltado",
  "total",
  ...CLAVES_NUEVAS_RESUMEN,
  "compuerta_pedidos",
  "compuerta_aplicados",
];

test("CA-7 (i): el [RESUMEN] muestra duplicados y cache_invalidada junto a todas las claves previas, sin nombrar SKUs, y ejecutarPar los devuelve", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_APPLYFIT]: 10, [SKU_C08N_S26ULTRA]: 5 },
      contabilium: { [SKU_APPLYFIT]: 10, [SKU_C08N_S26ULTRA]: 5 },
    });
    sembrarCacheSku(dir, { [SKU_APPLYFIT]: item(1701), [SKU_C08N_S26ULTRA]: item(700) });
    const tienda = tiendaFalsa([
      { n: 1301, sku: SKU_APPLYFIT, niveles: { [LOCATION_DOT]: 2 } },
      { n: 1701, sku: SKU_APPLYFIT, niveles: { [LOCATION_DOT]: 4 } },
      { n: 700, sku: SKU_C08P_S26ULTRA, niveles: { [LOCATION_DOT]: 3 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([[SKU_APPLYFIT, 9], [SKU_C08N_S26ULTRA, 4]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    const resumenes = lineaResumen(lineas, "dot");
    assert.equal(resumenes.length, 1, "un [RESUMEN] por par");
    const texto = resumenes[0].texto;
    for (const clave of [...CLAVES_PREVIAS, "duplicados", "cache_invalidada"]) {
      assert.notEqual(valorEnResumen(texto, clave), undefined, `el [RESUMEN] muestra ${clave}: "${texto}"`);
    }
    assert.equal(valorEnResumen(texto, "duplicados"), "1");
    assert.equal(valorEnResumen(texto, "cache_invalidada"), "1");
    assert.doesNotMatch(texto, /APPLYFIT|IEY-/, `el [RESUMEN] no nombra SKUs: "${texto}"`);
    assert.equal(res.duplicados, 1);
    assert.equal(res.cache_invalidada, 1);
  });
});

test("CA-7 (i): en una corrida sin duplicados ni invalidaciones las dos claves aparecen en 0", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 4 }, contabilium: { "IEY-A": 4 } });
    sembrarCacheSku(dir, { "IEY-A": item(1) });
    const tienda = tiendaFalsa([{ n: 1, sku: "IEY-A", niveles: { [LOCATION_DOT]: 4 } }]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 3]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    const [r] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(r.texto, "duplicados"), "0");
    assert.equal(valorEnResumen(r.texto, "cache_invalidada"), "0");
    assert.equal(res.duplicados, 0);
    assert.equal(res.cache_invalidada, 0);
    assert.equal(res.actualizado, 1, "control: la corrida resolvio y escribio con el resolverSku inyectado");
  });
});

// Ronda 2: un error de ESCRITURA despues de invalidar cuenta en los dos lados:
// cache_invalidada (la entrada dejo de valer) y error (no quedo escrito). El
// destino de la libreta se conserva, asi la corrida siguiente vuelve a sembrar.
test("CA-7 (ronda 2): un error de escritura despues de invalidar cuenta en cache_invalidada y en error, y el intento fue en la variante nueva", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 10 }, contabilium: { "IEY-X": 10 } });
    sembrarCacheSku(dir, { "IEY-X": item(700) });
    const tienda = tiendaFalsa([
      { n: 700, sku: "IEY-Y", niveles: { [LOCATION_DOT]: 9 } },
      { n: 800, sku: "IEY-X", niveles: { [LOCATION_DOT]: 1 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-X", 7]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });
    const intentos = [];
    deps.setearStock = async (inventoryItemId, quantity) => {
      intentos.push({ inventoryItemId, quantity });
      throw new Error("Shopify HTTP 500 (simulado)");
    };

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(intentos, [{ inventoryItemId: item(800), quantity: 7 }], "intento sembrar 7 en la variante nueva, nunca en la vieja");
    assert.equal(res.error, 1);
    assert.equal(res.cache_invalidada, 1);
    const [r] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(r.texto, "error"), "1");
    assert.equal(valorEnResumen(r.texto, "cache_invalidada"), "1");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-X"], 10, "sin escritura, el baseline no avanza");
    assert.equal(
      libreta.destinos?.["IEY-X"],
      item(700),
      "el destino (inicializado por SKU con la cache del inicio) se conserva: la corrida siguiente vuelve a sembrar"
    );
  });
});
