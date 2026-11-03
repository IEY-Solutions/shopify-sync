# CA-13 — Variante universal no activada en la location del par

Cubre: **R-18**, con sus **dos casos separados** (y R-5 "mismo contador de errores", R-10 "no se
persiste" y R-4 "null nunca participa").

Comando de referencia: `node --test test/sku-universal-no-activada.test.js`.

R-18 distingue dos casos que **no** se confunden con los caminos (a)/(b)/(c) de R-4:

| Caso de R-18 | Qué pasa en el catálogo | ¿Error? | Escenarios |
|---|---|---|---|
| **(b)** algunas null, otras activadas | catálogo inconsistente dentro del par | **sí**: `[ERROR]` por cada variante no activada, suma a `error` | B-1 a B-6 |
| **(a)** todas null | el SKU todavía no está activado en ese par | **no**: `no_activado` benigno, igual que hoy | A-1 a A-4 |

SKU: `APPLYFIT-CLEAR-IP16PM-17PM` (grupo A1, informe:187-194, 2 variantes esperadas según R-1).
Par: **Galerías Pacífico**, con los datos inventados del `README.md` (`nombre`
`galerias-pacifico`, `locationId gid://shopify/Location/7100000001`, depósito `7100001`), porque
es el par recién activado donde más se espera este caso (R-18). Tiene su propia libreta.

## Variantes (fijas para este archivo)

| Var. | Modelo (informe) | `variantId` | `inventoryItemId` | `sku` |
|---|---|---|---|---|
| V1 | iPhone 17 Pro Max (fila 19) | `gid://shopify/ProductVariant/8130001` | `gid://shopify/InventoryItem/9130001` | exacto |
| V2 | iPhone 16 Pro Max (fila 41) | `gid://shopify/ProductVariant/8130002` | `gid://shopify/InventoryItem/9130002` | exacto |

Los modelos son reales. Los ids, Contabilium, baseline y `available` son **inventados** (los
`available` del informe, 1/0, son de la location DOT y no se usan acá). "V2 con `available` null"
quiere decir que la respuesta inyectada trae el nodo de V2 sin nivel de inventario en la location
de Galerías: hoy eso es `no_activado` (`src/sync.js:1146-1148`).

**Contexto.** C0 del `README.md` (clasificador `ok`, ninguna línea acreditable, sin compuerta,
incremental). Mismo registro de eventos que CA-7: `guardar(libreta)` de la libreta de Galerías y
`mutar(…)`.

**Línea literal de R-18 para V2**, que esta evidencia llama **L18**:

```
  [ERROR] galerias-pacifico/APPLYFIT-CLEAR-IP16PM-17PM: variante gid://shopify/ProductVariant/8130002 no esta activada en la location del par, no se resuelve
```

**L18-V1** es la misma línea con `8130001` en lugar de `8130002`.

---

# Caso (b) de R-18 — algunas activadas y otras no: ERROR

## Resultado exacto común a B-1, B-2 y B-3 (salvo lo que cada uno agregue)

- **Cero** `mutar` para este SKU, ni en V2 ni en V1 (que sí está activada).
- **Cero** `guardar` que contenga `pendiente[sku]`: no se persiste entrada pendiente.
- La salida contiene **L18** exactamente una vez, y **no** contiene L18-V1 (una línea por
  variante **no** activada, nunca por las activadas). No contiene ninguna línea `[UNIVERSAL]` para
  el SKU, ni la línea `[SKIP] … el item no esta activado en esa location` de hoy.
- La libreta de Galerías queda, para este SKU, **idéntica** a la del inicio: `contabilium[sku]`,
  `skus[sku]`, `destinos[sku]` y `escrito[sku]` sin cambios.
- `[RESUMEN] galerias-pacifico`: `error=1` (el mismo contador de R-5), `no_activado=0`,
  `actualizado=0`, `universales=0`, `universales_pendientes=0`. El SKU no suma a `saltado` ni a
  `sin_cambios`.
- Ningún valor calculado es `NaN` ni negativo. El test lo verifica sobre la lista de mutaciones y
  sobre el plan de DRY_RUN de B-4: las dos quedan **vacías** para este SKU.

## B-1 — camino (a) de R-4, siembra: baseline `null`

| Campo | Valor |
|---|---|
| Caché | sin entrada |
| `contabilium[sku]` / `skus[sku]` | ausente / ausente |
| `destinos[sku]` / `escrito[sku]` / `pendiente[sku]` | ausente / ninguno / ninguna |
| Contabilium (depósito `7100001`) | `3` |
| Respuesta | V1 **`5`**, V2 **`null`**; `hasNextPage: false` |

Resultado: el común. En particular, ningún `mutar(9130001, 3, 5)`: la siembra de 3 en V1 sola no
ocurre. El baseline sigue ausente.

## B-2 — camino (b) de R-4, bootstrap: sin `escrito`

| Campo | Valor |
|---|---|
| Caché / `destinos[sku]` | `9130001` / `9130001` |
| `contabilium[sku]` / `skus[sku]` | `4` / `4` |
| `escrito[sku]` / `pendiente[sku]` | ninguno / ninguna |
| Contabilium | `3` |
| Respuesta | V1 **`5`**, V2 **`null`** |

Resultado: el común. `null` no entra al máximo: ningún `mutar` con `4` (`max(5) − 1`) ni con un
valor que provenga de tratar `null` como 0. La libreta sigue en `contabilium 4`, `skus 4`,
`destinos 9130001`.

## B-3 — camino (c) de R-4, normal: con `escrito`

| Campo | Valor |
|---|---|
| Caché / `destinos[sku]` | `9130001` / `9130001` |
| `contabilium[sku]` / `skus[sku]` | `4` / `4` |
| `escrito[sku]` | `5` |
| `pendiente[sku]` | ninguna |
| Contabilium | `3` |
| Respuesta | V1 **`5`**, V2 **`null`** (5/null) |

Resultado: el común. `null` no entra a la resta: tratado como 0 daría
`max(0, 5 − (0 + 5)) = 0` y `nuevoValor −1 → 0`, y tratado como `NaN` daría `NaN`. Ninguna de las
dos cosas ocurre, porque no se calcula `nuevoValor`. La libreta sigue en `contabilium 4`, `skus 4`,
`destinos 9130001`, `escrito 5`.

## B-4 — DRY_RUN del camino (c)

El estado de B-3, con `DRY_RUN=true`. Cero `guardar` y cero `mutar`. El plan de DRY_RUN
(`planDry` o equivalente) **no** tiene ninguna entrada para el SKU. La salida contiene L18 (y no
L18-V1) y no contiene `[UNIVERSAL] … (no se escribe, DRY_RUN=true)` ni `[DRY]` para el SKU.
`error=1`, `dry=0`.

## B-5 — caso (b) en una corrida posterior, con una entrada pendiente previa

| Campo | Valor |
|---|---|
| Caché / `destinos[sku]` | `9130001` / `9130001` |
| `contabilium[sku]` / `skus[sku]` | `4` / `4` |
| `escrito[sku]` | `5` |
| `pendiente[sku]` | `{nuevoValor: 4, contabiliumObjetivo: 3, variantes: [{8130001, 9130001, desde 5}, {8130002, 9130002, desde 5}]}`, sin marca |
| Contabilium | `3` |
| Respuesta | V1 **`4`** (ya en `nuevoValor`), V2 **`null`** |

**Resultado exacto**

- Cero mutaciones. La salida contiene L18 y no L18-V1.
- La entrada pendiente sigue **igual**, campo por campo, en todo `guardar` de esta corrida (si lo
  hay) y en disco al terminar. No se borra, aunque V1 ya esté en `nuevoValor`. No se reemplaza ni
  cambia su `desde`. R-18 no la toca.
- `contabilium 4`, `skus 4`, `escrito 5`, `destinos 9130001`.
- `error=1`, `universales=0`, `universales_pendientes=1`.
- Que además aparezca o no el `[ERROR]` de R-11(c) para V2 no lo fija el contrato (R-18 solo exige
  L18). El test no lo exige ni lo prohíbe.

## B-6 — control: el mismo SKU en el par DOT, todo activado, en la misma corrida

`correrTodosLosPares` con los dos pares. En Galerías, el estado de B-3 (5/null). En DOT, una
libreta propia con `contabilium 4`, `skus 4`, `escrito 5`, `destinos 9130001`, Contabilium del
depósito `127356` en `3` y respuesta **5/5** en la location DOT.

- Galerías: el resultado común de (b) (L18, cero mutaciones en `gid://shopify/Location/7100000001`,
  `error=1` en `[RESUMEN] galerias-pacifico`).
- DOT: camino (c), referencia 5, delta `−1`, `nuevoValor 4`, 2 mutaciones `(9130001, 4, 5, DOT)` y
  `(9130002, 4, 5, DOT)`, línea
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP16PM-17PM: 2 variantes -> 4 (escritas=2, ya_estaban=0)`, y en
  la libreta DOT `contabilium 3`, `escrito 4`.
- La variante no activada en un par no frena al otro par: cada par tiene su libreta y su location.
  El caso (b) en Galerías **sigue siendo error** (`error=1`) aunque el SKU se haya aplicado en
  DOT. Esta corrida no tiene compuerta, así que no hay ninguna "tolerancia entre pares" en juego:
  esa tolerancia existe **solo** dentro del reporte de la compuerta (`compuertaNoAplicadaEn`,
  `src/resultado.js:104-118`), y aun ahí no cubre el caso (b), porque un SKU en caso (b) no queda
  en `compuertaSkus.noActivados` (ver `escenarios-ca11-compuerta-absoluta.md` §5).

---

# Caso (a) de R-18 — todas las variantes null: benigno, `no_activado`

## Resultado exacto común a A-1 y A-2

- **Cero** `mutar` para este SKU y **cero** `guardar` que contenga `pendiente[sku]`. No se calcula
  `nuevoValor`.
- La salida **no** contiene L18 ni L18-V1, ni ninguna otra línea `[ERROR]` para el SKU, ni
  ninguna línea `[UNIVERSAL]`. La línea de hoy
  `  [SKIP] galerias-pacifico/APPLYFIT-CLEAR-IP16PM-17PM: el item no esta activado en esa location`
  (`src/sync.js:1147`) puede aparecer o no: el test no la exige ni la prohíbe.
- La libreta de Galerías queda, para este SKU, **idéntica** a la del inicio (baseline, `skus`,
  destino y `escrito` sin cambios).
- `[RESUMEN] galerias-pacifico`: `error=0` (**no** suma al contador de errores de R-5),
  `no_activado=1`, `actualizado=0`, `universales=0`, `universales_pendientes=0`.
- Veredicto del par: `no_activado` **no es error** (no suma a `error`), pero tampoco cuenta como
  "efectivo" para `evaluarCorrida` (`src/resultado.js:48-58`: efectivos = `actualizado` +
  `sin_cambios` + `dry` + `saltado`). Por eso, en A-1, A-2 y A-4, donde este es el **único** SKU de
  la corrida de Galerías, `detalle["galerias-pacifico"]` da **`ok: false`** con el motivo de
  corrida vacía (`la corrida no sincronizo ni verifico ningun SKU de 1. …`). Es la regla general
  de corrida vacía, la misma que hoy se aplica a un SKU **no** universal que termina `no_activado`
  como único SKU; no viene de R-18 ni de ningún `[ERROR]` de esta feature, y R-18 no la cambia. El
  test lo compara contra ese control no universal: el universal da el mismo `detalle` (mismo `ok`
  y mismo motivo), y no agrega ningún `[ERROR]` ni contador de error que el control no tenga.
- **No** hay acá ninguna tolerancia "aplicado en otro par": esa tolerancia vive **solo** en el
  reporte de la compuerta (`compuertaNoAplicadaEn`, `src/resultado.js:104-118`) y solo decide
  `compuertaNoAplicados`; nunca cambia `detalle[par].ok` (`src/resultado.js:86-89`). Fuera de la
  compuerta, `no_activado` simplemente no es error, y el par queda en verde o en rojo según la
  regla general de `evaluarCorrida` (ver A-3.1, donde el par queda en verde por **otro** SKU).

## A-1 — las dos null, camino (c) de R-4

El estado de B-3 (`contabilium 4`, `skus 4`, `escrito 5`, `destinos 9130001`, Contabilium `3`),
con respuesta **null/null**.

Resultado: el común de (a). La libreta sigue en `contabilium 4`, `skus 4`, `escrito 5`,
`destinos 9130001`.

## A-2 — las dos null en los otros caminos de R-4

- **A-2.1** — el estado de B-1 (baseline ausente, Contabilium `3`), respuesta null/null.
  Resultado: el común de (a). Ningún `mutar` con 3 (ninguna siembra). El baseline sigue ausente.
- **A-2.2** — el estado de B-2 (baseline 4, sin `escrito`, Contabilium `3`), respuesta
  null/null. Resultado: el común de (a). La libreta sigue en `contabilium 4`, `skus 4`,
  `destinos 9130001`.

## A-3 — el mismo SKU aplicado en el otro par en la misma corrida

`correrTodosLosPares` con los dos pares. En Galerías, el estado de A-1 (null/null). En DOT, el
estado y la respuesta de B-6 (5/5 en la location DOT, Contabilium `3`).

**SKU de control en Galerías (S2), solo en A-3.** Para que la corrida de Galerías no sea una
corrida vacía, Galerías tiene además un **segundo** SKU, no curado: `FUNDA-MAGSAFE-MATE-IPHONE16`
(ids inventados `gid://shopify/ProductVariant/8090001` / `gid://shopify/InventoryItem/9090001`,
como en `escenarios-ca9-ventas-individuales.md`). En la libreta de Galerías: `contabilium 6`,
`skus 6`, `destinos 9090001`. Contabilium del depósito `7100001` para S2: `6` (igual al
baseline). C0 (incremental, crédito 0), así que S2 toma el atajo del incremental
(`src/sync.js:1087-1091`): **ninguna** búsqueda en Shopify ni `mutar` para S2, y suma
`saltado=1` y `sin_cambios=1`. La libreta de Galerías queda, para S2, sin cambios.

