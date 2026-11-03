// CA-4 — No-regresion: un SKU repetido que NO esta en la lista curada de R-1
// sigue exactamente igual que antes de la feature `sku-universal-multivarianta`
// (R-6, R-9). T09.
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca4-no-regresion.md
// (A, B, C). El escenario D (atajo del incremental) ya lo cubre
// `test/sku-universal-5-variantes.test.js` ("R-14") para el curado; aca se
// prueba el control explicito de que un SKU no curado sigue salteandose igual.
//
// Corre con: node --test test/sku-no-universal-sin-regresion.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { SkuAmbiguoError } from "../src/shopify.js";
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
  item,
  variante,
  tiendaFalsa,
  sembrarCacheSku,
  leerCacheSkuCruda,
  depsConCacheReal,
  escriturasEn,
  lineasDeAviso,
} from "./_helpers-cache-sku.js";

const T = "2026-11-03T12:00:00.000Z";

// A — IEY-COMBO-CARBON-VERDE-IP16E con variante establecida: 16e y 17e, 4/0.
test("CA-4 A: con variante establecida, [AVISO] y escritura solo en la establecida (idem hoy)", async (t) => {
  const SKU = "IEY-COMBO-CARBON-VERDE-IP16E";
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { [SKU]: 2 }, contabilium: { [SKU]: 2 }, extra: { destinos: { [SKU]: item(9040001) } } });
    sembrarCacheSku(dir, { [SKU]: item(9040001) });
    const tienda = tiendaFalsa([
      { n: 9040001, sku: SKU, titulo: "16e", niveles: { [LOCATION_DOT]: 4 } },
      { n: 9040002, sku: SKU, titulo: "17e", niveles: { [LOCATION_DOT]: 0 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([[SKU, 5]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(tienda.escrituras, [{ inventoryItemId: item(9040001), quantity: 7, changeFromQuantity: 4, locationId: LOCATION_DOT }]);
    const avisos = lineasDeAviso(lineas, "dot", SKU);
    assert.equal(avisos.length, 1);
    assert.ok(avisos[0].texto.includes(variante(9040001)));
    assert.ok(
      lineas.some((l) => l.texto === `  [SET] dot/${SKU}: 4 -> 7`),
      `falta la linea [SET] exacta: ${JSON.stringify(lineas.map((l) => l.texto))}`
    );
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")), "ninguna linea [UNIVERSAL] para un SKU no curado");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU], 5);
    assert.equal(libreta.skus[SKU], 5);
    assert.equal(libreta.destinos?.[SKU], item(9040001));
    assert.equal(libreta.pendiente?.[SKU], undefined);
    assert.equal(libreta.pendientes?.[SKU], undefined);
    assert.equal(libreta.escrito?.[SKU], undefined);
    assert.equal(libreta.escritos?.[SKU], undefined);

    const [resumen] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(resumen.texto, "actualizado"), "1");
    assert.equal(valorEnResumen(resumen.texto, "duplicados"), "1");
    assert.equal(valorEnResumen(resumen.texto, "universales"), "0");
    assert.equal(valorEnResumen(resumen.texto, "universales_pendientes"), "0");
    assert.equal(valorEnResumen(resumen.texto, "cache_invalidada"), "0");
  });
});

// B — IEY-COMBO-IEYC08P-CARBON-NEGRO-IP16E sin variante establecida: SkuAmbiguoError.
test("CA-4 B: sin variante establecida, SkuAmbiguoError y cero mutaciones (idem hoy)", async (t) => {
  const SKU = "IEY-COMBO-IEYC08P-CARBON-NEGRO-IP16E";
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa([
      { n: 9040011, sku: SKU, titulo: "Combo IEYC08P", niveles: { [LOCATION_DOT]: 3 } },
      { n: 9040012, sku: SKU, titulo: "Combo IEYC08P", niveles: { [LOCATION_DOT]: 0 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([[SKU, 3]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.ambiguo, 1);
    assert.equal(res.duplicados, 0);
    assert.equal(res.universales, 0);
    assert.equal(res.universales_pendientes, 0);
    assert.deepEqual(tienda.escrituras, []);
    assert.ok(
      lineas.some((l) => l.texto === `  [SKIP] dot/${SKU}: SKU ambiguo: 2 variantes de Shopify tienen el sku exacto "${SKU}" -> no se escribe`)
    );
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));
    assert.ok(!lineas.some((l) => l.texto.includes("[AVISO]")));

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium?.[SKU], undefined);
    assert.equal(libreta.destinos?.[SKU], undefined);
    assert.equal(libreta.pendientes?.[SKU], undefined);
    assert.equal(libreta.escritos?.[SKU], undefined);
    assert.deepEqual(leerCacheSkuCruda(dir), {});
  });
});

// C — control: forma de universal (prefijo APPLYFIT-CLEAR-, dos modelos, dos
// variantes exactas) pero FUERA de la lista curada: sigue ambiguo (R-1 no es
// heuristica, R-6).
test("CA-4 C: control con forma de universal fuera de la lista curada: SkuAmbiguoError, nunca el camino universal", async (t) => {
  const SKU = "APPLYFIT-CLEAR-IP17-17PRO";
  await conDirTemporal(async (dir) => {
    const tienda = tiendaFalsa([
      { n: 9050001, sku: SKU, titulo: "ApplyFit 17", niveles: { [LOCATION_DOT]: 4 } },
      { n: 9050002, sku: SKU, titulo: "ApplyFit 17", niveles: { [LOCATION_DOT]: 4 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([[SKU, 5]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.ambiguo, 1);
    assert.equal(res.universales, 0);
    assert.deepEqual(tienda.escrituras, [], "en particular, nunca escribe 5 en las dos variantes");
    assert.ok(
      lineas.some((l) => l.texto === `  [SKIP] dot/${SKU}: SKU ambiguo: 2 variantes de Shopify tienen el sku exacto "${SKU}" -> no se escribe`)
    );
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")));
  });
});
