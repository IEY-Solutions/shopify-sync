// R-5 / CA-5 — regresion del censo de agosto con la regla contable del diseño B.
//
// Caso REAL (AGENTS.md: "todo fix lleva su test de regresion, con el caso real
// que lo produjo"): orden Shopify #4586, facturada a mano contra el DOT en el
// comprobante 177960828 (FCB, Origen Shopify, IDIntegracion 25020, Inventario
// 127356, IEY-C09-GRIS x1, FechaEmision "2026-08-12T19:14:29.66" SIN zona = hora
// de Argentina). Shopify ya habia descontado la unidad al vender online;
// Contabilium la desconto al facturar. Con delta puro, el sync la descontaba
// otra vez en Shopify: doble descuento.
//
// Regla (DISENO-INTERFAZ.md seccion 2):
//   valor = shopifyActual + (contabiliumActual - baseline) + creditoAcreditable
//   credito = lineas Shopify del deposito del par, no consumidas, con
//             referencia < tInicioLectura - margen (5 min por defecto).
//
// TZ=UTC como el runner: si la fecha sin zona se parsea con la zona del proceso
// (19:14Z en vez de 22:14Z), el caso "19:16 ART" acredita antes de tiempo.
//
// Corre con: node --test test/regresion-censo-agosto.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import * as clasif from "../src/clasificador-causa.js";
import {
  conDirTemporal,
  depsFake,
  llamadasVacias,
  reloj,
  sembrarLibreta,
  leerLibretaCruda,
  comprobanteReal,
  comprobanteDetalle,
  resumenSearch,
  escriturasDe,
  PAR_DOT,
  PAR_ISLA,
  DEPOSITO_DOT,
  DEPOSITO_ISLA,
  LOCATION_DOT,
  LOCATION_ISLA,
  REFERENCIA_REAL_177960828,
  SKU_CENSO,
  MIN,
  HORA,
} from "./_helpers-clasificador.js";

const CORTE_VIEJO = "2026-08-01T00:00:00.000Z"; // el registro ya estaba en uso: nada es pre-corte
const CLAVE_CENSO = `177960828:${SKU_CENSO}`;

function todasEnteras(llamadas) {
  for (const s of llamadas.setearStock) {
    assert.ok(Number.isInteger(s.quantity), `cantidad no entera escrita en Shopify: ${s.quantity} (invariante 6)`);
  }
}

// Escenario base: baseline 5, Contabilium bajo a 4 (factura #4586), Shopify ya en 4.
function escenarioCenso(dir, { ahoraIso, contabiliumAhora = 4, shopifyAhora = 4, baseline = 5, llamadas = llamadasVacias() }) {
  sembrarLibreta(dir, "dot", { skus: { [SKU_CENSO]: baseline }, contabilium: { [SKU_CENSO]: baseline }, corte: CORTE_VIEJO });
  const r = reloj(ahoraIso);
  const stock = new Map([[DEPOSITO_DOT, new Map([[SKU_CENSO, contabiliumAhora]])]]);
  const shopify = new Map([[LOCATION_DOT, new Map([[SKU_CENSO, shopifyAhora]])]]);
  const deps = depsFake({
    dir,
    reloj: r,
    stock,
    shopify,
    search: [resumenSearch(177960828, "FCB")],
    detalles: new Map([[177960828, comprobanteReal()]]),
    llamadas,
  });
  return { deps, r, stock, shopify, llamadas };
}

// -----------------------------------------------------------------------------
// Funcion pura
// -----------------------------------------------------------------------------

test("CA-5 (pura): creditoAcreditable acredita la linea real solo si su referencia es anterior a tInicioLectura - 5 min, y nunca una consumida", () => {
  const lineas = clasif.lineasAcreditables(comprobanteReal(), DEPOSITO_DOT);
  assert.equal(clasif.MARGEN_ACREDITACION_MS, 5 * MIN);

  // 19:30 ART: 15 min despues de la venta -> acreditable.
  const a = clasif.creditoAcreditable({ lineas, consumos: {}, tInicioLectura: new Date("2026-08-12T22:30:00.000Z") });
  assert.deepEqual(a, { credito: 1, claves: [CLAVE_CENSO] });

  // 19:16 ART: 1,5 min despues -> dentro del margen, todavia no.
  const b = clasif.creditoAcreditable({ lineas, consumos: {}, tInicioLectura: new Date("2026-08-12T22:16:00.000Z") });
  assert.deepEqual(b, { credito: 0, claves: [] });

  // Ya consumida -> nunca mas.
  const c = clasif.creditoAcreditable({
    lineas,
    consumos: { [CLAVE_CENSO]: { cantidad: 1, motivo: "delta" } },
    tInicioLectura: new Date("2026-08-13T22:30:00.000Z"),
  });
  assert.deepEqual(c, { credito: 0, claves: [] });

  // El margen es configurable.
  const d = clasif.creditoAcreditable({ lineas, consumos: {}, tInicioLectura: new Date("2026-08-12T22:16:00.000Z"), margenMs: 60_000 });
  assert.equal(d.credito, 1);
});

