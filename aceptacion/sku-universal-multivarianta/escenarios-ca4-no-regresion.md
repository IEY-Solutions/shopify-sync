# CA-4 — SKU repetido que NO está en la lista curada (no-regresión)

Cubre: **R-6, R-9** (y la mitad "fuera de la lista" de R-14 en el escenario D).

Comando de referencia: `node --test test/sku-no-universal-sin-regresion.test.js`.

Par `dot` (`gid://shopify/Location/83342655574`). Contexto común **C0** del `README.md`:
clasificador `ok`, sin líneas acreditables ni notas de crédito (`credito 0`), compuerta que no
alcanza, incremental, `DRY_RUN=false`.

**Caché y destino son dos cosas distintas (resuelve B-3).** La "variante establecida" sale de la
**caché** `.cache/sku-map.json` (`docs/contratos/verificar-cache-sku.md` R-2: "Acierto en cache y
el item cacheado esta entre las coincidencias exactas"). `destinos[sku]` es el destino guardado en
la **libreta del par** (R-9 de ese contrato), y decide siembra contra delta. Cada escenario fija
las dos por separado:

- **con variante establecida:** caché **y** `destinos[sku]` apuntan a la misma variante;
- **sin variante establecida:** **ni** la caché **ni** `destinos[sku]` tienen entrada para el SKU.
  Con 2 o más exactas eso da `SkuAmbiguoError` (R-5 de `verificar-cache-sku`).

Ningún SKU de este archivo está en la lista de R-1. Ninguno debe dejar `pendiente[sku]` ni
`escrito[sku]` en la libreta, en ningún escenario.

---

## A — A4 con variante establecida: `[AVISO]` y escritura solo en la establecida

SKU **real**: `IEY-COMBO-CARBON-VERDE-IP16E` (informe:224). Los `available` 4/0 son **reales**.
Contabilium y el baseline son **inventados**. Los ids son inventados.

| Var. | `variantId` | `inventoryItemId` | `available` |
|---|---|---|---|
| 16e | `gid://shopify/ProductVariant/8040001` | `gid://shopify/InventoryItem/9040001` | 4 |
| 17e | `gid://shopify/ProductVariant/8040002` | `gid://shopify/InventoryItem/9040002` | 0 |

| Campo | Valor |
|---|---|
| Caché `sku-map.json` | `{"IEY-COMBO-CARBON-VERDE-IP16E": "gid://shopify/InventoryItem/9040001"}` |
| `destinos[sku]` (libreta `dot`) | `gid://shopify/InventoryItem/9040001` |
| `contabilium[sku]` / `skus[sku]` | `2` / `2` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / ninguno |
| Contabilium | `5` |
| Respuesta | 16e y 17e exactas, `hasNextPage: false` |

**Resultado exacto (idéntico a hoy)**

- `nuevoValor = Math.round(4 + 3) = 7`. Exactamente **1** mutación: `(9040001, 7, 4, DOT)`.
  `9040002` no recibe ninguna.
- Log, caracter a caracter:
  - `  [AVISO] dot/IEY-COMBO-CARBON-VERDE-IP16E: 2 variantes de Shopify tienen el sku exacto -> se escribe en la variante establecida gid://shopify/ProductVariant/8040001`
  - `  [SET] dot/IEY-COMBO-CARBON-VERDE-IP16E: 4 -> 7`
  - **ninguna** línea que contenga `[UNIVERSAL]`.
- Libreta: `contabilium 5`, `skus 5`, `destinos 9040001`. No hay `pendiente[sku]` ni
  `escrito[sku]`, y no se persistió ninguna entrada de journal antes de la mutación.
- `[RESUMEN] dot`: `actualizado=1`, `duplicados=1`, `universales=0`,
  `universales_pendientes=0`, `cache_invalidada=0`.

## B — A4 sin variante establecida: `SkuAmbiguoError`, sin escritura

SKU **real**: `IEY-COMBO-IEYC08P-CARBON-NEGRO-IP16E` (informe:228, "ambiguo en el sync: sí"). Los
`available` 3/0 son **reales**. Contabilium y los ids son inventados. Título de producto inyectado
en ambos nodos: `Combo IEYC08P`.

| Var. | `variantId` | `inventoryItemId` | `available` |
|---|---|---|---|
| 16e | `gid://shopify/ProductVariant/8040011` | `gid://shopify/InventoryItem/9040011` | 3 |
| 17e | `gid://shopify/ProductVariant/8040012` | `gid://shopify/InventoryItem/9040012` | 0 |

| Campo | Valor |
|---|---|
| Caché `sku-map.json` | **sin entrada** para el SKU (`{}`) |
| `destinos[sku]` | **sin entrada** |
| `contabilium[sku]` / `skus[sku]` | ausente / ausente |
| `pendiente[sku]` / `escrito[sku]` | ninguna / ninguno |
| Contabilium | `3` |

**Resultado exacto (idéntico a hoy)**

- `resolverSku` lanza `SkuAmbiguoError` con los 2 nodos. Cero mutaciones.
- Log, caracter a caracter:
  - `  [SKIP] dot/IEY-COMBO-IEYC08P-CARBON-NEGRO-IP16E: SKU ambiguo: 2 variantes de Shopify tienen el sku exacto "IEY-COMBO-IEYC08P-CARBON-NEGRO-IP16E" -> no se escribe`
  - `      - gid://shopify/ProductVariant/8040011 — Combo IEYC08P`
  - `      - gid://shopify/ProductVariant/8040012 — Combo IEYC08P`
  - ninguna línea con `[UNIVERSAL]` ni `[AVISO]`.
- `ambiguo=1`, `duplicados=0`, `universales=0`, `universales_pendientes=0`.
- Libreta: el SKU sigue sin `contabilium`, `destinos`, `pendiente` ni `escrito`. La caché sigue
  sin entrada.

## C — control con forma de universal pero fuera de la lista: ambiguo (R-1 "no es heurística", R-6)

SKU **inventado**: `APPLYFIT-CLEAR-IP17-17PRO` (empieza con `APPLYFIT-CLEAR-`, nombra dos modelos y
está en dos variantes exactas: cualquier heurística de CA-1 §2 lo tomaría como universal).

| Var. | `variantId` | `inventoryItemId` | `available` |
|---|---|---|---|
| iPhone 17 | `gid://shopify/ProductVariant/8050001` | `gid://shopify/InventoryItem/9050001` | 4 |
| iPhone 17 Pro | `gid://shopify/ProductVariant/8050002` | `gid://shopify/InventoryItem/9050002` | 4 |

Caché sin entrada y `destinos` sin entrada. `contabilium`/`skus` ausentes. Sin `pendiente` ni
`escrito`. Contabilium 5. Título de producto `ApplyFit 17`.

**Resultado exacto:** `SkuAmbiguoError` y cero mutaciones (en particular, nada de escribir 5 en las
dos). Log `  [SKIP] dot/APPLYFIT-CLEAR-IP17-17PRO: SKU ambiguo: 2 variantes de Shopify tienen el sku exacto "APPLYFIT-CLEAR-IP17-17PRO" -> no se escribe`,
seguido de las dos líneas de detalle. `ambiguo=1`, `universales=0` y ninguna línea
`[UNIVERSAL]`.

## D — el atajo del incremental sigue igual fuera de la lista (R-14, R-6)

Mismo SKU inventado que C, ahora **con** variante establecida:

| Campo | Valor |
|---|---|
| Caché `sku-map.json` | `{"APPLYFIT-CLEAR-IP17-17PRO": "gid://shopify/InventoryItem/9050001"}` |
| `destinos[sku]` | `gid://shopify/InventoryItem/9050001` |
| `contabilium[sku]` / `skus[sku]` | `5` / `5` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / ninguno |
| Contabilium | `5` (sin cambios) |
| Shopify (si se consultara) | 4/3 |

**Resultado exacto:** **cero** búsquedas `QUERY_POR_SKU` para este SKU. Cero mutaciones.
`saltado=1` y `sin_cambios=1` (como hoy, `src/sync.js:1087-1091`). Sin `[AVISO]` ni
`[UNIVERSAL]`. Libreta sin cambios.

## Qué prueba este archivo sobre R-9

A y B son literalmente el comportamiento de `docs/contratos/verificar-cache-sku.md` (R-2, R-5) y
de `test/cache-sku-duplicados.test.js` y `test/cache-sku-sin-cache.test.js`. Este test nuevo no
los reemplaza: comprueba que, con la lista curada ya en el código, SKUs repetidos reales y uno
inventado con forma de universal no entran al camino nuevo. Si algún día el patrón 16e/17e entra a
la lista (pregunta P1 del informe), A y B dejan de aplicar y hay que actualizarlos junto con R-1.
