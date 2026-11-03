// sku-universal-resolucion.test.js
// -----------------------------------------------------------------------------
// T03: `resolverSkuUniversal` de src/shopify.js, a nivel resolucion.
// Cubre los subcasos de CA-2 F1-F4 (conteo contra la cantidad esperada) y de
// CA-14 D1-D3 (caché en sus tres estados), mas el control de R-6 (un no
// curado sigue exactamente igual que hoy). El calculo de `nuevoValor` es T04;
// la escritura es T06. Fuera de alcance aca.
// -----------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as shopify from "../src/shopify.js";
import {
  SKU_5V,
  VARIANTES_5V,
  VARIANTE_5V_EXTRA,
  ITEM_CACHE_VENCIDA,
  LOCATION_DOT,
  nodoExacto,
  prefijoLargo,
  consultaInyectada,
} from "./_helpers-sku-universal.js";
import { SKU_PREFIJO, SKU_PREFIJO_LARGO } from "./_helpers-cache-sku.js";

const [V1, V2, V3, V4, V5] = VARIANTES_5V;

// ----------------------------------------------------- A (bootstrap, R-2)
test("resolverSkuUniversal: devuelve las 5 variantes exactas, con la misma QUERY_POR_SKU y nunca SkuAmbiguoError", async () => {
  const nodos = [
    nodoExacto(V1, SKU_5V, 5),
    nodoExacto(V2, SKU_5V, 5),
    nodoExacto(V3, SKU_5V, 5),
    nodoExacto(V4, SKU_5V, 5),
    nodoExacto(V5, SKU_5V, 5),
    prefijoLargo(SKU_5V, 1), // P1: prefijo-largo, NO es candidata (invariante 3)
  ];
  const consultar = consultaInyectada(nodos, { hasNextPage: false });

  const resultado = await shopify.resolverSkuUniversal(SKU_5V, LOCATION_DOT, { consultar });

  assert.equal(consultar.llamadas.length, 1);
  assert.deepEqual(consultar.llamadas[0].variables, {
    query: `sku:"${SKU_5V}"`,
    locationId: LOCATION_DOT,
    first: 10,
  });

  assert.equal(resultado.length, 5);
  const porItem = Object.fromEntries(resultado.map((r) => [r.inventoryItemId, r]));
  for (const v of VARIANTES_5V) {
    assert.ok(porItem[v.inventoryItemId], `falta ${v.inventoryItemId}`);
    assert.equal(porItem[v.inventoryItemId].variantId, v.variantId);
    assert.equal(porItem[v.inventoryItemId].available, 5);
  }
  // P1 (prefijo-largo) nunca es candidata.
  assert.ok(!resultado.some((r) => r.inventoryItemId.endsWith("9019901")));
});

test("resolverSkuUniversal: conserva un available null tal cual (R-18, no se lo pisa)", async () => {
  const nodos = [
    nodoExacto(V1, SKU_5V, null),
    nodoExacto(V2, SKU_5V, 5),
    nodoExacto(V3, SKU_5V, 5),
    nodoExacto(V4, SKU_5V, 5),
    nodoExacto(V5, SKU_5V, 5),
  ];
  const consultar = consultaInyectada(nodos);
  const resultado = await shopify.resolverSkuUniversal(SKU_5V, LOCATION_DOT, { consultar });
  const v1 = resultado.find((r) => r.inventoryItemId === V1.inventoryItemId);
  assert.equal(v1.available, null);
});

// ----------------------------------------------- F1-F4 (R-7, conteo esperado)
test("F1 — tope alcanzado con menos de las esperadas: error (I-1)", async () => {
  const nodos = [
    nodoExacto(V1, SKU_5V, 5),
    nodoExacto(V2, SKU_5V, 5),
    nodoExacto(V3, SKU_5V, 5),
    ...Array.from({ length: 7 }, (_, i) => prefijoLargo(SKU_5V, i + 1)),
  ];
  const consultar = consultaInyectada(nodos, { hasNextPage: true });

  await assert.rejects(
    () => shopify.resolverSkuUniversal(SKU_5V, LOCATION_DOT, { consultar }),
    (err) => {
      assert.notEqual(err.name, "SkuAmbiguoError");
      assert.equal(err.esperadas, 5);
      assert.equal(err.encontradas, 3);
      assert.equal(err.topeAlcanzado, true);
      return true;
    }
  );
});

test("F2 — tope alcanzado con las 5 esperadas: NO es error (R-2)", async () => {
  const nodos = [
    nodoExacto(V1, SKU_5V, 5),
    nodoExacto(V2, SKU_5V, 5),
    nodoExacto(V3, SKU_5V, 5),
    nodoExacto(V4, SKU_5V, 5),
    nodoExacto(V5, SKU_5V, 5),
    ...Array.from({ length: 5 }, (_, i) => prefijoLargo(SKU_5V, i + 1)),
  ];
  const consultar = consultaInyectada(nodos, { hasNextPage: true });

  const resultado = await shopify.resolverSkuUniversal(SKU_5V, LOCATION_DOT, { consultar });
  assert.equal(resultado.length, 5);
});

