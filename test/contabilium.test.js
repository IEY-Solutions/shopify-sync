// H8 (reintentos), D-04 (StockConReservas) y D-01 (subestimar).
//
// Los tres eran hallazgos con decision tomada que el codigo no honraba:
//   - H8: no habia NINGUN reintento. Un solo 429 o 5xx en cualquiera de las ~52
//     paginas abortaba la corrida entera y tiraba todo el progreso.
//   - D-04 / regla 11: la fuente de cantidad es StockConReservas, no StockActual.
//   - D-01 / AC-16: ante incertidumbre se SUBESTIMA. Math.round sobre-ofrecia.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decidirReintento,
  cantidadDeItem,
  MAX_INTENTOS,
  ESPERA_429_POR_DEFECTO_MS,
  PRESUPUESTO_ESPERA_MS,
} from "../src/contabilium.js";

// -----------------------------------------------------------------------------
// H8 — politica de reintentos
// -----------------------------------------------------------------------------

test("un 429 respeta el Retry-After que manda Contabilium", () => {
  const d = decidirReintento({ status: 429, intento: 1, retryAfter: "30" });
  assert.equal(d.reintentar, true);
  assert.equal(d.esperaMs, 30_000);
});

test("un 429 SIN Retry-After espera un minuto, no reintenta al toque", () => {
  // Un 429 bloquea TODOS los endpoints de Contabilium por ~1 min, y el cupo esta
  // compartido con iey-ai. Insistir antes profundiza el bloqueo para los dos.
  const d = decidirReintento({ status: 429, intento: 1, retryAfter: null });
  assert.equal(d.reintentar, true);
  assert.equal(d.esperaMs, ESPERA_429_POR_DEFECTO_MS);
  assert.equal(ESPERA_429_POR_DEFECTO_MS, 60_000);
});

test("un Retry-After basura cae al default en vez de romper", () => {
  for (const v of ["", "muchos", "-5", "0", null, undefined]) {
    const d = decidirReintento({ status: 429, intento: 1, retryAfter: v });
    assert.equal(d.esperaMs, ESPERA_429_POR_DEFECTO_MS, `Retry-After=${v}`);
  }
});

test("los 5xx reintentan con backoff exponencial", () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(decidirReintento({ status, intento: 1 }).esperaMs, 1000);
    assert.equal(decidirReintento({ status, intento: 2 }).esperaMs, 2000);
    assert.equal(decidirReintento({ status, intento: 3 }).esperaMs, 4000);
  }
});

test("un fallo de red (sin status) tambien reintenta", () => {
  const d = decidirReintento({ status: null, intento: 1 });
  assert.equal(d.reintentar, true);
  assert.match(d.motivo, /red/);
});

test("los 4xx que NO son transitorios fallan rapido: reintentar no arregla nada", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    const d = decidirReintento({ status, intento: 1 });
    assert.equal(d.reintentar, false, `HTTP ${status} no deberia reintentarse`);
    assert.match(d.motivo, /no es transitorio/);
  }
});

test("se rinde tras agotar los intentos", () => {
  const d = decidirReintento({ status: 503, intento: MAX_INTENTOS });
  assert.equal(d.reintentar, false);
  assert.match(d.motivo, /agotados/);
});

test("si esperar excede el presupuesto de la corrida, NO duerme: aborta", () => {
  // Regla heredada del cliente de iey-ai. Dormir 40 min dentro de un job con
  // timeout de 50 es perder la corrida igual, pero tarde y sin diagnostico.
  const d = decidirReintento({
    status: 429,
    intento: 1,
    retryAfter: null,
    esperaAcumuladaMs: PRESUPUESTO_ESPERA_MS,
  });
  assert.equal(d.reintentar, false);
  assert.match(d.motivo, /presupuesto/);
});

test("justo debajo del presupuesto todavia reintenta", () => {
  const d = decidirReintento({
    status: 503,
    intento: 1,
    esperaAcumuladaMs: PRESUPUESTO_ESPERA_MS - 2000,
  });
  assert.equal(d.reintentar, true);
});

// -----------------------------------------------------------------------------
// D-04 — la fuente de cantidad es StockConReservas
// -----------------------------------------------------------------------------

test("usa StockConReservas y no StockActual", () => {
  // StockConReservas = StockActual - StockReservado. Contabilium reserva al
  // ENTRAR la orden: publicar StockActual ofrece unidades que ya tienen dueño.
  assert.equal(cantidadDeItem({ StockActual: 10, StockReservado: 3, StockConReservas: 7 }), 7);
});

test("hoy en el DOT son identicos, y eso no cambia el resultado", () => {
  // StockReservado = 0 en los 2.562 items del DOT (verificado en P0).
  assert.equal(cantidadDeItem({ StockActual: 5, StockReservado: 0, StockConReservas: 5 }), 5);
});

test("si falta StockConReservas cae a StockActual en vez de saltear el SKU", () => {
  // Un NaN aca no seria un error ruidoso: saltearia el SKU en silencio.
  assert.equal(cantidadDeItem({ StockActual: 4 }), 4);
});

test("sin ningun campo usable devuelve NaN, y el llamador saltea la fila", () => {
  assert.ok(Number.isNaN(cantidadDeItem({})));
  assert.ok(Number.isNaN(cantidadDeItem(null)));
  assert.ok(Number.isNaN(cantidadDeItem({ StockActual: "hola" })));
});

// -----------------------------------------------------------------------------
// D-01 — ante incertidumbre se SUBESTIMA
// -----------------------------------------------------------------------------

test("los decimales se redondean HACIA ABAJO: venta perdida antes que sobreventa", () => {
  // Math.round(2.6) = 3 publicaba 3 unidades habiendo 2,6. Es sobre-oferta, o sea
  // exactamente lo contrario de lo que decidio D-01.
  assert.equal(cantidadDeItem({ StockConReservas: 2.6 }), 2);
  assert.equal(cantidadDeItem({ StockConReservas: 0.9 }), 0);
  assert.equal(cantidadDeItem({ StockConReservas: 1.0 }), 1);
});

test("un cero es un cero, no un faltante", () => {
  assert.equal(cantidadDeItem({ StockConReservas: 0, StockActual: 0 }), 0);
});