// -----------------------------------------------------------------------------
// El caso real, de punta a punta por ejecutarPar
// -----------------------------------------------------------------------------

test("CA-5: censo de agosto (177960828, IEY-C09-GRIS, orden #4586): delta -1 NO escribe en Shopify y la linea queda consumida", async () => {
  await conDirTemporal(async (dir) => {
    const { deps, llamadas } = escenarioCenso(dir, { ahoraIso: "2026-08-12T22:30:00.000Z" });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.deepEqual(escriturasDe(llamadas, SKU_CENSO), [], "4 + (-1) + 1 = 4 = Shopify: no se vuelve a descontar (con delta puro escribia 3)");
    assert.equal(res.causa_venta_shopify, 1, "una unidad acreditada");
    assert.equal(res.clasificador, "ok");
    assert.equal(res.causa_desconocida, 0);

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_CENSO], 4, "el baseline avanza");
    assert.ok(libreta.consumos?.[CLAVE_CENSO], `la linea ${CLAVE_CENSO} queda consumida en la misma libreta`);
    assert.equal(libreta.consumos[CLAVE_CENSO].cantidad, 1);
    assert.equal(libreta.consumos[CLAVE_CENSO].motivo, "delta");
    todasEnteras(llamadas);
  });
});

test("CA-5: a las 19:16 ART la venta de las 19:14 todavia no se acredita (margen); a las 19:30 si, aunque el SKU ya no tenga delta (saltea el atajo)", async () => {
  await conDirTemporal(async (dir) => {
    // Corrida A, 19:16 ART. Con FechaEmision mal parseada en UTC (19:14Z) la linea
    // pareceria de hace 3 h y se acreditaria ya: Shopify quedaria en 4 antes de que
    // el comprobante sea acreditable.
    const { deps, r, llamadas } = escenarioCenso(dir, { ahoraIso: "2026-08-12T22:16:00.000Z" });

    const a = await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(escriturasDe(llamadas, SKU_CENSO), [3], "sin credito todavia: 4 + (-1) = 3 (subventa transitoria, lado seguro)");
    assert.equal(a.causa_venta_shopify, 0);
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_CENSO], 4);
    assert.equal(libreta.consumos?.[CLAVE_CENSO], undefined, "no acreditada: no consumida");

    // Corrida B, 19:30 ART. Contabilium sigue en 4: delta 0. El atajo incremental
    // lo saltearia; el credito pendiente lo obliga a procesarse.
    r.fijar("2026-08-12T22:30:00.000Z");
    const b = await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(escriturasDe(llamadas, SKU_CENSO), [3, 4], "3 + 0 + 1 = 4: el credito diferido se repone");
    assert.equal(b.causa_venta_shopify, 1);
    assert.equal(b.saltado ?? 0, 0, "con credito pendiente no hay atajo");
    libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.consumos[CLAVE_CENSO].motivo, "delta");
    todasEnteras(llamadas);
  });
});

test("CA-5: un credito consumido no explica una baja POSTERIOR del mismo SKU (ni en la corrida siguiente)", async () => {
  await conDirTemporal(async (dir) => {
    const { deps, stock, r, llamadas } = escenarioCenso(dir, { ahoraIso: "2026-08-12T22:30:00.000Z" });
    await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(escriturasDe(llamadas, SKU_CENSO), []);

    // Una venta de mostrador despues: Contabilium 4 -> 3. /search sigue devolviendo
    // el 177960828 (mismo dia): ya esta consumido.
    stock.get(DEPOSITO_DOT).set(SKU_CENSO, 3);
    r.fijar("2026-08-12T23:30:00.000Z");
    const res = await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(escriturasDe(llamadas, SKU_CENSO), [3], "4 + (-1) + 0 = 3: la baja de mostrador se descuenta");
    assert.equal(res.causa_venta_shopify, 0);
    todasEnteras(llamadas);
  });
});

