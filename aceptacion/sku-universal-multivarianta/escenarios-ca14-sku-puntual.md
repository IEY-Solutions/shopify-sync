# CA-14 — Corrida de un SKU puntual (`--sku`): mismo camino universal

Cubre: **R-19, R-2** (incluido el control de caché del hallazgo IM-1), **R-1** (coincidencia
exacta; control NO-2 de prefijo o extensión), y **R-11, R-17, R-18** por `--sku`, con el código
de salida de cada caso. También R-6 por `--sku`.

Comando de referencia: `node --test test/sku-universal-sku-puntual.test.js`.

**Punto de entrada.** `syncUnSku(sku, null, deps)` (`src/sync.js:440`), que es lo que corre
`node src/index.js --sku <SKU>` (`src/main.js:115-117`). Todas las dependencias van inyectadas
(`deps`): `getStockDeposito` (Contabilium del depósito DOT `127356`, un `Map`), `resolverSku` o la
consulta `QUERY_POR_SKU` debajo, `setearStock`, `cargarLibretaCompleta`, `guardarSnapshot`,
`rutaSnapshotPara` (siempre `"dot"`, `src/sync.js:471`), `esDryRun` y `ahora`. La caché se inyecta
con su ruta (`opciones.rutaCache`, como en el resto de la carpeta). `SHOPIFY_DOT_LOCATION_ID` es
`gid://shopify/Location/83342655574`. Sin red. Mismo **registro de eventos** que CA-7
(`guardar`, `mutar`).

**Par y prefijo.** `--sku` siempre usa la libreta del par `dot`. Para un SKU universal, las líneas
de R-8 llevan el prefijo `dot/<sku>` (R-19: "las líneas de log de R-8"). Para un SKU **no**
universal, `--sku` mantiene **hoy** los textos sin prefijo de par (`src/sync.js:343`, `:363`,
`:417`), y R-19 dice que sigue "exactamente igual que hoy".

**Lo que `--sku` no tiene.** No imprime `[RESUMEN]` (los contadores `universales` y
`universales_pendientes` no aplican). No tiene atajo del incremental (siempre consulta Shopify,
así que R-14 no agrega nada). Hoy no consulta comprobantes (crédito 0) ni recibe la compuerta
`ESCRITURA_ABSOLUTA` (`src/main.js:117`). Ver Dudas.

**Código de salida: mecanismo real (R-19).** No hay ningún flag nuevo. El comando real en modo
escritura es

```
DRY_RUN=false node src/index.js --sku <sku>
```

con la variable de entorno `DRY_RUN=false` (`src/sync.js:38`). `src/argv.js` no acepta ningún
flag de dry-run en la línea de comandos: un flag inventado daría error de uso, no una corrida.
Hoy el modo `sku` de `main()` hace `await d.syncUnSku(modo.sku, modo.qty); return 0`
(`src/main.js:117-118`) y solo devuelve **1** si `syncUnSku` lanza, en el `catch` existente que
imprime `[FATAL] <mensaje>` (`src/main.js:119-121`). Por R-19, cuando el SKU pedido está en la
lista curada y **no** queda resuelto en esa corrida (fallo de escritura de R-5, entrada
pendiente trabada de R-11/R-17, o variante no activada caso (b) de R-18), `syncUnSku`/`procesarSku`
**lanzan** una excepción; esa excepción llega a ese `catch` y `main()` devuelve 1. Cuando el SKU
curado sí se resuelve (incluido el caso (a) benigno de R-18), no lanza y `main()` devuelve 0.
`main.js` no cambia para el resto de los SKUs.

