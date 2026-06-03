// shopify.js
// -----------------------------------------------------------------------------
// Habla con la Shopify Admin GraphQL API. Tres responsabilidades:
//   1. Buscar el inventory_item_id de un SKU (con cache en disco).
//   2. Leer el stock actual de ese item en la location DOT.
//   3. Setear el stock absoluto con inventorySetQuantities (compare-and-set).
//
// Las operaciones GraphQL fueron validadas contra el schema 2026-01.
// Scopes del token: read_products, read_inventory, write_inventory.
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, "..", ".cache", "sku-map.json");

// -----------------------------------------------------------------------------
// Cache SKU -> inventory_item_id (requisito 8)
// -----------------------------------------------------------------------------
// El inventory_item_id de un SKU no cambia, asi que lo guardamos en un JSON.
// Asi no consultamos Shopify para resolver el SKU en cada corrida.
let cache = null;

function cargarCache() {
  if (cache) return cache;
  if (existsSync(CACHE_PATH)) {
    try {
      cache = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    } catch {
      cache = {}; // archivo corrupto -> empezar limpio
    }
  } else {
    cache = {};
  }
  return cache;
}

function guardarCache() {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

// -----------------------------------------------------------------------------
// Auth — client credentials grant (modelo Dev Dashboard 2026)
// -----------------------------------------------------------------------------
// Shopify ya NO entrega un token estatico (shpat_) para copiar al .env. Ahora la
// app cambia su client_id + client_secret por un access_token que dura 24h.
// Es el MISMO patron OAuth2 client_credentials que usa Contabilium.
//
// Cacheamos el token en memoria y lo renovamos solo cuando esta por vencer, asi
// no pedimos uno nuevo en cada request (en el modo cron el proceso vive mucho).
let tokenCache = { token: null, expiraEn: 0 };

async function obtenerAccessToken() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!domain || !clientId || !clientSecret) {
    throw new Error(
      "Faltan variables de Shopify en .env: SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET"
    );
  }

  // Reusar el token cacheado si todavia le queda mas de 60s de vida.
  if (tokenCache.token && Date.now() < tokenCache.expiraEn - 60_000) {
    return tokenCache.token;
  }

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify auth fallo (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Shopify auth: respuesta sin access_token");
  }

  // expires_in viene en segundos (~86399 = 24h). Lo pasamos a timestamp absoluto.
  tokenCache = {
    token: data.access_token,
    expiraEn: Date.now() + Number(data.expires_in ?? 86400) * 1000,
  };
  return tokenCache.token;
}

// -----------------------------------------------------------------------------
// Manejo de rate limit (throttling) de Shopify
// -----------------------------------------------------------------------------
// Shopify limita las requests con un "balde" de puntos (bucket de 2000, se
// rellena a ~100/s). Cada consulta gasta puntos; si lo vaciamos, responde
// THROTTLED (errores GraphQL) o HTTP 429. En vez de abortar, esperamos lo que
// haga falta y reintentamos. Asi un sync de miles de SKUs no se corta.
const MAX_REINTENTOS = 6;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// shopifyGraphQL — helper que hace UN request a la Admin API (con reintentos)
// -----------------------------------------------------------------------------
async function shopifyGraphQL(query, variables) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION;

  if (!domain || !version) {
    throw new Error(
      "Faltan variables de Shopify en .env: SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION"
    );
  }

  const token = await obtenerAccessToken();
  const url = `https://${domain}/admin/api/${version}/graphql.json`;

  for (let intento = 1; ; intento++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });

    // Throttling a nivel transporte (HTTP 429): respetar Retry-After y reintentar.
    if (res.status === 429) {
      if (intento >= MAX_REINTENTOS) {
        throw new Error(`Shopify HTTP 429 persistente tras ${intento} intentos`);
      }
      const retryAfter = Number(res.headers.get("Retry-After")) || 2;
      console.warn(`  [throttle] HTTP 429, espero ${retryAfter}s y reintento (intento ${intento})`);
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Shopify HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = await res.json();

    // Throttling a nivel GraphQL: Shopify responde 200 con errors[].code = THROTTLED.
    const throttled =
      Array.isArray(json.errors) &&
      json.errors.some((e) => e?.extensions?.code === "THROTTLED");

    if (throttled) {
      if (intento >= MAX_REINTENTOS) {
        throw new Error(`Shopify THROTTLED persistente tras ${intento} intentos`);
      }
      // Calcular la espera segun el estado real del balde, si Shopify lo informa.
      const cost = json.extensions?.cost;
      const estado = cost?.throttleStatus;
      const costo = Number(cost?.requestedQueryCost) || 50;
      let esperaMs = 1000 * 2 ** (intento - 1); // backoff exponencial por defecto
      if (estado && Number(estado.restoreRate) > 0) {
        const faltan = Math.max(0, costo - Number(estado.currentlyAvailable));
        esperaMs = Math.max(esperaMs, Math.ceil((faltan / estado.restoreRate) * 1000) + 200);
      }
      console.warn(
        `  [throttle] Shopify pidio frenar, espero ${Math.round(esperaMs)}ms y reintento (intento ${intento})`
      );
      await sleep(esperaMs);
      continue;
    }

    // Otros errores GraphQL (sintaxis, permisos): error real -> abortar.
    if (json.errors) {
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
    }

    return json.data;
  }
}

