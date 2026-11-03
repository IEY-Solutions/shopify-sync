// _helpers-cache-sku.js
// -----------------------------------------------------------------------------
// Helpers de los tests de `verificar-cache-sku`. NO termina en `.test.js` a
// proposito: `node --test test/*.test.js` no lo corre como suite.
//
// Interfaz asumida: aceptacion/verificar-cache-sku/DISENO-INTERFAZ.md.
//
// Lo central: una tienda de Shopify FALSA que responde la consulta GraphQL que
// recibe `resolverSku(sku, locationId, { consultar, rutaCache })`. La tienda
// imita la busqueda TOKENIZADA de Shopify: para `sku:"X"` devuelve tambien las
// variantes cuyo SKU empieza con X (FUNDA-...-IPHONE16 trae FUNDA-...-IPHONE16PRO),
// que es el 26% del catalogo real (AGENTS.md, invariante 3). Asi, una
// implementacion que no compare el SKU exacto se ve.
//
// Los simbolos nuevos de src/ se usan via import de namespace (`* as shopify`):
// si no existen, cada test falla por su cuenta con un error claro.
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as shopify from "../src/shopify.js";
import { depsFake, guardiaDeEscriturasEnRepo, LOCATION_DOT } from "./_helpers-clasificador.js";

// ------------------------------------------------------------ casos reales
// docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md, grupo A4 (fila 224):
// el SKU hoy esta en 5 variantes. El historial de ajustes de Shopify muestra
// que el sync escribio SOLO en la variante establecida, porque la tenia en
// la cache. Migrado de APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E (T02, R-15): ese
// SKU paso a ser un curado universal (T01) y dejo de servir para este caso.
export const SKU_APPLYFIT = "IEY-COMBO-CARBON-VERDE-IP16E";
// Correccion pendiente 9 del mismo analisis (fila 184): la variante
// "Negro / iPhone 18 Pro" del combo carbon tiene el SKU de otra.
export const SKU_NEGRO_18PRO = "IEY-COMBO-IEY108N-CARBON-NEGRO-IP18PRO";
export const SKU_AZUL_18PRO = "IEY-COMBO-IEY108N-CARBON-AZUL-IP18PRO";
// Correccion pendiente 3 (fila 700): renombre de C08N a C08P.
export const SKU_C08N_S26ULTRA = "IEY-COMBO-IEYC08N-S-RING-GRIS-S26ULTRA";
export const SKU_C08P_S26ULTRA = "IEY-COMBO-IEYC08P-S-RING-GRIS-S26ULTRA";
// Correcciones 1 y 2 (filas 4 y 5): par invertido.
export const SKU_Q2_18PRO = "IEY-COMBO-IEYQ222N-CARBON-AZUL-IP18PRO";
export const SKU_Q2_18PM = "IEY-COMBO-IEYQ222N-CARBON-AZUL-IP18PM";
// AGENTS.md, invariante 3: un SKU prefijo estricto de otro.
export const SKU_PREFIJO = "FUNDA-MAGSAFE-MATE-IPHONE16";
export const SKU_PREFIJO_LARGO = "FUNDA-MAGSAFE-MATE-IPHONE16PRO";

// ------------------------------------------------------------------ ids
export function item(n) {
  return `gid://shopify/InventoryItem/${n}`;
}
export function variante(n) {
  return `gid://shopify/ProductVariant/${n}`;
}

// ---------------------------------------------------------- cache en disco
// Forma FIJADA por DISENO-INTERFAZ.md seccion 2: { [sku]: inventoryItemId }.
export function rutaCacheSku(dir) {
  return join(dir, "sku-map.json");
}
export function sembrarCacheSku(dir, mapa) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(rutaCacheSku(dir), JSON.stringify(mapa, null, 2), "utf-8");
}
export function leerCacheSkuCruda(dir) {
  const r = rutaCacheSku(dir);
  if (!existsSync(r)) return {};
  return JSON.parse(readFileSync(r, "utf-8"));
}