**Cómo lo mide el test.** Llama a `main(argv, env, deps)` con el argv equivalente a
`--sku <sku>`, `env` con `DRY_RUN: "false"`, y `deps.syncUnSku = (sku, qty) => syncUnSku(sku, qty, d)`,
donde `d` son las dependencias inyectadas de arriba (con `esDryRun` devolviendo `false`, lo que
produce `DRY_RUN=false`). Mide el valor que devuelve `main()` y si la salida contiene una línea que
empieza con `[FATAL] `. El texto del mensaje de la excepción no lo fija el contrato. En cada
escenario se dice "**Salida: 0**" o "**Salida: 1**". "Salida: 1" implica siempre una línea
`[FATAL] …`; "Salida: 0", ninguna.

SKU universal: `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`, con las variantes V1…V5 y los ids de
`escenarios-ca2-cinco-variantes.md`. Datos **inventados**.

---

## A — sin entrada en caché: camino universal completo (R-19, R-2, R-4 b)

| Campo | Valor |
|---|---|
| `--sku` | `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E` |
| Caché `sku-map.json` | **`{}`** (sin entrada para el SKU) |
| Libreta `dot`: `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `destinos[sku]` / `pendiente[sku]` / `escrito[sku]` | ausente / ninguna / ninguno |
| Contabilium (`getStockDeposito`) | `Map {"APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E" => 13}` |
| Respuesta de la búsqueda | V1…V5 con 5/5/5/5/5, `hasNextPage: false` |

**Resultado exacto**

- `syncUnSku` **no** lanza `SkuAmbiguoError` ni ninguna otra excepción. La salida no contiene
  `SKU ambiguo` ni `[SKIP]`.
- Una sola búsqueda con `query: 'sku:"APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E"'`.
- Camino (b): referencia 5, delta `+3`, `nuevoValor 8`. **No** hay siembra por cambio de destino
  aunque `destinos[sku]` esté ausente con baseline 10 (carve-out de R-4): ningún `mutar` lleva
  13.
- Antes del primer `mutar`: `guardar` con `pendiente[sku] = {8, 13, desde 5/5/5/5/5}`.
- Exactamente 5 mutaciones `(9010001…9010005, 8, 5, DOT)`.
- Último `guardar`: `pendiente` ausente, `contabilium 13`, `skus 13`, `escrito 8`,
  `destinos 9010001`. `resembradoPor[sku]` y `resembradoEn[sku]` no se escriben.
- Log: contiene
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 (escritas=5, ya_estaban=0)`.
  **No** contiene `[AVISO]` ni `[SET]` para el SKU (el `[SET]` de variante única de
  `procesarSku` no aplica al camino universal).
- **Salida: 0** (resolución exitosa, `src/main.js:118`).

## B — fallo parcial y reintento por `--sku` (R-19 → R-5, R-10, R-11)

**Corrida B1.** Estado de A, con la mutación de V3 (`9010003`) rechazando.

- `mutar` exitosos en V1, V2, V4 y V5 `(…, 8, 5)`. Ninguna reversión.
- En disco: `pendiente[sku] = {8, 13, desde 5/5/5/5/5}`, `contabilium 10`, `skus 10`, sin
  `escrito`.
- Log: una línea que empieza con `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: `, y
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 PENDIENTE (escritas=4, ya_estaban=0, fallidas=1)`.
- **Salida: 1**. La excepción de R-19 llega al `catch` de `src/main.js:119-121`, que imprime
  `[FATAL] …`. La entrada pendiente ya está en disco antes de que la excepción salga (el `guardar`
  del journal precede a las mutaciones).

**Corrida B2, otra `--sku` sobre el disco de B1.** Contabilium 13, respuesta **8/8/5/8/8**.

- Exactamente **1** mutación: `(9010003, 8, 5)`. Ninguna con 11.
- Último `guardar`: `pendiente` ausente, `contabilium 13`, `skus 13`, `escrito 8`.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 (escritas=1, ya_estaban=4) [reintento]`.
- **Salida: 0** (esta segunda corrida sí resuelve el SKU).

**Corrida B2′, en lugar de B2.** Contabilium **15**, respuesta 8/8/5/8/8. El mismo resultado
exacto que B2 (R-12): se escribe 8 (no 10), y el baseline y `skus` quedan en **13**, no en 15.
**Salida: 0**.

