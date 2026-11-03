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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
  // H3: en un runner limpio .cache/ no existe y writeFileSync tira ENOENT. Esa
  // excepcion se propagaba hasta procesarSku, que la reportaba como "fallo al
  // consultar Shopify" y dejaba la corrida en verde con 0 SKUs sincronizados.
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
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
// - available: stock actual en la location DOT (sirve como changeFromQuantity).
//              Es null si el item NO esta activado en esa location.
// H4: el campo `sku` de Shopify es TOKENIZADO con coincidencia parcial, y 671 de
// los 2562 SKUs del deposito (26,2%) son prefijo estricto de otro. Con
// `first: 1` y sin comillas, `sku:IEY-103-NEGRO` puede devolver
// IEY-103-NEGRO-INCLUIDO y escribir el stock en la variante equivocada.
// Defensa en tres capas: comillas, first > 1, y verificacion del sku devuelto.
const CANDIDATOS_POR_SKU = 10;

export const QUERY_POR_SKU = `
  query GetVariantBySku($query: String!, $locationId: ID!, $first: Int!) {
    productVariants(first: $first, query: $query) {
      edges {
        node {
          id
          sku
          product {
            id
            title
          }
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
      pageInfo {
        hasNextPage
      }
    }
  }
`;

// Escapa el valor para meterlo entre comillas en la search syntax de Shopify.
export function escaparValorBusqueda(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export class SkuAmbiguoError extends Error {
  // `candidatos` son los nodos exactos que devolvio Shopify. Sin ellos el
  // hallazgo es un numero ("41 ambiguos") que nadie puede accionar; con ellos es
  // una lista de variantes concretas para deduplicar. Invariante 4 de AGENTS.md:
  // una divergencia se REPORTA -- y un reporte que no nombra el objeto no sirve.
  constructor(sku, candidatos) {
    const lista = Array.isArray(candidatos) ? candidatos : [];
    super(`SKU ambiguo: ${lista.length} variantes de Shopify tienen el sku exacto "${sku}"`);
    this.name = "SkuAmbiguoError";
    this.sku = sku;
    this.candidatos = lista.map((n) => ({
      variantId: n?.id ?? null,
      productId: n?.product?.id ?? null,
      producto: n?.product?.title ?? "(sin titulo)",
    }));
  }

  // Una linea por variante, lista para el log.
  detalle() {
    return this.candidatos.map(
      (c) => `      - ${c.variantId ?? "(sin id)"} — ${c.producto}`
    );
  }
}

// Decide cual de los candidatos que devolvio Shopify es realmente el SKU pedido.
// Separada de la consulta para poder testearla sin red (test/sku-match.test.js).
//   - null            -> no hay coincidencia exacta (no escribir)
//   - SkuAmbiguoError -> hay mas de una (no escribir: elegir seria elegir al azar)
export function elegirVarianteExacta(edges, sku) {
  const exactos = (edges ?? []).map((e) => e?.node).filter((n) => n && n.sku === sku);
  if (exactos.length === 0) return null;
  if (exactos.length > 1) throw new SkuAmbiguoError(sku, exactos);
  return exactos[0];
}

export async function buscarVariantePorSku(sku, locationId) {
  if (!locationId) {
    throw new Error(`buscarVariantePorSku(${sku}): locationId es obligatorio, no hay default`);
  }
  const data = await shopifyGraphQL(QUERY_POR_SKU, {
    query: `sku:"${escaparValorBusqueda(sku)}"`,
    locationId,
    first: CANDIDATOS_POR_SKU,
  });

  const node = elegirVarianteExacta(data?.productVariants?.edges, sku);
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

export async function leerStockActual(inventoryItemId, locationId) {
  if (!locationId) {
    throw new Error(`leerStockActual(${inventoryItemId}): locationId es obligatorio, no hay default`);
  }
  const data = await shopifyGraphQL(QUERY_NIVEL, { id: inventoryItemId, locationId });
  const nivel = data?.inventoryItem?.inventoryLevel;
  return nivel?.quantities?.find((q) => q.name === "available")?.quantity ?? null;
}

// -----------------------------------------------------------------------------
// leerCacheSku — copia NUEVA de la cache leida del disco, sin memo (R-9)
// -----------------------------------------------------------------------------
// ejecutarPar la lee UNA vez al empezar la corrida para inicializar el destino
// por par de los SKUs con baseline. Archivo ausente o corrupto -> {}.
export function leerCacheSku(ruta = CACHE_PATH) {
  try {
    if (!existsSync(ruta)) return {};
    const crudo = JSON.parse(readFileSync(ruta, "utf-8"));
    return crudo && typeof crudo === "object" && !Array.isArray(crudo) ? { ...crudo } : {};
  } catch {
    return {};
  }
}

function escribirCacheEn(ruta, mapa) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, JSON.stringify(mapa, null, 2), "utf-8");
}