**A-3.1 — sin compuerta.**

- Galerías, universal: el común de (a), sin L18, `error=0`, `no_activado=1`.
- Galerías, S2: `sin_cambios` por el atajo, como arriba.
- `[RESUMEN] galerias-pacifico`: `error=0`, `no_activado=1`, `sin_cambios=1`, `saltado=1`,
  `actualizado=0`, `universales=0`, `universales_pendientes=0`.
- DOT: lo de B-6 (2 mutaciones con 4, `[UNIVERSAL] dot/… -> 4 (escritas=2, ya_estaban=0)`).
- Veredicto: `detalle["galerias-pacifico"].ok = true`, `detalle.dot.ok = true` y `ok: true`.
- **Por qué Galerías queda en verde:** por S2, que es un SKU efectivo (`src/resultado.js:50-52`),
  y porque el universal `no_activado` no suma a `error`. **No** porque `no_activado` se "tolere"
  por haberse aplicado en DOT: sin compuerta no existe ninguna tolerancia entre pares. Sin S2,
  Galerías daría `ok: false` por corrida vacía (lo del común de (a)), aunque el SKU se haya
  aplicado en DOT, exactamente igual que hoy con un SKU no universal; R-18 no cambia eso.

**A-3.2 — con la compuerta sobre el SKU** (`escrituraAbsoluta = new Set(["APPLYFIT-CLEAR-IP16PM-17PM"])`).

