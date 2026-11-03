# CA-3 — SKU universal de 2 variantes

Cubre: **R-2, R-3, R-4, R-5, R-13** (y R-14 en D y E, R-5 por par en F, R-5 orden de
`destinos[sku]` en G).

Comando de referencia: `node --test test/sku-universal-2-variantes.test.js`.

SKU: `APPLYFIT-CLEAR-S24-S25` (grupo A1, informe:157-164). Contexto común **C0** del `README.md`
en todos los escenarios: clasificador `ok`, sin líneas acreditables ni notas de crédito
(`credito 0`), compuerta que no lo alcanza, incremental, `DRY_RUN=false`. Salvo el escenario F,
el par es `dot`.

## Variantes (fijas para todo el archivo y para CA-5 y CA-8)

| Var. | Modelo (informe) | `variantId` | `inventoryItemId` | `sku` |
|---|---|---|---|---|
| V1 | Samsung S25 (fila 46) | `gid://shopify/ProductVariant/8030001` | `gid://shopify/InventoryItem/9030001` | exacto |
| V2 | Samsung S24 (fila 49) | `gid://shopify/ProductVariant/8030002` | `gid://shopify/InventoryItem/9030002` | exacto |
| P1 | (inventado) | `gid://shopify/ProductVariant/8039901` | `gid://shopify/InventoryItem/9039901` | `APPLYFIT-CLEAR-S24-S25FE` (prefijo-largo) |

Los `available` reales del informe son 10/0. Este archivo usa los valores **inventados** de los
ejemplos normativos de CA-3.

---

## A — iguales, decimal de Contabilium, con un candidato prefijo-largo (R-2, R-3, R-4 b, R-9)

| Campo | Valor (inventado) |
|---|---|
| Caché `sku-map.json` | `{"APPLYFIT-CLEAR-S24-S25": "gid://shopify/InventoryItem/9030001"}` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `destinos[sku]` | `gid://shopify/InventoryItem/9030001` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / ninguno |
| Contabilium | **`12.6`** (resuelve I-4) |
| Respuesta | V1 5, V2 5 y **P1 2**; `hasNextPage: false` |

**Resultado exacto**

- N = 2 (P1 excluida, resuelve I-3). Camino (b) con las variantes iguales: referencia 5. Delta
  `2.6`. `nuevoValor = Math.round(7.6) = 8`.
- `pendiente[sku] = {8, 12.6, desde 5/5}` persistido antes de mutar.
- 2 mutaciones: `(9030001, 8, 5, DOT)` y `(9030002, 8, 5, DOT)`. Ninguna sobre `9039901`. Ninguna
  con valor no entero.
- Libreta final: `contabilium 12.6`, `skus 12.6`, `escrito 8`, `pendiente` ninguna.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 8 (escritas=2, ya_estaban=0)`.
- `actualizado=1`, `universales=1`, `duplicados=0`.

## B — bootstrap divergente 5/0 (R-4 b; ejemplo de CA-3)

| Campo | Valor (inventado) |
|---|---|
| Caché / `destinos[sku]` | `9030001` / `9030001` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / ninguno |
| Contabilium | `9` |
| Respuesta | 5/0 |

**Resultado exacto:** referencia `max(5, 0) = 5`. Delta `−1`. `nuevoValor = 4`, calculado una vez.
2 mutaciones: `(9030001, 4, 5)` y `(9030002, 4, 0)`. Libreta: `contabilium 9` (avanza una vez),
`skus 9`, `escrito 4`. Log:
`  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 4 (escritas=2, ya_estaban=0)`.

## C — ventas individuales (R-4 c; ejemplo de CA-3)

| Campo | Valor (inventado) |
|---|---|
| Caché / `destinos[sku]` | `9030001` / `9030001` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / **`6`** |
| Contabilium | `9` |
| Respuesta | 5/6 (una venta online en V1) |

**Resultado exacto:** referencia `6 − (1 + 0) = 5`. Delta `−1`. `nuevoValor = 4` (nunca 5). 2
mutaciones: `(9030001, 4, 5)` y `(9030002, 4, 6)`. Ninguna mutación lleva el valor 5. Libreta:
`contabilium 9`, `escrito 4`. Log:
`  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 4 (escritas=2, ya_estaban=0)`.

## D — piso 0, con Contabilium sin cambios (R-4 c, R-13, R-14; ejemplo de CA-3)

| Campo | Valor (inventado) |
|---|---|
| Caché / `destinos[sku]` | `9030001` / `9030001` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / **`1`** |
| Contabilium | `10` (igual a `skus[sku]`: un SKU común caería en el atajo) |
| Respuesta | 0/0 (una venta online en cada variante) |

**Resultado exacto**

- Hay búsqueda exacta para el SKU (bypass de R-14). `saltado` no suma por este SKU.
- Referencia `max(0, 1 − (1 + 1)) = 0` (doble piso 0 de R-4: el piso por término no alcanza,
  el total también lleva piso). Delta 0. `nuevoValor = 0`.
- Ninguna mutación (las dos ya están en 0). Ninguna persistencia de `pendiente` (R-10 la exige solo
  si alguna variante difiere). Ninguna mutación ni valor negativo.
- No se emite ninguna línea `[UNIVERSAL]` (SKU sin cambios, R-8).
- Libreta: `escrito[sku] = 0` (R-13: resuelto con las N confirmadas porque ya lo tenían),
  `contabilium 10`, `skus 10`.
- `sin_cambios=1` por este SKU, `actualizado=0`, `universales=1` (R-8: cuenta el universal que
  ya tenía las N variantes en `nuevoValor`, aunque no emita `[UNIVERSAL]`).

## E — suba ignorada (R-4 c, R-14; ejemplo normativo de CA-3, Duda 7 del contrato)

| Campo | Valor (inventado) |
|---|---|
| Caché / `destinos[sku]` | `9030001` / `9030001` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / **`5`** |
| Contabilium | `10` (sin cambios) |
| Respuesta | **8**/5 (alguien repuso V1 a mano) |

**Resultado exacto**

- Hay búsqueda (bypass de R-14). Referencia
  `5 − (max(0, 5−8) + max(0, 5−5)) = 5`. Delta 0. `nuevoValor = 5`.
- `pendiente[sku] = {5, 10, desde 8/5}` persistido antes de mutar.
- Exactamente **1** mutación: `(9030001, 5, 8)`. V2 no recibe ninguna. Ninguna mutación lleva el
  valor 8, y 8 nunca se usa como referencia.
- Libreta: `escrito 5`, `contabilium 10`, `skus 10`, `pendiente` ninguna.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 5 (escritas=1, ya_estaban=1)`.
- `actualizado=1`, `universales=1`.

