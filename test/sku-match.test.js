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
