// CA-10 — Migración del fixture `SKU_APPLYFIT` de los tests de
// `verificar-cache-sku` (R-15, y la parte de R-9 "migran de fixture según
// R-15, sin cambiar sus aserciones"). Evidencia:
// aceptacion/sku-universal-multivarianta/escenarios-ca10-migracion-fixture.md
//
// Sin red ni git: lee las copias congeladas en
// aceptacion/sku-universal-multivarianta/fixtures-originales/ y compara
// contra los archivos actuales de test/.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SKU_APPLYFIT } from "./_helpers-cache-sku.js";
import { SKUS_UNIVERSALES } from "../src/shopify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..");
const FIXTURES_ORIGINALES = join(
  RAIZ,
  "aceptacion",
  "sku-universal-multivarianta",
  "fixtures-originales"
);
const INFORME_SKUS = join(
  RAIZ,
  "docs",
  "analisis",
  "2026-11-02-skus-repetidos-y-cruzados.md"
);

const SKU_VIEJO = "APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E";
const SKU_NUEVO = SKU_APPLYFIT;

const PARES = [
  ["_helpers-cache-sku.js", "test/_helpers-cache-sku.js"],
  ["cache-sku-duplicados.test.js", "test/cache-sku-duplicados.test.js"],
  ["cache-sku-verificada.test.js", "test/cache-sku-verificada.test.js"],
  [
    "cache-sku-caminos-de-escritura.test.js",
    "test/cache-sku-caminos-de-escritura.test.js",
  ],
  ["cache-sku-resumen.test.js", "test/cache-sku-resumen.test.js"],
];

function leer(ruta) {
  return readFileSync(ruta, "utf8");
}

function esComentario(linea) {
  return /^[ \t]*\/\//.test(linea);
}

function lineasNoComentario(texto) {
  return texto.split("\n").filter((l) => !esComentario(l));
}

function contar(texto, patron) {
  const m = texto.match(patron);
  return m ? m.length : 0;
}

for (const [nombreCongelado, rutaActual] of PARES) {
  const rutaCongelada = join(FIXTURES_ORIGINALES, nombreCongelado);

  test(`CA-10 §1: ${rutaActual} preserva forma y aserciones del fixture migrado`, () => {
    const congelado = leer(rutaCongelada);
    const actual = leer(join(RAIZ, rutaActual));

    const esperado = congelado.split(SKU_VIEJO).join(SKU_NUEVO);

    const esperadoLineas = lineasNoComentario(esperado);
    const actualLineas = lineasNoComentario(actual);

    assert.deepEqual(
      actualLineas,
      esperadoLineas,
      `las líneas de código (sin comentarios) de ${rutaActual} difieren del fixture migrado`
    );
  });

  test(`CA-10 §2: ${rutaActual} conserva la cantidad de bloques y aserciones`, () => {
    const congelado = leer(rutaCongelada);
    const actual = leer(join(RAIZ, rutaActual));

    for (const [nombre, patron] of [
      ["test(", /\btest\(/g],
      ["describe(", /\bdescribe\(/g],
      ["assert(...)", /\bassert(\.\w+)?\(/g],
    ]) {
      assert.equal(
        contar(actual, patron),
        contar(congelado, patron),
        `conteo de "${nombre}" distinto entre ${rutaActual} y su copia congelada`
      );
    }
  });

  test(`CA-10 §1(d): ${rutaActual} no conserva el SKU viejo fuera de comentarios`, () => {
    const actual = leer(join(RAIZ, rutaActual));
    const lineasCodigo = lineasNoComentario(actual);
    for (const linea of lineasCodigo) {
      assert.ok(
        !linea.includes(SKU_VIEJO),
        `línea de código de ${rutaActual} todavía contiene el SKU viejo: "${linea}"`
      );
    }
  });
}

test("CA-10 §3(a): SKU_NUEVO no está en la lista curada", () => {
  for (const sku of SKUS_UNIVERSALES.keys()) {
    assert.notEqual(sku, SKU_NUEVO);
  }
});

test("CA-10 §3(b): SKU_NUEVO no es prefijo ni extensión de ningún curado", () => {
  for (const sku of SKUS_UNIVERSALES.keys()) {
    assert.ok(
      !sku.startsWith(SKU_NUEVO) && !SKU_NUEVO.startsWith(sku),
      `${SKU_NUEVO} y ${sku} son prefijo/extensión uno del otro`
    );
  }
});

test("CA-10 §3(c): SKU_NUEVO aparece citado en el informe de SKUs", () => {
  const informe = leer(INFORME_SKUS);
  assert.ok(
    informe.includes(`\`${SKU_NUEVO}\``),
    `el informe no contiene \`${SKU_NUEVO}\``
  );
});
