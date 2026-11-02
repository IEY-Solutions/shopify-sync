// CA-4 / R-5 — `verificar-cache-sku`.
//
// Sin entrada en la cache, el comportamiento es el de hoy: busqueda exacta; un
// solo resultado se usa y se cachea; mas de uno es `ambiguo` sin escritura;
// ninguno es `no_encontrado`. Un SKU con baseline en una libreta que todavia no
// conoce su destino (libreta de antes de esta feature) aplica el delta como
// hoy: nunca se siembra el catalogo entero por falta de dato (invariante 1).
// Interfaz: DISENO-INTERFAZ.md 3 y 4.
//
// Corre con: node --test test/cache-sku-sin-cache.test.js
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
  PAR_DOT,
  DEPOSITO_DOT,
  LOCATION_DOT,
} from "./_helpers-clasificador.js";
import {
  SKU_PREFIJO,
  SKU_PREFIJO_LARGO,
  item,
  tiendaFalsa,
  leerCacheSkuCruda,
  depsConCacheReal,
  escriturasEn,
  aislarShopify,
} from "./_helpers-cache-sku.js";

const T = "2026-11-03T12:00:00.000Z";

test("CA-4 (e): sin cache, igual que hoy: unico nuevo se siembra y se cachea, unico con baseline aplica el delta, dos variantes es ambiguo, ninguna (ni un prefijo-largo) es no_encontrado", async (t) => {
  const { violacionesFs, llamadasFetch } = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    // IEY-BASE trae baseline de una libreta anterior a esta feature (sin destinos).
    sembrarLibreta(dir, "dot", { skus: { "IEY-BASE": 10 }, contabilium: { "IEY-BASE": 10 } });
    const tienda = tiendaFalsa([
      { n: 1, sku: "IEY-NUEVO", niveles: { [LOCATION_DOT]: 2 } },
      { n: 2, sku: "IEY-BASE", niveles: { [LOCATION_DOT]: 6 } },
      { n: 3, sku: "IEY-DOBLE", niveles: { [LOCATION_DOT]: 1 } },
      { n: 4, sku: "IEY-DOBLE", niveles: { [LOCATION_DOT]: 1 } },
      { n: 5, sku: SKU_PREFIJO_LARGO, niveles: { [LOCATION_DOT]: 9 } },
    ]);
    const stock = new Map([
      [
        DEPOSITO_DOT,
        new Map([
          ["IEY-NUEVO", 4],
          ["IEY-BASE", 8],
          ["IEY-DOBLE", 3],
          ["IEY-NO-EXISTE", 1],
          [SKU_PREFIJO, 2],
        ]),
      ],
    ]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(llamadasFetch, [], "sin red real");
    assert.deepEqual(violacionesFs, [], "sin escrituras en el repo");
    assert.deepEqual(escriturasEn(tienda, 1), [4], "IEY-NUEVO sin baseline: siembra el absoluto");
    assert.deepEqual(escriturasEn(tienda, 2), [4], "IEY-BASE con baseline y sin cache: delta como hoy, 6 + (8 - 10) = 4, no el absoluto 8");
    assert.deepEqual(escriturasEn(tienda, 3), [], "ambiguo: no se escribe");
    assert.deepEqual(escriturasEn(tienda, 4), [], "ambiguo: no se escribe");
    assert.deepEqual(escriturasEn(tienda, 5), [], "nunca en el SKU prefijo-largo");
    assert.equal(res.actualizado, 2);
    assert.equal(res.ambiguo, 1);
    assert.equal(res.no_encontrado, 2, "IEY-NO-EXISTE y el SKU prefijo");
    assert.equal(res.duplicados, 0);
    assert.equal(res.cache_invalidada, 0);
    const [resumen] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(resumen.texto, "duplicados"), "0");
    assert.equal(valorEnResumen(resumen.texto, "cache_invalidada"), "0");
    assert.deepEqual(leerCacheSkuCruda(dir), { "IEY-NUEVO": item(1), "IEY-BASE": item(2) }, "se cachean solo los resueltos unicos");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-BASE"], 8);
    assert.equal(libreta.resembradoEn?.["IEY-BASE"], undefined, "un delta no resiembra");
    assert.equal(libreta.resembradoEn?.["IEY-NUEVO"], T);
  });
});
