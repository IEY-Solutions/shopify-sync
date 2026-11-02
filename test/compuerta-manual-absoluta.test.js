// R-7 / CA-7 — compuerta manual auditada, independiente del clasificador (diseño B).
//
// Para un SKU alcanzado por escrituraAbsoluta: se escribe el ABSOLUTO de
// Contabilium, se resiembra el baseline con ese valor y todas sus lineas
// Shopify con referencia < tInicioLectura se marcan consumidas con motivo
// "absoluto" (el absoluto ya incorpora su efecto: acreditarlas despues inflaria
// Shopify). Las lineas con referencia posterior a tInicioLectura siguen
// pendientes. Un SKU sembrado igual, con motivo "sembrado".
//
// Ronda 2 (02/11/2026, R-7 ampliado): la libreta guarda resembradoEn[sku] =
// tInicioLectura. Una linea del SKU con referencia ANTERIOR a resembradoEn que
// se registra recien en un refresco POSTERIOR (llego tarde a /search o quedo
// pendiente por el tope) tambien queda consumida con motivo absoluto/sembrado y
// nunca se acredita: acreditarla encima del absoluto es sobreventa. Las
// posteriores se acreditan normalmente. Casos (a) a (d) al final del archivo.
//
// Ronda 3 (02/11/2026, hallazgos de revisor-alcance): (e) id pendiente por el
// TOPE en la corrida de la compuerta; (f) compuerta con /search caido guarda
// resembradoEn igual; (g) syncUnSku que siembra guarda resembradoEn; (h)
// syncUnSku con delta no borra un resembradoEn ya persistido.
//
// Ronda 4 (02/11/2026, importante 1 de revisor-alcance): (g) y (h) encierran
// syncUnSku en el directorio temporal (encierro de depsFake + guardia de
// escrituras sobre el repo) y verifican que la ruta de la libreta salio de
// deps.rutaSnapshotPara("dot"). DISENO-INTERFAZ.md 4.2.
//
// Corre con: node --test test/compuerta-manual-absoluta.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import {
  conDirTemporal,
  depsFake,
  llamadasVacias,
  reloj,
  sembrarLibreta,
  sembrarRegistro,
  leerLibretaCruda,
  leerRegistroCrudo,
  entradaShopify,
  comprobanteDetalle,
  resumenSearch,
  escriturasDe,
  encierroVacio,
  guardiaDeEscriturasEnRepo,
  rutaLibreta,
  PAR_DOT,
  DEPOSITO_DOT,
  LOCATION_DOT,
  MIN,
  HORA,
} from "./_helpers-clasificador.js";

const CORTE_VIEJO = "2026-08-01T00:00:00.000Z";
const T = "2026-08-12T16:00:00.000Z";
const iso = (ms) => new Date(ms).toISOString();
const tMs = new Date(T).getTime();

test("CA-7: escritura_absoluta sobre un SKU con credito: escribe el absoluto, resiembra, consume la linea previa con motivo absoluto y la corrida siguiente no la acredita", async () => {
  await conDirTemporal(async (dir) => {
    // Baseline 10, Contabilium ahora 7, Shopify 9.
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    // L1 (2 u.) ya registrada, de hace 1 h: acreditable.
    sembrarRegistro(dir, {
      ultimoRefrescoOk: iso(tMs - 2 * HORA),
      comprobantes: [entradaShopify({ id: 301, sku: "IEY-A", cantidad: 2, referencia: iso(tMs - HORA) })],
    });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 7]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-A", 9]])]]);
    // L2 (1 u.) emitida DURANTE la lectura (T + 1 min); la lectura termina en T + 3 min.
    const deps = depsFake({
      dir,
      reloj: r,
      stock,
      shopify,
      alLeerStock: () => r.fijar(iso(tMs + 3 * MIN)),
      search: [resumenSearch(301), resumenSearch(302)],
      detalles: new Map([[302, comprobanteDetalle({ id: 302, referenciaUtc: iso(tMs + MIN), items: [["IEY-A", 1]] })]]),
      llamadas,
    });

    await sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: new Set(["IEY-A"]) });

    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [7], "el absoluto de Contabilium, no 9 + (-3) + 2");
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-A"], 7, "baseline resembrado con el absoluto");
    assert.equal(libreta.resembradoEn?.["IEY-A"], T, "resembradoEn[sku] = tInicioLectura (antes de leer el stock, no T + 3 min)");
    assert.equal(libreta.consumos?.["301:IEY-A"]?.motivo, "absoluto");
    assert.equal(libreta.consumos["301:IEY-A"].cantidad, 2);
    assert.equal(libreta.consumos["302:IEY-A"], undefined, "la linea posterior a tInicioLectura sigue pendiente");

    // Corrida siguiente, 30 min despues, sin compuerta y sin delta: L1 no se
    // acredita (10 si se acreditara), L2 si (8).
    r.fijar(iso(tMs + 30 * MIN));
    await sync.ejecutarPar(PAR_DOT, depsFake({ dir, reloj: r, stock, shopify, search: [resumenSearch(301), resumenSearch(302)], llamadas }));
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [7, 8], "7 + 0 + 1 (solo L2)");
    libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.consumos["302:IEY-A"]?.motivo, "delta");
    assert.equal(libreta.consumos["301:IEY-A"].motivo, "absoluto", "L1 no se vuelve a consumir ni cambia de motivo");
  });
});

