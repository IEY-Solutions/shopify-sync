// CA-2 / R-2 — `verificar-cache-sku`. Caso real de produccion.
//
// Decision de la persona (02/11/2026), ante un SKU repetido que ya se venia
// escribiendo en una variante: "Seguir en la variante establecida y avisar
// (Recommended)". Con la cache valida (el item cacheado sigue teniendo el SKU
// exacto), ejecutarPar escribe en ESA variante aunque haya otras con el mismo
// SKU, cuenta `duplicados` en el [RESUMEN] del par, imprime una linea [AVISO]
// con el SKU y la cantidad de variantes, y NO pone la corrida en rojo.
//
// Caso real: IEY-COMBO-CARBON-VERDE-IP16E esta en 5 variantes (migrado de
// APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E, T02, R-15); el sync escribio solo en
// la variante establecida (24/10 +10, despues -1, -1 y -1, la ultima el 31/10
// 18:01 UTC) sin detectar la ambiguedad. Interfaz: DISENO-INTERFAZ.md 4 y 5.
//
// Corre con: node --test test/cache-sku-duplicados.test.js
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
  leerLibretaCruda,
  capturarConsola,
  lineaResumen,
  valorEnResumen,
  PAR_DOT,
  PAR_ISLA,
  DEPOSITO_DOT,
  DEPOSITO_ISLA,
  LOCATION_DOT,
  LOCATION_ISLA,
} from "./_helpers-clasificador.js";
import {
  SKU_APPLYFIT,
  SKU_PREFIJO,
  SKU_PREFIJO_LARGO,
  item,
  variante,
  tiendaFalsa,
  sembrarCacheSku,
  leerCacheSkuCruda,
  depsConCacheReal,
  escriturasEn,
  aislarShopify,
  lineasDeAviso,
} from "./_helpers-cache-sku.js";

const T = "2026-10-31T18:00:00.000Z";

function tiendaApplyfit() {
  return tiendaFalsa([
    { n: 1301, sku: SKU_APPLYFIT, titulo: "iPhone 13", niveles: { [LOCATION_DOT]: 2 } },
    { n: 1302, sku: SKU_APPLYFIT, titulo: "iPhone 13 Pro", niveles: { [LOCATION_DOT]: 0 } },
    { n: 1401, sku: SKU_APPLYFIT, titulo: "iPhone 14", niveles: { [LOCATION_DOT]: 1 } },
    { n: 1601, sku: SKU_APPLYFIT, titulo: "iPhone 16e", niveles: { [LOCATION_DOT]: 3 } },
    { n: 1701, sku: SKU_APPLYFIT, titulo: "iPhone 17e", niveles: { [LOCATION_DOT]: 4 } },
  ]);
}