**Corrida B3, una corrida completa (`ejecutarPar`) sobre el disco de B1.** Contabilium 13 y
respuesta 8/8/5/8/8. El mismo resultado que B2, con la línea `[reintento]` y el `[RESUMEN] dot`
con `universales=1`: el pendiente que dejó `--sku` lo retoma la corrida completa, porque las dos
usan la misma libreta `dot`.

## C — con `escrito` guardado: camino (c) por `--sku` (R-19 → R-4 c, R-13)

| Campo | Valor |
|---|---|
| Caché / `destinos[sku]` | `9010001` / `9010001` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `escrito[sku]` / `pendiente[sku]` | `5` / ninguna |
| Contabilium | `9` |
| Respuesta | **4/5/5/5/5** (una venta online en V1) |

- Referencia `max(0, 5 − 1) = 4`. Delta `−1`. `nuevoValor 3`.
- 5 mutaciones: `(9010001, 3, 4)` y `(9010002…9010005, 3, 5)`. Ninguna lleva 4 (lo que daría el
  máximo, 5 − 1).
- Libreta: `contabilium 9`, `skus 9`, `escrito 3`, sin `pendiente`.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 3 (escritas=5, ya_estaban=0)`.
- **Salida: 0**.

## D — estado de la caché: nunca `SkuAmbiguoError` para un SKU curado (R-2, IM-1)

Tres sub-casos con el **mismo** estado de A (libreta `contabilium 10`, `skus 10`, sin `destinos`,
`pendiente` ni `escrito`; Contabilium 13; respuesta 5/5/5/5/5), que difieren **solo** en la caché:

| Sub-caso | Caché `sku-map.json` |
|---|---|
| D1 — sin entrada | `{}` |
| D2 — entrada vencida | `{"APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E": "gid://shopify/InventoryItem/9010099"}`: un `inventoryItemId` que **no** está entre las exactas de la respuesta (variante borrada o recreada) |
| D3 — entrada presente en una sola | `{"APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E": "gid://shopify/InventoryItem/9010004"}` (V4) |

> La caché no tiene TTL (`docs/contratos/verificar-cache-sku.md:16`). "Vencida" en esta evidencia
> quiere decir "apunta a un item que ya no es candidato", que es el único modo en que una entrada
> deja de valer.

**Resultado exacto, idéntico en D1, D2 y D3**, por `--sku` y también por una corrida completa
(`ejecutarPar`, la parte de CA-2 "Caché (R-2, IM-1)"):

- Nunca se lanza `SkuAmbiguoError`. La salida no contiene `SKU ambiguo`.
- `resolverSku` devuelve las **5** variantes V1…V5 como candidatas, no una sola. En D3 las 5, no
  solo V4. En D2 ninguna es `9010099`.
- Las 5 mutaciones de A, `(9010001…9010005, 8, 5)`. Ningún `mutar` sobre `9010099`.
- Libreta final: la de A (`destinos 9010001`, el más chico, también en D3).
- Caché al terminar: en D1, ausente o `9010001`. En D2, **nunca** `9010099`: queda ausente o en
  `9010001`. En D3, `9010004` o `9010001` (R-5 deja reescribirla o no; igual que CA-2 I).
- Si D2 suma o no a `cache_invalidada` en la corrida completa, el contrato no lo fija para
  universales. El test no lo exige.
- Por `--sku`, **Salida: 0** en D1, D2 y D3.

## E — control fuera de la lista: `IEY-COMBO-CARBON-VERDE-IP16E` por `--sku` (R-19 última frase, R-6)

SKU **real** del grupo A4 (informe:224), con las variantes e ids de `escenarios-ca4-no-regresion.md`
A: 16e `8040001`/`9040001` y 17e `8040002`/`9040002`.

**E1 — con variante establecida.** Caché `{"IEY-COMBO-CARBON-VERDE-IP16E": "gid://shopify/InventoryItem/9040001"}`,
`destinos 9040001`, `contabilium 2`, `skus 2`, Contabilium `5`, respuesta 16e `4`, 17e `0`.

- Exactamente 1 mutación: `(9040001, 7, 4, DOT)`. `9040002` no recibe ninguna.
- Log, caracter a caracter (textos de hoy de `procesarSku`, sin prefijo de par):
  - `  [AVISO] IEY-COMBO-CARBON-VERDE-IP16E: 2 variantes de Shopify tienen el sku exacto -> se escribe en la variante establecida gid://shopify/ProductVariant/8040001`
  - `  [SET] IEY-COMBO-CARBON-VERDE-IP16E: 4 -> 7 (actualizado en Shopify)`
  - ninguna línea con `[UNIVERSAL]`.