test("CA-7: un SKU sembrado (sin baseline) se comporta igual: absoluto y sus lineas previas consumidas como 'sembrado'", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-VIEJO": 5 }, contabilium: { "IEY-VIEJO": 5 }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, {
      ultimoRefrescoOk: iso(tMs - 2 * HORA),
      comprobantes: [entradaShopify({ id: 401, sku: "IEY-S", cantidad: 1, referencia: iso(tMs - HORA) })],
    });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-VIEJO", 5], ["IEY-S", 6]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-VIEJO", 5], ["IEY-S", 2]])]]);
    const deps = depsFake({ dir, reloj: r, stock, shopify, search: [resumenSearch(401)], llamadas });

    await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(escriturasDe(llamadas, "IEY-S"), [6], "sembrado: absoluto de Contabilium");
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-S"], 6);
    assert.equal(libreta.resembradoEn?.["IEY-S"], T, "sembrar tambien fija resembradoEn[sku]");
    assert.equal(libreta.resembradoEn?.["IEY-VIEJO"], undefined, "un SKU con baseline y sin compuerta no se resiembra");
    assert.equal(libreta.consumos?.["401:IEY-S"]?.motivo, "sembrado");

    r.fijar(iso(tMs + 30 * MIN));
    await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(escriturasDe(llamadas, "IEY-S"), [6], "la corrida siguiente no acredita la linea: Shopify sigue en 6, no 7");
  });
});

test("CA-7: la compuerta es independiente del clasificador: con /search caido escribe el absoluto igual", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10, "IEY-B": 4 }, contabilium: { "IEY-A": 10, "IEY-B": 4 }, corte: CORTE_VIEJO });
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-A", 7], ["IEY-B", 3]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 9], ["IEY-B", 4]])]]),
      fallaBusqueda: true,
      llamadas,
    });
    await sync.ejecutarPar(PAR_DOT, deps, { escrituraAbsoluta: "todos" });
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [7]);
    assert.deepEqual(escriturasDe(llamadas, "IEY-B"), [3]);
    for (const s of llamadas.setearStock) assert.ok(Number.isInteger(s.quantity));
  });
});

test("CA-7: sin escritura_absoluta el mismo escenario aplica la regla contable (control negativo)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, {
      ultimoRefrescoOk: iso(tMs - 2 * HORA),
      comprobantes: [entradaShopify({ id: 301, sku: "IEY-A", cantidad: 2, referencia: iso(tMs - HORA) })],
    });
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-A", 7]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 9]])]]),
      search: [resumenSearch(301)],
      llamadas,
    });
    await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [8], "9 + (-3) + 2 = 8");
    assert.equal(leerLibretaCruda(dir, "dot").consumos["301:IEY-A"].motivo, "delta");
    assert.equal(leerLibretaCruda(dir, "dot").resembradoEn?.["IEY-A"], undefined, "sin compuerta ni sembrado no hay resembradoEn");
  });
});

