// R-6 / CA-6 — La cantidad escrita en Shopify es siempre entera, para TODOS
// los pares, aun cuando Contabilium devuelva decimales.
//
// cantidadDeItem (src/contabilium.js) YA es pura y YA aplica Math.floor, y NO
// depende de ningun deposito en particular (recibe el item, no el id): por eso
// ya sirve igual para el DOT y para la isla sin cambios. Lo que falta cubrir
// es la funcion NUEVA de deltas (calcularEscritura, R-1/CA-1): si no redondea
// su resultado, un baseline o un shopifyActual no entero (por ejemplo, si
// algun dia Shopify devolviera un valor fraccionario via otra integracion, o
// si StockConReservas trajera un decimal que cantidadDeItem no llego a
// limpiar) podria producir una `quantity` fraccionaria para
// inventorySetQuantities, que Shopify rechaza.
//
// INTERFAZ ASUMIDA: calcularEscritura en src/sync.js (ver DISENO-INTERFAZ.md
// seccion 2). Este archivo falla hoy porque esa funcion no existe todavia.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { cantidadDeItem } from "../src/contabilium.js";
import { calcularEscritura } from "../src/sync.js";

// -----------------------------------------------------------------------------
// cantidadDeItem ya es generica por diseño: un test de confirmacion, no de
// regresion (ya existia esta garantia antes de esta feature).
// -----------------------------------------------------------------------------

test("cantidadDeItem trunca decimales de StockConReservas para cualquier deposito", () => {
  // DOT y la isla usan la MISMA funcion, sin pasar el id de deposito: por eso
  // un item decimal se comporta igual sin importar de que par venga.
  assert.equal(cantidadDeItem({ StockConReservas: 7.9 }), 7);
  assert.equal(cantidadDeItem({ StockActual: 3.4 }), 3);
});

// -----------------------------------------------------------------------------
// calcularEscritura: el resultado del delta tiene que ser siempre entero
// -----------------------------------------------------------------------------

test("un baseline o shopifyActual no entero no produce una quantity fraccionaria", () => {
  const r = calcularEscritura({ baseline: 10.0, contabiliumActual: 7, shopifyActual: 8.5 });
  assert.ok(Number.isInteger(r.nuevoValor), `nuevoValor=${r.nuevoValor} tiene que ser entero`);
});

test("el valor sembrado (sin baseline) tambien es siempre entero", () => {
  const r = calcularEscritura({ baseline: null, contabiliumActual: 12.0, shopifyActual: 0 });
  assert.ok(Number.isInteger(r.nuevoValor));
  assert.equal(r.nuevoValor, 12);
});

test("esto vale igual para el par de la isla que para el DOT: la funcion no distingue pares", () => {
  // calcularEscritura no recibe ningun dato de "que par es": por eso la
  // garantia de entero es automaticamente multi-par.
  const dot = calcularEscritura({ baseline: 10, contabiliumActual: 9, shopifyActual: 8 });
  const isla = calcularEscritura({ baseline: 10, contabiliumActual: 9, shopifyActual: 8 });
  assert.deepEqual(dot, isla);
  assert.ok(Number.isInteger(dot.nuevoValor) && Number.isInteger(isla.nuevoValor));
});