- DOT: absoluto `Math.round(3) = 3` en las 2 variantes, mutaciones `(9130001, 3, 5, DOT)` y
  `(9130002, 3, 5, DOT)`; compuerta aplicada en DOT.
- Galerías: el común de (a) para el universal; el SKU está en `compuertaSkus.noActivados` y no en
  `aplicados`. S2 (fuera de la compuerta) igual que en A-3.1: `sin_cambios` por el atajo.
- Veredicto: `compuertaNoAplicados = []`, la salida **no** contiene `[COMPUERTA][ERROR]`. **Esta**
  es la tolerancia "aplicado en otro par", y es **solo** de la compuerta: `compuertaNoAplicadaEn`
  (`src/resultado.js:104-118`) no pone el SKU en `compuertaNoAplicados` porque se aplicó en DOT y
  en Galerías quedó en `noActivados`, sin alertar por Galerías.
- Esa tolerancia decide solo `compuertaNoAplicados`; `detalle["galerias-pacifico"].ok` sigue la
  regla general de `evaluarCorrida` y da `true` por S2, igual que en A-3.1. El veredicto global da
  `ok: true`.
- Si la corrida de la compuerta tuviera **solo** el par Galerías, el SKU no se habría aplicado en
  ningún par y la lógica existente lo dejaría "no aplicado", igual que a un no universal
  `no_activado` en la misma situación. R-18 no cambia ese mecanismo; el caso con un solo par lo
  verifica `escenarios-ca11-compuerta-absoluta.md` 5b-ii.

