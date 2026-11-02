// R-4 / CA-4 — huecos del registro: un refresco que falla, total o parcialmente,
// no bloquea la corrida (diseño B).
//
//   - /search lanza: los SKUs con delta aplican el delta SIN credito y suman
//     causa_desconocida en el agregado del par; ejecutarPar no rechaza.
//   - un id de detalle de cinco falla: los otros cuatro se registran (y su
//     credito se usa), el fallido queda `pendiente` y se pide en la corrida
//     siguiente, y solo ese.
//   - nunca una linea de log por SKU para causa_desconocida (ADR 0001:45-46).
//   - Ronda 2 (02/11/2026): un id que acumula 3 errores NO transitorios
//     (definitivo: 400, 404 o detalle que no es un comprobante) pasa a
//     `ilegible`, deja de pedirse, se cuenta en `comprobantes_ilegibles` y NO
//     deja el clasificador en `fallo` en las corridas siguientes (analisis
//     4.2; caso real P0-S2:212-213, Id=173386407). Un error transitorio, en
//     cambio, sigue dejando la corrida en rojo y nunca lleva a `ilegible`.
//
// causa_desconocida (DISENO-INTERFAZ.md seccion 6): con clasificador fallo o
// parcial, SKUs con delta no sembrado y delta + credito != 0.
//
// Corre con: node --test test/clasificador-huecos.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { evaluarCorrida } from "../src/resultado.js";
import {
  lineaResumen,
  valorEnResumen,
  idsPedidosDesde,
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
  capturarConsola,
  PAR_DOT,
  DEPOSITO_DOT,
  LOCATION_DOT,
  HORA,
} from "./_helpers-clasificador.js";

const CORTE_VIEJO = "2026-08-01T00:00:00.000Z";
const T = "2026-08-12T16:00:00.000Z";
const HACE_UNA_HORA = new Date(new Date(T).getTime() - HORA).toISOString();

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `skusContados`: los SKUs contados en causa_desconocida en esa corrida.
// `skusDelDeposito`: todos los del escenario (regla de la ronda 1, se conserva).
//
// Ronda 3 (CA-4 ampliado): falla ante CUALQUIER linea de log que contenga el
// codigo de un SKU contado en causa_desconocida, diga o no "desconocid" (por
// ejemplo "[AVISO] IEY-B: baja sin comprobante"). Unica salvedad: las lineas de
// escritura que ejecutarPar ya imprime hoy, con su formato EXACTO y sin nada
// agregado (R-4: esos SKUs se escriben). DISENO-INTERFAZ.md seccion 6.
function sinLineasPorSkuDeDesconocida(lineas, skusContados, skusDelDeposito = skusContados, par = "dot") {
  for (const l of lineas) {
    if (!/desconocid/i.test(l.texto)) continue;
    for (const sku of skusDelDeposito) {
      assert.ok(!l.texto.includes(sku), `log por SKU para causa_desconocida (prohibido): "${l.texto}"`);
    }
  }
  for (const sku of skusContados) {
    const s = escaparRegex(sku);
    const p = escaparRegex(par);
    const permitidas = [
      new RegExp(`^\\s*\\[SET\\] ${p}/${s}: -?\\d+ -> -?\\d+$`),
      new RegExp(`^\\s*\\[DRY\\] ${p}/${s}: actualizaria -?\\d+ -> -?\\d+ \\(no se escribe, DRY_RUN=true\\)$`),
    ];
    for (const l of lineas) {
      if (!l.texto.includes(sku)) continue;
      assert.ok(
        permitidas.some((re) => re.test(l.texto)),
        `linea de log que nombra ${sku}, contado en causa_desconocida (prohibido, ADR 0001:45-46): [${l.canal}] "${l.texto}"`
      );
    }
  }
}