// -----------------------------------------------------------------------------
// Ronda 2: resembradoEn[sku] (R-7 ampliado). Lineas que se registran DESPUES del
// absoluto o del sembrado.
// -----------------------------------------------------------------------------

// Un /search que recien "ve" los ids a partir de un instante: el comprobante
// llego tarde al indice (o, para el caso, quedo pendiente por el tope de 60). En
// la corrida de la compuerta la linea NO esta registrada; se registra en la
// siguiente. Depende del reloj y no del numero de invocacion, para que el caso
// valga tanto si la corrida de la compuerta refresca como si no.
function searchDesde(r, desdeMs, ids) {
  return () => (r.ms >= desdeMs ? ids.map((id) => resumenSearch(id)) : []);
}

const T2 = tMs + 30 * MIN; // corrida siguiente

test("CA-7 (a): compuerta sin la linea registrada; en la corrida siguiente se registra una linea ANTERIOR a resembradoEn: queda consumida 'absoluto' y no cambia el valor escrito", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, { ultimoRefrescoOk: iso(tMs - 2 * HORA) });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 7]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-A", 9]])]]);
    // Venta online de 2 u., una hora ANTES de la compuerta: el absoluto (7) ya la incorpora.
    const detalles = new Map([[601, comprobanteDetalle({ id: 601, referenciaUtc: iso(tMs - HORA), items: [["IEY-A", 2]] })]]);
    const base = { dir, reloj: r, stock, shopify, detalles, search: searchDesde(r, T2, [601]), llamadas };

    // Corrida 1: compuerta. La lectura termina en T + 3 min; tInicioLectura = T.
    await sync.ejecutarPar(PAR_DOT, depsFake({ ...base, alLeerStock: () => r.fijar(iso(tMs + 3 * MIN)) }), {
      escrituraAbsoluta: new Set(["IEY-A"]),
    });
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [7]);
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.resembradoEn?.["IEY-A"], T);
    assert.equal(libreta.consumos?.["601:IEY-A"], undefined, "precondicion: la linea todavia no estaba registrada");
    assert.equal(llamadas.idsDetalle.includes(601), false, "precondicion: el 601 no se pidio en la corrida de la compuerta");

    // Corrida 2, sin compuerta: venta de mostrador de 1 u. (7 -> 6) que dispara el refresco.
    r.fijar(iso(T2));
    stock.get(DEPOSITO_DOT).set("IEY-A", 6);
    const res2 = await sync.ejecutarPar(PAR_DOT, depsFake(base));
    assert.ok(llamadas.idsDetalle.includes(601), "precondicion: el refresco de la corrida 2 registro el 601");

    assert.deepEqual(
      escriturasDe(llamadas, "IEY-A"),
      [7, 6],
      "7 + (6 - 7) + 0 = 6. Acreditar la linea anterior al absoluto daria 8: sobreventa de 2",
    );
    libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.consumos?.["601:IEY-A"]?.motivo, "absoluto", "consumida por el absoluto, no 'delta' ni 'pre-corte'");
    assert.equal(libreta.consumos["601:IEY-A"].cantidad, 2);
    assert.equal(libreta.resembradoEn?.["IEY-A"], T, "una corrida sin compuerta no mueve resembradoEn");
    assert.equal(res2.causa_venta_shopify, 0, "nada acreditado por la regla contable");
    assert.equal(res2.creditos_pendientes, 0);

    // Corrida 3: sin cambios. La linea no reaparece como credito.
    r.fijar(iso(T2 + 30 * MIN));
    await sync.ejecutarPar(PAR_DOT, depsFake(base));
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [7, 6], "Shopify sigue en 6");
  });
});

