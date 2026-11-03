# CA-5 — Línea `[UNIVERSAL]` y claves nuevas del `[RESUMEN]`

Cubre: **R-8**.

Comando de referencia: `node --test test/resumen-universales.test.js`.

## Formato normativo (copiado de R-8, `.agents/.arn/feature.md:65`)

Dos espacios de sangría y prefijo `<par>/<sku>`, igual que `[SET]`/`[AVISO]`/`[DRY]` de
`ejecutarPar`. `<par>` es el nombre del par (`dot` en este archivo), `<sku>` el SKU exacto, `<N>`
la cantidad de variantes exactas, `<V>` el `nuevoValor`, `<E>` las variantes mutadas con éxito en
esta corrida, `<Y>` las que ya tenían `<V>` y `<F>` las fallidas o no escritas, con `E+Y+F=N`:

1. Confirmada: `  [UNIVERSAL] <par>/<sku>: <N> variantes -> <V> (escritas=<E>, ya_estaban=<Y>)`
2. Pendiente: `  [UNIVERSAL] <par>/<sku>: <N> variantes -> <V> PENDIENTE (escritas=<E>, ya_estaban=<Y>, fallidas=<F>)`
3. DRY_RUN: `  [UNIVERSAL] <par>/<sku>: <N> variantes -> <V> (no se escribe, DRY_RUN=true)`
4. Retoma de un pendiente (R-11): cualquiera de las tres, con el sufijo literal ` [reintento]` al
   final.

Todas las líneas `[ERROR]` nuevas de esta feature (R-7, R-10, R-11, R-13) llevan el mismo
prefijo: empiezan con `  [ERROR] <par>/<sku>: `.

El test compara cada línea **completa**, caracter a caracter (`assert.ok(lineas.includes(esperada))`
sobre la salida capturada, partida por `\n`). No alcanza con buscar una subcadena. Una línea
`  [UNIVERSAL] APPLYFIT-…` **sin** el prefijo `dot/` no cumple (escenario H).

**Claves nuevas del `[RESUMEN]` (resuelve I-6):** son **dos**, y las dos son nuevas:
`universales` y `universales_pendientes`. `duplicados` ya existía (`src/sync.js:1268`) y no es
nueva. Las dos nuevas aparecen siempre, también en 0. No nombran SKUs. Las claves previas siguen
todas: `actualizado`, `dry`, `sin_cambios`, `no_encontrado`, `no_activado`, `error`, `ambiguo`,
`no_sincronizable`, `saltado`, `total`, `clasificador`, `causa_venta_shopify`,
`causa_desconocida`, `creditos_pendientes`, `creditos_pre_corte`, `creditos_vencidos`,
`notas_credito_shopify`, `comprobantes_pedidos`, `comprobantes_pendientes`,
`comprobantes_ilegibles`, `compuerta_pedidos`, `compuerta_aplicados`, `duplicados` y
`cache_invalidada`. La posición de las claves nuevas no se fija: el test busca los tokens
`universales=<k>` y `universales_pendientes=<p>` como palabras separadas por espacio (sin que
`universales=` se confunda con `universales_pendientes=`).

Contexto común **C0** del `README.md` en todos los escenarios (salvo F, que cambia el
clasificador). Par `dot`. Las variantes y los ids son los de `escenarios-ca2-cinco-variantes.md` y
`escenarios-ca3-dos-variantes.md`.

---

## A — universal confirmado y duplicado no universal en la misma corrida (forma 1)

Dos SKUs en el stock del par:

1. `APPLYFIT-CLEAR-S24-S25`: estado inicial y respuesta **idénticos al escenario A de CA-3**
   (caché y `destinos` en `9030001`, baseline 10, `skus` 10, sin `pendiente`, sin `escrito`,
   Contabilium 12.6, 5/5 más P1).
2. `IEY-COMBO-CARBON-VERDE-IP16E`: estado inicial y respuesta **idénticos al escenario A de CA-4**
   (caché y `destinos` en `9040001`, baseline 2, Contabilium 5, 4/0).

**La salida contiene estas líneas exactas** (afirmación positiva, resuelve B-4):

- `  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 8 (escritas=2, ya_estaban=0)`
- `  [AVISO] dot/IEY-COMBO-CARBON-VERDE-IP16E: 2 variantes de Shopify tienen el sku exacto -> se escribe en la variante establecida gid://shopify/ProductVariant/8040001`

**Y no contiene:** ninguna línea con `[AVISO]` que contenga `APPLYFIT-CLEAR-S24-S25`, ni ninguna
línea `[UNIVERSAL]` que contenga `IEY-COMBO-CARBON-VERDE-IP16E`.

**`[RESUMEN] dot:`** contiene `universales=1`, `universales_pendientes=0`, `duplicados=1`,
`actualizado=2` y `total=2`. Cada SKU suma solo a su propio contador: el universal no toca
`duplicados` y el A4 no toca `universales` (lo prueba este mismo escenario, con un SKU de cada
clase). La línea del `[RESUMEN]` no contiene `APPLYFIT` ni `IEY-COMBO`.

## B — corrida sin ningún caso: las dos claves en 0

