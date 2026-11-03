// sku-universal-calculo.test.js
// -----------------------------------------------------------------------------
// T04 — test de apoyo de `calcularUnico` (src/sync.js). Sin red, sin journal:
// solo la funcion pura de calculo. CA-2 y CA-3 se cierran en T06; estos casos
// son apoyo de R-3/R-4 con los numeros exactos de
// aceptacion/sku-universal-multivarianta/escenarios-ca2-cinco-variantes.md
// (A, A', B, C, D, D2, H) y escenarios-ca3-dos-variantes.md (B, C, D, E).
// -----------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularUnico } from "../src/sync.js";

// -----------------------------------------------------------------------------
// R-4: los tres ejemplos normativos del contrato.
// -----------------------------------------------------------------------------

test("R-4: ventas individuales, escrito 5, 4/5/5/5/5 y Contabilium -1 da 3", () => {
  const { nuevoValor, camino } = calcularUnico({
    baseline: 5,
    contabiliumActual: 4,
    escrito: 5,
    availables: [4, 5, 5, 5, 5],
  });
  assert.equal(camino, "normal");
  assert.equal(nuevoValor, 3);
});

test("R-4: piso total, escrito 1, Shopify 0/0 y Contabilium sin cambios da 0", () => {
  const { nuevoValor, shopifyActual } = calcularUnico({
    baseline: 1,
    contabiliumActual: 1,
    escrito: 1,
    availables: [0, 0],
  });
  assert.equal(shopifyActual, 0);
  assert.equal(nuevoValor, 0);
});

test("R-4: suba ignorada, escrito 5, Shopify 8/5/5/5/5 y Contabilium sin cambios da 5", () => {
  const { nuevoValor, shopifyActual } = calcularUnico({
    baseline: 5,
    contabiliumActual: 5,
    escrito: 5,
    availables: [8, 5, 5, 5, 5],
  });
  assert.equal(shopifyActual, 5);
  assert.equal(nuevoValor, 5);
});

// -----------------------------------------------------------------------------
// CA-2 — SKU de 5 variantes (escenarios-ca2-cinco-variantes.md).
// -----------------------------------------------------------------------------

test("CA-2 A: bootstrap, 5 variantes iguales en 5, baseline 10 -> 13 da 8", () => {
  const { nuevoValor, camino, shopifyActual } = calcularUnico({
    baseline: 10,
    contabiliumActual: 13,
    escrito: null,
    availables: [5, 5, 5, 5, 5],
  });
  assert.equal(camino, "bootstrap");
  assert.equal(shopifyActual, 5);
  assert.equal(nuevoValor, 8);
});

test("CA-2 A': camino normal con escrito 5, mismas variantes, mismo resultado que A", () => {
  const { nuevoValor, camino } = calcularUnico({
    baseline: 10,
    contabiliumActual: 13,
    escrito: 5,
    availables: [5, 5, 5, 5, 5],
  });
  assert.equal(camino, "normal");
  assert.equal(nuevoValor, 8);
});

test("CA-2 B: bootstrap divergente 7/0/0/0/0 toma el maximo 7, baseline 10 -> 9 da 6", () => {
  const { nuevoValor, camino, shopifyActual } = calcularUnico({
    baseline: 10,
    contabiliumActual: 9,
    escrito: null,
    availables: [7, 0, 0, 0, 0],
  });
  assert.equal(camino, "bootstrap");
  assert.equal(shopifyActual, 7);
  assert.equal(nuevoValor, 6);
});

test("CA-2 C: siembra con Contabilium decimal 8.6 da 9 (entero, Math.round)", () => {
  const { nuevoValor, camino } = calcularUnico({
    baseline: null,
    contabiliumActual: 8.6,
    escrito: null,
    availables: [7, 0, 0, 0, 0],
  });
  assert.equal(camino, "siembra");
  assert.equal(nuevoValor, 9);
});

test("CA-2 D: ventas individuales, escrito 5, 5/5/5/4/5 y Contabilium 10 -> 9 da 3", () => {
  const { nuevoValor } = calcularUnico({
    baseline: 10,
    contabiliumActual: 9,
    escrito: 5,
    availables: [5, 5, 5, 4, 5],
  });
  assert.equal(nuevoValor, 3);
});