// --------------------------------------------------------- tienda falsa
// variantes: [{ n, sku, titulo?, niveles: { [locationId]: number | null } }]
//   n        -> variantId variante(n) e inventoryItemId item(n)
//   niveles  -> available por location; una location ausente o null = no activado.
export function tiendaFalsa(variantes) {
  const t = {
    variantes: variantes.map((v) => ({ ...v, niveles: { ...(v.niveles ?? {}) } })),
    // Una entrada por consulta GraphQL: { tipo: "busqueda" | "nivel" | "otra", variables }.
    consultas: [],
    // Una entrada por setearStock: { inventoryItemId, quantity, changeFromQuantity, locationId }.
    escrituras: [],
    fallarBusqueda: false,

    porNumero(n) {
      return t.variantes.find((v) => v.n === n);
    },
    porItem(id) {
      return t.variantes.find((v) => item(v.n) === id);
    },
    // Lo que hace la persona en el admin de Shopify.
    renombrar(n, nuevoSku) {
      t.porNumero(n).sku = nuevoSku;
    },
    busquedas() {
      return t.consultas.filter((c) => c.tipo === "busqueda");
    },

    async consultar(query, variables = {}) {
      const q = String(query);
      if (/productVariants\s*\(/.test(q)) {
        t.consultas.push({ tipo: "busqueda", variables: { ...variables } });
        if (t.fallarBusqueda) throw new Error("Shopify HTTP 503: caido (simulado)");
        const m = /^sku:"((?:[^"\\]|\\.)*)"$/.exec(String(variables.query ?? ""));
        if (!m) throw new Error(`busqueda sin el formato exacto sku:"...": ${variables.query}`);
        const pedido = m[1].replace(/\\(.)/g, "$1");
        const first = Number(variables.first) || 1;
        const coinciden = t.variantes.filter((v) => typeof v.sku === "string" && v.sku.startsWith(pedido));
        const nodos = coinciden.slice(0, first).map((v) => nodo(v, variables.locationId));
        // Ronda 2 (E2): como Shopify, avisa si quedaron coincidencias afuera del tope `first`.
        return {
          productVariants: {
            edges: nodos.map((node) => ({ node })),
            pageInfo: { hasNextPage: coinciden.length > first },
          },
        };
      }
      if (/inventoryItem\s*\(/.test(q)) {
        // GetLevel (leerStockActual). resolverSku ya no deberia usarlo (R-7).
        t.consultas.push({ tipo: "nivel", variables: { ...variables } });
        const v = t.porItem(variables.id);
        return { inventoryItem: v ? { inventoryLevel: nivel(v, variables.locationId) } : null };
      }
      t.consultas.push({ tipo: "otra", variables: { ...variables } });
      throw new Error(`consulta GraphQL inesperada en la tienda falsa: ${q.slice(0, 80)}`);
    },

    async setearStock(inventoryItemId, quantity, changeFromQuantity, locationId) {
      t.escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      const v = t.porItem(inventoryItemId);
      if (!v) throw new Error(`setearStock sobre un inventory item que no existe: ${inventoryItemId}`);
      v.niveles[locationId] = quantity;
    },
  };
  // Para pasarlas sueltas sin perder `this`.
  t.consultar = t.consultar.bind(t);
  t.setearStock = t.setearStock.bind(t);
  return t;
}

function nivel(v, locationId) {
  const q = v.niveles[locationId];
  if (q === undefined || q === null) return null;
  return { quantities: [{ name: "available", quantity: q }] };
}

function nodo(v, locationId) {
  return {
    id: variante(v.n),
    sku: v.sku,
    product: { id: `gid://shopify/Product/${v.n}`, title: v.titulo ?? `Producto ${v.n}` },
    inventoryItem: { id: item(v.n), inventoryLevel: nivel(v, locationId) },
  };
}