test("CA-4: si buscarComprobantes lanza, los SKUs con delta aplican el delta sin credito y suman causa_desconocida, sin abortar", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { "IEY-A": 10, "IEY-B": 10, "IEY-C": 10 },
      contabilium: { "IEY-A": 10, "IEY-B": 10, "IEY-C": 10 },
      corte: CORTE_VIEJO,
    });
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-A", 9], ["IEY-B", 8], ["IEY-C", 10]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 10], ["IEY-B", 10], ["IEY-C", 10]])]]),
      fallaBusqueda: true,
      llamadas,
    });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [9], "delta -1 sin credito");
    assert.deepEqual(escriturasDe(llamadas, "IEY-B"), [8], "delta -2 sin credito");
    assert.deepEqual(escriturasDe(llamadas, "IEY-C"), [], "sin delta: atajo");
    assert.equal(res.causa_desconocida, 2, "los DOS SKUs con delta (no los 3 del deposito, no 1 por corrida)");
    assert.equal(res.clasificador, "fallo");
    assert.equal(res.actualizado, 2);
    assert.equal(llamadas.fetchComprobantesDetalle.length, 0, "sin /search no hay ids para pedir");
    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.contabilium, { "IEY-A": 9, "IEY-B": 8, "IEY-C": 10 }, "el baseline avanza igual: R-4 no bloquea");
    sinLineasPorSkuDeDesconocida(lineas, ["IEY-A", "IEY-B"], ["IEY-A", "IEY-B", "IEY-C"]);
  });
});

test("CA-4: si falla el detalle de UN id de cinco, los otros cuatro se registran y acreditan; el fallido queda pendiente y es el unico que se pide despues", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { "IEY-A": 10, "IEY-B": 10 },
      contabilium: { "IEY-A": 10, "IEY-B": 10 },
      corte: CORTE_VIEJO,
    });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 9], ["IEY-B", 8]])]]);
    const idsQueFallan = new Set([13]);
    const detalles = new Map([
      [11, comprobanteDetalle({ id: 11, referenciaUtc: HACE_UNA_HORA, items: [["IEY-A", 1]] })], // venta Shopify DOT
      [12, comprobanteDetalle({ id: 12, origen: "", idIntegracion: null, referenciaUtc: HACE_UNA_HORA, items: [["IEY-X", 1]] })],
      [13, comprobanteDetalle({ id: 13, origen: "", idIntegracion: null, referenciaUtc: HACE_UNA_HORA, items: [["IEY-B", 2]] })],
      [14, comprobanteDetalle({ id: 14, origen: "", idIntegracion: null, referenciaUtc: HACE_UNA_HORA, items: [["IEY-Y", 1]] })],
      [15, comprobanteDetalle({ id: 15, origen: "", idIntegracion: null, referenciaUtc: HACE_UNA_HORA, items: [["IEY-Z", 1]] })],
    ]);
    const deps = depsFake({
      dir,
      reloj: r,
      stock,
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 9], ["IEY-B", 10]])]]),
      search: [11, 12, 13, 14, 15].map((id) => resumenSearch(id)),
      detalles,
      idsQueFallan,
      llamadas,
    });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.deepEqual([...llamadas.idsDetalle].sort(), [11, 12, 13, 14, 15]);
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [], "el credito del 11 (que si llego) se usa: 9 + (-1) + 1 = 9");
    assert.deepEqual(escriturasDe(llamadas, "IEY-B"), [8], "IEY-B: delta -2 sin credito");
    assert.equal(res.causa_desconocida, 1, "solo IEY-B: IEY-A quedo explicado por su credito");
    assert.equal(res.clasificador, "fallo", "un detalle que falla es una falla del refresco (D-5)");
    assert.equal(evaluarCorrida(res).ok, false, "falla transitoria en esta corrida: rojo enseguida (D-5)");
    assert.equal(res.comprobantes_pendientes, 1);

    const reg = leerRegistroCrudo(dir);
    for (const id of ["11", "12", "14", "15"]) assert.equal(reg.comprobantes[id]?.estado, "ok", `id ${id} registrado`);
    assert.equal(reg.comprobantes["13"]?.estado, "pendiente");
    assert.equal(reg.comprobantes["13"].intentos, 1);
    assert.equal(reg.comprobantes["11"].lineas[0].sku, "IEY-A");
    sinLineasPorSkuDeDesconocida(lineas, ["IEY-B"], ["IEY-A", "IEY-B"]);

    // Corrida siguiente: el 13 se recupera y es el UNICO que se pide.
    idsQueFallan.delete(13);
    stock.get(DEPOSITO_DOT).set("IEY-B", 7);
    r.fijar("2026-08-12T17:00:00.000Z");
    const desde = llamadas.idsDetalle.length;
    const res2 = await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(llamadas.idsDetalle.slice(desde), [13]);
    assert.equal(leerRegistroCrudo(dir).comprobantes["13"].estado, "ok");
    assert.equal(res2.clasificador, "ok");
    assert.equal(res2.comprobantes_pendientes, 0);
  });
});