test("CA-2 D2: dos ventas online, escrito 5, 4/4/5/5/5 y Contabilium 10 -> 9 da 2", () => {
  const { nuevoValor } = calcularUnico({
    baseline: 10,
    contabiliumActual: 9,
    escrito: 5,
    availables: [4, 4, 5, 5, 5],
  });
  assert.equal(nuevoValor, 2);
});

test("CA-2 H: credito acreditable 2, camino normal (igual a A'), nuevoValor 10 (no 18 ni 8)", () => {
  const { nuevoValor, camino } = calcularUnico({
    baseline: 10,
    contabiliumActual: 13,
    escrito: 5,
    credito: 2,
    availables: [5, 5, 5, 5, 5],
  });
  assert.equal(camino, "normal");
  assert.equal(nuevoValor, 10);
});

// -----------------------------------------------------------------------------
// CA-3 — SKU de 2 variantes (escenarios-ca3-dos-variantes.md).
// -----------------------------------------------------------------------------

test("CA-3 B: bootstrap divergente 5/0 toma el maximo 5, baseline 10 -> 9 da 4", () => {
  const { nuevoValor, camino, shopifyActual } = calcularUnico({
    baseline: 10,
    contabiliumActual: 9,
    escrito: null,
    availables: [5, 0],
  });
  assert.equal(camino, "bootstrap");
  assert.equal(shopifyActual, 5);
  assert.equal(nuevoValor, 4);
});

test("CA-3 C: ventas individuales, escrito 6, 5/6 y Contabilium 10 -> 9 da 4 (nunca 5)", () => {
  const { nuevoValor } = calcularUnico({
    baseline: 10,
    contabiliumActual: 9,
    escrito: 6,
    availables: [5, 6],
  });
  assert.equal(nuevoValor, 4);
});

test("CA-3 D: piso 0 sobre el total, escrito 1, 0/0 y Contabilium sin cambios da 0", () => {
  const { nuevoValor, shopifyActual } = calcularUnico({
    baseline: 10,
    contabiliumActual: 10,
    escrito: 1,
    availables: [0, 0],
  });
  assert.equal(shopifyActual, 0);
  assert.equal(nuevoValor, 0);
});

test("CA-3 E: suba ignorada, escrito 5, 8/5 y Contabilium sin cambios da 5 (nunca usa 8)", () => {
  const { nuevoValor, shopifyActual } = calcularUnico({
    baseline: 10,
    contabiliumActual: 10,
    escrito: 5,
    availables: [8, 5],
  });
  assert.equal(shopifyActual, 5);
  assert.equal(nuevoValor, 5);
});

// -----------------------------------------------------------------------------
// R-18: contrato de null. Esta funcion nunca recibe variantes mezcladas (o
// todas en null); si llega, rechaza en vez de tratar el null como 0.
// -----------------------------------------------------------------------------

test("R-18: rechaza si alguna variante llega en null (no la trata como 0)", () => {
  assert.throws(() =>
    calcularUnico({
      baseline: 10,
      contabiliumActual: 9,
      escrito: 5,
      availables: [5, null],
    })
  );
});

// Nota (revision importante 3): `calcularUnico` usa la MISMA formula que los
// SKUs no universales (R-3), sin ningun piso extra sobre el `nuevoValor`
// final (el unico piso 0 es el interno de R-4, dentro del camino (c), sobre
// `shopifyActual`). Ningun escenario obligatorio de
// aceptacion/sku-universal-multivarianta/ produce un resultado negativo, asi
// que este test usa numeros que respetan esa invariante en vez de forzar un
// piso que el contrato no pide.
test("resultado es entero y no NaN con el piso interno de R-4 (camino normal)", () => {
  const { nuevoValor } = calcularUnico({
    baseline: 10,
    contabiliumActual: 5,
    escrito: 5,
    availables: [5, 5, 5],
  });
  assert.ok(Number.isInteger(nuevoValor));
  assert.ok(nuevoValor >= 0);
  assert.equal(nuevoValor, 0);
});