// -----------------------------------------------------------------------------
// Casos adicionales de la tabla del diseño (D-2, D-3)
// -----------------------------------------------------------------------------

async function correrConCredito({ baseline, contabiliumAhora, shopifyAhora, lineas }) {
  return conDirTemporal(async (dir) => {
    const T = "2026-08-12T22:30:00.000Z";
    sembrarLibreta(dir, "dot", { skus: { "IEY-T": baseline }, contabilium: { "IEY-T": baseline }, corte: CORTE_VIEJO });
    const detalles = new Map();
    const search = [];
    lineas.forEach((cant, i) => {
      const id = 600 + i;
      search.push(resumenSearch(id));
      detalles.set(id, comprobanteDetalle({ id, referenciaUtc: new Date(new Date(T).getTime() - HORA).toISOString(), items: [["IEY-T", cant]] }));
    });
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-T", contabiliumAhora]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-T", shopifyAhora]])]]),
      search,
      detalles,
      llamadas,
    });
    const res = await sync.ejecutarPar(PAR_DOT, deps);
    todasEnteras(llamadas);
    return { res, escrituras: escriturasDe(llamadas, "IEY-T"), libreta: leerLibretaCruda(dir, "dot") };
  });
}

test("CA-5: delta -3 con credito 1 escribe -2 (1 venta Shopify + 2 de mostrador), sin 'todo o nada'", async () => {
  const { escrituras, res, libreta } = await correrConCredito({ baseline: 13, contabiliumAhora: 10, shopifyAhora: 10, lineas: [1] });
  assert.deepEqual(escrituras, [8], "10 + (-3) + 1 = 8");
  assert.equal(res.causa_venta_shopify, 1);
  assert.equal(libreta.consumos["600:IEY-T"].cantidad, 1, "el credito se consume entero aunque explique solo parte del delta");
});

test("CA-5: delta +4 con credito 1 escribe +5 (venta Shopify -1 oculta en una reposicion +5)", async () => {
  const { escrituras, res } = await correrConCredito({ baseline: 6, contabiliumAhora: 10, shopifyAhora: 10, lineas: [1] });
  assert.deepEqual(escrituras, [15], "10 + 4 + 1 = 15 (con delta puro: 14, Shopify 1 abajo)");
  assert.equal(res.causa_venta_shopify, 1);
});

test("CA-5: dos comprobantes Shopify del mismo SKU se suman (no hay 'mas de un candidato -> desconocida')", async () => {
  const { escrituras, res, libreta } = await correrConCredito({ baseline: 12, contabiliumAhora: 10, shopifyAhora: 10, lineas: [1, 1] });
  assert.deepEqual(escrituras, [], "10 + (-2) + 2 = 10 = Shopify");
  assert.equal(res.causa_venta_shopify, 2, "causa_venta_shopify cuenta UNIDADES");
  assert.ok(libreta.consumos["600:IEY-T"] && libreta.consumos["601:IEY-T"]);
});

test("CA-5: el credito de una linea del DOT no se usa en la isla, aunque la isla tenga el mismo SKU con la misma baja", async () => {
  await conDirTemporal(async (dir) => {
    const T = "2026-08-12T22:30:00.000Z";
    sembrarLibreta(dir, "dot", { skus: { [SKU_CENSO]: 5 }, contabilium: { [SKU_CENSO]: 5 }, corte: CORTE_VIEJO });
    sembrarLibreta(dir, "galerias-pacifico", { skus: { [SKU_CENSO]: 5 }, contabilium: { [SKU_CENSO]: 5 }, corte: CORTE_VIEJO });
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([
        [DEPOSITO_DOT, new Map([[SKU_CENSO, 4]])],
        [DEPOSITO_ISLA, new Map([[SKU_CENSO, 4]])],
      ]),
      shopify: new Map([
        [LOCATION_DOT, new Map([[SKU_CENSO, 4]])],
        [LOCATION_ISLA, new Map([[SKU_CENSO, 5]])],
      ]),
      search: [resumenSearch(177960828)],
      detalles: new Map([[177960828, comprobanteReal()]]),
      llamadas,
    });

    await sync.correrTodosLosPares([PAR_DOT, PAR_ISLA], deps);

    assert.deepEqual(escriturasDe(llamadas, SKU_CENSO, LOCATION_DOT), [], "DOT: acreditado");
    assert.deepEqual(escriturasDe(llamadas, SKU_CENSO, LOCATION_ISLA), [4], "isla: 5 + (-1) + 0 = 4 (Inventario 127356 no es su deposito)");
    assert.equal(leerLibretaCruda(dir, "galerias-pacifico").consumos?.[CLAVE_CENSO], undefined);
    todasEnteras(llamadas);
  });
});

