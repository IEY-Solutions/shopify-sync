// R-3 / CA-3 — costo acotado del registro de comprobantes (diseño B).
//
//   - el detalle de cada id se pide como maximo UNA vez mientras siga en la cache;
//   - los COT se descartan por el TipoFc de /search, sin pedir detalle;
//   - el refresco ocurre como maximo una vez por corrida, y solo si algun SKU no
//     sembrado tiene delta != 0 o queda credito pendiente;
//   - tope de detalles por corrida (60 por defecto); lo que excede queda pendiente.
//
// Contadores SEPARADOS (hallazgo del juez): `llamadas.fetchComprobantesDetalle`
// cuenta INVOCACIONES de la funcion; `llamadas.idsDetalle` cuenta ids pedidos.
// Los fixtures usan numeros distintos a proposito (ids != SKUs con delta), para
// que "un pedido por SKU" y "un pedido por comprobante" no den lo mismo.
//
// Corre con: node --test test/clasificador-costo-acotado.test.js
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
  leerRegistroCrudo,
  entradaShopify,
  comprobanteDetalle,
  resumenSearch,
  PAR_DOT,
  PAR_ISLA,
  DEPOSITO_DOT,
  DEPOSITO_ISLA,
  LOCATION_DOT,
  LOCATION_ISLA,
  HORA,
} from "./_helpers-clasificador.js";

const CORTE_VIEJO = "2026-08-01T00:00:00.000Z";

function detalleMostrador(id) {
  // Comprobante de mostrador (sin Origen): se registra, no acredita.
  return comprobanteDetalle({ id, origen: "", idIntegracion: null, referenciaUtc: "2026-08-12T15:00:00.000Z", items: [["IEY-OTRO", 1]] });
}

test("CA-3: dos corridas el mismo dia no vuelven a pedir el detalle de ningun id ya visto, y los COT nunca se piden", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    const llamadas = llamadasVacias();
    const r = reloj("2026-08-12T16:00:00.000Z");
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 9]])]]);
    const detalles = new Map([1, 2, 3, 4, 6].map((id) => [id, detalleMostrador(id)]));
    const deps = depsFake({
      dir,
      reloj: r,
      stock,
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 10]])]]),
      search: (rango, n) =>
        n === 1
          ? [resumenSearch(1), resumenSearch(2, "FCA"), resumenSearch(3), resumenSearch(4), resumenSearch(5, "COT")]
          : [resumenSearch(1), resumenSearch(2, "FCA"), resumenSearch(3), resumenSearch(4), resumenSearch(5, "COT"), resumenSearch(6)],
      detalles,
      llamadas,
    });

    await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual([...llamadas.idsDetalle].sort(), [1, 2, 3, 4], "corrida 1: los 4 no COT");
    assert.equal(llamadas.fetchComprobantesDetalle.length, 1, "una sola invocacion con el lote, no una por id");

    // Corrida 2, mismo dia, otra baja de IEY-A.
    stock.get(DEPOSITO_DOT).set("IEY-A", 8);
    r.fijar("2026-08-12T19:00:00.000Z");
    const desde = llamadas.idsDetalle.length;
    await sync.ejecutarPar(PAR_DOT, deps);
    assert.deepEqual(llamadas.idsDetalle.slice(desde), [6], "corrida 2: solo el id nuevo");
    assert.equal(llamadas.fetchComprobantesDetalle.length, 2);
    assert.ok(!llamadas.idsDetalle.includes(5), "un COT no genera pedido de detalle");
    assert.equal(llamadas.buscarComprobantes.length, 2, "un refresco por corrida");

    const reg = leerRegistroCrudo(dir);
    assert.ok(reg?.comprobantes?.["5"], "el COT queda registrado (para no volver a evaluarlo)");
    assert.equal(reg.comprobantes["5"].estado, "ok");
  });
});

test("CA-3: una corrida sin deltas no sembrados ni credito pendiente no llama a buscarComprobantes ni al detalle", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { "IEY-QUIETO": 7, "IEY-SIN-SNAP": 3 },
      contabilium: { "IEY-QUIETO": 7, "IEY-SIN-SNAP": 3 },
      corte: CORTE_VIEJO,
    });
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj("2026-08-12T16:00:00.000Z"),
      stock: new Map([
        [
          DEPOSITO_DOT,
          new Map([
            ["IEY-QUIETO", 7], // baseline = actual
            ["IEY-SIN-SNAP", 3], // baseline = actual
            ["IEY-NUEVO", 12], // sin baseline: sembrado, no dispara el refresco
          ]),
        ],
      ]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-QUIETO", 7], ["IEY-SIN-SNAP", 3], ["IEY-NUEVO", 0]])]]),
      search: [resumenSearch(1)],
      detalles: new Map([[1, detalleMostrador(1)]]),
      llamadas,
    });

    const res = await sync.ejecutarPar(PAR_DOT, deps);
    assert.equal(llamadas.buscarComprobantes.length, 0);
    assert.equal(llamadas.fetchComprobantesDetalle.length, 0);
    assert.equal(res.clasificador, "no_requerido");
    assert.equal(res.comprobantes_pedidos, 0);
  });
});

test("CA-3 (contracara): un credito pendiente SIN delta alcanza para refrescar", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-P": 5 }, contabilium: { "IEY-P": 5 }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, {
      ultimoRefrescoOk: "2026-08-12T15:00:00.000Z",
      comprobantes: [entradaShopify({ id: 70, sku: "IEY-P", referencia: "2026-08-12T15:30:00.000Z" })],
    });
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj("2026-08-12T16:00:00.000Z"),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-P", 5]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-P", 4]])]]),
      search: [resumenSearch(70)],
      llamadas,
    });
    await sync.ejecutarPar(PAR_DOT, deps);
    assert.equal(llamadas.buscarComprobantes.length, 1);
    assert.equal(llamadas.idsDetalle.length, 0, "el 70 ya estaba en la cache: no se vuelve a pedir");
  });
});

