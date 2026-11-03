# CA-1 — Lista curada de SKUs universales

Cubre: **R-1**.

Comando de referencia: `node --test test/skus-universales-lista.test.js`.

Datos: **reales**, del informe `docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md`, sección 3.A1
(líneas 145-212), copiados también, con su cantidad de variantes, en `.agents/.arn/feature.md:18-24`.

## Entrada

Ninguna entrada externa. El test importa la constante exportada. El implementador decide su
nombre y su módulo (el contrato sugiere `SKUS_UNIVERSALES` en `src/shopify.js`). R-1 exige que
sea "una constante exportada, auditable con un test" y que lleve **pares `{sku, variantes}`**, no
una lista de SKUs sola. Formas aceptadas:

- un iterable (`Array`, `Set`) de objetos con exactamente las claves `sku` y `variantes`, o
- un `Map` de `sku` a `variantes`.

Una lista plana de SKUs (strings sueltos, sin la cantidad) **no** cumple R-1 y el test falla.

## Resultado esperado exacto

### 1. Contenido exacto de los pares, con orden fijo y sin ambigüedad (resuelve N-1)

El test normaliza la constante a un array de objetos `{sku, variantes}` (con un `Map`,
`[...m].map(([sku, variantes]) => ({ sku, variantes }))`; con un iterable de objetos,
`[...c].map(({ sku, variantes }) => ({ sku, variantes }))`), **lo ordena por `sku` en orden de
código UTF-16** (`(a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)`, el mismo orden que
`sort()` sin comparador sobre los strings) y compara con `assert.deepStrictEqual` contra este
literal, que ya está en ese orden:

```js
[
  { sku: "APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E", variantes: 5 },
  { sku: "APPLYFIT-CLEAR-IP13PM-14PLUS", variantes: 2 },
  { sku: "APPLYFIT-CLEAR-IP15-16", variantes: 2 },
  { sku: "APPLYFIT-CLEAR-IP16PM-17PM", variantes: 2 },
  { sku: "APPLYFIT-CLEAR-IP16PRO-17-17PRO", variantes: 3 },
  { sku: "APPLYFIT-CLEAR-S24-S25", variantes: 2 },
  { sku: "APPLYFIT-CLEAR-S24PLUS-S25PLUS", variantes: 2 },
]
```

Es el mismo contenido de R-1, que lo enumera en otro orden (IP16PRO-17-17PRO 3, S24-S25 2,
IP15-16 2, IP13-13PRO-14-16E-17E 5, IP16PM-17PM 2, IP13PM-14PLUS 2, S24PLUS-S25PLUS 2). La
cantidad de cada par es la referencia fija del control de R-7 (ver
`escenarios-ca2-cinco-variantes.md`, F1 a F4).

Cómo se calculó ese orden: todos empiezan con `APPLYFIT-CLEAR-`, y después `I` (0x49) va antes
que `S` (0x53). En el primer carácter después de `APPLYFIT-CLEAR-IP1`, `3` (0x33) va antes que
`5` (0x35) y que `6` (0x36). Entre `IP13-` e `IP13P`, `-` (0x2D) va antes que `P`
(0x50). Entre `IP16PM` e `IP16PR`, `M` va antes que `R`. Entre `S24-` y `S24P`, `-` va antes que
`P`. Las mayúsculas, minúsculas y guiones se comparan tal cual: no se normaliza nada.

`deepStrictEqual` sobre el array ordenado ya garantiza a la vez el largo 7, que no haya pares de
más ni de menos, que no haya un SKU duplicado, que el texto de cada SKU sea exacto y que cada
`variantes` sea el **número** esperado (`deepStrictEqual` distingue `5` de `"5"`). Además, el test
verifica que la suma de `variantes` es **18**.

### 2. Control de "no es heurística" (resuelve N-2)

R-1 dice: "No es una heuristica (no se infiere de que el SKU nombre varios modelos)". El
control usa SKUs que una heurística **plausible** clasificaría como universales y que la lista
explícita deja afuera. El test verifica que **ninguno** aparece como `sku` de algún par de la
constante normalizada (`!pares.some((p) => p.sku === x)`):

| SKU de control | Origen | Heurística plausible que lo aceptaría |
|---|---|---|
| `APPLYFIT-CLEAR-IP18FOLD` | **real**, informe línea 297 (P3) | "empieza con `APPLYFIT-CLEAR-`" (los 7 universales empiezan así) |
| `APPLYFIT-CLEAR-IP17-17PRO` | **inventado** | "`APPLYFIT-CLEAR-` y nombra dos o más modelos separados por guion" |
| `APPLYFIT-CLEAR-S24` | **inventado**, prefijo estricto de dos universales | "es prefijo de un SKU de la lista" (coincidencia parcial tokenizada, invariante 3) |
| `IEY-COMBO-CARBON-VERDE-IP16E` | **real**, informe línea 224 (grupo A4) | "el mismo SKU exacto está en dos o más variantes de modelos de teléfono distintos" |

Con la lista explícita de la sección 1, los cuatro dan "no está". Las cuatro heurísticas de la
tabla habrían devuelto "sí" para al menos uno de ellos. El control conductual (que el sync no
trate como universal un SKU repetido no curado) está en `escenarios-ca4-no-regresion.md`
(escenarios A, B y C) y en `escenarios-ca9-ventas-individuales.md` (paso 5).

### 3. Discrepancia 19 contra 18 (informativa)

El pedido decía "19 variantes"; el informe suma 18 (3+2+2+5+2+2+2). El contrato adopta el
informe (`.agents/.arn/feature.md:26-27` y R-1): la suma de `variantes` de la constante tiene que
dar **18**, nunca 19.
