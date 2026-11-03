# CA-2 — SKU universal de 5 variantes (caso real)

Cubre: **R-2, R-3, R-4, R-5, R-7, R-9, R-13**.

Comando de referencia: `node --test test/sku-universal-5-variantes.test.js`.

SKU: `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E` (grupo A1, informe
`docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md:175-185`). Par: `dot`
(`gid://shopify/Location/83342655574`). Contexto común **C0** del `README.md` en todos los
escenarios: clasificador `ok`, sin líneas acreditables ni notas de crédito para el SKU
(`credito 0`), compuerta que no lo alcanza, incremental, `DRY_RUN=false`.

## Variantes (fijas para todo el archivo y para CA-5, CA-7 y CA-9)

| Var. | Modelo (informe) | `variantId` | `inventoryItemId` | `sku` |
|---|---|---|---|---|
| V1 | iPhone 17e (fila 17) | `gid://shopify/ProductVariant/8010001` | `gid://shopify/InventoryItem/9010001` | exacto |
| V2 | iPhone 13 (fila 29) | `gid://shopify/ProductVariant/8010002` | `gid://shopify/InventoryItem/9010002` | exacto |
| V3 | iPhone 13 Pro (fila 30) | `gid://shopify/ProductVariant/8010003` | `gid://shopify/InventoryItem/9010003` | exacto |
| V4 | iPhone 14 (fila 32) | `gid://shopify/ProductVariant/8010004` | `gid://shopify/InventoryItem/9010004` | exacto |
| V5 | iPhone 16e (fila 42) | `gid://shopify/ProductVariant/8010005` | `gid://shopify/InventoryItem/9010005` | exacto |
| P1…P7 | (inventados) | `gid://shopify/ProductVariant/801990k` | `gid://shopify/InventoryItem/901990k` | `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E-Pk` (prefijo-largo) |

`k` va de 1 a 7. Los `available` de P1…P7 son siempre `3`. Los modelos son reales; los ids son
inventados.

---

## A — iguales, bootstrap, con un candidato prefijo-largo (R-2, R-3, R-4 b, R-5, R-9)

**Estado inicial** (datos inventados)

| Campo | Valor |
|---|---|
| Caché `sku-map.json` | `{"APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E": "gid://shopify/InventoryItem/9010001"}` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `destinos[sku]` | `gid://shopify/InventoryItem/9010001` |
| `pendiente[sku]` | ninguna |
| `escrito[sku]` | ninguno |
| Contabilium en esta corrida | `13` |
| Respuesta de la búsqueda | V1…V5 con `available` 5/5/5/5/5, y **P1** con `available` 3; `hasNextPage: false` |

**Resultado exacto**

- Una sola búsqueda, con `query: 'sku:"APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E"'`, `first: 10` y el
  `locationId` DOT.
- N = **5**. P1 (`node.sku` = `…-17E-P1`) **no** es candidata (coincidencia exacta, invariante 3,
  resuelve I-3).
- Camino (b), bootstrap: sin `escrito` y las 5 iguales, así que la referencia es 5. Delta
  `13 − 10 = 3`. `nuevoValor = Math.round(5 + 3) = 8`, calculado una vez.
- Antes de la primera mutación, la libreta persistida tiene `pendiente[sku] = {nuevoValor: 8,
  contabiliumObjetivo: 13, variantes: [V1…V5, cada una con desde 5]}` (R-10; el orden se prueba
  en CA-7).
- Exactamente **5 mutaciones**: `(9010001, 8, 5, DOT)`, `(9010002, 8, 5, DOT)`,
  `(9010003, 8, 5, DOT)`, `(9010004, 8, 5, DOT)` y `(9010005, 8, 5, DOT)`. **Ninguna** sobre
  `gid://shopify/InventoryItem/9019901` (P1) ni en otra location.
- Libreta persistida al final: `contabilium[sku] = 13` (un solo valor por SKU, ninguna clave por
  variante), `skus[sku] = 13`, `escrito[sku] = 8`, `pendiente[sku]` ninguna y `destinos[sku] =
  gid://shopify/InventoryItem/9010001`, el `inventoryItemId` **más chico** de las 5 (R-5; el
  orden de respuesta no importa, ver G). La caché, si se reescribe, también queda en `9010001`.
  Nunca apunta a `9019901` (P1).