test("CA-3: con 150 ids nuevos y el tope por defecto (60), la corrida pide 60 y deja 90 pendientes, que piden las corridas siguientes sin repetir", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 100 }, contabilium: { "IEY-A": 100 }, corte: CORTE_VIEJO });
    const ids = Array.from({ length: 150 }, (_, i) => 5000 + i);
    const llamadas = llamadasVacias();
    const r = reloj("2026-08-12T16:00:00.000Z");
    const stock = new Map([[DEPOSITO_DOT, new Map([["IEY-A", 99]])]]);
    const deps = depsFake({
      dir,
      reloj: r,
      stock,
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 100]])]]),
      search: ids.map((id) => resumenSearch(id)),
      detalles: new Map(ids.map((id) => [id, detalleMostrador(id)])),
      llamadas,
    });

    const r1 = await sync.ejecutarPar(PAR_DOT, deps); // sin topeDetalles: tiene que valer 60
    const corrida1 = llamadas.idsDetalle.slice();
    assert.equal(corrida1.length, 60);
    assert.equal(new Set(corrida1).size, 60);
    assert.equal(llamadas.fetchComprobantesDetalle.length, 1);
    assert.equal(r1.comprobantes_pedidos, 60);
    assert.equal(r1.comprobantes_pendientes, 90);
    assert.equal(r1.clasificador, "parcial", "quedaron ids solo por el tope: parcial, no fallo");

    const reg = leerRegistroCrudo(dir);
    const pendientes = Object.values(reg.comprobantes).filter((c) => c.estado === "pendiente");
    assert.equal(pendientes.length, 90, "los 90 que no entraron quedan pendientes EN DISCO");

    stock.get(DEPOSITO_DOT).set("IEY-A", 98);
    r.fijar("2026-08-12T17:00:00.000Z");
    const r2 = await sync.ejecutarPar(PAR_DOT, deps);
    const corrida2 = llamadas.idsDetalle.slice(60);
    assert.equal(corrida2.length, 60, "la corrida siguiente sigue con los pendientes, con el mismo tope");
    assert.ok(corrida2.every((id) => !corrida1.includes(id)), "ningun id de la corrida 1 se vuelve a pedir");
    assert.equal(r2.comprobantes_pendientes, 30);

    stock.get(DEPOSITO_DOT).set("IEY-A", 97);
    r.fijar("2026-08-12T18:00:00.000Z");
    const r3 = await sync.ejecutarPar(PAR_DOT, deps);
    const corrida3 = llamadas.idsDetalle.slice(120);
    assert.equal(corrida3.length, 30);
    assert.deepEqual(new Set([...corrida1, ...corrida2, ...corrida3]).size, 150, "los 150, cada uno una sola vez");
    assert.equal(llamadas.idsDetalle.length, 150);
    assert.equal(r3.comprobantes_pendientes, 0);
    assert.equal(r3.clasificador, "ok");
  });
});

test("CA-3: el tope es configurable por corrida", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 100 }, contabilium: { "IEY-A": 100 }, corte: CORTE_VIEJO });
    const ids = Array.from({ length: 25 }, (_, i) => 8000 + i);
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj("2026-08-12T16:00:00.000Z"),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-A", 99]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 100]])]]),
      search: ids.map((id) => resumenSearch(id)),
      detalles: new Map(ids.map((id) => [id, detalleMostrador(id)])),
      llamadas,
    });
    const res = await sync.ejecutarPar(PAR_DOT, deps, { topeDetalles: 10 });
    assert.equal(llamadas.idsDetalle.length, 10);
    assert.equal(res.comprobantes_pendientes, 15);
  });
});

test("CA-3: con dos pares con deltas, el refresco es UNO por corrida (no uno por par)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-D": 5 }, contabilium: { "IEY-D": 5 }, corte: CORTE_VIEJO });
    sembrarLibreta(dir, "galerias-pacifico", { skus: { "IEY-I": 5 }, contabilium: { "IEY-I": 5 }, corte: CORTE_VIEJO });
    const llamadas = llamadasVacias();
    const T = "2026-08-12T16:00:00.000Z";
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([
        [DEPOSITO_DOT, new Map([["IEY-D", 4]])],
        [DEPOSITO_ISLA, new Map([["IEY-I", 4]])],
      ]),
      shopify: new Map([
        [LOCATION_DOT, new Map([["IEY-D", 5]])],
        [LOCATION_ISLA, new Map([["IEY-I", 5]])],
      ]),
      search: [resumenSearch(1), resumenSearch(2), resumenSearch(3)],
      detalles: new Map([
        [1, detalleMostrador(1)],
        [2, detalleMostrador(2)],
        [3, comprobanteDetalle({ id: 3, inventario: Number(DEPOSITO_ISLA), referenciaUtc: new Date(new Date(T).getTime() - HORA).toISOString(), items: [["IEY-I", 1]] })],
      ]),
      llamadas,
    });

    const porPar = await sync.correrTodosLosPares([PAR_DOT, PAR_ISLA], deps);

    assert.equal(llamadas.buscarComprobantes.length, 1);
    assert.equal(llamadas.fetchComprobantesDetalle.length, 1);
    assert.deepEqual([...llamadas.idsDetalle].sort(), [1, 2, 3]);
    // El registro es de la cuenta: la linea de la isla se acredita en la isla.
    assert.equal(porPar["galerias-pacifico"].causa_venta_shopify, 1);
    assert.equal(porPar.dot.causa_venta_shopify, 0);
  });
});