- Ningún `guardar` con `pendiente[sku]`. Libreta final: `contabilium 5`, `skus 5`,
  `destinos 9040001`, sin `escrito[sku]`.
- **Salida: 0**.

**E3 — fallo de escritura fuera de la lista: el código de salida de siempre.** El estado de E1,
con la mutación `(9040001, 7, 4, DOT)` rechazando.

- La salida contiene una línea que empieza con
  `  [ERROR] IEY-COMBO-CARBON-VERDE-IP16E: fallo al escribir en Shopify -> ` (texto de hoy,
  `src/sync.js:420`). Ningún `guardar` de la libreta.
- **Salida: 0**, sin `[FATAL]`: para un SKU fuera de la lista, `syncUnSku` no lanza y `main()`
  sigue devolviendo 0 aunque falle (gap preexistente de `src/main.js:118`, fuera de alcance por
  R-19). Este control prueba que la excepción nueva es **solo** para los 7 curados.

**E2 — sin variante establecida.** El mismo SKU con caché `{}`, sin `destinos`, sin baseline,
Contabilium `5`, respuesta 4/0, título de producto inyectado `Combo Carbon Verde` en ambos nodos.

- Cero mutaciones. `syncUnSku` no lanza: reporta el ambiguo como hoy.
- Log, caracter a caracter:
  - `  [SKIP] IEY-COMBO-CARBON-VERDE-IP16E: SKU ambiguo: 2 variantes de Shopify tienen el sku exacto "IEY-COMBO-CARBON-VERDE-IP16E" -> no se escribe`
  - `      - gid://shopify/ProductVariant/8040001 — Combo Carbon Verde`
  - `      - gid://shopify/ProductVariant/8040002 — Combo Carbon Verde`
- Ningún `guardar` de la libreta (como hoy: solo se guarda si el resultado es `actualizado` o
  `sin_cambios`, `src/sync.js:479`).
- **Salida: 0** (el código de salida de hoy).

## F — control de prefijo o extensión de un curado: nunca el camino universal (R-1, NO-2)

Los dos SKUs son **inventados**. Ninguno está en la lista curada.

**F1 — extensión:** `--sku APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E-P1` (el P1 de CA-2: empieza con el
curado y sigue).

| Var. | `variantId` | `inventoryItemId` | `sku` | `available` |
|---|---|---|---|---|
| P1 | `gid://shopify/ProductVariant/8019901` | `gid://shopify/InventoryItem/9019901` | `…-17E-P1` exacto | 3 |
| P1b | `gid://shopify/ProductVariant/8019902` | `gid://shopify/InventoryItem/9019902` | `…-17E-P1` exacto | 3 |

Caché `{}`, sin `destinos`, sin baseline, Contabilium `4`. Respuesta: P1 y P1b (2 exactas),
título `ApplyFit P1`.

- `SkuAmbiguoError`, como cualquier repetido no curado sin variante establecida (R-6). Cero
  mutaciones (en particular, nada de escribir 4 en las dos).
- Log: `  [SKIP] APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E-P1: SKU ambiguo: 2 variantes de Shopify tienen el sku exacto "APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E-P1" -> no se escribe`,
  más las dos líneas de detalle. Ninguna línea `[UNIVERSAL]`.