- No hay siembra por cambio de destino: `resembradoPor[sku]` no se escribe en esta corrida.
- Log: contiene, caracter a caracter, la línea
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 (escritas=5, ya_estaban=0)`.
  No contiene ninguna línea `[AVISO]` para el SKU.
- `[RESUMEN] dot`: `actualizado=1`, `error=0`, `universales=1`, `universales_pendientes=0`,
  `duplicados=0`, `cache_invalidada=0`.

## A' — iguales, camino normal (R-4 c)

Igual que A, salvo `escrito[sku] = 5`. Referencia `5 − (0+0+0+0+0) = 5`. Mismo resultado exacto
que A (`nuevoValor` 8, las mismas 5 mutaciones, `escrito` 8, la misma línea `[UNIVERSAL]`). Prueba
que con las variantes iguales los caminos (b) y (c) coinciden.

## B — bootstrap divergente, caso real del informe (R-4 b, R-5)

**Estado inicial.** Los `available` son **reales** (informe:179-183). Contabilium y el baseline
son **inventados**.

| Campo | Valor |
|---|---|
| Caché `sku-map.json` | `{sku: "gid://shopify/InventoryItem/9010001"}` (la 17e, la establecida histórica, `verificar-cache-sku`:25-28) |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `destinos[sku]` | `gid://shopify/InventoryItem/9010001` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / ninguno |
| Contabilium en esta corrida | `9` |
| Respuesta | V1…V5 con 7/0/0/0/0, `hasNextPage: false` |

**Resultado exacto**

- Camino (b): las 5 divergen, así que la referencia es `max(7,0,0,0,0) = 7`. Delta `9 − 10 = −1`.
  `nuevoValor = 6`, calculado una vez.
- `pendiente[sku] = {6, 9, desde 7/0/0/0/0}` persistido antes de mutar.
- 5 mutaciones: `(9010001, 6, 7)` y `(9010002…9010005, 6, 0)`, todas en DOT. El
  `changeFromQuantity` es el `available` de **cada** variante, no el máximo.
- Libreta final: `contabilium 9`, `skus 9`, `escrito 6`, `pendiente` ninguna.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 6 (escritas=5, ya_estaban=0)`.
- `universales=1`, `duplicados=0`, `actualizado=1`.

## C — siembra con un valor decimal de Contabilium (R-4 a, R-9 enteros)

**Estado inicial.** Los `available` son **reales** (informe:179-183). Contabilium es
**inventado**.

| Campo | Valor |
|---|---|
| Caché `sku-map.json` | `{sku: "gid://shopify/InventoryItem/9010001"}` |
| `contabilium[sku]` / `skus[sku]` | ausente / ausente (baseline `null`) |
| `destinos[sku]` | ausente |
| `pendiente[sku]` / `escrito[sku]` | ninguna / ninguno |
| Contabilium en esta corrida | **`8.6`** (decimal; resuelve I-4) |
| Respuesta | V1…V5 con 7/0/0/0/0 |

**Resultado exacto**

- Camino (a): `nuevoValor = Math.round(8.6) = 9`. No se usan los `available` (ni máximo ni
  `escrito`).
- `pendiente[sku] = {9, 8.6, desde 7/0/0/0/0}` persistido antes de mutar.
- 5 mutaciones con valor **9** (entero): `(9010001, 9, 7)` y `(9010002…9010005, 9, 0)`. Ninguna
  mutación lleva `8.6` ni `8`.
- Libreta final: `contabilium[sku] = 8.6` (el valor crudo de Contabilium, como hoy en
  `src/sync.js:1211`), `skus[sku] = 8.6`, `escrito[sku] = 9` (entero) y
  `resembradoPor[sku] = "sembrado"`, como cualquier siembra de hoy.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 9 (escritas=5, ya_estaban=0)`.

## D — ventas individuales, camino normal (ejemplo normativo de R-4 y CA-2)

**Estado inicial** (inventado; es el ejemplo del contrato)

| Campo | Valor |
|---|---|
| Caché / `destinos[sku]` | `9010001` / `9010001` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / **`5`** |
| Contabilium en esta corrida | `9` (venta de mostrador) |
| Respuesta | 5/5/5/**4**/5: una venta online en la IP14 (V4). El contrato la escribe "4/5/5/5/5" porque lista la IP14 primero. |

**Resultado exacto**

- Camino (c): referencia `5 − (0+0+0+1+0) = 4`. Delta `−1`. `nuevoValor = 3`.
- 5 mutaciones con valor 3: `(9010001, 3, 5)`, `(9010002, 3, 5)`, `(9010003, 3, 5)`,
  `(9010004, 3, 4)` y `(9010005, 3, 5)`. **Ninguna** mutación lleva el valor 4, que es lo que daría
  el máximo y re-inflaría la venta online.
