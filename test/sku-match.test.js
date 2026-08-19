// Regresión de H4: la coincidencia de SKU tiene que ser EXACTA.
//
// El campo `sku` de Shopify es tokenizado con coincidencia parcial, y 671 de los
// 2562 SKUs del deposito DOT (26,2%) son prefijo estricto de otro. La corrida
// 32274094052 encontro ademas 41 SKUs con mas de una variante declarando el
// mismo sku exacto.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { elegirVarianteExacta, escaparValorBusqueda, SkuAmbiguoError } from "../src/shopify.js";

const nodo = (sku) => ({ sku, id: `gid://shopify/ProductVariant/${sku}`, inventoryItem: { id: `ii-${sku}` } });
const edges = (...skus) => skus.map((s) => ({ node: nodo(s) }));

test("elige la variante exacta aunque Shopify devuelva prefijos mas largos", () => {
  const e = edges(
    "FUNDA-MAGSAFE-MATE-IPHONE16PRO",
    "FUNDA-MAGSAFE-MATE-IPHONE16",
    "FUNDA-MAGSAFE-MATE-IPHONE16PROMAX",
    "FUNDA-MAGSAFE-MATE-IPHONE16PLUS"
  );
  assert.equal(elegirVarianteExacta(e, "FUNDA-MAGSAFE-MATE-IPHONE16").sku, "FUNDA-MAGSAFE-MATE-IPHONE16");
});

test("el caso real de H4: IEY-103-NEGRO no puede resolver a IEY-103-NEGRO-INCLUIDO", () => {
  // Con first:1 y sin comillas, Shopify podia devolver primero el -INCLUIDO.
  const e = edges("IEY-103-NEGRO-INCLUIDO", "IEY-103-NEGRO");
  assert.equal(elegirVarianteExacta(e, "IEY-103-NEGRO").sku, "IEY-103-NEGRO");
});

test("si el exacto no esta, devuelve null en vez de escribir en el parcial", () => {
  const e = edges("IEY-103-NEGRO-INCLUIDO", "IEY-103-NEGRO-OTRO");
  assert.equal(elegirVarianteExacta(e, "IEY-103-NEGRO"), null);
});

test("sin resultados devuelve null", () => {
  assert.equal(elegirVarianteExacta([], "LO-QUE-SEA"), null);
});

test("dos variantes con el mismo sku exacto: lanza y NO elige una al azar", () => {
  // Caso real: 41 SKUs, 38 de ellos del iPhone 16e.
  const e = edges("IEY-COMBO-IEY108N-TRANSP-IP16E", "IEY-COMBO-IEY108N-TRANSP-IP16E");
  assert.throws(() => elegirVarianteExacta(e, "IEY-COMBO-IEY108N-TRANSP-IP16E"), SkuAmbiguoError);
});

test("la comparacion distingue mayusculas y no normaliza", () => {
  const e = edges("iey-103-negro");
  assert.equal(elegirVarianteExacta(e, "IEY-103-NEGRO"), null);
});

test("escapa comillas y backslashes para la search syntax", () => {
  assert.equal(escaparValorBusqueda('AB"C'), 'AB\\"C');
  assert.equal(escaparValorBusqueda("AB\\C"), "AB\\\\C");
  assert.equal(escaparValorBusqueda("RT60D-SOPORTE-AUTO+ADAPTADOR-30W"), "RT60D-SOPORTE-AUTO+ADAPTADOR-30W");
});

test("tolera edges con node nulo sin romper", () => {
  const e = [{ node: null }, ...edges("IEY-105-NEGRO")];
  assert.equal(elegirVarianteExacta(e, "IEY-105-NEGRO").sku, "IEY-105-NEGRO");
});

// -----------------------------------------------------------------------------
// Contrato del input de inventorySetQuantities (API 2026-04)
// -----------------------------------------------------------------------------
// Desde 2026-04 Shopify ELIMINO `compareQuantity` e `ignoreCompareQuantity`; el
// reemplazo es `changeFromQuantity`. El Dev Dashboard daba fecha limite
// 2027-01-01. Este test congela el shape para que un revert silencioso no pase.
import { construirInputSet } from "../src/shopify.js";

test("el input usa changeFromQuantity y NO compareQuantity", () => {
  const input = construirInputSet({
    inventoryItemId: "gid://shopify/InventoryItem/1",
    locationId: "gid://shopify/Location/83342655574",
    quantity: 7,
    changeFromQuantity: 5,
  });
  const q = input.quantities[0];
  assert.equal(q.changeFromQuantity, 5);
  assert.ok(!("compareQuantity" in q), "compareQuantity fue eliminado en la API 2026-04");
  assert.ok(!("ignoreCompareQuantity" in input), "ignoreCompareQuantity fue eliminado en la API 2026-04");
  assert.deepEqual(Object.keys(q).sort(), ["changeFromQuantity", "inventoryItemId", "locationId", "quantity"]);
});

test("changeFromQuantity null es valido: saltea la comprobacion", () => {
  const input = construirInputSet({
    inventoryItemId: "gid://shopify/InventoryItem/1",
    locationId: "gid://shopify/Location/1",
    quantity: 0,
    changeFromQuantity: null,
  });
  assert.equal(input.quantities[0].changeFromQuantity, null);
});

test("solo se escribe la location DOT y el name es available", () => {
  const input = construirInputSet({
    inventoryItemId: "gid://shopify/InventoryItem/1",
    locationId: "gid://shopify/Location/83342655574",
    quantity: 3,
    changeFromQuantity: 3,
  });
  assert.equal(input.name, "available");
  assert.equal(input.quantities.length, 1);
  assert.equal(input.quantities[0].locationId, "gid://shopify/Location/83342655574");
});

// -----------------------------------------------------------------------------
// La directiva @idempotent es obligatoria desde la API 2026-04
// -----------------------------------------------------------------------------
// Sin ella Shopify responde BAD_REQUEST. Se detecto en produccion en la corrida
// 32280618922: "The @idempotent directive is required for this mutation but was
// not provided.". H12 del diagnostico eran DOS cambios, no uno: el renombre de
// compareQuantity y esta directiva.
import { MUTATION_SET } from "../src/shopify.js";

test("la mutation declara @idempotent en el campo, con key como variable", () => {
  assert.match(MUTATION_SET, /\$idempotencyKey:\s*String!/);
  assert.match(MUTATION_SET, /inventorySetQuantities\(input:\s*\$input\)\s*@idempotent\(key:\s*\$idempotencyKey\)/);
});

test("la directiva va en el campo y no en la operacion", () => {
  const lineaOperacion = MUTATION_SET.split("\n").find((l) => l.includes("mutation InventorySet"));
  assert.ok(!lineaOperacion.includes("@idempotent"), "@idempotent va en el campo, no en la operacion");
});