test("CA-4: si fetchComprobantesDetalle rechaza entera, ningun id se pierde: todos quedan pendientes y se piden en la corrida siguiente", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 9]])]]);
    const detalles = new Map([21, 22, 23].map((id) => [id, comprobanteDetalle({ id, origen: "", referenciaUtc: HACE_UNA_HORA, items: [["IEY-Q", 1]] })]));
    const base = {
      dir,
      reloj: r,
      stock,
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 10]])]]),
      search: [21, 22, 23].map((id) => resumenSearch(id)),
      detalles,
      llamadas,
    };

    const res = await sync.ejecutarPar(PAR_DOT, depsFake({ ...base, fallaDetalleEntero: true }));
    assert.equal(res.clasificador, "fallo");
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [9]);
    const reg = leerRegistroCrudo(dir);
    for (const id of ["21", "22", "23"]) assert.equal(reg.comprobantes[id]?.estado, "pendiente", `id ${id}`);

    stock.get(DEPOSITO_DOT).set("IEY-A", 8);
    r.fijar("2026-08-12T17:00:00.000Z");
    const desde = llamadas.idsDetalle.length;
    await sync.ejecutarPar(PAR_DOT, depsFake(base));
    assert.deepEqual(llamadas.idsDetalle.slice(desde).sort(), [21, 22, 23]);
  });
});

// -----------------------------------------------------------------------------
// Ronda 2: `ilegible` no deja la corrida en rojo para siempre.
// -----------------------------------------------------------------------------

// Id REAL de P0-S2:212-213 (una NCA que fallo el parseo estricto). En el fake,
// un id sin detalle devuelve { ok:false, error:"HTTP 404 ...", definitivo:true }:
// error NO transitorio en cada intento.
const ID_ILEGIBLE = 173386407;
const numerico = (a, b) => a - b;

// Corre `n` corridas de una hora de diferencia (mismo dia ART), con una venta de
// mostrador de 1 u. de IEY-A en cada una para que el refresco se dispare siempre.
async function corridasSeguidas({ dir, n, deps, llamadas, r, stock }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    r.fijar(new Date(new Date(T).getTime() + i * HORA).toISOString());
    stock.get(DEPOSITO_DOT).set("IEY-A", 9 - i);
    const desde = llamadas.idsDetalle.length;
    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));
    const [resumen] = lineaResumen(lineas, "dot");
    out.push({
      res,
      lineas,
      resumen: resumen?.texto ?? "",
      pedidos: [...idsPedidosDesde(llamadas, desde)].sort(numerico),
      registro: leerRegistroCrudo(dir),
    });
  }
  return out;
}

