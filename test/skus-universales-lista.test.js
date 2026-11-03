import { test } from "node:test";
import assert from "node:assert/strict";
import { SKUS_UNIVERSALES } from "../src/shopify.js";

function normalizar(constante) {
  if (constante instanceof Map) {
    return [...constante].map(([sku, variantes]) => ({ sku, variantes }));
  }
  return [...constante].map(({ sku, variantes }) => ({ sku, variantes }));
}

const ESPERADO = [
  { sku: "APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E", variantes: 5 },
  { sku: "APPLYFIT-CLEAR-IP13PM-14PLUS", variantes: 2 },
  { sku: "APPLYFIT-CLEAR-IP15-16", variantes: 2 },
  { sku: "APPLYFIT-CLEAR-IP16PM-17PM", variantes: 2 },
  { sku: "APPLYFIT-CLEAR-IP16PRO-17-17PRO", variantes: 3 },
  { sku: "APPLYFIT-CLEAR-S24-S25", variantes: 2 },
  { sku: "APPLYFIT-CLEAR-S24PLUS-S25PLUS", variantes: 2 },
];

test("CA-1 §1: contenido exacto de los 7 pares, ordenado por sku UTF-16", () => {
  const pares = normalizar(SKUS_UNIVERSALES).sort((a, b) =>
    a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0
  );
  assert.deepStrictEqual(pares, ESPERADO);
});

test("CA-1 §1: la suma de variantes es 18", () => {
  const pares = normalizar(SKUS_UNIVERSALES);
  const suma = pares.reduce((acc, p) => acc + p.variantes, 0);
  assert.strictEqual(suma, 18);
});

test("CA-1 §2: control de no-heurística, ningún SKU de control aparece en la lista", () => {
  const pares = normalizar(SKUS_UNIVERSALES);
  const controles = [
    "APPLYFIT-CLEAR-IP18FOLD",
    "APPLYFIT-CLEAR-IP17-17PRO",
    "APPLYFIT-CLEAR-S24",
    "IEY-COMBO-CARBON-VERDE-IP16E",
  ];
  for (const x of controles) {
    assert.ok(
      !pares.some((p) => p.sku === x),
      `${x} no debería estar en la lista de universales`
    );
  }
});