test("CA-7 (b): compuerta sin la linea registrada; una linea POSTERIOR a resembradoEn registrada despues se acredita normalmente", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, { ultimoRefrescoOk: iso(tMs - 2 * HORA) });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 7]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-A", 9]])]]);
    // Venta online de 1 u. emitida DURANTE la lectura (T + 1 min > resembradoEn = T):
    // el absoluto no la incorpora, Shopify la descuenta aparte.
    const detalles = new Map([[602, comprobanteDetalle({ id: 602, referenciaUtc: iso(tMs + MIN), items: [["IEY-A", 1]] })]]);
    const base = { dir, reloj: r, stock, shopify, detalles, search: searchDesde(r, T2, [602]), llamadas };

    await sync.ejecutarPar(PAR_DOT, depsFake({ ...base, alLeerStock: () => r.fijar(iso(tMs + 3 * MIN)) }), {
      escrituraAbsoluta: new Set(["IEY-A"]),
    });
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [7]);
    assert.equal(leerLibretaCruda(dir, "dot").resembradoEn?.["IEY-A"], T);

    // Corrida 2: Contabilium 7 -> 5 (la factura 602 baja 1, el mostrador otra).
    r.fijar(iso(T2));
    stock.get(DEPOSITO_DOT).set("IEY-A", 5);
    const res2 = await sync.ejecutarPar(PAR_DOT, depsFake(base));
    assert.ok(llamadas.idsDetalle.includes(602), "precondicion: el refresco de la corrida 2 registro el 602");

    assert.deepEqual(
      escriturasDe(llamadas, "IEY-A"),
      [7, 6],
      "7 + (5 - 7) + 1 = 6. Consumirla como 'absoluto' daria 5: la venta online se descontaria dos veces",
    );
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.consumos?.["602:IEY-A"]?.motivo, "delta");
    assert.equal(libreta.consumos["602:IEY-A"].cantidad, 1);
    assert.equal(res2.causa_venta_shopify, 1);
  });
});

test("CA-7 (c): SKU sembrado sin la linea registrada; una linea ANTERIOR a resembradoEn registrada despues queda consumida 'sembrado' y no se acredita", async () => {
  await conDirTemporal(async (dir) => {
    // IEY-VIEJO tiene baseline y no se mueve; IEY-S no tiene baseline: se siembra.
    sembrarLibreta(dir, "dot", { skus: { "IEY-VIEJO": 5 }, contabilium: { "IEY-VIEJO": 5 }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, { ultimoRefrescoOk: iso(tMs - 2 * HORA) });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-VIEJO", 5], ["IEY-S", 6]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-VIEJO", 5], ["IEY-S", 2]])]]);
    const detalles = new Map([[701, comprobanteDetalle({ id: 701, referenciaUtc: iso(tMs - HORA), items: [["IEY-S", 2]] })]]);
    const base = { dir, reloj: r, stock, shopify, detalles, search: searchDesde(r, T2, [701]), llamadas };

    await sync.ejecutarPar(PAR_DOT, depsFake({ ...base, alLeerStock: () => r.fijar(iso(tMs + 3 * MIN)) }));
    assert.deepEqual(escriturasDe(llamadas, "IEY-S"), [6], "sembrado: absoluto de Contabilium");
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.resembradoEn?.["IEY-S"], T);
    assert.equal(libreta.consumos?.["701:IEY-S"], undefined, "precondicion: la linea todavia no estaba registrada");

    // Corrida 2: mostrador 6 -> 5, dispara el refresco que registra el 701.
    r.fijar(iso(T2));
    stock.get(DEPOSITO_DOT).set("IEY-S", 5);
    const res2 = await sync.ejecutarPar(PAR_DOT, depsFake(base));
    assert.ok(llamadas.idsDetalle.includes(701), "precondicion: el refresco de la corrida 2 registro el 701");

    assert.deepEqual(escriturasDe(llamadas, "IEY-S"), [6, 5], "6 + (5 - 6) + 0 = 5. Acreditar la linea daria 7: sobreventa de 2");
    libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.consumos?.["701:IEY-S"]?.motivo, "sembrado");
    assert.equal(libreta.consumos["701:IEY-S"].cantidad, 2);
    assert.equal(libreta.resembradoEn?.["IEY-S"], T);
    assert.equal(res2.causa_venta_shopify, 0);
  });
});

