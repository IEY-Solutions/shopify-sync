// _helpers-sku-universal.js
// -----------------------------------------------------------------------------
// Helper compartido de fixtures de la feature `sku-universal-multivarianta`.
// NO termina en `.test.js` a proposito: `node --test test/*.test.js` no lo
// corre como suite.
//
// Creado en T03 (resolucion). Las tareas siguientes (T04 en adelante) solo
// AGREGAN exportaciones aca: no cambian la semantica de las que ya existen
// (`tasks/README.md`).
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca2-cinco-variantes.md
// (V1...V5, P1...P7) y escenarios-ca3-dos-variantes.md (803000k).
// -----------------------------------------------------------------------------

import { LOCATION_DOT } from "./_helpers-clasificador.js";

export { LOCATION_DOT };

// SKU curado de 5 variantes (CA-2).
export const SKU_5V = "APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E";
// SKU curado de 2 variantes (CA-3).
export const SKU_2V = "APPLYFIT-CLEAR-S24-S25";

// V1...V5, ids `801000k`/`901000k` (escenarios-ca2-cinco-variantes.md).
export const VARIANTES_5V = [
  { variantId: "gid://shopify/ProductVariant/8010001", inventoryItemId: "gid://shopify/InventoryItem/9010001" },
  { variantId: "gid://shopify/ProductVariant/8010002", inventoryItemId: "gid://shopify/InventoryItem/9010002" },
  { variantId: "gid://shopify/ProductVariant/8010003", inventoryItemId: "gid://shopify/InventoryItem/9010003" },
  { variantId: "gid://shopify/ProductVariant/8010004", inventoryItemId: "gid://shopify/InventoryItem/9010004" },
  { variantId: "gid://shopify/ProductVariant/8010005", inventoryItemId: "gid://shopify/InventoryItem/9010005" },
];

// V6, inventada para F4 (escenarios-ca2-cinco-variantes.md, F4).
export const VARIANTE_5V_EXTRA = {
  variantId: "gid://shopify/ProductVariant/8010006",
  inventoryItemId: "gid://shopify/InventoryItem/9010006",
};

// 803000k, k=1,2 (escenarios-ca3-dos-variantes.md).
export const VARIANTES_2V = [
  { variantId: "gid://shopify/ProductVariant/8030001", inventoryItemId: "gid://shopify/InventoryItem/9030001" },
  { variantId: "gid://shopify/ProductVariant/8030002", inventoryItemId: "gid://shopify/InventoryItem/9030002" },
];

// Variante inexistente para la cache "vencida" (escenarios-ca14-sku-puntual.md, ids nuevos de esta ronda, D2).
export const ITEM_CACHE_VENCIDA = "gid://shopify/InventoryItem/9010099";

// SKU curado de 2 variantes usado por CA-13 (variante no activada), par
// Galerias Pacifico. Ids `813000k`/`913000k`, k=1,2 (escenarios-ca13-no-activada.md).
export const SKU_NO_ACTIVADA = "APPLYFIT-CLEAR-IP16PM-17PM";
export const VARIANTES_NO_ACTIVADA = [
  { variantId: "gid://shopify/ProductVariant/8130001", inventoryItemId: "gid://shopify/InventoryItem/9130001" },
  { variantId: "gid://shopify/ProductVariant/8130002", inventoryItemId: "gid://shopify/InventoryItem/9130002" },
];

// Nodo GraphQL crudo, con la misma forma que devuelve `QUERY_POR_SKU`.
// `available` undefined/null -> variante no activada en la location (R-18).
export function nodoUniversal({ variantId, inventoryItemId, sku, available, titulo }) {
  return {
    id: variantId,
    sku,
    product: { id: `${variantId}-producto`, title: titulo ?? "(sin titulo)" },
    inventoryItem: {
      id: inventoryItemId,
      inventoryLevel:
        available === undefined || available === null
          ? null
          : { quantities: [{ name: "available", quantity: available }] },
    },
  };
}

// Nodo exacto de una de las variantes fijas (V1...V5 o 803000k), con el SKU
// curado correspondiente y el `available` que pida el escenario.
export function nodoExacto(variante, sku, available) {
  return nodoUniversal({ variantId: variante.variantId, inventoryItemId: variante.inventoryItemId, sku, available });
}

// Candidato prefijo-largo P1...P7 (CA-2, grupo A1, informe:175-185). `available`
// es siempre 3, como fija el README de la carpeta.
export function prefijoLargo(sku, k, available = 3) {
  const kk = String(k).padStart(2, "0");
  return nodoUniversal({
    variantId: `gid://shopify/ProductVariant/80199${kk}`,
    inventoryItemId: `gid://shopify/InventoryItem/90199${kk}`,
    sku: `${sku}-P${k}`,
    available,
  });
}

// Consulta inyectada (`opciones.consultar`): responde siempre con los `nodos`
// dados, sin tocar la red. Registra cada llamada en `.llamadas` para que el
// test verifique `query`, `locationId` y `first` (C0).
export function consultaInyectada(nodos, { hasNextPage = false } = {}) {
  const llamadas = [];
  const consultar = async (query, variables) => {
    llamadas.push({ query, variables: { ...variables } });
    return {
      productVariants: {
        edges: nodos.map((node) => ({ node })),
        pageInfo: { hasNextPage },
      },
    };
  };
  consultar.llamadas = llamadas;
  return consultar;
}
