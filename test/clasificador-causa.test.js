// R-2 / CA-2 — funciones puras del clasificador (diseño B, 02/11/2026).
//
// Interfaz: aceptacion/clasificador-causa-comprobante/DISENO-INTERFAZ.md, seccion 2.
//   lineasAcreditables(detalle, depositoId) -> [{ comprobanteId, sku, cantidad, referencia }]
//   esNotaCreditoShopify(detalle, depositoId) -> boolean
//   parsearFechaArgentina(texto) -> Date | null
//   diaArgentina(date) -> "YYYY-MM-DD"
//
// ZONA HORARIA: este archivo fuerza TZ=UTC, la del runner de GitHub. Contabilium
// manda las fechas SIN zona ("2026-08-12T19:14:29.66", verificado por la persona
// el 02/11/2026) y son hora de Argentina. Una implementacion que haga
// `new Date(texto)` las interpreta en la zona del proceso: en UTC da
// 19:14:29.660Z en vez de 22:14:29.660Z, y este archivo falla.
//
// Corre con: node --test test/clasificador-causa.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as clasif from "../src/clasificador-causa.js";
import {
  comprobanteReal,
  comprobanteDetalle,
  COMPROBANTE_REAL_177960828,
  REFERENCIA_REAL_177960828,
  DEPOSITO_DOT,
  DEPOSITO_CENTRAL,
  DEPOSITO_FULL_ML,
} from "./_helpers-clasificador.js";

test("precondicion: el proceso de este test corre en UTC (la trampa de zona horaria esta armada)", () => {
  assert.equal(new Date(2026, 7, 12, 19, 14, 29, 660).toISOString(), "2026-08-12T19:14:29.660Z");
  assert.equal(new Date("2026-08-12T19:14:29.66").toISOString(), "2026-08-12T19:14:29.660Z");
});

// -----------------------------------------------------------------------------
// El caso real
// -----------------------------------------------------------------------------

test("CA-2: el comprobante REAL 177960828 devuelve una linea IEY-C09-GRIS x1 con referencia 2026-08-12T22:14:29.660Z", () => {
  const lineas = clasif.lineasAcreditables(comprobanteReal(), DEPOSITO_DOT);
  assert.deepEqual(lineas, [
    { comprobanteId: 177960828, sku: "IEY-C09-GRIS", cantidad: 1, referencia: REFERENCIA_REAL_177960828 },
  ]);
  // La referencia es la MAYOR entre FechaAlta (19:14:11.633) y FechaEmision
  // (19:14:29.66): la de emision, interpretada como hora de Argentina.
  assert.notEqual(lineas[0].referencia, "2026-08-12T19:14:29.660Z", "interpretada en UTC: 3 horas corrida");
  assert.notEqual(lineas[0].referencia, "2026-08-12T22:14:11.633Z", "esa es FechaAlta: la referencia es la mayor de las dos");
});

test("CA-2: el depositoId del par llega como string ('127356') y el Inventario como numero (127356): coinciden", () => {
  assert.equal(clasif.lineasAcreditables(comprobanteReal(), "127356").length, 1);
  assert.equal(clasif.lineasAcreditables(comprobanteReal(), 127356).length, 1);
});