test("CA-7 (d): resembradoEn queda en disco y ni los checkpoints de una corrida posterior ni un guardado de 3 argumentos (syncUnSku) lo borran", async () => {
  await conDirTemporal(async (dir) => {
    const diez = { "IEY-A": 10, "IEY-B": 10, "IEY-C": 10, "IEY-D": 10 };
    sembrarLibreta(dir, "dot", { skus: { ...diez }, contabilium: { ...diez }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, { ultimoRefrescoOk: iso(tMs - 2 * HORA) });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 7], ["IEY-B", 10], ["IEY-C", 10], ["IEY-D", 10]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-A", 9], ["IEY-B", 10], ["IEY-C", 10], ["IEY-D", 10]])]]);

    await sync.ejecutarPar(PAR_DOT, depsFake({ dir, reloj: r, stock, shopify, llamadas }), { escrituraAbsoluta: new Set(["IEY-A"]) });
    assert.equal(leerLibretaCruda(dir, "dot").resembradoEn?.["IEY-A"], T, "en disco despues de la compuerta");

    // Corrida 2 sin compuerta, con checkpoint en cada SKU: B, C y D bajan 1. Se lee
    // el disco DESPUES de cada guardarSnapshot (checkpoints intermedios y final).
    r.fijar(iso(T2));
    for (const sku of ["IEY-B", "IEY-C", "IEY-D"]) stock.get(DEPOSITO_DOT).set(sku, 9);
    const enDisco = [];
    const deps2 = depsFake({
      dir,
      reloj: r,
      stock,
      shopify,
      llamadas,
      guardarSnapshotEnvoltorio: (real) => (...args) => {
        const v = real(...args);
        enDisco.push(leerLibretaCruda(dir, "dot")?.resembradoEn?.["IEY-A"]);
        return v;
      },
    });
    await sync.ejecutarPar(PAR_DOT, deps2, { checkpointCada: 1 });
    assert.ok(enDisco.length >= 2, `precondicion: hubo checkpoints intermedios ademas del final (${enDisco.length})`);
    assert.deepEqual(
      enDisco,
      enDisco.map(() => T),
      "ningun checkpoint (ni el guardado final) borra ni mueve resembradoEn de un SKU que la corrida no resembro",
    );
    assert.equal(leerLibretaCruda(dir, "dot").contabilium["IEY-B"], 9, "control: la corrida 2 si avanzo baselines");

    // Guardado de 3 argumentos, el que usa syncUnSku (DISENO-INTERFAZ.md seccion 4).
    const crudo = leerLibretaCruda(dir, "dot");
    sync.guardarSnapshot({ ...crudo.skus, "IEY-B": 8 }, sync.rutaSnapshotPara("dot", dir), { ...crudo.contabilium, "IEY-B": 8 });
    const despues = leerLibretaCruda(dir, "dot");
    assert.equal(despues.contabilium["IEY-B"], 8, "control: el guardado de 3 argumentos si escribio");
    assert.equal(despues.resembradoEn?.["IEY-A"], T, "un guardado sin contabilidad conserva resembradoEn");
  });
});

// -----------------------------------------------------------------------------
// Ronda 3 (R-7 y CA-7 ampliados por el orquestador tras revisor-alcance).
// -----------------------------------------------------------------------------