- Ningún `guardar` con `pendiente` ni `escrito` para ese SKU. No se exige un conteo de 5
  variantes (R-7 no aplica): no hay `[ERROR]` de conteo.

**F2 — recorte:** `--sku APPLYFIT-CLEAR-IP13-13PRO-14-16E` (el curado sin `-17E`).

| Var. | `variantId` | `inventoryItemId` | `sku` | `available` |
|---|---|---|---|---|
| R1 | `gid://shopify/ProductVariant/8019911` | `gid://shopify/InventoryItem/9019911` | `APPLYFIT-CLEAR-IP13-13PRO-14-16E` exacto | 2 |

Caché `{"APPLYFIT-CLEAR-IP13-13PRO-14-16E": "gid://shopify/InventoryItem/9019911"}`,
`destinos 9019911`, `contabilium 2`, `skus 2`, Contabilium `3`. Respuesta (la búsqueda de Shopify
es tokenizada con coincidencia parcial, invariante 3): **R1** más **V1…V5** del curado (sku
`APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`, `available` 5), `hasNextPage: false`.

- Una sola exacta (R1), así que es una variante única de hoy: `nuevoValor = 2 + 1 = 3`.
- Exactamente 1 mutación: `(9019911, 3, 2, DOT)`. **Ninguna** sobre `9010001…9010005`.
- Log: `  [SET] APPLYFIT-CLEAR-IP13-13PRO-14-16E: 2 -> 3 (actualizado en Shopify)`. Ninguna línea
  `[UNIVERSAL]` ni `[AVISO]`.
- Libreta: `contabilium[APPLYFIT-CLEAR-IP13-13PRO-14-16E] = 3`. Ningún `pendiente` ni `escrito`
  para ningún SKU. La libreta del curado (`APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`), si existía, no
  se toca.

**F3 — el mismo control por la corrida completa.** F1 y F2 dentro de `ejecutarPar` dan el mismo
resultado, con el prefijo `dot/` en las líneas `[SKIP]`/`[SET]`, y el `[RESUMEN] dot` con
`universales=0` y `universales_pendientes=0`. La versión de la corrida completa con un SKU
inventado de forma universal está en `escenarios-ca4-no-regresion.md` C.

---

## Dudas de esta evidencia (resueltas)

1. **Compuerta por `--sku`, resuelta.** R-19 excluye explícitamente a R-16 de "mismo
   comportamiento sin importar el punto de entrada": la compuerta sigue sin estar conectada a
   `--sku` (no es parte de este pedido, `src/main.js:12-13,117`). El escenario **G** confirma que
   `--sku` sobre un SKU con una entrada marcada "requiere compuerta" NO la resuelve y `main()`
   devuelve 1.
2. **Prefijo `dot/` en `--sku`, confirmado.** R-19 deja explícito que las líneas universales de
   R-8 llevan el prefijo `<par>/<sku>` también en `--sku`, aunque el resto de los mensajes de
   `--sku` hoy no lleve par. Los textos de A, B y C quedan como estaban.
3. **Normalización, sin cambio de contrato.** `syncUnSku` normaliza con `trim().toUpperCase()`
   (`src/sync.js:453`) antes de cualquier otra cosa; la pertenencia a la lista curada de R-1 se
   evalúa sobre ese SKU ya normalizado, igual que ya pasa hoy para el resto de la lógica de
   `syncUnSku`. No hace falta un requisito nuevo: es el mismo punto de normalización que ya
   existe, aplicado antes del chequeo de R-1 en vez de después.

---

## G — `--sku` sobre una entrada marcada "requiere compuerta" (R-19 → R-17): salida 1

**Estado inicial**

| Campo | Valor |
|---|---|
| Caché / `destinos[sku]` | `9010001` / `9010001` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `escrito[sku]` | `5` |
| `pendiente[sku]` | `{nuevoValor: 8, contabiliumObjetivo: 13, variantes: [V1…V5, cada una con desde 5], marca}` (marcada "requiere compuerta"; el nombre del campo lo decide el implementador) |
| Contabilium | `13` |
| Respuesta | **8/8/5/8/8** |

