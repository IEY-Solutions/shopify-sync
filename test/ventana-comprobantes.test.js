// R-9 / CA-9 — que dias consulta el refresco del registro (diseño B).
//
// Reemplaza la ventana [ultimaCorridaExitosa, ahora] del diseño viejo. Regla
// (DISENO-INTERFAZ.md seccion 5, paso 7): un solo buscarComprobantes por
// refresco, con fechaDesde/fechaHasta en dias calendario de ARGENTINA:
//   - fechaHasta = hoy (ART) de tInicioLectura;
//   - sin refresco previo -> desde ayer;
//   - ultimo refresco OK del mismo dia ART -> solo hoy;
//   - si no -> desde el dia del ultimo refresco OK, con tope de 7 dias (hoy incluido).
// Y tInicioLectura se toma ANTES de getStockDeposito.
//
// TZ=UTC como el runner: los casos estan elegidos para que el dia de UTC y el
// de Argentina NO coincidan (00:30 ART del 13/08 = 03:30Z del 13/08, y el
// refresco anterior, 23:50 ART del 12/08 = 02:50Z del 13/08: mismo dia en UTC).
//
// Corre con: node --test test/ventana-comprobantes.test.js
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
  comprobanteDetalle,
  resumenSearch,
  escriturasDe,
  PAR_DOT,
  DEPOSITO_DOT,
  LOCATION_DOT,
  MIN,
} from "./_helpers-clasificador.js";

const CORTE_VIEJO = "2026-08-01T00:00:00.000Z";

// Un par con un SKU con delta -1 (dispara el refresco). Devuelve las llamadas.
async function unaCorrida(dir, { ahora, registro = undefined, llamadas = llamadasVacias(), cantidadAhora = 9 }) {
  if (registro !== undefined) sembrarRegistro(dir, registro);
  if (!leerLibretaCruda(dir, "dot")) {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
  }
  const deps = depsFake({
    dir,
    reloj: reloj(ahora),
    stock: new Map([[DEPOSITO_DOT, new Map([["IEY-A", cantidadAhora]])]]),
    shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 10]])]]),
    search: [],
    llamadas,
  });
  await sync.ejecutarPar(PAR_DOT, deps);
  return llamadas;
}

function rangoUnico(llamadas) {
  assert.equal(llamadas.buscarComprobantes.length, 1, "un solo buscarComprobantes por refresco");
  const { fechaDesde, fechaHasta } = llamadas.buscarComprobantes[0];
  return { fechaDesde, fechaHasta };
}

test("CA-9: sin refresco previo (cache vacia), a las 22:30 ART del 12/08 consulta ayer y hoy de Argentina: 2026-08-11 .. 2026-08-12", async () => {
  await conDirTemporal(async (dir) => {
    const ll = await unaCorrida(dir, { ahora: "2026-08-13T01:30:00.000Z" });
    assert.deepEqual(rangoUnico(ll), { fechaDesde: "2026-08-11", fechaHasta: "2026-08-12" });
  });
});

test("CA-9: el primer refresco despues de medianoche de Argentina consulta ayer y hoy, y marca ayer cerrado", async () => {
  await conDirTemporal(async (dir) => {
    const ll = await unaCorrida(dir, {
      ahora: "2026-08-13T03:30:00.000Z", // 00:30 ART del 13/08
      registro: { ultimoRefrescoOk: "2026-08-13T02:50:00.000Z", diasCerrados: [], comprobantes: [] }, // 23:50 ART del 12/08
    });
    assert.deepEqual(rangoUnico(ll), { fechaDesde: "2026-08-12", fechaHasta: "2026-08-13" });
    const reg = leerRegistroCrudo(dir);
    assert.ok(reg.diasCerrados.includes("2026-08-12"), "ayer queda cerrado");
    assert.ok(!reg.diasCerrados.includes("2026-08-13"), "hoy no se cierra");
    assert.equal(reg.ultimoRefrescoOk, "2026-08-13T03:30:00.000Z", "ultimoRefrescoOk = tInicioLectura del refresco exitoso");
  });
});

test("CA-9: los refrescos siguientes del mismo dia de Argentina consultan solo hoy", async () => {
  await conDirTemporal(async (dir) => {
    const ll = await unaCorrida(dir, {
      ahora: "2026-08-13T15:00:00.000Z", // 12:00 ART del 13/08
      registro: { ultimoRefrescoOk: "2026-08-13T03:30:00.000Z", diasCerrados: ["2026-08-12"], comprobantes: [] },
    });
    assert.deepEqual(rangoUnico(ll), { fechaDesde: "2026-08-13", fechaHasta: "2026-08-13" });
  });
});

