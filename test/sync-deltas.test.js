// R-1 / CA-1 — Deltas contra una linea base durable, nunca el absoluto.
//
// INTERFAZ ASUMIDA (no existe hoy en src/sync.js; ver
// aceptacion/deltas-dot-mas-isla-galerias/DISENO-INTERFAZ.md seccion 2):
//
//   calcularEscritura({ baseline, contabiliumActual, shopifyActual })
//     -> { nuevoValor, delta, sembrado }
//
// baseline es lo que Contabilium decia en la corrida ANTERIOR para este SKU
// (viene de libreta.contabilium). null significa "primera vez que se ve este
// SKU en este par" -- NO es lo mismo que 0.
//
// Hoy sync.js escribe el absoluto de Contabilium directo (procesarSku linea
// ~172: `setearStock(inventoryItemId, stockObjetivo, available)`), que es
// exactamente la regla prohibida por AGENTS.md invariante 1 y el ADR 0001.
// Este archivo falla hoy porque `calcularEscritura` no existe todavia.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularEscritura } from "../src/sync.js";

test("sin cambios en Contabilium y Shopify ya descontado por una venta web: NO re-infla", () => {
  // Caso central del ADR 0001: baseline=10 (lo que Contabilium decia antes),
  // Contabilium sigue en 10 (nadie vendio por mostrador), pero Shopify ya bajo
  // a 8 porque la web vendio 2 unidades con retiro en tienda. El absoluto
  // pisaria 8 -> 10 (re-infla lo vendido). El delta tiene que dejarlo en 8.
  const r = calcularEscritura({ baseline: 10, contabiliumActual: 10, shopifyActual: 8 });
  assert.equal(r.nuevoValor, 8, "no debe re-inflar el stock ya descontado por la venta web");
  assert.equal(r.delta, 0);
  assert.equal(r.sembrado, false);
});

test("una venta real por mostrador SI se traslada, encima del descuento web", () => {
  // Mismo escenario, pero ademas el mostrador vendio 1 unidad: Contabilium
  // pasa de 10 a 9. Shopify (ya en 8 por la venta web) tiene que bajar a 7,
  // nunca pisarse con el 9 absoluto de Contabilium.
  const r = calcularEscritura({ baseline: 10, contabiliumActual: 9, shopifyActual: 8 });
  assert.equal(r.nuevoValor, 7);
  assert.equal(r.delta, -1);
});

test("reposicion en Contabilium SI sube el stock en Shopify, via delta", () => {
  // Contabilium sube de 10 a 15 (llego mercaderia). Shopify estaba en 8 (por
  // la venta web). El delta (+5) se suma sobre el valor REAL de Shopify, no
  // sobre el de Contabilium: resultado 13, no 15.
  const r = calcularEscritura({ baseline: 10, contabiliumActual: 15, shopifyActual: 8 });
  assert.equal(r.nuevoValor, 13);
  assert.equal(r.delta, 5);
});

test("sin baseline (primer SKU visto en este par) se siembra el valor de Contabilium", () => {
  // La unica situacion donde un valor "parecido al absoluto" es correcto: no
  // hay delta posible porque no hay corrida anterior que lo sostenga.
  const r = calcularEscritura({ baseline: null, contabiliumActual: 20, shopifyActual: 999 });
  assert.equal(r.sembrado, true);
  assert.equal(r.nuevoValor, 20);
});

test("baseline=0 (valor real) es DISTINTO de baseline ausente: no se siembra", () => {
  // Un SKU que la corrida anterior vio en 0 tiene baseline=0, no null. Si
  // Contabilium sigue en 0 y Shopify esta en 3 (por una venta web desde un
  // stock viejo), el delta (0) tiene que dejar Shopify en 3, no resembrar 0.
  const r = calcularEscritura({ baseline: 0, contabiliumActual: 0, shopifyActual: 3 });
  assert.equal(r.sembrado, false);
  assert.equal(r.nuevoValor, 3);
});

test("el delta puede ser negativo y dejar el nuevo valor en cero, pero no bajo cero", () => {
  const r = calcularEscritura({ baseline: 5, contabiliumActual: 0, shopifyActual: 2 });
  assert.equal(r.delta, -5);
  assert.equal(r.nuevoValor, -3, "este test documenta el numero crudo; el guard de piso vive en procesarSku, no aca");
});