Stock del par con un solo SKU **inventado**, `FUNDA-TEST-UNICA`, fuera de la lista y con una sola
variante exacta (`gid://shopify/InventoryItem/9060001`, `available` 2). Caché y `destinos` en
`9060001`, baseline 2, `skus` 2, sin `pendiente` ni `escrito`, y Contabilium 3. `nuevoValor 3`, 1 mutación.

**`[RESUMEN] dot:`** contiene `universales=0`, `universales_pendientes=0` y `duplicados=0`. El test
falla si falta cualquiera de las dos claves nuevas. La salida no contiene ninguna línea
`[UNIVERSAL]`.

## C — pendiente tras una mutación fallida (forma 2)

Estado inicial, respuesta y falla **idénticos al escenario E de CA-2** (5 variantes, baseline 10,
Contabilium 13, sin `escrito`, sin `pendiente`, 5/5/5/5/5, falla la mutación de V3).

- La salida contiene exactamente:
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 PENDIENTE (escritas=4, ya_estaban=0, fallidas=1)`
- `[RESUMEN] dot:` contiene `universales=0`, `universales_pendientes=1` y `error=1`.

## D — retoma del pendiente (forma 1 con ` [reintento]`)

Estado inicial = la libreta que dejó C: `pendiente[sku] = {8, 13, desde 5/5/5/5/5}`, baseline 10,
`skus` 10, `destinos 9010001`, sin `escrito`. Caché en `9010001`. Contabilium 13. Respuesta
8/8/5/8/8.

- La salida contiene exactamente:
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 (escritas=1, ya_estaban=4) [reintento]`
- `[RESUMEN] dot:` contiene `universales=1`, `universales_pendientes=0` y `actualizado=1`.

## E — DRY_RUN (forma 3, con y sin ` [reintento]`)

**E1.** Estado inicial y respuesta del escenario A de CA-2 (baseline 10, Contabilium 13,
5/5/5/5/5, sin `pendiente`, sin `escrito`), con **`DRY_RUN=true`**.

- La salida contiene exactamente:
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 (no se escribe, DRY_RUN=true)`
- Cero mutaciones. Cero persistencias de la libreta.
- `[RESUMEN] dot:` contiene `dry=1`, `universales=0` y `universales_pendientes=0` (R-8: en
  DRY_RUN `universales` queda en 0 porque no hay confirmación real).

**E2.** Estado inicial = la libreta de D (con `pendiente[sku] = {8, 13, …}`), respuesta 8/8/5/8/8,
`DRY_RUN=true`.

- La salida contiene exactamente:
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 (no se escribe, DRY_RUN=true) [reintento]`
- Cero mutaciones. La libreta en disco no cambia (sigue con el `pendiente`).
- `[RESUMEN] dot:` contiene `universales=0` y `universales_pendientes=1` (la entrada sigue en la
  libreta al terminar).

## F — excepción del ADR 0001: `[UNIVERSAL]` nombra el SKU aunque cuente en `causa_desconocida` (resuelve I-5)

R-8 dice: "Esta linea es una excepcion explicita que nombra el SKU, igual que [SET], [DRY] y el
[AVISO] de duplicados (adenda del ADR 0001)" (`.agents/.arn/feature.md:65`). La adenda está en
`docs/adr/0001-semantica-de-escritura-de-stock.md:47-52` y su precedente es la R-2 de
`docs/contratos/verificar-cache-sku.md`.

Estado inicial y respuesta del escenario D de CA-2 (escrito 5, baseline 10, Contabilium 9,
5/5/5/4/5), **pero** con el clasificador en `fallo` (la búsqueda de comprobantes cae). Sin líneas
acreditables y `credito 0`.

- La salida contiene exactamente:
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 3 (escritas=5, ya_estaban=0)`
- Ninguna línea de la salida que contenga `desconocid` contiene
  `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`.
- Este escenario no fija el valor de `causa_desconocida` (el contrato no lo define para los
  universales).

## G — `universales` cuenta SKUs, no variantes

Escenario A de CA-2 solo (un SKU de 5 variantes confirmado): `[RESUMEN] dot:` contiene
`universales=1` (no 5) y `actualizado=1` (no 5).

## H — el prefijo `<par>/<sku>` es obligatorio en `[UNIVERSAL]` y en los `[ERROR]` nuevos (R-8)

Sobre la salida capturada de los escenarios A, C, D, E1, E2 y F de este archivo:

- Toda línea que empieza con `  [UNIVERSAL] ` sigue con `dot/`. Ninguna línea empieza con
  `  [UNIVERSAL] APPLYFIT-`.
- En C, la línea `[ERROR]` de la mutación fallida de V3 empieza con
  `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: `. Ninguna línea de la salida empieza con
  `  [ERROR] APPLYFIT-`.

Los literales `[ERROR]` de R-10 y R-11 con prefijo se prueban en `escenarios-ca7-pendiente.md`
(pasos 5 y 7), los de R-7 en `escenarios-ca2-cinco-variantes.md` (F1, F3, F4), y el prefijo de
otro par en `escenarios-ca3-dos-variantes.md` F.