- Libreta final: `contabilium 9`, `skus 9`, `escrito 3`, `pendiente` ninguna.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 3 (escritas=5, ya_estaban=0)`.

## D2 — dos ventas online en variantes distintas

Igual que D, salvo la respuesta **4/4/5/5/5**. Referencia `5 − 2 = 3`, delta `−1` y
`nuevoValor = 2`. 5 mutaciones con valor 2 (`changeFromQuantity` 4, 4, 5, 5 y 5). Libreta final:
`contabilium 9`, `escrito 2`. Log:
`  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 2 (escritas=5, ya_estaban=0)`.

## E — una de las 5 mutaciones falla (R-5; el reintento está en CA-7)

**Estado inicial** (inventado; es el ejemplo normativo de R-11 y CA-7)

| Campo | Valor |
|---|---|
| Caché / `destinos[sku]` | `9010001` / `9010001` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / ninguno |
| Contabilium | `13` |
| Respuesta | 5/5/5/5/5 |
| Falla inyectada | la mutación de **V3** (`9010003`) rechaza (error de Shopify) |

**Resultado exacto**

- `nuevoValor = 8`. `pendiente[sku] = {8, 13, desde 5/5/5/5/5}` persistido **antes** de mutar.
- Se intentan las 5 mutaciones. Tienen éxito `(9010001, 8, 5)`, `(9010002, 8, 5)`,
  `(9010004, 8, 5)` y `(9010005, 8, 5)`. La de `9010003` falla. Ninguna mutación revierte a 5 las
  que ya quedaron en 8.
- Libreta persistida al final: `pendiente[sku] = {8, 13, desde 5/5/5/5/5}` **intacta**,
  `contabilium[sku] = 10` y `skus[sku] = 10` sin avanzar, `destinos[sku] = 9010001` sin cambios y
  `escrito[sku]` ninguno.
- Log: exactamente **una** línea que empieza con
  `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: `, por V3 (el contrato no fija el resto del
  texto; sirve el existente `fallo al escribir en Shopify -> <mensaje>`, `src/sync.js:1177`), y la
  línea `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 PENDIENTE (escritas=4, ya_estaban=0, fallidas=1)`.
- `[RESUMEN] dot` (resuelve N-3): `error=1`, `actualizado=0`, `sin_cambios=0`, `dry=0`,
  `universales=0`, **`universales_pendientes=1`**, `duplicados=0`.
- Código de salida (R-5, invariante 5): el SKU suma 1 al **mismo** contador `error` que usa
  cualquier fallo de escritura, y entra en `evaluarCorrida` como cualquier otro error. No hay un
  camino de salida ni un umbral nuevos: el test compara el veredicto de `evaluarCorrida` para
  este `[RESUMEN]` con el que da hoy para un `error=1` de un SKU común con el mismo `total`.

## F — conteo contra la cantidad ESPERADA de la lista curada (R-7, R-1)

La referencia del control es el número fijo del par de la lista curada para este SKU: **5**
(`escenarios-ca1-lista-curada.md` §1). No se deriva en tiempo de ejecución: la caché,
`destinos[sku]` y `pendiente[sku]` no intervienen en el conteo. Para probarlo, en F1, F3 y F4 la
variante de la caché y de `destinos` (V1) **sí** aparece entre las visibles: una regla basada en
"variantes conocidas" no daría error, y R-7 sí.

**Estado inicial común de F1 a F4** (inventado)

| Campo | Valor |
|---|---|
| Caché / `destinos[sku]` | `9010001` / `9010001` (V1) |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / `5` |
| Contabilium | `13` |

**Resultado exacto común a F1, F3 y F4 (error)**

- Cero persistencias de `pendiente`. Cero mutaciones de este SKU (en ninguna variante, tampoco en
  las exactas visibles).
- Log: una línea que empieza con `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: ` (el
  contrato no fija el resto del texto). No hay línea `[UNIVERSAL]`, porque no se calculó `<V>`.
- El SKU no queda resuelto. La caché queda intacta. Libreta: `contabilium 10`, `skus 10`,
  `destinos 9010001`, `escrito 5`, sin `pendiente`.
- `error=1`, `universales=0`, `universales_pendientes=0`, `cache_invalidada=0`, `duplicados=0`.

### F1 — tope alcanzado con menos de las esperadas: error (R-7 b; resuelve I-1)

Respuesta: 10 candidatos, **V1, V2 y V3** (exactos, `available` 5) y P1…P7 (prefijo-largo), con
**`hasNextPage: true`**. V4 y V5 no aparecen. 3 exactas, 5 esperadas: error.

### F2 — tope alcanzado con las 5 esperadas: no es error (R-7, R-2)

Mismo estado inicial, respuesta: 10 candidatos, **V1…V5** (exactos, 5/5/5/5/5) y P1…P5, con
**`hasNextPage: true`**.

- 5 exactas = 5 esperadas: se procesa normal. Camino (c): referencia `5 − 0 = 5`, delta `+3` y
  `nuevoValor = 8`.
- 5 mutaciones `(9010001…9010005, 8, 5)`. Ninguna sobre P1…P5 (`9019901…9019905`).
- Libreta: `contabilium 13`, `skus 13`, `escrito 8`, `pendiente` ninguna, `destinos 9010001`.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 (escritas=5, ya_estaban=0)`.
  `error=0`, `universales=1`.