test("F3 — sin tope, 4 exactas: error (falta una)", async () => {
  const nodos = [nodoExacto(V1, SKU_5V, 5), nodoExacto(V2, SKU_5V, 5), nodoExacto(V3, SKU_5V, 5), nodoExacto(V4, SKU_5V, 5)];
  const consultar = consultaInyectada(nodos, { hasNextPage: false });

  await assert.rejects(
    () => shopify.resolverSkuUniversal(SKU_5V, LOCATION_DOT, { consultar }),
    (err) => {
      assert.notEqual(err.name, "SkuAmbiguoError");
      assert.equal(err.esperadas, 5);
      assert.equal(err.encontradas, 4);
      assert.equal(err.topeAlcanzado, false);
      return true;
    }
  );
});

test("F4 — sin tope, 6 exactas: error (sobra una)", async () => {
  const nodos = [
    nodoExacto(V1, SKU_5V, 5),
    nodoExacto(V2, SKU_5V, 5),
    nodoExacto(V3, SKU_5V, 5),
    nodoExacto(V4, SKU_5V, 5),
    nodoExacto(V5, SKU_5V, 5),
    nodoExacto(VARIANTE_5V_EXTRA, SKU_5V, 5),
  ];
  const consultar = consultaInyectada(nodos, { hasNextPage: false });

  await assert.rejects(
    () => shopify.resolverSkuUniversal(SKU_5V, LOCATION_DOT, { consultar }),
    (err) => {
      assert.notEqual(err.name, "SkuAmbiguoError");
      assert.equal(err.esperadas, 5);
      assert.equal(err.encontradas, 6);
      assert.equal(err.topeAlcanzado, false);
      return true;
    }
  );
});

// ------------------------------------------ CA-14 D1-D3 (caché en sus 3 estados)
// La caché no interviene en la resolución universal: nunca se lee ni se usa
// para elegir la candidata, sea cual sea su estado.
function conCacheFalsa(mapa) {
  const dir = mkdtempSync(join(tmpdir(), "sku-universal-cache-"));
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, "sku-map.json");
  writeFileSync(ruta, JSON.stringify(mapa), "utf-8");
  return ruta;
}

for (const [nombre, mapa] of [
  ["D1 — sin entrada", {}],
  ["D2 — entrada vencida", { [SKU_5V]: ITEM_CACHE_VENCIDA }],
  ["D3 — entrada presente en una sola (V4)", { [SKU_5V]: V4.inventoryItemId }],
]) {
  test(`${nombre}: resolverSkuUniversal nunca lanza SkuAmbiguoError y devuelve las 5 variantes`, async () => {
    const rutaCache = conCacheFalsa(mapa);
    const nodos = [
      nodoExacto(V1, SKU_5V, 5),
      nodoExacto(V2, SKU_5V, 5),
      nodoExacto(V3, SKU_5V, 5),
      nodoExacto(V4, SKU_5V, 5),
      nodoExacto(V5, SKU_5V, 5),
    ];
    const consultar = consultaInyectada(nodos, { hasNextPage: false });

    const resultado = await shopify.resolverSkuUniversal(SKU_5V, LOCATION_DOT, { consultar, rutaCache });

    assert.equal(resultado.length, 5);
    assert.ok(!resultado.some((r) => r.inventoryItemId === ITEM_CACHE_VENCIDA));
  });
}

// --------------------------------------------------- R-6: un no curado no cambia
test("resolverSkuUniversal: rechaza un SKU que no está en la lista curada (no es su camino)", async () => {
  await assert.rejects(() => shopify.resolverSkuUniversal(SKU_PREFIJO, LOCATION_DOT, { consultar: async () => ({}) }));
});

test("resolverSku (no curado) sigue sin cambios: coincidencia tokenizada ambigua sigue lanzando SkuAmbiguoError", async () => {
  const nodos = [
    { id: "gid://shopify/ProductVariant/1", sku: SKU_PREFIJO, inventoryItem: { id: "gid://shopify/InventoryItem/1", inventoryLevel: { quantities: [{ name: "available", quantity: 1 }] } } },
    { id: "gid://shopify/ProductVariant/2", sku: SKU_PREFIJO, inventoryItem: { id: "gid://shopify/InventoryItem/2", inventoryLevel: { quantities: [{ name: "available", quantity: 1 }] } } },
  ];
  const consultar = async () => ({
    productVariants: { edges: nodos.map((node) => ({ node })), pageInfo: { hasNextPage: false } },
  });

  await assert.rejects(
    () => shopify.resolverSku(SKU_PREFIJO, LOCATION_DOT, { consultar, rutaCache: conCacheFalsa({}) }),
    (err) => {
      assert.equal(err.name, "SkuAmbiguoError");
      return true;
    }
  );
  // Control: SKU_PREFIJO_LARGO no es alcanzado por esta aserción; solo se usa
  // para documentar que el prefijo estricto (invariante 3) sigue vigente.
  assert.ok(SKU_PREFIJO_LARGO.startsWith(SKU_PREFIJO));
});