**Corrida.** `DRY_RUN=false node src/index.js --sku APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`, sin
`ESCRITURA_ABSOLUTA` (que `--sku` no recibe, `src/main.js:117`).

**Resultado exacto**

- **Cero** mutaciones. En particular, ningún `(9010003, 8, 5)`: la entrada marcada no se
  reintenta sola, tampoco por `--sku` (R-17). No se calcula delta ni máximo, no se usa `escrito`.
- La salida contiene, exactamente una vez y en una sola línea:
  `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: pendiente universal requiere compuerta manual -> no se escribe`.
- La entrada marcada sigue **igual** en la libreta; `contabilium 10`, `skus 10`, `escrito 5`,
  `destinos 9010001`.
- **Salida: 1**, con `[FATAL] …`: `--sku` no tiene acceso a la compuerta (R-19, R-16 fuera de
  alcance de `--sku`), así que el SKU curado queda no resuelto, `syncUnSku` lanza y el `catch` de
  `src/main.js:119-121` devuelve 1.

## H — `--sku` con una variante no activada, caso (b) de R-18: salida 1

**Estado inicial:** el de C (`escrito 5`, `contabilium 10`, `skus 10`, `destinos 9010001`, sin
`pendiente`), Contabilium `9`. Respuesta **5/5/5/5/null** (V5 sin nivel de inventario en la
location DOT; V1…V4 activadas).

**Corrida.** `DRY_RUN=false node src/index.js --sku APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`.

**Resultado exacto**

- **Cero** mutaciones, tampoco en V1…V4. Ningún `guardar` con `pendiente[sku]`.
- La salida contiene, una sola vez:
  `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: variante gid://shopify/ProductVariant/8010005 no esta activada en la location del par, no se resuelve`,
  y ninguna línea de R-18 por `8010001…8010004`. Ninguna línea `[UNIVERSAL]`.
- La libreta queda igual: `contabilium 10`, `skus 10`, `escrito 5`, `destinos 9010001`.
- **Salida: 1**, con `[FATAL] …` (SKU curado no resuelto, excepción de R-19).

## I — `--sku` con las 5 variantes no activadas, caso (a) de R-18: salida 0

**Estado inicial:** el de H. Respuesta **null/null/null/null/null**.

**Corrida.** `DRY_RUN=false node src/index.js --sku APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`.

**Resultado exacto**

- **Cero** mutaciones. Ningún `guardar` con `pendiente[sku]`. No se calcula `nuevoValor`.
- La salida **no** contiene ninguna línea de R-18 (`… no esta activada en la location del par,
  no se resuelve`), ni ninguna otra `[ERROR]` para el SKU, ni `[UNIVERSAL]`. Un aviso
  `[SKIP]` de no activado como el de hoy (`src/sync.js:386-389`) puede aparecer o no: el test no
  lo exige ni lo prohíbe.
- La libreta queda igual: `contabilium 10`, `skus 10`, `escrito 5`, `destinos 9010001`.
- **Salida: 0**, sin `[FATAL]`: el caso (a) es benigno (`no_activado`), `syncUnSku` no lanza.

## Resumen del código de salida por `--sku`

| Escenario | SKU | Qué pasa | `main()` |
|---|---|---|---|
| A, C, D | curado | resuelto | 0 |
| B1 | curado | fallo de escritura de R-5, queda pendiente | 1 |
| B2, B2′ | curado | el reintento resuelve | 0 |
| G | curado | entrada marcada "requiere compuerta" (R-17) | 1 |
| H | curado | caso (b) de R-18 | 1 |
| I | curado | caso (a) de R-18, benigno | 0 |
| E1, E2, E3 | fuera de la lista | comportamiento de hoy, incluso con fallo | 0 |