test("CA-7 (e): un id que quedo pendiente por el TOPE en la corrida de la compuerta y pasa a ok en una corrida posterior, con referencia anterior a resembradoEn, queda consumido 'absoluto'", async () => {
  await conDirTemporal(async (dir) => {
    // IEY-B (sin compuerta) garantiza que la corrida 1 refresque, con cualquier
    // criterio de disparo.
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10, "IEY-B": 4 }, contabilium: { "IEY-A": 10, "IEY-B": 4 }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, { ultimoRefrescoOk: iso(tMs - 2 * HORA) });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 7], ["IEY-B", 3]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-A", 9], ["IEY-B", 4]])]]);
    const detalles = new Map([
      [610, comprobanteDetalle({ id: 610, origen: "", idIntegracion: null, referenciaUtc: iso(tMs - 2 * HORA), items: [["IEY-Q", 1]] })],
      // Venta online de 2 u. de IEY-A, una hora ANTES de la compuerta: el absoluto ya la incorpora.
      [611, comprobanteDetalle({ id: 611, referenciaUtc: iso(tMs - HORA), items: [["IEY-A", 2]] })],
    ]);
    const base = { dir, reloj: r, stock, shopify, detalles, search: [resumenSearch(610), resumenSearch(611)], llamadas };

    // Corrida 1: compuerta sobre IEY-A, tope 1: se pide el 610 (primero en /search) y el 611 queda pendiente.
    await sync.ejecutarPar(PAR_DOT, depsFake({ ...base, alLeerStock: () => r.fijar(iso(tMs + 3 * MIN)) }), {
      escrituraAbsoluta: new Set(["IEY-A"]),
      topeDetalles: 1,
    });
    assert.deepEqual(llamadas.idsDetalle, [610], "precondicion: con tope 1 se pide solo el primero de /search");
    assert.equal(leerRegistroCrudo(dir).comprobantes["611"]?.estado, "pendiente", "precondicion: el 611 quedo pendiente por el tope");
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [7], "absoluto");
    assert.equal(leerLibretaCruda(dir, "dot").resembradoEn?.["IEY-A"], T);

    // Corrida 2, sin compuerta y con el tope por defecto: mostrador 7 -> 6; se pide el 611.
    r.fijar(iso(T2));
    stock.get(DEPOSITO_DOT).set("IEY-A", 6);
    const res2 = await sync.ejecutarPar(PAR_DOT, depsFake(base));
    assert.ok(llamadas.idsDetalle.includes(611), "precondicion: la corrida 2 pidio el 611");
    assert.equal(leerRegistroCrudo(dir).comprobantes["611"]?.estado, "ok", "precondicion: el 611 paso a ok");

    assert.deepEqual(
      escriturasDe(llamadas, "IEY-A"),
      [7, 6],
      "7 + (6 - 7) + 0 = 6. Si resembradoEn solo se aplica a ids nuevos de /search y no a pendientes que pasan a ok: 8 (sobreventa de 2)"
    );
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.consumos?.["611:IEY-A"]?.motivo, "absoluto");
    assert.equal(libreta.consumos["611:IEY-A"].cantidad, 2);
    assert.equal(res2.causa_venta_shopify, 0);
  });
});

test("CA-7 (f): la compuerta con /search caido igual guarda resembradoEn, y la corrida siguiente no acredita una linea anterior", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, { ultimoRefrescoOk: iso(tMs - 2 * HORA) });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 7]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-A", 9]])]]);
    const detalles = new Map([[620, comprobanteDetalle({ id: 620, referenciaUtc: iso(tMs - HORA), items: [["IEY-A", 2]] })]]);
    const base = { dir, reloj: r, stock, shopify, detalles, search: [resumenSearch(620)], llamadas };

    await sync.ejecutarPar(PAR_DOT, depsFake({ ...base, fallaBusqueda: true }), { escrituraAbsoluta: new Set(["IEY-A"]) });
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [7], "absoluto aunque /search falle");
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-A"], 7);
    assert.equal(
      libreta.resembradoEn?.["IEY-A"],
      T,
      "resembradoEn se guarda aunque el refresco haya fallado (si depende del refresco OK, la linea anterior se acredita despues)"
    );

    // Corrida 2: /search vuelve; mostrador 7 -> 6; se registra el 620 (T - 1 h).
    r.fijar(iso(T2));
    stock.get(DEPOSITO_DOT).set("IEY-A", 6);
    await sync.ejecutarPar(PAR_DOT, depsFake(base));
    assert.ok(llamadas.idsDetalle.includes(620), "precondicion: la corrida 2 registro el 620");
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [7, 6], "7 + (6 - 7) + 0 = 6. Sin resembradoEn: 8");
    libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.consumos?.["620:IEY-A"]?.motivo, "absoluto");
  });
});

