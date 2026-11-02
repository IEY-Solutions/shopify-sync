// CA-6 / R-7 — `verificar-cache-sku`.
//
// Costo: como maximo UNA busqueda en Shopify por SKU resuelto (la misma
// consulta que hoy hace un fallo de cache), ninguna GetLevel, y el atajo
// incremental no cambia: un SKU sin cambios en Contabilium no se resuelve ni
// se escribe (AGENTS.md, Limites externos: balde de puntos de Shopify).
// Interfaz: DISENO-INTERFAZ.md 2 y 6.
//
// Corre con: node --test test/cache-sku-costo.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import {
  conDirTemporal,
  llamadasVacias,
  reloj,
  sembrarLibreta,
  PAR_DOT,
  DEPOSITO_DOT,
  LOCATION_DOT,
} from "./_helpers-clasificador.js";
import {
  item,
  tiendaFalsa,
  sembrarCacheSku,
  leerCacheSkuCruda,
  depsConCacheReal,
  aislarShopify,
} from "./_helpers-cache-sku.js";

const T = "2026-11-03T12:00:00.000Z";

test("CA-6 (h): una busqueda por SKU resuelto (cache valida, sin cache o cache renombrada), ninguna GetLevel, y el SKU del atajo sin ninguna consulta", async (t) => {
  const { violacionesFs, llamadasFetch } = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { "IEY-QUIETO": 5, "IEY-VALIDO": 4, "IEY-RENOMBRADO": 9 },
      contabilium: { "IEY-QUIETO": 5, "IEY-VALIDO": 4, "IEY-RENOMBRADO": 9 },
    });
    sembrarCacheSku(dir, { "IEY-QUIETO": item(1), "IEY-VALIDO": item(2), "IEY-RENOMBRADO": item(3) });
    const tienda = tiendaFalsa([
      { n: 1, sku: "IEY-QUIETO", niveles: { [LOCATION_DOT]: 5 } },
      { n: 2, sku: "IEY-VALIDO", niveles: { [LOCATION_DOT]: 4 } },
      { n: 3, sku: "IEY-OTRO", niveles: { [LOCATION_DOT]: 9 } },
      { n: 4, sku: "IEY-RENOMBRADO", niveles: { [LOCATION_DOT]: 2 } },
      { n: 5, sku: "IEY-SIN-CACHE", niveles: { [LOCATION_DOT]: 0 } },
    ]);
    const stock = new Map([
      [
        DEPOSITO_DOT,
        new Map([
          ["IEY-QUIETO", 5], // sin cambios: atajo
          ["IEY-VALIDO", 3],
          ["IEY-RENOMBRADO", 8],
          ["IEY-SIN-CACHE", 1],
        ]),
      ],
    ]);
    const llamadas = llamadasVacias();
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.deepEqual(llamadasFetch, [], "sin red real");
    assert.deepEqual(violacionesFs, [], "sin escrituras en el repo");
    assert.equal(res.saltado, 1, "el atajo incremental sigue igual");
    assert.deepEqual(
      llamadas.resolverSku.map((l) => l.sku),
      ["IEY-VALIDO", "IEY-RENOMBRADO", "IEY-SIN-CACHE"],
      "el SKU sin cambios no se resuelve"
    );
    assert.deepEqual(
      tienda.consultas.map((c) => [c.tipo, c.variables.query]),
      [
        ["busqueda", 'sku:"IEY-VALIDO"'],
        ["busqueda", 'sku:"IEY-RENOMBRADO"'],
        ["busqueda", 'sku:"IEY-SIN-CACHE"'],
      ],
      "exactamente una busqueda por SKU resuelto (la cache renombrada no dispara una segunda) y ninguna GetLevel"
    );
    assert.equal(res.actualizado, 3);
    assert.deepEqual(leerCacheSkuCruda(dir), {
      "IEY-QUIETO": item(1),
      "IEY-VALIDO": item(2),
      "IEY-RENOMBRADO": item(4),
      "IEY-SIN-CACHE": item(5),
    });
  });
});

test("CA-6 (h): si la busqueda falla con cache presente, el SKU queda en error sin escribir y sin caer a GetLevel", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-X": 4 }, contabilium: { "IEY-X": 4 } });
    sembrarCacheSku(dir, { "IEY-X": item(2) });
    const tienda = tiendaFalsa([{ n: 2, sku: "IEY-X", niveles: { [LOCATION_DOT]: 4 } }]);
    tienda.fallarBusqueda = true;
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-X", 3]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.error, 1);
    assert.deepEqual(tienda.escrituras, [], "un id sin verificar no se usa para escribir");
    assert.deepEqual(tienda.consultas.map((c) => c.tipo), ["busqueda"], "se intento la busqueda y no hubo GetLevel");
    assert.deepEqual(leerCacheSkuCruda(dir), { "IEY-X": item(2) }, "un fallo de red no invalida la cache");
  });
});