### F3 — sin tope, 4 exactas: error (R-7 a, falta una)

Respuesta: **V1…V4** (exactos, 5/5/5/5), `hasNextPage: false`. V5 no aparece. 4 exactas, 5
esperadas: error. En particular, no se escribe 8 en V1…V4.

### F4 — sin tope, 6 exactas: error (R-7 a, sobra una)

Respuesta: **V1…V5** (5/5/5/5/5) más **V6** (`gid://shopify/ProductVariant/8010006`,
`gid://shopify/InventoryItem/9010006`, sku exacto, `available` 5), `hasNextPage: false`. 6
exactas, 5 esperadas: error. En particular, no se escribe 8 en ninguna de las 6.

## G — orden de respuesta no estable: `destinos[sku]` queda igual y no hay siembra (R-5)

Dos corridas encadenadas sobre la misma libreta, con el **mismo conjunto** V1…V5 devuelto en dos
órdenes distintos (simula que la API no garantiza orden estable). Datos inventados.

**Corrida G1.** Estado inicial: caché y `destinos[sku]` en `9010001`, baseline 10, `skus` 10,
sin `pendiente`, `escrito 5`, Contabilium 13. Respuesta en el orden **V3, V1, V5, V2, V4**, todas
en 5, `hasNextPage: false`.

- Camino (c): referencia 5, delta `+3`, `nuevoValor 8`. 5 mutaciones `(9010001…9010005, 8, 5)`.
- Libreta: `contabilium 13`, `skus 13`, `escrito 8`, `destinos[sku] = 9010001` (el más chico, no
  `9010003`, que fue la primera de la respuesta).

**Corrida G2.** Estado inicial: la libreta de G1. Contabilium **12**. Respuesta en el orden
**V5, V4, V3, V2, V1**, todas en 8.

- `destinos[sku]` sigue siendo uno de los visibles y el mismo de G1, así que **no** hay cambio de
  destino (`verificar-cache-sku` R-4) ni siembra: camino (c), referencia 8, delta `12 − 13 = −1`,
  `nuevoValor 7`.
- 5 mutaciones `(9010001…9010005, 7, 8)`. **Ninguna** con el valor 12 (el absoluto que escribiría
  una siembra).
- Libreta: `contabilium 12`, `skus 12`, `escrito 7`, `destinos[sku] = 9010001` (idéntico a G1, no
  `9010005`). `resembradoPor[sku]` no se escribe en ninguna de las dos corridas.
- `cache_invalidada=0` en las dos corridas.

## H — crédito acreditable: se suma una sola vez en el cálculo único (R-3)

Igual que A', salvo el contexto C0: el registro de comprobantes inyectado trae, para este SKU y el
depósito del par, líneas Shopify acreditables por un total de **2** unidades, de modo que
`creditoAcreditable` da `credito 2` (datos inventados).

- Camino (c): referencia 5, delta `+3`. `nuevoValor = Math.round(5 + 3 + 2) = 10`, calculado una
  vez.
- 5 mutaciones `(9010001…9010005, 10, 5)`. **Ninguna** con el valor 18 (`5 + 3 + 2×5`, crédito
  sumado por variante) ni 8 (crédito perdido).
- Libreta: `contabilium 13`, `escrito 10`. Las claves de consumo de esas líneas quedan registradas
  una sola vez.
- `[RESUMEN] dot:` `causa_venta_shopify=2` (no 10), `universales=1`.

## I — destino heredado que no es el más chico: se actualiza sin siembra (R-4, R-5)