// -----------------------------------------------------------------------------
// syncUnSku (modo --sku) con dependencias inyectadas: DISENO-INTERFAZ.md 4.2.
// syncUnSku(sku, manualQty, deps) con el depsFake de siempre sobre un directorio
// temporal: no se toca el .cache/ real.
//
// Red de seguridad por si una implementacion ignora `deps` (toda o en parte):
//   1. DRY_RUN=true en el entorno (no escribe en Shopify) y un fetch que lanza
//      (no sale a la red).
//   2. Ronda 4: `encierro` en depsFake. rutaSnapshotPara, cargarLibretaCompleta,
//      guardarSnapshot, migrarLibretaLegada y el registro LANZAN antes de tocar el
//      disco si la ruta no esta en el directorio temporal. Al final se assierta
//      que la ruta de la libreta salio de deps.rutaSnapshotPara("dot") y que
//      cada lectura/escritura uso ESA ruta (DISENO-INTERFAZ.md 4.2).
//   3. Ronda 4: guardiaDeEscriturasEnRepo. Cubre el camino que (2) no ve: una
//      implementacion parcial que importa el guardarSnapshot REAL y lo combina con
//      deps.esDryRun (false) escribiria en .cache/last-sync.dot.json del repo sin
//      pasar por ninguna dep. La guardia hace lanzar cualquier escritura del
//      proceso dentro del repo y la anota.
// No se respalda/restaura el .cache/ real: test/sku-individual-usa-libreta-por-par.test.js
// lo hace en otro proceso de node --test, en paralelo, y una restauracion desde
// aca podria pisarle el estado a mitad de su caso. Con (2) y (3) no hace falta:
// ninguna escritura llega al .cache/ real.
// -----------------------------------------------------------------------------

// Asserts del encierro (ronda 4). Se llama justo despues de syncUnSku, antes de
// cualquier otra corrida, asi que todo lo anotado es de syncUnSku.
function verificarEncierro({ dir, encierro, violacionesFs, llamadas }) {
  assert.deepEqual(violacionesFs, [], "ninguna escritura del proceso cayo dentro del repo (.cache/ real)");
  assert.deepEqual(encierro.violaciones, [], "ninguna dep de disco recibio una ruta fuera del directorio temporal");
  const esperada = rutaLibreta(dir, "dot");
  assert.ok(
    encierro.rutaSnapshotPara.some((x) => x.stateKey === "dot"),
    "la ruta de la libreta sale de deps.rutaSnapshotPara(\"dot\") (DISENO 4.2), no de rutaSnapshotPara importada"
  );
  assert.ok(encierro.cargarLibretaCompleta.length >= 1, "la libreta se lee con deps.cargarLibretaCompleta");
  for (const ruta of encierro.cargarLibretaCompleta) assert.equal(ruta, esperada, "cargarLibretaCompleta con la ruta inyectada");
  assert.ok(encierro.guardarSnapshot.length >= 1, "la libreta se escribe con deps.guardarSnapshot");
  for (const ruta of encierro.guardarSnapshot) assert.equal(ruta, esperada, "guardarSnapshot con la ruta inyectada (nunca sin ruta: caeria en SNAPSHOT_PATH)");
  for (const g of llamadas.guardarSnapshot) assert.equal(g.ruta, esperada);
}