// Ronda 2 (E2, tope de candidatos): `cantidad` variantes con un SKU prefijo-largo
// de `sku` (`<sku>-L01`, `<sku>-L02`, ...). La busqueda tokenizada las trae como
// coincidencias de `sku:"<sku>"`, asi que llenan el tope `first: 10` y dejan
// afuera a las que vengan despues en la tienda.
export function prefijosLargos(sku, desdeN, cantidad, niveles) {
  return Array.from({ length: cantidad }, (_, i) => ({
    n: desdeN + i,
    sku: `${sku}-L${String(i + 1).padStart(2, "0")}`,
    niveles: { ...niveles },
  }));
}

// Cantidades escritas en el inventory item n, en la location dada, en orden.
export function escriturasEn(tienda, n, locationId = LOCATION_DOT) {
  return tienda.escrituras.filter((e) => e.inventoryItemId === item(n) && e.locationId === locationId).map((e) => e.quantity);
}

// --------------------------------------------------------------- resolver
// El resolverSku REAL de src/shopify.js con la consulta y la ruta de cache
// inyectadas (DISENO-INTERFAZ.md seccion 1).
export function resolverInyectado(tienda, dir) {
  const rutaCache = rutaCacheSku(dir);
  return (sku, locationId, extra) =>
    shopify.resolverSku(sku, locationId, {
      ...(extra && typeof extra === "object" ? extra : {}),
      consultar: tienda.consultar,
      rutaCache,
    });
}

// deps de ejecutarPar / correrTodosLosPares / syncUnSku: los de
// _helpers-clasificador.js (libreta, registro, reloj, encierro) con el
// resolverSku REAL inyectado, el setearStock de la tienda falsa y la lectura
// de la cache de esta corrida (DISENO-INTERFAZ.md seccion 4).
// Ronda 2: `fallaBusqueda` (busqueda de comprobantes caida) y
// `guardarSnapshotEnvoltorio` (falla de IO en un guardado) pasan tal cual a depsFake.
export function depsConCacheReal({
  dir,
  tienda,
  reloj,
  stock,
  dryRun = false,
  llamadas,
  search = [],
  encierro = null,
  fallaBusqueda = false,
  guardarSnapshotEnvoltorio = null,
}) {
  const base = depsFake({ dir, reloj, stock, shopify: new Map(), dryRun, llamadas, search, encierro, fallaBusqueda, guardarSnapshotEnvoltorio });
  const resolver = resolverInyectado(tienda, dir);
  return {
    ...base,
    resolverSku: async (sku, locationId, ...resto) => {
      if (llamadas) llamadas.resolverSku.push({ sku, locationId });
      return resolver(sku, locationId, resto[0]);
    },
    setearStock: tienda.setearStock,
    leerCacheSku: () => leerCacheSkuCruda(dir),
  };
}

// --------------------------------------------------------------- entorno
// Red de seguridad: si la implementacion ignora la consulta inyectada, no sale
// a la red (fetch lanza y queda anotado) ni encuentra credenciales; y ninguna
// escritura del proceso puede caer dentro del repo (el .cache/ real).
const VARIABLES_SHOPIFY = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_API_VERSION", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"];

export function aislarShopify(t) {
  const previo = {};
  for (const k of [...VARIABLES_SHOPIFY, "DRY_RUN", "SHOPIFY_DOT_LOCATION_ID"]) previo[k] = process.env[k];
  const fetchOriginal = globalThis.fetch;
  const llamadasFetch = [];
  for (const k of VARIABLES_SHOPIFY) delete process.env[k];
  process.env.DRY_RUN = "true";
  process.env.SHOPIFY_DOT_LOCATION_ID = LOCATION_DOT;
  globalThis.fetch = async (url) => {
    llamadasFetch.push(String(url));
    throw new Error(`red real prohibida en este test: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(previo)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const violacionesFs = guardiaDeEscriturasEnRepo(t);
  return { llamadasFetch, violacionesFs };
}

// La linea [AVISO] de un SKU con variantes duplicadas (DISENO-INTERFAZ.md seccion 5).
export function lineasDeAviso(lineas, par, sku) {
  const prefijo = par ? `[AVISO] ${par}/${sku}:` : `[AVISO] ${sku}:`;
  return lineas.filter((l) => l.texto.includes(prefijo));
}