test("CA-9: dos corridas seguidas: la primera post-medianoche cubre ayer; la segunda, mismo dia, ya no", async () => {
  await conDirTemporal(async (dir) => {
    sembrarRegistro(dir, { ultimoRefrescoOk: "2026-08-13T02:50:00.000Z", diasCerrados: [], comprobantes: [] });
    const ll = llamadasVacias();
    await unaCorrida(dir, { ahora: "2026-08-13T03:30:00.000Z", llamadas: ll, cantidadAhora: 9 });
    await unaCorrida(dir, { ahora: "2026-08-13T04:30:00.000Z", llamadas: ll, cantidadAhora: 8 });
    assert.equal(ll.buscarComprobantes.length, 2);
    assert.deepEqual(
      ll.buscarComprobantes.map((b) => [b.fechaDesde, b.fechaHasta]),
      [["2026-08-12", "2026-08-13"], ["2026-08-13", "2026-08-13"]]
    );
  });
});

test("CA-9: con el ultimo refresco exitoso de hace 4 dias, consulta esos 4 dias y hoy", async () => {
  await conDirTemporal(async (dir) => {
    const ll = await unaCorrida(dir, {
      ahora: "2026-08-13T15:00:00.000Z",
      registro: { ultimoRefrescoOk: "2026-08-09T15:00:00.000Z", diasCerrados: [], comprobantes: [] },
    });
    assert.deepEqual(rangoUnico(ll), { fechaDesde: "2026-08-09", fechaHasta: "2026-08-13" });
  });
});

test("CA-9: con el ultimo refresco exitoso de hace 10 dias, consulta como maximo 7 dias (hoy incluido)", async () => {
  await conDirTemporal(async (dir) => {
    const ll = await unaCorrida(dir, {
      ahora: "2026-08-13T15:00:00.000Z",
      registro: { ultimoRefrescoOk: "2026-08-03T15:00:00.000Z", diasCerrados: [], comprobantes: [] },
    });
    assert.deepEqual(rangoUnico(ll), { fechaDesde: "2026-08-07", fechaHasta: "2026-08-13" });
  });
});

test("CA-9: un refresco que falla no avanza ultimoRefrescoOk: la corrida siguiente vuelve a cubrir desde el mismo dia", async () => {
  await conDirTemporal(async (dir) => {
    sembrarRegistro(dir, { ultimoRefrescoOk: "2026-08-11T15:00:00.000Z", diasCerrados: [], comprobantes: [] });
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    const ll = llamadasVacias();
    const base = {
      dir,
      reloj: reloj("2026-08-13T15:00:00.000Z"),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-A", 9]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 10]])]]),
      llamadas: ll,
    };
    await sync.ejecutarPar(PAR_DOT, depsFake({ ...base, fallaBusqueda: true }));
    base.stock.get(DEPOSITO_DOT).set("IEY-A", 8);
    base.reloj.fijar("2026-08-13T16:00:00.000Z");
    await sync.ejecutarPar(PAR_DOT, depsFake(base));
    assert.deepEqual(
      ll.buscarComprobantes.map((b) => b.fechaDesde),
      ["2026-08-11", "2026-08-11"],
      "el dia 11 no se da por cubierto hasta que un refresco salga bien"
    );
  });
});

test("CA-9: tInicioLectura se toma ANTES de getStockDeposito: una venta emitida durante la lectura no se acredita en esa corrida, si en la siguiente", async () => {
  await conDirTemporal(async (dir) => {
    // La lectura de stock arranca a T y tarda 20 min. La venta Shopify se emite a
    // T + 2 min (durante la lectura). Margen 5 min.
    //   tInicioLectura correcto = T       -> T+2 no es < T-5:      no se acredita.
    //   tomado DESPUES de leer  = T+20min -> T+2 <  T+15:          se acreditaria (mal).
    const T = new Date("2026-08-12T16:00:00.000Z").getTime();
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    const ll = llamadasVacias();
    const r = reloj(new Date(T).toISOString());
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 9]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["IEY-A", 9]])]]); // Shopify ya desconto la venta online
    const deps = depsFake({
      dir,
      reloj: r,
      stock,
      shopify,
      alLeerStock: () => r.fijar(new Date(T + 20 * MIN).toISOString()),
      search: [resumenSearch(901)],
      detalles: new Map([[901, comprobanteDetalle({ id: 901, referenciaUtc: new Date(T + 2 * MIN).toISOString(), items: [["IEY-A", 1]] })]]),
      llamadas: ll,
    });

    await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(escriturasDe(ll, "IEY-A"), [8], "corrida 1: la venta todavia no es acreditable: 9 + (-1) = 8");
    assert.equal(leerLibretaCruda(dir, "dot").consumos?.["901:IEY-A"], undefined);

    r.fijar(new Date(T + 40 * MIN).toISOString());
    await sync.ejecutarPar(PAR_DOT, depsFake({ dir, reloj: r, stock, shopify, search: [resumenSearch(901)], llamadas: ll }));
    assert.deepEqual(escriturasDe(ll, "IEY-A"), [8, 9], "corrida 2: se acredita sin delta: 8 + 0 + 1 = 9");
  });
});