function availableDe(node) {
  return node?.inventoryItem?.inventoryLevel?.quantities?.find((q) => q.name === "available")?.quantity ?? null;
}

// -----------------------------------------------------------------------------
// resolverSku — verifica SIEMPRE contra Shopify, tambien con acierto en cache
// -----------------------------------------------------------------------------
// Invariante 3: el id cacheado solo se usa si la busqueda exacta de ESTA
// llamada lo devuelve con el sku pedido. Una sola consulta por llamada
// (QUERY_POR_SKU), que en el acierto de cache reemplaza a GetLevel (R-7).
// Forma del retorno: aceptacion/verificar-cache-sku/DISENO-INTERFAZ.md, seccion 3.
//   opciones.consultar  async (query, variables) => data (por defecto, shopifyGraphQL)
//   opciones.rutaCache  ruta de la cache; explicita = sin memo de proceso
export async function resolverSku(sku, locationId, opciones = {}) {
  if (!locationId) {
    throw new Error(`resolverSku(${sku}): locationId es obligatorio, no hay default`);
  }
  const consultar = typeof opciones?.consultar === "function" ? opciones.consultar : shopifyGraphQL;
  const rutaCache = typeof opciones?.rutaCache === "string" ? opciones.rutaCache : null;
  const c = rutaCache ? leerCacheSku(rutaCache) : cargarCache();
  const persistir = () => (rutaCache ? escribirCacheEn(rutaCache, c) : guardarCache());
  const cacheado = c[sku] ?? null;

  // Si la busqueda falla, se propaga: no se usa el id cacheado sin verificar.
  const data = await consultar(QUERY_POR_SKU, {
    query: `sku:"${escaparValorBusqueda(sku)}"`,
    locationId,
    first: CANDIDATOS_POR_SKU,
  });

  const nodos = (data?.productVariants?.edges ?? []).map((e) => e?.node).filter(Boolean);
  const topeAlcanzado = data?.productVariants?.pageInfo?.hasNextPage === true;
  const itemsVistos = nodos.map((n) => n.inventoryItem?.id).filter(Boolean);
  // Coincidencia EXACTA: aparecer en la busqueda tokenizada no alcanza.
  const exactos = nodos.filter((n) => n.sku === sku && n.inventoryItem?.id);
  const armar = (n, extra) => ({
    inventoryItemId: n.inventoryItem.id,
    variantId: n.id ?? null,
    available: availableDe(n),
    topeAlcanzado,
    itemsVistos,
    ...extra,
  });

  if (cacheado) {
    const establecida = exactos.find((n) => n.inventoryItem.id === cacheado);
    if (establecida) {
      // Variante establecida: se sigue escribiendo ahi aunque haya duplicados (R-2).
      return armar(establecida, {
        desdeCache: true,
        duplicados: exactos.length - 1,
        cacheInvalidada: false,
        cambioDeDestino: false,
        inventoryItemIdAnterior: cacheado,
      });
    }
    if (topeAlcanzado) {
      // E2: no se sabe si la establecida fue renombrada o quedo afuera del tope.
      const err = new Error(
        `busqueda en el tope de ${CANDIDATOS_POR_SKU} candidatos y la variante cacheada no esta entre las visibles -> no se escribe`
      );
      err.topeAlcanzado = true;
      throw err;
    }
    // R-3: la entrada dejo de valer. Se resuelve de cero con la MISMA respuesta.
    delete c[sku];
    if (exactos.length === 1) {
      c[sku] = exactos[0].inventoryItem.id;
      persistir();
      return armar(exactos[0], {
        desdeCache: false,
        duplicados: 0,
        cacheInvalidada: true,
        cambioDeDestino: true,
        inventoryItemIdAnterior: cacheado,
      });
    }
    persistir();
    if (exactos.length > 1) {
      const err = new SkuAmbiguoError(sku, exactos);
      err.cacheInvalidada = true;
      err.inventoryItemIdAnterior = cacheado;
      throw err;
    }
    return {
      inventoryItemId: null,
      variantId: null,
      available: null,
      desdeCache: false,
      duplicados: 0,
      cacheInvalidada: true,
      cambioDeDestino: false,
      inventoryItemIdAnterior: cacheado,
      topeAlcanzado,
      itemsVistos,
    };
  }

  // Sin entrada en cache: el comportamiento de siempre (R-5).
  if (exactos.length === 0) return null;
  if (exactos.length > 1) throw new SkuAmbiguoError(sku, exactos);
  c[sku] = exactos[0].inventoryItem.id;
  persistir();
  return armar(exactos[0], {
    desdeCache: false,
    duplicados: 0,
    cacheInvalidada: false,
    cambioDeDestino: false,
    inventoryItemIdAnterior: null,
  });
}