function entornoSeguroParaSyncUnSku(t) {
  const previo = { DRY_RUN: process.env.DRY_RUN, SHOPIFY_DOT_LOCATION_ID: process.env.SHOPIFY_DOT_LOCATION_ID };
  const fetchOriginal = globalThis.fetch;
  process.env.DRY_RUN = "true";
  process.env.SHOPIFY_DOT_LOCATION_ID = LOCATION_DOT;
  globalThis.fetch = async (url) => {
    throw new Error(`red real prohibida en este test (syncUnSku ignoro deps): ${url}`);
  };
  t.after(() => {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(previo)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  return guardiaDeEscriturasEnRepo(t);
}

test("CA-7 (g): syncUnSku que SIEMBRA un SKU sin baseline guarda resembradoEn = su tInicioLectura, y la corrida siguiente de ejecutarPar no acredita una linea anterior", async (t) => {
  const violacionesFs = entornoSeguroParaSyncUnSku(t);
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-VIEJO": 5 }, contabilium: { "IEY-VIEJO": 5 }, corte: CORTE_VIEJO });
    // Venta online de 2 u. de IEY-U, una hora antes, ya registrada.
    sembrarRegistro(dir, {
      ultimoRefrescoOk: iso(tMs - 2 * HORA),
      comprobantes: [entradaShopify({ id: 901, sku: "IEY-U", cantidad: 2, referencia: iso(tMs - HORA) })],
    });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-VIEJO", 5], ["IEY-U", 6]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-VIEJO", 5], ["IEY-U", 2]])]]);
    const base = { dir, reloj: r, stock, shopify, search: [resumenSearch(901)], llamadas };

    // --sku IEY-U --qty 6: sin baseline -> absoluto.
    const encierro = encierroVacio();
    await sync.syncUnSku("IEY-U", 6, depsFake({ ...base, encierro }));
    verificarEncierro({ dir, encierro, violacionesFs, llamadas });
    assert.deepEqual(escriturasDe(llamadas, "IEY-U"), [6], "sin baseline: syncUnSku escribe el absoluto");
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-U"], 6, "baseline sembrado");
    assert.equal(libreta.resembradoEn?.["IEY-U"], T, "resembradoEn[sku] = tInicioLectura de syncUnSku (R-7)");
    assert.equal(libreta.corte, CORTE_VIEJO, "syncUnSku no mueve el corte");
    assert.equal(libreta.contabilium["IEY-VIEJO"], 5, "los demas SKUs quedan como estaban");

    // Corrida siguiente de ejecutarPar: mostrador 6 -> 5.
    r.fijar(iso(T2));
    stock.get(DEPOSITO_DOT).set("IEY-U", 5);
    const encierro2 = encierroVacio();
    const res = await sync.ejecutarPar(PAR_DOT, depsFake({ ...base, encierro: encierro2 }));
    assert.deepEqual(encierro2.violaciones, [], "ejecutarPar tampoco sale del directorio temporal");
    assert.deepEqual(violacionesFs, [], "ni escribe dentro del repo");
    assert.deepEqual(
      escriturasDe(llamadas, "IEY-U"),
      [6, 5],
      "6 + (5 - 6) + 0 = 5. Si syncUnSku no guardo resembradoEn, el 901 (anterior al absoluto) se acredita: 7 (sobreventa de 2)"
    );
    libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.consumos?.["901:IEY-U"]?.motivo, "sembrado", "consumida por el sembrado de syncUnSku");
    assert.equal(libreta.consumos["901:IEY-U"].cantidad, 2);
    assert.equal(libreta.resembradoEn?.["IEY-U"], T, "ejecutarPar sin resembrar no lo mueve");
    assert.equal(res.causa_venta_shopify, 0);
  });
});

test("CA-7 (h): syncUnSku sobre un SKU CON baseline (delta) no borra ni mueve un resembradoEn ya persistido, ni el de ese SKU ni el de otro", async (t) => {
  const violacionesFs = entornoSeguroParaSyncUnSku(t);
  await conDirTemporal(async (dir) => {
    const T0 = "2026-08-10T12:00:00.000Z";
    const RESEMBRADO = { "IEY-A": T0, "IEY-B": T0 };
    const CONSUMOS = { "555:IEY-A": { cantidad: 1, motivo: "absoluto", referencia: "2026-08-10T11:00:00.000Z", en: T0 } };
    sembrarLibreta(dir, "dot", {
      skus: { "IEY-A": 9, "IEY-B": 4 },
      contabilium: { "IEY-A": 10, "IEY-B": 4 },
      corte: CORTE_VIEJO,
      consumos: CONSUMOS,
      extra: { resembradoEn: { ...RESEMBRADO } },
    });
    const llamadas = llamadasVacias();
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-A", 9], ["IEY-B", 4]])]]);

    // --sku IEY-A --qty 12: baseline 10 -> delta +2 -> 9 + 2 = 11.
    const encierro = encierroVacio();
    await sync.syncUnSku("IEY-A", 12, depsFake({ dir, reloj: reloj(T), stock: new Map(), shopify, llamadas, encierro }));
    verificarEncierro({ dir, encierro, violacionesFs, llamadas });
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [11], "control: delta, no absoluto");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["IEY-A"], 12, "control: el baseline avanzo");
    assert.deepEqual(
      libreta.resembradoEn,
      RESEMBRADO,
      "un delta no es una resiembra: ni borra resembradoEn (de IEY-A ni de IEY-B) ni lo mueve a la hora de syncUnSku"
    );
    assert.deepEqual(libreta.consumos, CONSUMOS, "syncUnSku tampoco borra consumos");
    assert.equal(libreta.corte, CORTE_VIEJO);
  });
});