test("CA-2 (caso real APPLYFIT): cache valida con 4 variantes mas del mismo SKU: escribe el delta en la 17e establecida, duplicados=1, una linea [AVISO] con 5 variantes, y la corrida no queda en rojo", async (t) => {
  const { violacionesFs, llamadasFetch } = aislarShopify(t);
  await conDirTemporal(async (dir) => {
    // La ultima corrida dejo el baseline en 10; el mostrador vendio 1.
    sembrarLibreta(dir, "dot", { skus: { [SKU_APPLYFIT]: 10 }, contabilium: { [SKU_APPLYFIT]: 10 } });
    sembrarCacheSku(dir, { [SKU_APPLYFIT]: item(1701) });
    const tienda = tiendaApplyfit();
    const stock = new Map([[DEPOSITO_DOT, new Map([[SKU_APPLYFIT, 9]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(llamadasFetch, [], "sin red real");
    assert.deepEqual(violacionesFs, [], "sin escrituras en el repo");
    assert.deepEqual(
      tienda.escrituras,
      [{ inventoryItemId: item(1701), quantity: 3, changeFromQuantity: 4, locationId: LOCATION_DOT }],
      "una sola escritura, en la 17e: 4 + (9 - 10) = 3"
    );
    for (const n of [1301, 1302, 1401, 1601]) assert.deepEqual(escriturasEn(tienda, n), [], `nada en la variante ${n}`);
    assert.equal(res.actualizado, 1);
    assert.equal(res.ambiguo, 0, "con la cache valida no es ambiguo: la persona eligio seguir en la establecida");
    assert.equal(res.duplicados, 1, "un SKU del par con duplicados");
    assert.equal(res.cache_invalidada, 0);

    const [resumen] = lineaResumen(lineas, "dot");
    assert.ok(resumen, "hay [RESUMEN] del par");
    assert.equal(valorEnResumen(resumen.texto, "duplicados"), "1");
    assert.equal(valorEnResumen(resumen.texto, "cache_invalidada"), "0");

    const avisos = lineasDeAviso(lineas, "dot", SKU_APPLYFIT);
    assert.equal(avisos.length, 1, `una linea "[AVISO] dot/${SKU_APPLYFIT}: ..." por SKU: ${JSON.stringify(lineas.map((l) => l.texto))}`);
    assert.match(avisos[0].texto, /\b5 variantes\b/, "el aviso dice cuantas variantes tienen el SKU exacto");
    assert.ok(
      avisos[0].texto.includes(variante(1701)),
      `ronda 2 (E1): el aviso DEBE nombrar la variante establecida (${variante(1701)}) para cotejarla con el analisis: "${avisos[0].texto}"`
    );

    assert.equal(evaluarCorrida(res).ok, true, "los duplicados se avisan, no ponen la corrida en rojo (invariante 5 con aviso visible)");
    assert.equal(leerLibretaCruda(dir, "dot").contabilium[SKU_APPLYFIT], 9, "el baseline avanza como en cualquier delta");
    assert.deepEqual(leerCacheSkuCruda(dir), { [SKU_APPLYFIT]: item(1701) }, "la variante establecida sigue en la cache");
  });
});

test("CA-2: en DRY_RUN el SKU con duplicados tambien se avisa y se cuenta, sin escribir", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { [SKU_APPLYFIT]: 10 }, contabilium: { [SKU_APPLYFIT]: 10 } });
    sembrarCacheSku(dir, { [SKU_APPLYFIT]: item(1701) });
    const tienda = tiendaApplyfit();
    const stock = new Map([[DEPOSITO_DOT, new Map([[SKU_APPLYFIT, 9]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, dryRun: true, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(tienda.escrituras, [], "DRY_RUN no escribe");
    assert.equal(res.dry, 1, "simula la escritura en la establecida");
    assert.equal(res.duplicados, 1);
    const avisos = lineasDeAviso(lineas, "dot", SKU_APPLYFIT);
    assert.equal(avisos.length, 1);
    assert.ok(avisos[0]?.texto.includes(variante(1701)), "ronda 2 (E1): tambien en DRY_RUN nombra la establecida");
    assert.deepEqual(res.planDry.map((p) => [p.actual, p.nuevoValor]), [[4, 3]], "el plan usa el available de la 17e");
  });
});

test("CA-2: un SKU cuyo unico 'otro' resultado es un SKU prefijo-largo no tiene duplicados ni aviso (invariante 3)", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { [SKU_PREFIJO]: 6 }, contabilium: { [SKU_PREFIJO]: 6 } });
    sembrarCacheSku(dir, { [SKU_PREFIJO]: item(1) });
    const tienda = tiendaFalsa([
      { n: 2, sku: SKU_PREFIJO_LARGO, niveles: { [LOCATION_DOT]: 8 } },
      { n: 1, sku: SKU_PREFIJO, niveles: { [LOCATION_DOT]: 6 } },
    ]);
    const stock = new Map([[DEPOSITO_DOT, new Map([[SKU_PREFIJO, 5]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(escriturasEn(tienda, 1), [5], "6 + (5 - 6) = 5 en la variante del SKU exacto");
    assert.deepEqual(escriturasEn(tienda, 2), [], "nunca en la del SKU prefijo-largo");
    assert.equal(res.duplicados, 0);
    assert.equal(lineas.filter((l) => l.texto.includes("[AVISO]")).length, 0, "sin aviso");
  });
});

// -----------------------------------------------------------------------------
// Ronda 2 (02/11/2026, arreglo tras revisor-alcance)
// -----------------------------------------------------------------------------

test("CA-2 (ronda 2): en la isla el aviso lleva el prefijo [AVISO] galerias-pacifico/<sku>: y nombra la establecida de la isla", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "galerias-pacifico", { skus: { [SKU_APPLYFIT]: 3 }, contabilium: { [SKU_APPLYFIT]: 3 } });
    sembrarCacheSku(dir, { [SKU_APPLYFIT]: item(1701) });
    const tienda = tiendaFalsa([
      { n: 1301, sku: SKU_APPLYFIT, niveles: { [LOCATION_ISLA]: 1 } },
      { n: 1701, sku: SKU_APPLYFIT, niveles: { [LOCATION_ISLA]: 2 } },
    ]);
    const stock = new Map([[DEPOSITO_ISLA, new Map([[SKU_APPLYFIT, 2]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias() });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_ISLA, deps));

    assert.deepEqual(escriturasEn(tienda, 1701, LOCATION_ISLA), [1], "2 + (2 - 3) = 1 en la establecida, en la location de la isla");
    assert.deepEqual(escriturasEn(tienda, 1301, LOCATION_ISLA), []);
    assert.equal(res.duplicados, 1);
    const avisos = lineasDeAviso(lineas, "galerias-pacifico", SKU_APPLYFIT);
    assert.equal(avisos.length, 1, `una linea "[AVISO] galerias-pacifico/${SKU_APPLYFIT}: ...": ${JSON.stringify(lineas.map((l) => l.texto))}`);
    assert.match(avisos[0].texto, /\b2 variantes\b/);
    assert.ok(avisos[0].texto.includes(variante(1701)));
    assert.equal(lineasDeAviso(lineas, "dot", SKU_APPLYFIT).length, 0, "el prefijo es el del par que avisa, no dot/");
    const [resumen] = lineaResumen(lineas, "galerias-pacifico");
    assert.equal(valorEnResumen(resumen.texto, "duplicados"), "1");
  });
});

// El [AVISO] frente al CA-4 del clasificador (docs/contratos/clasificador-causa-comprobante.md,
// CA-4; ADR 0001:45: causa_desconocida es metrica agregada, nunca alerta por SKU).
// Decision del orquestador (ronda 2): el [AVISO] de duplicados es una alerta de
// CATALOGO, acotada a SKUs con duplicados, que no menciona la causa; queda como
// excepcion explicita, igual que [SET] y [DRY]. Este caso fija los dos lados: el
// aviso sale aunque el SKU cuente en causa_desconocida, y ninguna linea que hable
// de "desconocid" lo nombra.
test("CA-2 (ronda 2): con la busqueda de comprobantes caida, el SKU con duplicados cuenta en causa_desconocida, el [AVISO] sale igual y ninguna linea con 'desconocid' lo nombra", async (t) => {
  aislarShopify(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_APPLYFIT]: 10 },
      contabilium: { [SKU_APPLYFIT]: 10 },
      corte: "2026-10-01T00:00:00.000Z",
    });
    sembrarCacheSku(dir, { [SKU_APPLYFIT]: item(1701) });
    const tienda = tiendaApplyfit();
    const stock = new Map([[DEPOSITO_DOT, new Map([[SKU_APPLYFIT, 9]])]]);
    const deps = depsConCacheReal({ dir, tienda, reloj: reloj(T), stock, llamadas: llamadasVacias(), fallaBusqueda: true });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.clasificador, "fallo", "control: la busqueda de comprobantes cayo");
    assert.deepEqual(escriturasEn(tienda, 1701), [3], "el delta se aplica igual, sin credito (CA-4 del clasificador)");
    assert.equal(res.causa_desconocida, 1, "control: el SKU cuenta en causa_desconocida");
    assert.equal(res.duplicados, 1);

    const avisos = lineasDeAviso(lineas, "dot", SKU_APPLYFIT);
    assert.equal(avisos.length, 1, "la alerta de catalogo sale aunque el SKU cuente en causa_desconocida");
    assert.ok(avisos[0].texto.includes(variante(1701)));
    for (const l of lineas) {
      if (!/desconocid/i.test(l.texto)) continue;
      assert.ok(!l.texto.includes(SKU_APPLYFIT), `ninguna linea que hable de la causa nombra el SKU: "${l.texto}"`);
    }
  });
});