// -----------------------------------------------------------------------------
// setearStock — inventorySetQuantities (cantidad absoluta, compare-and-set)
// -----------------------------------------------------------------------------
// changeFromQuantity protege contra cambios concurrentes: Shopify solo aplica el
// cambio si el stock persistido sigue siendo el que leimos. Si alguien lo movio
// en el medio, devuelve userError y NO pisa el valor.
//
// El campo se llamaba `compareQuantity` hasta la API 2026-01. Desde la 2026-04
// ese campo (y `ignoreCompareQuantity`) fueron ELIMINADOS y su reemplazo es
// `changeFromQuantity`, que acepta `null` para saltear la validacion.
// El Dev Dashboard de la app marcaba la llamada vieja como obsoleta con fecha
// limite 2027-01-01. Verificado contra el schema de 2026-04:
// https://shopify.dev/docs/api/admin-graphql/2026-04/input-objects/InventoryQuantityInput
// La directiva @idempotent es OBLIGATORIA desde la API 2026-04. Sin ella la
// mutation falla con BAD_REQUEST: "The @idempotent directive is required for
// this mutation but was not provided." Va en el CAMPO, no en la operacion.
// https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/inventorySetQuantities
export const MUTATION_SET = `
  mutation InventorySet($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        reason
        changes { name delta quantityAfterChange }
      }
      userErrors { code field message }
    }
  }
`;

// Construye el input de la mutation. Separado para poder testear el shape sin red.
export function construirInputSet({ inventoryItemId, locationId, quantity, changeFromQuantity }) {
  return {
    name: "available",
    reason: "correction",
    referenceDocumentUri: "iey://contabilium/deposito-dot-baires/sync",
    quantities: [
      {
        inventoryItemId,
        locationId,
        quantity,
        changeFromQuantity, // numero esperado actual; protege concurrencia
      },
    ],
  };
}

export async function setearStock(inventoryItemId, quantity, changeFromQuantity, locationId) {
  if (!locationId) {
    throw new Error(`setearStock(${inventoryItemId}): locationId es obligatorio, no hay default`);
  }
  const input = construirInputSet({ inventoryItemId, locationId, quantity, changeFromQuantity });

  // Clave por intento logico. El reintento interno de shopifyGraphQL reusa las
  // mismas variables, asi que un reintento por 429/THROTTLED no duplica la
  // escritura. No se deriva del contenido a proposito: dos escrituras legitimas
  // del mismo valor en momentos distintos NO deben deduplicarse entre si.
  const idempotencyKey = randomUUID();

  const data = await shopifyGraphQL(MUTATION_SET, { input, idempotencyKey });
  const userErrors = data?.inventorySetQuantities?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(`Shopify userErrors: ${JSON.stringify(userErrors)}`);
  }
  return data.inventorySetQuantities.inventoryAdjustmentGroup;
}

// -----------------------------------------------------------------------------
// Diagnostico read-only: sobre que location escribe la integracion nativa
// -----------------------------------------------------------------------------
// Riesgo 1 de la spec, abierto desde P0 y unico de la familia de S-2 sin cerrar.
// Si la integracion 25020 (deposito CENTRAL) escribiera sobre la location del
// DOT, habria un TERCER escritor absoluto sobre el mismo inventario y el diseño
// de deltas quedaria invalidado.
//
// Se dio por no verificable porque "requiere acceso al admin de Shopify". No lo
// requiere: `read_products` + `read_inventory` alcanzan para leer los niveles de
// un SKU en TODAS las locations, que es lo que decide la pregunta.
//
// NADA de esto escribe.

// NO se usa la query raiz `locations` ni el campo `Location.name`: ambos exigen
// el scope `read_locations`, que esta app NO tiene (write_inventory,
// read_inventory, read_products). Verificado contra produccion en la corrida
// 32318874707: "Access denied for name field. Required access: read_locations".
//
// El ID de la location alcanza para responder la pregunta, porque el de la DOT
// ya lo conocemos (SHOPIFY_DOT_LOCATION_ID).