// -----------------------------------------------------------------------------
// buscarVariantePorSku — query completa por SKU
// -----------------------------------------------------------------------------
// Devuelve { inventoryItemId, available } o null si el SKU no existe en Shopify.
// - inventoryItemId: el GID del inventory item (se cachea).
// - available: stock actual en la location DOT (sirve como compareQuantity).
//              Es null si el item NO esta activado en esa location.
const QUERY_POR_SKU = `
  query GetVariantBySku($query: String!, $locationId: ID!) {
    productVariants(first: 1, query: $query) {
      edges {
        node {
          id
          sku
          inventoryItem {
            id
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

export async function buscarVariantePorSku(sku) {
  const locationId = process.env.SHOPIFY_DOT_LOCATION_ID;
  const data = await shopifyGraphQL(QUERY_POR_SKU, {
    query: `sku:${sku}`,
    locationId,
  });

  const node = data?.productVariants?.edges?.[0]?.node;
  if (!node) return null; // SKU no encontrado en Shopify

  const inventoryItemId = node.inventoryItem?.id;
  if (!inventoryItemId) return null;

  // available: puede ser null si el item no esta activado en la location DOT
  const nivel = node.inventoryItem?.inventoryLevel;
  const available = nivel?.quantities?.find((q) => q.name === "available")?.quantity ?? null;

  return { inventoryItemId, available };
}

// -----------------------------------------------------------------------------
// leerStockActual — stock actual de un inventoryItem en la location DOT
// -----------------------------------------------------------------------------
// Version liviana para cuando ya tenemos el inventoryItemId cacheado.
// Devuelve el numero "available" o null si no esta activado en la location.
const QUERY_NIVEL = `
  query GetLevel($id: ID!, $locationId: ID!) {
    inventoryItem(id: $id) {
      inventoryLevel(locationId: $locationId) {
        quantities(names: ["available"]) {
          name
          quantity
        }
      }
    }
  }
`;

export async function leerStockActual(inventoryItemId) {
  const locationId = process.env.SHOPIFY_DOT_LOCATION_ID;
  const data = await shopifyGraphQL(QUERY_NIVEL, { id: inventoryItemId, locationId });
  const nivel = data?.inventoryItem?.inventoryLevel;
  return nivel?.quantities?.find((q) => q.name === "available")?.quantity ?? null;
}

// -----------------------------------------------------------------------------
// resolverInventoryItemId — usa cache, consulta Shopify solo si hace falta
// -----------------------------------------------------------------------------
// Devuelve { inventoryItemId, available } o null si el SKU no existe en Shopify.
export async function resolverSku(sku) {
  const c = cargarCache();
  const cacheado = c[sku];

  if (cacheado) {
    // Ya conocemos el id: solo leemos el stock actual (mas barato).
    const available = await leerStockActual(cacheado);
    return { inventoryItemId: cacheado, available, desdeCache: true };
  }

  // Primera vez: query completa por SKU y guardamos el id en cache.
  const resultado = await buscarVariantePorSku(sku);
  if (!resultado) return null;

  c[sku] = resultado.inventoryItemId;
  guardarCache();
  return { ...resultado, desdeCache: false };
}

// -----------------------------------------------------------------------------
// setearStock — inventorySetQuantities (cantidad absoluta, compare-and-set)
// -----------------------------------------------------------------------------
// compareQuantity protege contra cambios concurrentes: Shopify solo aplica el
// cambio si el stock persistido sigue siendo el que leimos. Si alguien lo movio
// en el medio, devuelve userError y NO pisa el valor.
const MUTATION_SET = `
  mutation InventorySet($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        reason
        changes { name delta quantityAfterChange }
      }
      userErrors { code field message }
    }
  }
`;

export async function setearStock(inventoryItemId, quantity, compareQuantity) {
  const locationId = process.env.SHOPIFY_DOT_LOCATION_ID;

  const input = {
    name: "available",
    reason: "correction",
    referenceDocumentUri: "iey://contabilium/deposito-dot-baires/sync",
    quantities: [
      {
        inventoryItemId,
        locationId,
        quantity,
        compareQuantity, // numero esperado actual; protege concurrencia
      },
    ],
  };

  const data = await shopifyGraphQL(MUTATION_SET, { input });
  const userErrors = data?.inventorySetQuantities?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(`Shopify userErrors: ${JSON.stringify(userErrors)}`);
  }
  return data.inventorySetQuantities.inventoryAdjustmentGroup;
}