test("CA-4: un id con 3 errores NO transitorios pasa a 'ilegible', deja de pedirse, se cuenta en comprobantes_ilegibles y NO deja la corrida en rojo en las corridas siguientes (5 corridas)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 9]])]]);
    // 78: comprobante sano sin lineas Shopify. ID_ILEGIBLE: sin detalle (404 definitivo).
    const detalles = new Map([[78, comprobanteDetalle({ id: 78, origen: "", idIntegracion: null, referenciaUtc: HACE_UNA_HORA, items: [["IEY-Q", 1]] })]]);
    const deps = depsFake({
      dir,
      reloj: r,
      stock,
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 10]])]]),
      search: [resumenSearch(ID_ILEGIBLE, "NCA"), resumenSearch(78)],
      detalles,
      llamadas,
    });
    const c = await corridasSeguidas({ dir, n: 5, deps, llamadas, r, stock });

    // Pedidos: el id se reintenta hasta el 3er error definitivo y despues nunca mas.
    assert.deepEqual(c.map((x) => x.pedidos), [[78, ID_ILEGIBLE], [ID_ILEGIBLE], [ID_ILEGIBLE], [], []]);

    // Estado en el registro en disco al terminar cada corrida.
    const enDisco = c.map((x) => {
      const e = x.registro?.comprobantes?.[String(ID_ILEGIBLE)];
      return e && { estado: e.estado, intentos: e.intentos };
    });
    assert.deepEqual(enDisco, [
      { estado: "pendiente", intentos: 1 },
      { estado: "pendiente", intentos: 2 },
      { estado: "ilegible", intentos: 3 },
      { estado: "ilegible", intentos: 3 },
      { estado: "ilegible", intentos: 3 },
    ]);
    assert.equal(c[4].registro.comprobantes["78"].estado, "ok", "el resto del lote en orden");

    // Veredicto corrida por corrida. Corridas 1 y 2: el id quedo pendiente por un
    // error de ESTA corrida -> rojo (D-5). Desde la 3: ya no hay nada pendiente por
    // error; el ilegible se cuenta y la corrida sale en verde. Con la
    // implementacion incorrecta (ilegible = fallo) las cinco salen en rojo.
    assert.deepEqual(c.map((x) => x.res.clasificador), ["fallo", "fallo", "ok", "ok", "ok"]);
    assert.deepEqual(c.map((x) => evaluarCorrida(x.res).ok), [false, false, true, true, true]);
    assert.deepEqual(c.map((x) => x.res.comprobantes_pendientes), [1, 1, 0, 0, 0]);
    assert.deepEqual(c.map((x) => x.res.comprobantes_ilegibles), [0, 0, 1, 1, 1], "se cuenta mientras siga en el registro");
    assert.deepEqual(c.slice(2).map((x) => x.res.causa_desconocida), [0, 0, 0], "con clasificador ok no hay causa desconocida");
    // Ronda 3: en las corridas en fallo, IEY-A (delta -1, sin credito) es causa_desconocida
    // y ninguna linea de log lo nombra, salvo su [SET] con el formato exacto.
    assert.deepEqual(c.slice(0, 2).map((x) => x.res.causa_desconocida), [1, 1]);
    for (const x of c.slice(0, 2)) sinLineasPorSkuDeDesconocida(x.lineas, ["IEY-A"]);

    // Visible en el resumen impreso, sin SKUs.
    for (const [i, x] of c.entries()) {
      assert.equal(valorEnResumen(x.resumen, "comprobantes_ilegibles"), i < 2 ? "0" : "1", `corrida ${i + 1}: "${x.resumen}"`);
      assert.equal(valorEnResumen(x.resumen, "clasificador"), i < 2 ? "fallo" : "ok", `corrida ${i + 1}`);
    }
    // Una vez ilegible, el id no genera un error del clasificador en cada corrida.
    for (const x of c.slice(3)) {
      assert.equal(x.lineas.filter((l) => l.texto.includes("[CLASIFICADOR][ERROR]")).length, 0);
    }
    // El delta de mostrador se aplico en las cinco corridas (no bloquea, R-4).
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [9, 8, 7, 6, 5]);
  });
});

test("CA-4: un error TRANSITORIO nunca lleva a 'ilegible': el id se pide en cada corrida y cada corrida sale en rojo hasta que se recupera", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 9]])]]);
    const idsQueFallan = new Set([88]); // 503: definitivo:false
    const deps = depsFake({
      dir,
      reloj: r,
      stock,
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 10]])]]),
      search: [resumenSearch(88)],
      detalles: new Map([[88, comprobanteDetalle({ id: 88, origen: "", idIntegracion: null, referenciaUtc: HACE_UNA_HORA, items: [["IEY-Q", 1]] })]]),
      idsQueFallan,
      llamadas,
    });
    const c = await corridasSeguidas({ dir, n: 4, deps, llamadas, r, stock });
    assert.deepEqual(c.map((x) => x.pedidos), [[88], [88], [88], [88]]);
    assert.deepEqual(c.map((x) => x.registro.comprobantes["88"].estado), ["pendiente", "pendiente", "pendiente", "pendiente"]);
    assert.deepEqual(c.map((x) => x.res.clasificador), ["fallo", "fallo", "fallo", "fallo"]);
    assert.deepEqual(c.map((x) => evaluarCorrida(x.res).ok), [false, false, false, false]);
    assert.deepEqual(c.map((x) => x.res.comprobantes_ilegibles), [0, 0, 0, 0]);
    // Ronda 3: IEY-A es causa_desconocida en las cuatro y ninguna linea lo nombra (salvo su [SET]).
    assert.deepEqual(c.map((x) => x.res.causa_desconocida), [1, 1, 1, 1]);
    for (const x of c) sinLineasPorSkuDeDesconocida(x.lineas, ["IEY-A"]);

    // Se recupera: verde.
    idsQueFallan.delete(88);
    r.fijar(new Date(new Date(T).getTime() + 4 * HORA).toISOString());
    stock.get(DEPOSITO_DOT).set("IEY-A", 5);
    const res5 = await sync.ejecutarPar(PAR_DOT, deps);
    assert.equal(leerRegistroCrudo(dir).comprobantes["88"].estado, "ok");
    assert.equal(res5.clasificador, "ok");
    assert.equal(evaluarCorrida(res5).ok, true);
  });
});