// Niveles de un SKU en TODAS las locations (no solo la del DOT).
const QUERY_NIVELES_TODAS = `
  query NivelesPorSku($query: String!, $first: Int!, $firstLevels: Int!) {
    productVariants(first: $first, query: $query) {
      edges {
        node {
          id
          sku
          inventoryItem {
            id
            inventoryLevels(first: $firstLevels) {
              edges {
                node {
                  location { id }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Devuelve [{ locationId, location, available }] o null si el SKU no resuelve.
export async function leerNivelesEnTodasLasLocations(sku) {
  const data = await shopifyGraphQL(QUERY_NIVELES_TODAS, {
    query: `sku:"${escaparValorBusqueda(sku)}"`,
    first: CANDIDATOS_POR_SKU,
    firstLevels: 50,
  });

  let node;
  try {
    node = elegirVarianteExacta(data?.productVariants?.edges, sku);
  } catch {
    return null; // ambiguo: para un diagnostico no vale la pena elegir
  }
  if (!node) return null;

  return (node.inventoryItem?.inventoryLevels?.edges ?? [])
    .map((e) => e?.node)
    .filter(Boolean)
    .map((n) => ({
      locationId: n.location?.id ?? null,
      // Sin `read_locations` no hay nombre: se identifica por el sufijo del GID.
      location: (n.location?.id ?? "").split("/").pop() || "(sin id)",
      available: n.quantities?.find((q) => q.name === "available")?.quantity ?? null,
    }));
}

// -----------------------------------------------------------------------------
// SKUs universales (requisito R-1)
// -----------------------------------------------------------------------------
// Lista curada y explícita: un SKU que corresponde a varios modelos de
// teléfono distintos, resuelto en Shopify como N variantes separadas con el
// mismo SKU exacto. No es una heurística: se infiere solo de esta lista, no
// de la forma del string. Pertenencia por igualdad exacta del string
// completo, nunca por prefijo ni extensión.
export const SKUS_UNIVERSALES = new Map([
  ["APPLYFIT-CLEAR-IP16PRO-17-17PRO", 3],
  ["APPLYFIT-CLEAR-S24-S25", 2],
  ["APPLYFIT-CLEAR-IP15-16", 2],
  ["APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E", 5],
  ["APPLYFIT-CLEAR-IP16PM-17PM", 2],
  ["APPLYFIT-CLEAR-IP13PM-14PLUS", 2],
  ["APPLYFIT-CLEAR-S24PLUS-S25PLUS", 2],
]);

// Devuelve la cantidad de variantes esperadas si `sku` es universal, o
// `undefined` si no lo es. Igualdad exacta del string completo.
export function variantesUniversales(sku) {
  return SKUS_UNIVERSALES.get(sku);
}

// true/false explícito, por si conviene a un llamador en vez de `undefined`.
export function esSkuUniversal(sku) {
  return SKUS_UNIVERSALES.has(sku);
}

export class ConteoVariantesUniversalError extends Error {
  constructor(sku, esperadas, encontradas, topeAlcanzado) {
    super(
      `${sku}: se esperaban ${esperadas} variantes exactas y se encontraron ${encontradas}` +
        (topeAlcanzado ? " (tope de busqueda alcanzado)" : "")
    );
    this.name = "ConteoVariantesUniversalError";
    this.sku = sku;
    this.esperadas = esperadas;
    this.encontradas = encontradas;
    this.topeAlcanzado = topeAlcanzado;
  }
}

// -----------------------------------------------------------------------------
// resolverSkuUniversal — resolucion multi-variante para un SKU curado (R-2, R-7)
// -----------------------------------------------------------------------------
// Misma QUERY_POR_SKU, mismo CANDIDATOS_POR_SKU y la misma verificacion de
// `node.sku` exacto que resolverSku. No consulta ni escribe la cache: para un
// curado la cache NUNCA elige la candidata (R-2). Nunca lanza SkuAmbiguoError.
// R-7: la cantidad de variantes exactas se controla contra la cantidad
// ESPERADA de la lista curada (T01), no contra la cache ni contra el tope.
export async function resolverSkuUniversal(sku, locationId, opciones = {}) {
  const esperadas = variantesUniversales(sku);
  if (esperadas === undefined) {
    throw new Error(`resolverSkuUniversal(${sku}): no es un SKU de la lista curada`);
  }
  if (!locationId) {
    throw new Error(`resolverSkuUniversal(${sku}): locationId es obligatorio, no hay default`);
  }
  const consultar = typeof opciones?.consultar === "function" ? opciones.consultar : shopifyGraphQL;
  const data = await consultar(QUERY_POR_SKU, {
    query: `sku:"${escaparValorBusqueda(sku)}"`,
    locationId,
    first: CANDIDATOS_POR_SKU,
  });

  const nodos = (data?.productVariants?.edges ?? []).map((e) => e?.node).filter(Boolean);
  const topeAlcanzado = data?.productVariants?.pageInfo?.hasNextPage === true;
  // Coincidencia EXACTA: aparecer en la busqueda tokenizada no alcanza (invariante 3).
  const exactos = nodos.filter((n) => n.sku === sku && n.inventoryItem?.id);

  if (exactos.length !== esperadas) {
    throw new ConteoVariantesUniversalError(sku, esperadas, exactos.length, topeAlcanzado);
  }

  return exactos.map((n) => ({
    variantId: n.id ?? null,
    inventoryItemId: n.inventoryItem.id,
    available: availableDe(n),
  }));
}