## F — par Galerías Pacífico, en la misma corrida que el DOT (R-5 "location del par"; resuelve N-4)

Pares y ids como en el `README.md`: Galerías con `locationId gid://shopify/Location/7100000001` y
depósito `7100001`, **inventados**. Los `inventoryItemId` son los mismos de la tabla (un inventory
item es global y su `available` es por location). Una sola caché y dos libretas.

**Estado inicial** (todo inventado)

| Campo | Libreta `dot` | Libreta `galerias-pacifico` |
|---|---|---|
| Caché `sku-map.json` (única) | `{sku: "gid://shopify/InventoryItem/9030001"}` | (la misma) |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` | `4` / `4` |
| `destinos[sku]` | `9030001` | `9030001` |
| `pendiente[sku]` | ninguna | ninguna |
| `escrito[sku]` | `5` | `2` |
| Contabilium del depósito del par | `10` | `3` |
| Respuesta de la búsqueda con el `locationId` del par | 5/5 | 2/**1** (una venta online de la S24 en Galerías) |

**Resultado exacto**

- Dos búsquedas `sku:"APPLYFIT-CLEAR-S24-S25"`, una con
  `locationId: gid://shopify/Location/83342655574` y otra con
  `locationId: gid://shopify/Location/7100000001`.
- DOT: referencia 5, delta 0 y `nuevoValor 5`. Ninguna mutación. La libreta `dot` queda igual
  (`escrito 5`, `contabilium 10`, sin `pendiente`).
- Galerías: referencia `2 − (0 + 1) = 1`. Delta `3 − 4 = −1`. `nuevoValor = 0`. Se persiste
  `pendiente` **en la libreta de Galerías** (`{0, 3, desde 2/1}`), nunca en la del DOT.
- Exactamente 2 mutaciones en toda la corrida: `(9030001, 0, 2, gid://shopify/Location/7100000001)`
  y `(9030002, 0, 1, gid://shopify/Location/7100000001)`. **Ninguna** mutación con
  `locationId gid://shopify/Location/83342655574`.
- Libreta `galerias-pacifico` final: `contabilium 3`, `skus 3`, `escrito 0`, `pendiente` ninguna.
- Log: exactamente **una** línea `[UNIVERSAL]` en la corrida,
  `  [UNIVERSAL] galerias-pacifico/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 0 (escritas=2, ya_estaban=0)`
  (prefijo `<par>/<sku>` de R-8, con el nombre del par que escribió). Ninguna línea
  `[UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25` (el DOT quedó sin cambios).
- `[RESUMEN] galerias-pacifico:` con `actualizado=1`, `universales=1` y
  `universales_pendientes=0`. `[RESUMEN] dot:` con `actualizado=0`, `sin_cambios=1`,
  `universales_pendientes=0` y `universales=1` (R-8: cuenta también el universal que ya estaba
  en `nuevoValor`).
- `destinos[sku]` queda en `9030001` (el `inventoryItemId` más chico de las 2, R-5) en las dos
  libretas.

## G — `destinos[sku]` se fija al número de gid más chico, no al string más chico (R-5)

R-5 ordena "comparando el numero del gid". Este escenario usa ids **inventados** de distinta
cantidad de dígitos, exclusivos de G, para que el orden numérico y el lexicográfico den distinto:

| Var. | `variantId` | `inventoryItemId` |
|---|---|---|
| W1 | `gid://shopify/ProductVariant/8031000` | `gid://shopify/InventoryItem/1000000` |
| W2 | `gid://shopify/ProductVariant/8031001` | `gid://shopify/InventoryItem/999999` |

Por número, 999999 < 1000000. Por string, `"…/1000000"` < `"…/999999"`.

**Corrida G1.** Caché y `destinos[sku]` en `gid://shopify/InventoryItem/999999`, baseline 10,
`skus` 10, sin `pendiente`, `escrito 5`, Contabilium 9. Respuesta en el orden **W1, W2**, ambas
en 5.

- Referencia 5, delta `−1`, `nuevoValor 4`. 2 mutaciones `(1000000, 4, 5)` y `(999999, 4, 5)`.
- Libreta: `contabilium 9`, `escrito 4`, `destinos[sku] = gid://shopify/InventoryItem/999999`
  (nunca `…/1000000`, que es la primera de la respuesta y la más chica como string).

**Corrida G2.** La libreta de G1, Contabilium 9, respuesta en el orden **W2, W1**, ambas en 4.

- Sin cambios: ninguna mutación, ninguna línea `[UNIVERSAL]`, ninguna siembra.
- `destinos[sku]` sigue en `gid://shopify/InventoryItem/999999`. `resembradoPor[sku]` no se
  escribe. `universales=1`, `sin_cambios=1`.