Cubre la frase final de R-4 y la Duda 9 del contrato: para los 7 SKUs curados, el chequeo
genérico de `cambioDeDestino` (`verificar-cache-sku` R-4; hoy `src/sync.js:1134-1138` y `:1151`)
**no aplica**. La única condición de siembra es baseline `null` (camino a). Pasar `destinos[sku]`
de un valor heredado al `inventoryItemId` más chico no siembra por sí solo. Datos inventados.

**Estado inicial**

| Campo | Valor |
|---|---|
| Caché `sku-map.json` | `{"APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E": "gid://shopify/InventoryItem/9010004"}` (V4, la variante "establecida" del comportamiento viejo) |
| `destinos[sku]` | **`gid://shopify/InventoryItem/9010004`** (V4), heredado de antes de esta feature. **No** es el más chico (`9010001`) |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` (baseline **no** `null`) |
| `resembradoPor[sku]` / `resembradoEn[sku]` | ausente / ausente |
| `pendiente[sku]` | ninguna |
| `escrito[sku]` | **`5`** |
| Contabilium en esta corrida | **`9`** (una venta de mostrador) |
| Respuesta | V1…V5, **todas en 5** (sin ventas online, para aislar el efecto del destino), en el orden **V4, V1, V2, V3, V5** (la heredada primero), `hasNextPage: false` |

**Resultado exacto**

- N = 5 = esperadas. Hay pendiente `ninguna` y baseline `10`, así que **no** es el camino (a).
  Con `escrito 5`, es el camino (c): `shopifyActual = max(0, 5 − (0+0+0+0+0)) = 5`.
- Delta `9 − 10 = −1`. `nuevoValor = Math.round(5 + (−1)) = 4`, calculado una vez.
- **No hay siembra.** Ninguna mutación lleva el valor **9** (el absoluto de Contabilium, que es lo
  que escribiría el chequeo genérico de `cambioDeDestino` al ver `destinos[sku] = 9010004` contra
  el destino nuevo `9010001`).
- Antes de la primera mutación, la libreta persistida tiene `pendiente[sku] = {nuevoValor: 4,
  contabiliumObjetivo: 9, variantes: [V1…V5, cada una con desde 5]}` (R-10).
- Exactamente **5 mutaciones**: `(9010001, 4, 5, DOT)`, `(9010002, 4, 5, DOT)`,
  `(9010003, 4, 5, DOT)`, `(9010004, 4, 5, DOT)` y `(9010005, 4, 5, DOT)`.
- Libreta persistida al final: `contabilium[sku] = 9`, `skus[sku] = 9`, `escrito[sku] = 4`,
  `pendiente[sku]` ninguna y **`destinos[sku] = gid://shopify/InventoryItem/9010001`** (el más
  chico, distinto del heredado `9010004` y distinto de la primera de la respuesta).
- `resembradoPor[sku]` y `resembradoEn[sku]` siguen **ausentes**: la corrida no registra ninguna
  siembra ni absoluto para el SKU.
- Caché: R-5 deja que se reescriba o no. Los dos únicos valores válidos al final son `9010004`
  (sin reescribir) o `9010001` (reescrita al más chico). Cualquier otro valor es falla. En
  ninguno de los dos casos cuenta como invalidación.
- Log: contiene, caracter a caracter,
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 4 (escritas=5, ya_estaban=0)`.
  No contiene ninguna línea `[AVISO]` ni `[ERROR]` para el SKU.
- `[RESUMEN] dot`: `actualizado=1`, `error=0`, `universales=1`, `universales_pendientes=0`,
  `duplicados=0` y **`cache_invalidada=0`**. Hoy, un `cambioDeDestino` suma 1 a
  `cache_invalidada` (`src/sync.js:1138`, `:1190`). Que quede en 0 es la señal observable de que
  el chequeo no se disparó.

### I' — el mismo destino heredado en la primera corrida tras desplegar (sin `escrito`)

Igual que I, salvo `escrito[sku]` **ninguno**: es la primera corrida real tras desplegar la
feature, y la libreta todavía no tiene `escrito`. Camino (b): las 5 iguales, así que la referencia
es 5. Delta `−1`, `nuevoValor 4`. El resultado exacto es el de I: las mismas 5 mutaciones con valor
4, ninguna con 9, `destinos[sku] = 9010001`, `escrito[sku] = 4`, `resembradoPor`/`resembradoEn`
ausentes, la misma línea `[UNIVERSAL]` y `cache_invalidada=0`.