// -----------------------------------------------------------------------------
// Ronda 3 (CA-5 ampliado): SKUs que son prefijo uno del otro (AGENTS.md,
// invariante 3: el 26% del catalogo tiene este patron). El credito de una linea
// es de su SKU EXACTO: ni `includes`, ni `startsWith` en ningun sentido.
//
// Para que el caso no dependa del orden en que ejecutarPar recorre los SKUs, en
// la corrida 1 el SKU DUENO del credito falla en Shopify (error: no consume) y el
// otro se procesa solo contra una linea que no es suya.
//
//   Los dos: baseline 10, Contabilium 9.
//   Dueno: Shopify 9 (la venta online ya se desconto). Otro: Shopify 10 (venta de mostrador).
//   Corrida 1 (dueno en error). Otro, correcto: 10 + (-1) + 0 = 9.
//                               Otro con el credito ajeno: 10 + (-1) + 1 = 10 -> no escribe.
//   Corrida 2 (dueno resuelto). Dueno: 9 + (-1) + 1 = 9 -> no escribe; consume SU linea.
// -----------------------------------------------------------------------------

const CORTO = "FUNDA-X-IPHONE16";
const LARGO = "FUNDA-X-IPHONE16PRO";

for (const [dueno, otro] of [
  [LARGO, CORTO], // detecta lineaSku.startsWith(sku) / lineaSku.includes(sku)
  [CORTO, LARGO], // detecta sku.startsWith(lineaSku) / sku.includes(lineaSku)
]) {
  test(`CA-5 (ronda 3, invariante 3): con ${CORTO} y ${LARGO}, el credito de ${dueno} nunca se aplica a ${otro}`, async () => {
    await conDirTemporal(async (dir) => {
      const T = "2026-08-12T22:30:00.000Z";
      sembrarLibreta(dir, "dot", { skus: { [CORTO]: 10, [LARGO]: 10 }, contabilium: { [CORTO]: 10, [LARGO]: 10 }, corte: CORTE_VIEJO });
      const llamadas = llamadasVacias();
      const r = reloj(T);
      const skusConError = new Set([dueno]);
      const deps = depsFake({
        dir,
        reloj: r,
        stock: new Map([[DEPOSITO_DOT, new Map([[otro, 9], [dueno, 9]])]]),
        shopify: new Map([[LOCATION_DOT, new Map([[dueno, 9], [otro, 10]])]]),
        search: [resumenSearch(650)],
        detalles: new Map([[650, comprobanteDetalle({ id: 650, referenciaUtc: new Date(new Date(T).getTime() - HORA).toISOString(), items: [[dueno, 1]] })]]),
        skusConError,
        llamadas,
      });

      const res1 = await sync.ejecutarPar(PAR_DOT, deps);
      assert.equal(res1.error, 1, `precondicion: ${dueno} en error`);
      assert.deepEqual(escriturasDe(llamadas, otro), [9], `${otro}: 10 + (-1) + 0 = 9. Con el credito de ${dueno}: 10 (no escribiria)`);
      let libreta = leerLibretaCruda(dir, "dot");
      assert.deepEqual(Object.keys(libreta.consumos ?? {}), [], `nadie consumio la linea de ${dueno}`);

      skusConError.clear();
      r.fijar("2026-08-12T23:00:00.000Z");
      const res2 = await sync.ejecutarPar(PAR_DOT, deps);
      assert.deepEqual(escriturasDe(llamadas, dueno), [], `${dueno}: 9 + (-1) + 1 = 9 = Shopify`);
      assert.deepEqual(escriturasDe(llamadas, otro), [9], `${otro}: sin delta ni credito propio, no se vuelve a escribir`);
      assert.equal(res2.causa_venta_shopify, 1);
      libreta = leerLibretaCruda(dir, "dot");
      assert.deepEqual(Object.keys(libreta.consumos ?? {}), [`650:${dueno}`], "la linea se consume con la clave de su SKU exacto");
      assert.deepEqual(libreta.contabilium, { [CORTO]: 9, [LARGO]: 9 });
      todasEnteras(llamadas);
    });
  });
}

test("CA-5: la referencia del comprobante real que usa ejecutarPar es la de Argentina (22:14:29.660Z)", () => {
  assert.equal(clasif.lineasAcreditables(comprobanteReal(), DEPOSITO_DOT)[0].referencia, REFERENCIA_REAL_177960828);
});
