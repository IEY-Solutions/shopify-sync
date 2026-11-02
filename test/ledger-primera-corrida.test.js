// R-11 / CA-11 — primera corrida con registro (o libreta perdida): corte.
//
// Sin `corte` en la libreta del par, se fija corte = tInicioLectura. Las lineas
// Shopify del deposito con referencia anterior al corte ya pasaron por el sync
// viejo (no se sabe si se descontaron dos veces): se registran consumidas con
// motivo "pre-corte", NO se acreditan, y su cantidad (unidades) se informa
// agregada en creditos_pre_corte. Las posteriores al corte se acreditan normal.
//
// Corre con: node --test test/ledger-primera-corrida.test.js
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
  leerLibretaCruda,
  leerRegistroCrudo,
  comprobanteDetalle,
  resumenSearch,
  escriturasDe,
  PAR_DOT,
  DEPOSITO_DOT,
  LOCATION_DOT,
  MIN,
  HORA,
} from "./_helpers-clasificador.js";

const T1 = "2026-11-02T15:00:00.000Z"; // primera corrida tras el deploy
const t1 = new Date(T1).getTime();
const iso = (ms) => new Date(ms).toISOString();

test("CA-11: sin cache ni corte, una linea anterior a tInicioLectura queda consumida pre-corte, no cambia lo escrito y suma creditos_pre_corte", async () => {
  await conDirTemporal(async (dir) => {
    // Libreta vieja (del sync anterior al registro): baseline, sin corte ni consumos.
    sembrarLibreta(dir, "dot", { skus: { "IEY-P": 10 }, contabilium: { "IEY-P": 10 } });
    const llamadas = llamadasVacias();
    const r = reloj(T1);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-P", 8]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-P", 8]])]]);
    const deps = depsFake({
      dir,
      reloj: r,
      stock,
      shopify,
      search: [resumenSearch(801), resumenSearch(802)],
      detalles: new Map([
        // 2 unidades, 1 h antes del corte: pre-corte.
        [801, comprobanteDetalle({ id: 801, referenciaUtc: iso(t1 - HORA), items: [["IEY-P", 2]] })],
        // 1 unidad emitida DURANTE la lectura (T1 + 1 min): posterior al corte.
        [802, comprobanteDetalle({ id: 802, referenciaUtc: iso(t1 + MIN), items: [["IEY-P", 1]] })],
      ]),
      alLeerStock: () => r.fijar(iso(t1 + 2 * MIN)),
      llamadas,
    });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.deepEqual(escriturasDe(llamadas, "IEY-P"), [6], "8 + (-2) + 0 = 6: la linea pre-corte no se acredita (acreditada daria 8, sin escribir)");
    assert.equal(res.creditos_pre_corte, 2, "unidades, no lineas");
    assert.equal(res.causa_venta_shopify, 0);

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.corte, T1, "corte = tInicioLectura de la primera corrida (antes de leer el stock)");
    assert.equal(libreta.consumos?.["801:IEY-P"]?.motivo, "pre-corte");
    assert.equal(libreta.consumos["801:IEY-P"].cantidad, 2);
    assert.equal(libreta.consumos["802:IEY-P"], undefined, "la linea posterior al corte sigue pendiente");
    assert.ok(leerRegistroCrudo(dir)?.comprobantes?.["801"], "la cache de comprobantes se creo");

    // Corrida siguiente: la linea posterior al corte se acredita normal, sin delta.
    r.fijar(iso(t1 + 30 * MIN));
    const res2 = await sync.ejecutarPar(PAR_DOT, depsFake({ dir, reloj: r, stock, shopify, search: [resumenSearch(801), resumenSearch(802)], llamadas }));
    assert.deepEqual(escriturasDe(llamadas, "IEY-P"), [6, 7], "6 + 0 + 1 = 7");
    assert.equal(res2.creditos_pre_corte, 0, "la pre-corte ya estaba consumida");
    const libreta2 = leerLibretaCruda(dir, "dot");
    assert.equal(libreta2.corte, T1, "el corte no se mueve en las corridas siguientes");
    assert.equal(libreta2.consumos["802:IEY-P"].motivo, "delta");
  });
});

test("CA-11: una linea anterior al corte que aparece DESPUES de la primera corrida (refresco fallido) tambien es pre-corte, no credito", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-Q": 10 }, contabilium: { "IEY-Q": 10 } });
    const llamadas = llamadasVacias();
    const r = reloj(T1);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-Q", 9]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-Q", 9]])]]);
    const detalles = new Map([[811, comprobanteDetalle({ id: 811, referenciaUtc: iso(t1 - HORA), items: [["IEY-Q", 1]] })]]);

    // Primera corrida: /search caido. El corte se fija igual.
    await sync.ejecutarPar(PAR_DOT, depsFake({ dir, reloj: r, stock, shopify, fallaBusqueda: true, llamadas }));
    assert.deepEqual(escriturasDe(llamadas, "IEY-Q"), [8]);
    assert.equal(leerLibretaCruda(dir, "dot").corte, T1, "el corte no depende de que el refresco salga bien");

    // Segunda corrida: aparece el 811 (de antes del corte) y otra baja.
    stock.get(DEPOSITO_DOT).set("IEY-Q", 8);
    r.fijar(iso(t1 + 30 * MIN));
    const res = await sync.ejecutarPar(PAR_DOT, depsFake({ dir, reloj: r, stock, shopify, search: [resumenSearch(811)], detalles, llamadas }));
    assert.deepEqual(escriturasDe(llamadas, "IEY-Q"), [8, 7], "8 + (-1) + 0 = 7: el 811 es pre-corte, no explica esta baja");
    assert.equal(res.creditos_pre_corte, 1);
    assert.equal(leerLibretaCruda(dir, "dot").consumos?.["811:IEY-Q"]?.motivo, "pre-corte");
  });
});

test("CA-11: una libreta que ya tiene corte no lo reinicia", async () => {
  await conDirTemporal(async (dir) => {
    const CORTE = "2026-10-01T00:00:00.000Z";
    sembrarLibreta(dir, "dot", { skus: { "IEY-R": 10 }, contabilium: { "IEY-R": 10 }, corte: CORTE, consumos: {} });
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj(T1),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-R", 9]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-R", 9]])]]),
      search: [resumenSearch(821)],
      detalles: new Map([[821, comprobanteDetalle({ id: 821, referenciaUtc: iso(t1 - HORA), items: [["IEY-R", 1]] })]]),
      llamadas,
    });
    const res = await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(escriturasDe(llamadas, "IEY-R"), [], "posterior al corte viejo: se acredita, 9 + (-1) + 1 = 9");
    assert.equal(res.creditos_pre_corte, 0);
    assert.equal(leerLibretaCruda(dir, "dot").corte, CORTE);
  });
});