test("CA-2: la funcion es pura: no hace IO y no muta el comprobante que recibe", () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("lineasAcreditables no puede hacer IO");
  };
  try {
    const c = comprobanteReal();
    const antes = JSON.stringify(c);
    clasif.lineasAcreditables(c, DEPOSITO_DOT);
    clasif.esNotaCreditoShopify(c, DEPOSITO_DOT);
    assert.equal(JSON.stringify(c), antes);
    assert.deepEqual(JSON.parse(antes), JSON.parse(JSON.stringify(COMPROBANTE_REAL_177960828)));
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// -----------------------------------------------------------------------------
// Fechas sin zona horaria = hora de Argentina, con CUALQUIER TZ del proceso
// -----------------------------------------------------------------------------

test("CA-2: parsearFechaArgentina interpreta un texto sin zona como hora de Argentina, sea cual sea la TZ del proceso", () => {
  const zonas = ["UTC", "Asia/Tokyo", "America/Los_Angeles", "America/Argentina/Buenos_Aires"];
  try {
    for (const tz of zonas) {
      process.env.TZ = tz;
      const d = clasif.parsearFechaArgentina("2026-08-12T19:14:29.66");
      assert.ok(d instanceof Date, `con TZ=${tz} tiene que devolver un Date`);
      assert.equal(d.toISOString(), "2026-08-12T22:14:29.660Z", `con TZ=${tz}`);
      assert.equal(clasif.parsearFechaArgentina("2026-08-12T19:14:11.633").toISOString(), "2026-08-12T22:14:11.633Z", `con TZ=${tz}`);
    }
  } finally {
    process.env.TZ = "UTC";
  }
});

test("CA-2: parsearFechaArgentina: fracciones de 0 a 7 digitos, offsets explicitos y textos invalidos", () => {
  assert.equal(clasif.parsearFechaArgentina("2026-08-12T19:14:29").toISOString(), "2026-08-12T22:14:29.000Z");
  assert.equal(clasif.parsearFechaArgentina("2026-08-12T19:14:29.6").toISOString(), "2026-08-12T22:14:29.600Z");
  // .NET serializa hasta 7 digitos de fraccion: se trunca a milisegundos.
  assert.equal(clasif.parsearFechaArgentina("2026-08-12T19:14:29.6601234").toISOString(), "2026-08-12T22:14:29.660Z");
  // Cruce de dia: 22:30 de Argentina del 12/08 es 01:30Z del 13/08.
  assert.equal(clasif.parsearFechaArgentina("2026-08-12T22:30:00").toISOString(), "2026-08-13T01:30:00.000Z");
  // Con zona explicita se respeta la zona del texto.
  assert.equal(clasif.parsearFechaArgentina("2026-08-12T19:14:29.66Z").toISOString(), "2026-08-12T19:14:29.660Z");
  assert.equal(clasif.parsearFechaArgentina("2026-08-12T19:14:29.66-03:00").toISOString(), "2026-08-12T22:14:29.660Z");
  for (const malo of ["", null, undefined, "no-es-fecha", "2026-13-45T99:99:99"]) {
    assert.equal(clasif.parsearFechaArgentina(malo), null, `"${malo}" tiene que dar null`);
  }
});

test("CA-2: diaArgentina devuelve el dia calendario de Argentina, no el de UTC ni el de la TZ del proceso", () => {
  assert.equal(clasif.diaArgentina(new Date("2026-08-13T01:30:00.000Z")), "2026-08-12", "22:30 ART del 12/08");
  assert.equal(clasif.diaArgentina(new Date("2026-08-13T02:59:59.999Z")), "2026-08-12", "23:59:59.999 ART del 12/08");
  assert.equal(clasif.diaArgentina(new Date("2026-08-13T03:00:00.000Z")), "2026-08-13", "medianoche ART");
  try {
    process.env.TZ = "Asia/Tokyo";
    assert.equal(clasif.diaArgentina(new Date("2026-08-12T16:00:00.000Z")), "2026-08-12", "con TZ=Asia/Tokyo (ya es 13/08 alla)");
  } finally {
    process.env.TZ = "UTC";
  }
});

test("CA-2: la referencia es la MAYOR entre FechaAlta y FechaEmision (una emision con fecha anterior al alta usa el alta)", () => {
  const c = comprobanteDetalle({
    id: 900001,
    referenciaUtc: "2026-08-12T13:00:00.000Z", // FechaEmision 10:00 ART
    fechaAltaUtc: "2026-08-12T22:00:00.000Z", // FechaAlta 19:00 ART, mas tarde
    items: [["IEY-A", 1]],
  });
  const [l] = clasif.lineasAcreditables(c, DEPOSITO_DOT);
  assert.equal(l.referencia, "2026-08-12T22:00:00.000Z");
});

// -----------------------------------------------------------------------------
// Normalizacion, cantidades enteras y lineas sin Codigo
// -----------------------------------------------------------------------------

test("CA-2: el SKU se normaliza con trim + mayusculas, y dos items del mismo SKU del mismo comprobante se suman en una linea", () => {
  const c = comprobanteDetalle({
    id: 900002,
    referenciaUtc: "2026-08-12T22:00:00.000Z",
    items: [[" iey-x ", 1], ["IEY-X", 2], ["iey-y", 1]],
  });
  const lineas = clasif.lineasAcreditables(c, DEPOSITO_DOT);
  const porSku = Object.fromEntries(lineas.map((l) => [l.sku, l.cantidad]));
  assert.deepEqual(porSku, { "IEY-X": 3, "IEY-Y": 1 });
  assert.equal(lineas.length, 2);
  for (const l of lineas) assert.equal(l.comprobanteId, 900002);
});

test("CA-2: cantidades enteras (invariante 6): decimales al piso (lado seguro), cero o negativo se ignora", () => {
  const c = comprobanteDetalle({
    id: 900003,
    referenciaUtc: "2026-08-12T22:00:00.000Z",
    items: [["IEY-ENTERO", 2.0], ["IEY-DECIMAL", 1.7], ["IEY-CERO", 0], ["IEY-NEG", -1]],
  });
  const porSku = Object.fromEntries(clasif.lineasAcreditables(c, DEPOSITO_DOT).map((l) => [l.sku, l.cantidad]));
  assert.deepEqual(porSku, { "IEY-ENTERO": 2, "IEY-DECIMAL": 1 });
  for (const v of Object.values(porSku)) assert.ok(Number.isInteger(v));
});

test("CA-2: las lineas sin Codigo (combos) se ignoran, sin descartar las demas lineas del comprobante", () => {
  const c = comprobanteDetalle({
    id: 900004,
    referenciaUtc: "2026-08-12T22:00:00.000Z",
    items: [["IEY-OK", 1]],
  });
  c.Items.push({ Id: 1, Cantidad: 1, Tipo: "C" }); // sin Codigo
  c.Items.push({ Id: 2, Codigo: "", Cantidad: 1 });
  c.Items.push({ Id: 3, Codigo: null, Cantidad: 1 });
  c.Items.push({ Id: 4, Codigo: "   ", Cantidad: 1 });
  const lineas = clasif.lineasAcreditables(c, DEPOSITO_DOT);
  assert.deepEqual(lineas.map((l) => l.sku), ["IEY-OK"]);
});

// -----------------------------------------------------------------------------
// Filtros: cualquier otra combinacion devuelve CERO lineas
// -----------------------------------------------------------------------------

test("CA-2: Inventario de CENTRAL (96667) o FULL ML (97094) devuelve cero lineas para el DOT (invariante 2)", () => {
  for (const inv of [Number(DEPOSITO_CENTRAL), Number(DEPOSITO_FULL_ML), DEPOSITO_CENTRAL]) {
    const c = { ...comprobanteReal(), Inventario: inv };
    assert.deepEqual(clasif.lineasAcreditables(c, DEPOSITO_DOT), [], `Inventario ${inv}`);
  }
  // Y al reves: el comprobante real del DOT no le da lineas a CENTRAL.
  assert.deepEqual(clasif.lineasAcreditables(comprobanteReal(), DEPOSITO_CENTRAL), []);
});

test("CA-2: Origen vacio o ausente, o IDIntegracion 24528, devuelven cero lineas", () => {
  const sinOrigen = { ...comprobanteReal(), Origen: "" };
  const origenAusente = comprobanteReal();
  delete origenAusente.Origen;
  const otraIntegracion = { ...comprobanteReal(), IDIntegracion: 24528 };
  const integracionAusente = comprobanteReal();
  delete integracionAusente.IDIntegracion;
  for (const [nombre, c] of Object.entries({ sinOrigen, origenAusente, otraIntegracion, integracionAusente })) {
    assert.deepEqual(clasif.lineasAcreditables(c, DEPOSITO_DOT), [], nombre);
  }
});

test("CA-2: TipoFc COT o una nota de credito devuelven cero lineas acreditables; FCA, FCB, FCE y FCM si acreditan", () => {
  for (const tipo of ["COT", "NCA", "NCB", "NCE", "NCM", "", "PRE"]) {
    const c = { ...comprobanteReal(), TipoFc: tipo };
    assert.deepEqual(clasif.lineasAcreditables(c, DEPOSITO_DOT), [], `TipoFc ${tipo}`);
  }
  for (const tipo of ["FCA", "FCB", "FCE", "FCM"]) {
    const c = { ...comprobanteReal(), TipoFc: tipo };
    assert.equal(clasif.lineasAcreditables(c, DEPOSITO_DOT).length, 1, `TipoFc ${tipo}`);
  }
});

test("CA-2: una NCB Shopify/25020 del deposito se reconoce como nota de credito (para contarla) y no acredita", () => {
  const ncb = { ...comprobanteReal(), Id: 177999001, TipoFc: "NCB" };
  assert.deepEqual(clasif.lineasAcreditables(ncb, DEPOSITO_DOT), []);
  assert.equal(clasif.esNotaCreditoShopify(ncb, DEPOSITO_DOT), true);
  for (const tipo of ["NCA", "NCE", "NCM"]) {
    assert.equal(clasif.esNotaCreditoShopify({ ...ncb, TipoFc: tipo }, DEPOSITO_DOT), true, tipo);
  }
  // No es nota de credito Shopify del deposito: factura, otro deposito, otro origen, otra integracion.
  assert.equal(clasif.esNotaCreditoShopify(comprobanteReal(), DEPOSITO_DOT), false, "una factura no es nota de credito");
  assert.equal(clasif.esNotaCreditoShopify({ ...ncb, Inventario: Number(DEPOSITO_CENTRAL) }, DEPOSITO_DOT), false);
  assert.equal(clasif.esNotaCreditoShopify({ ...ncb, Origen: "" }, DEPOSITO_DOT), false);
  assert.equal(clasif.esNotaCreditoShopify({ ...ncb, IDIntegracion: 24528 }, DEPOSITO_DOT), false);
});

test("CA-2: claveConsumo arma la clave comprobanteId:SKU", () => {
  assert.equal(clasif.claveConsumo(177960828, "IEY-C09-GRIS"), "177960828:IEY-C09-GRIS");
});