## A-4 — caso (a) en una corrida posterior, con una entrada pendiente previa

| Campo | Valor |
|---|---|
| Caché / `destinos[sku]` | `9130001` / `9130001` |
| `contabilium[sku]` / `skus[sku]` | `4` / `4` |
| `escrito[sku]` | `5` |
| `pendiente[sku]` | `{nuevoValor: 4, contabiliumObjetivo: 3, variantes: [{8130001, 9130001, desde 5}, {8130002, 9130002, desde 5}]}`, sin marca (la misma de B-5) |
| Contabilium | `3` |
| Respuesta | V1 **`null`**, V2 **`null`** (las dos sin activar) |

**Resultado exacto**

- El común de (a): cero mutaciones, ninguna L18 ni L18-V1, ninguna otra `[ERROR]` para el SKU,
  ninguna `[UNIVERSAL]`, `error=0`, `no_activado=1`.
- La entrada pendiente sigue **igual**, campo por campo, en todo `guardar` de esta corrida (si lo
  hay) y en disco al terminar: no se borra, no se descarta, no se reemplaza y no cambia ningún
  `desde`. Espera a que las variantes se reactiven (R-18: "si todas las variantes vuelven a
  aparecer null mientras hay un pendiente, el pendiente no se toca ni se descarta"). Es el mismo
  tratamiento que B-5 en el caso (b).
- `contabilium 4`, `skus 4`, `escrito 5`, `destinos 9130001`.
- `universales_pendientes=1` (en lugar del `0` del común de (a)): R-8 lo define como la cantidad
  de SKUs universales con entrada pendiente en la libreta **al terminar la corrida**, y A-4
  conserva la entrada intacta. Es lo mismo que fija B-5. `universales=0`.

**A-4′ — la corrida siguiente, con las variantes reactivadas.** Sobre el disco de A-4, Contabilium
`3`, respuesta **4/5**. R-11 retoma la entrada con sus propios valores (`nuevoValor 4`, `desde 5`):
V1 ya está en `nuevoValor` y no se muta; V2 sigue en su `desde` y recibe exactamente
`(9130002, 4, 5)`. Ninguna mutación con otro valor. Último `guardar`: `pendiente[sku]` ausente,
`contabilium 3`, `skus 3`, `escrito 4` (como CA-7 §3). Log:
`  [UNIVERSAL] galerias-pacifico/APPLYFIT-CLEAR-IP16PM-17PM: 2 variantes -> 4 (escritas=1, ya_estaban=1) [reintento]`.
Esto confirma que la entrada sobrevivió intacta a A-4 y que R-18 no
la alteró.
