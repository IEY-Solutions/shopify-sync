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
import { elegirVarianteExacta, escaparValorBusqueda, SkuAmbiguoError, QUERY_POR_SKU } from "../src/shopify.js";

const nodo = (sku, titulo = `Producto ${sku}`, n = 1) => ({
  sku,
  id: `gid://shopify/ProductVariant/${sku}-${n}`,
  product: { id: `gid://shopify/Product/${sku}-${n}`, title: titulo },
  inventoryItem: { id: `ii-${sku}` },
});
const edges = (...skus) => skus.map((s, i) => ({ node: nodo(s, `Producto ${s}`, i + 1) }));

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

// -----------------------------------------------------------------------------
// Un SKU ambiguo tiene que NOMBRAR las variantes, no solo contarlas
// -----------------------------------------------------------------------------
// Los 41 ambiguos del deposito DOT tienen los 41 exactamente 2 variantes. Con
// solo el numero, el hallazgo no es accionable: nadie sabe cual duplicado
// borrar. Invariante 4 de AGENTS.md: una divergencia se reporta -- y un reporte
// que no nombra el objeto no sirve de nada.

test("el error de ambiguedad expone las variantes duplicadas con su producto", () => {
  const e = [
    { node: nodo("IEY-COMBO-IEY108N-TRANSP-IP16E", "Combo iPhone 16e transparente", 1) },
    { node: nodo("IEY-COMBO-IEY108N-TRANSP-IP16E", "Combo iPhone 16e transparente (duplicado)", 2) },
  ];
  try {
    elegirVarianteExacta(e, "IEY-COMBO-IEY108N-TRANSP-IP16E");
    assert.fail("tenia que lanzar SkuAmbiguoError");
  } catch (err) {
    assert.ok(err instanceof SkuAmbiguoError);
    assert.equal(err.candidatos.length, 2);
    assert.equal(err.candidatos[0].variantId, "gid://shopify/ProductVariant/IEY-COMBO-IEY108N-TRANSP-IP16E-1");
    assert.equal(err.candidatos[0].producto, "Combo iPhone 16e transparente");
    assert.equal(err.candidatos[1].producto, "Combo iPhone 16e transparente (duplicado)");
  }
});

test("detalle() da una linea por variante, con id y nombre de producto", () => {
  const e = [
    { node: nodo("SKU-X", "Producto A", 1) },
    { node: nodo("SKU-X", "Producto B", 2) },
  ];
  const err = (() => { try { elegirVarianteExacta(e, "SKU-X"); } catch (x) { return x; } })();
  const lineas = err.detalle();
  assert.equal(lineas.length, 2);
  assert.match(lineas[0], /gid:\/\/shopify\/ProductVariant\/SKU-X-1 — Producto A/);
  assert.match(lineas[1], /gid:\/\/shopify\/ProductVariant\/SKU-X-2 — Producto B/);
});

test("una variante sin producto no rompe el reporte", () => {
  const sinProducto = { sku: "SKU-Y", id: "gid://v/1", inventoryItem: { id: "ii" } };
  const e = [{ node: sinProducto }, { node: { ...sinProducto, id: "gid://v/2" } }];
  const err = (() => { try { elegirVarianteExacta(e, "SKU-Y"); } catch (x) { return x; } })();
  assert.equal(err.candidatos.length, 2);
  assert.equal(err.candidatos[0].producto, "(sin titulo)");
  assert.match(err.detalle()[0], /\(sin titulo\)/);
});

test("la query pide el producto: sin eso no hay como nombrar el duplicado", () => {
  assert.match(QUERY_POR_SKU, /product\s*\{[^}]*title/s);
});

// -----------------------------------------------------------------------------
// Arreglo post-juez (2026-10-29): R-5 para un par que NO es el DOT
// -----------------------------------------------------------------------------
// El juez rechazo el cierre de CA-5 porque ningun caso de este archivo pasaba
// un locationId distinto del de la location DOT (83342655574). El criterio
// exige que la coincidencia de SKU funcione "para los pares multiples, no
// solo para el DOT", y los tests de arriba ejercitan elegirVarianteExacta,
// que ni siquiera recibe locationId (opera sobre los edges ya devueltos).
//
// buscarVariantePorSku/resolverSku SI reciben locationId como parametro
// explicito, sin default (ver src/shopify.js: "locationId es obligatorio, no
// hay default"), y son las funciones reales que un par no-DOT usa para
// resolver un SKU. Este bloque mockea globalThis.fetch -- el unico punto de
// red real de este modulo -- con un fixture que tiene el MISMO sku
// disponible en DOS locations distintas (DOT e ISLA), con `available`
// distinto en cada una, y confirma que la resolucion exacta no se confunde
// de location al pedir la de la isla.
import { buscarVariantePorSku } from "../src/shopify.js";

test("buscarVariantePorSku resuelve el sku exacto para un par que no es el DOT, sin confundir la location", async (t) => {
  const LOCATION_DOT = "gid://shopify/Location/83342655574";
  const LOCATION_ISLA = "gid://shopify/Location/99988877766"; // una location DISTINTA del DOT

  const envPrevio = {
    SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION,
    SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
    SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
  };
  const fetchOriginal = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(envPrevio)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  process.env.SHOPIFY_STORE_DOMAIN = "tienda-fake.myshopify.com";
  process.env.SHOPIFY_API_VERSION = "2026-04";
  process.env.SHOPIFY_CLIENT_ID = "id-fake";
  process.env.SHOPIFY_CLIENT_SECRET = "secret-fake";

  // El mismo sku, con available distinto segun la location consultada --
  // asi cualquier mezcla de location se detecta por el numero devuelto.
  const availablePorLocation = { [LOCATION_DOT]: 10, [LOCATION_ISLA]: 4 };

  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("/oauth/access_token")) {
      return { ok: true, json: async () => ({ access_token: "tok-fake", expires_in: 86400 }) };
    }
    const body = JSON.parse(opts.body);
    const locationIdPedido = body.variables.locationId;
    return {
      ok: true,
      json: async () => ({
        data: {
          productVariants: {
            edges: [
              {
                node: {
                  id: "gid://shopify/ProductVariant/1",
                  sku: "IEY-103-NEGRO",
                  product: { id: "gid://shopify/Product/1", title: "Funda" },
                  inventoryItem: {
                    id: "gid://shopify/InventoryItem/1",
                    inventoryLevel: {
                      quantities: [{ name: "available", quantity: availablePorLocation[locationIdPedido] }],
                    },
                  },
                },
              },
            ],
          },
        },
      }),
    };
  };

  const resultadoIsla = await buscarVariantePorSku("IEY-103-NEGRO", LOCATION_ISLA);
  assert.equal(resultadoIsla.inventoryItemId, "gid://shopify/InventoryItem/1");
  assert.equal(resultadoIsla.available, 4, "con locationId de la isla, tiene que leer el available de LA ISLA");

  const resultadoDot = await buscarVariantePorSku("IEY-103-NEGRO", LOCATION_DOT);
  assert.equal(resultadoDot.available, 10, "con locationId del DOT, tiene que leer el available del DOT, no el de la isla");
});
