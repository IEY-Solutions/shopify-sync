# CA-11 — Compuerta absoluta manual (`ESCRITURA_ABSOLUTA`) multi-variante

Cubre: **R-16, R-18** (los dos casos), **R-3, R-13, R-17** (y R-8 y R-10 en la forma que toman
bajo la compuerta).

Comando de referencia: `node --test test/sku-universal-compuerta-absoluta.test.js`.

SKU: `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`, con las variantes V1…V5 y los ids de
`escenarios-ca2-cinco-variantes.md` (`8010001…8010005` / `9010001…9010005`). Par `dot`
(`gid://shopify/Location/83342655574`). Todos los valores de Contabilium, baseline y `available`
son **inventados**.

**Contexto.** C0 del `README.md`, **salvo** la compuerta: en las corridas marcadas "con
compuerta", la opción `escrituraAbsoluta` que recibe la corrida del par es
`new Set(["APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E"])` (lo que hoy arma `ESCRITURA_ABSOLUTA` vía
`src/argv.js:73`), y el veredicto se pide con `evaluarCorridaMultiPar(porPar, umbral,
{escrituraAbsoluta})` (`src/resultado.js:90`). Las corridas marcadas "automática" no traen
compuerta. Mismo **registro de eventos** que CA-7: `guardar(libreta)` con copia profunda y
`mutar(inventoryItemId, valor, desde, locationId)`, en un único array ordenado.

**Notación.** `pendiente[sku] = {…, marca}` indica una entrada marcada "requiere compuerta"
(R-17). El nombre del campo lo decide el implementador.

**Crédito activo K1, K2.** Donde el escenario lo diga, el registro de comprobantes inyectado trae,
para este SKU y el depósito `127356`, dos líneas Shopify acreditables de **1** unidad cada una,
con claves de consumo `K1` y `K2`, todavía no consumidas y con `referencia` **anterior** al
inicio de la lectura de la corrida (la condición con la que hoy la compuerta consume líneas,
`src/sync.js:1219`). Sin compuerta, `creditoAcreditable` daría `{credito: 2, claves: [K1, K2]}`.
"Marcada consumida con motivo `absoluto`" quiere decir que la libreta persistida tiene
`consumos[K] = {cantidad: 1, motivo: "absoluto", referencia, en}`, la misma forma que ya escribe
hoy la compuerta sobre un SKU no universal (`src/sync.js:1220`). En los escenarios sin esta frase
rige C0: ninguna línea acreditable.

**Reloj y corte.** Cada corrida recibe un `ahora()` inyectado (`src/sync.js:966-967`); el de la
corrida de un escenario con compuerta se llama **T1**. El corte del clasificador
(`contab.corte`) es anterior a la `referencia` de toda línea de crédito de este archivo, así que
ninguna la consume la rama `pre-corte` de `aplicarCortes` (`src/sync.js:870-873`). Salvo que el
escenario lo diga, la libreta inicial no tiene `resembradoPor[sku]` ni `resembradoEn[sku]`.

**Marca de resiembra (R-16, obligatoria).** "Resiembra anotada" quiere decir que esa persistencia
de la libreta tiene `resembradoPor[sku] = "absoluto"` y `resembradoEn[sku]` igual a T1 en ISO (el
inicio de la lectura de la corrida que resolvió la compuerta), una sola clave por SKU (no una por
variante), como hoy escribe la compuerta para un no universal (`src/sync.js:1213-1215`;
`test/cache-sku-caminos-de-escritura.test.js:212`). R-16 la exige además del consumo del crédito:
es lo que permite que una línea de crédito que llega **tarde** al registro, con `referencia`
anterior a `resembradoEn[sku]`, no se acredite en una corrida futura (escenario 1d).

**Reporte de la compuerta.** "Aplicado" quiere decir que el SKU **no** está en
`veredicto.compuertaNoAplicados`. "No aplicado" quiere decir que sí está, y que la corrida
imprime, caracter a caracter (`src/main.js:48`):
`[COMPUERTA][ERROR] 1 SKU(s) de ESCRITURA_ABSOLUTA no quedaron aplicados: APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`.
El veredicto queda en `ok: false`.

---

## 1 — Compuerta sin pendiente y sin crédito (R-16)

**Estado inicial** (C0: ninguna línea acreditable)

| Campo | Valor |
|---|---|
| Caché `sku-map.json` | `{sku: "gid://shopify/InventoryItem/9010001"}` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `destinos[sku]` | `gid://shopify/InventoryItem/9010001` |
| `pendiente[sku]` | ninguna |
| `escrito[sku]` | `7` |
| Contabilium | `12` |
| Respuesta | V1…V5 con 7/0/0/0/0, `hasNextPage: false` |
| Corrida | con compuerta |

**Resultado exacto**

- Valor absoluto `Math.round(12) = 12`. No se usa ningún camino de R-4. Con el delta `+2`, el
  máximo daría `7 + 2 = 9`, y el camino (c), con referencia `max(0, 7 − (0+7+7+7+7)) = 0`, daría
  `2`. Ningún `mutar` lleva `9` ni `2`.
- Antes del primer `mutar` hay un `guardar` con `pendiente[sku] = {nuevoValor: 12,
  contabiliumObjetivo: 12, variantes: [V1 desde 7, V2…V5 desde 0], marca}`.
- Exactamente **5** mutaciones: `(9010001, 12, 7, DOT)`, `(9010002, 12, 0, DOT)`,
  `(9010003, 12, 0, DOT)`, `(9010004, 12, 0, DOT)` y `(9010005, 12, 0, DOT)`. El
  `changeFromQuantity` es el `available` leído de **cada** variante.
- Ninguna variante queda en otro valor: después de la corrida, una relectura inyectada de las 5
  da 12/12/12/12/12.
- Último `guardar`: `pendiente[sku]` ausente, `contabilium[sku] = 12`, `skus[sku] = 12`,
  `escrito[sku] = 12`, `destinos[sku] = gid://shopify/InventoryItem/9010001` (el
  `inventoryItemId` más chico, R-5) y, en esa **misma** persistencia, la **resiembra anotada**:
  `resembradoPor[sku] = "absoluto"` y `resembradoEn[sku] = T1`. Se escribe aunque no haya
  ninguna línea de crédito que consumir. Ningún `guardar` anterior al último (en particular, el
  del journal previo al primer `mutar`) la tiene.
- Compuerta: **aplicado** (`compuertaNoAplicados = []`, sin línea `[COMPUERTA][ERROR]`).
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 12 (escritas=5, ya_estaban=0)`.
  Ninguna línea `[AVISO]` ni `[ERROR]` para el SKU.
- `[RESUMEN] dot`: `actualizado=1`, `error=0`, `universales=1`, `universales_pendientes=0`.

## 1b — Compuerta sin pendiente y con crédito activo K1, K2 (R-16, R-3)

**Estado inicial:** el de 1, más el **crédito activo K1, K2** del encabezado. Con compuerta.

**Resultado exacto**

- La compuerta **no suma** el crédito al valor (R-16, "sin credito"): las 5 mutaciones son las
  de 1, todas con **12**. Ninguna lleva 14 (`12 + 2`).
- El `guardar` previo al primer `mutar` es el de 1 (`{12, 12, desde 7/0/0/0/0, marca}`) y **no**
  tiene `K1` ni `K2` en `consumos`: el consumo va con la resolución, no con el journal.
- Último `guardar`: lo de 1 (`pendiente` ausente, `contabilium 12`, `skus 12`, `escrito 12`,
  `destinos 9010001`) **y además**, en esa **misma** persistencia, `consumos[K1]` y
  `consumos[K2]` con `motivo: "absoluto"` y `cantidad: 1` cada una, y la **resiembra anotada**
  (`resembradoPor[sku] = "absoluto"`, `resembradoEn[sku] = T1`).
- **Una vez por SKU, no por variante:** en `consumos` hay exactamente **2** claves de este SKU (K1
  y K2), cada una con `cantidad: 1` (no 5, ni ninguna cantidad acumulada por las 5 variantes), y
  ninguna con `motivo: "delta"`. Ninguna de las dos queda sin marcar.
- `[RESUMEN] dot`: `causa_venta_shopify=0` (la compuerta no cuenta el crédito como venta
  aplicada por delta), `actualizado=1`, `error=0`, `universales=1`, `universales_pendientes=0`.
- Compuerta: aplicado.

**Corrida 1b′, automática, sobre el disco de 1b.** El **mismo** registro de comprobantes (K1 y K2
siguen en el registro, ahora consumidas), Contabilium `12`, respuesta 12/12/12/12/12.

- `creditoAcreditable` da crédito 0 porque K1 y K2 ya están consumidas: camino (c), referencia
  12, delta 0, `nuevoValor 12`. **Cero** mutaciones. Ningún `mutar` lleva 14: el crédito no vuelve
  a sumarse sobre el valor recién emparejado (el bug que R-16 evita).
- `consumos[K1]` y `consumos[K2]` siguen iguales, con `motivo: "absoluto"` (no se reescriben con
  `"delta"`). `causa_venta_shopify=0`.

## 1d — Línea de crédito tardía K3, anterior al corte de la compuerta (por qué R-16 exige `resembradoEn`)

**El caso real.** El registro de comprobantes puede tardar en reflejar una venta online: la
venta ocurrió **antes** de que la compuerta leyera Contabilium (y Contabilium ya la había
descontado, así que el absoluto `12` ya la incluye), pero su línea aparece en el registro
**después** de la corrida de la compuerta. El consumo inmediato de 1b no la alcanza (no estaba en
el registro). Lo único que la frena es `resembradoEn[sku]`.

**Corrida 1d, automática, sobre el disco de 1b.** `ahora()` = **T2**, posterior a T1 en más que el margen de acreditación. En el
disco: `contabilium 12`, `skus 12`, `escrito 12`, `destinos 9010001`, `consumos[K1]` y
`consumos[K2]` con `"absoluto"`, `resembradoPor[sku] = "absoluto"`, `resembradoEn[sku] = T1`.

El registro de comprobantes inyectado trae K1 y K2 (como en 1b) **y una línea nueva K3**: una
línea Shopify acreditable de **1** unidad, del depósito `127356`, para este SKU, de un
comprobante que **no** estaba en el registro de 1b, con `referencia` **R3** tal que
`contab.corte < R3 < T1` (posterior al corte del clasificador, anterior al corte de la
compuerta). Contabilium `12`, respuesta 12/12/12/12/12.

**Resultado exacto**

- `aplicarCortes` (`src/sync.js:875-879`) consume K3: en el último `guardar` (y en disco al
  terminar), `consumos[K3] = {cantidad: 1, motivo: "absoluto", referencia: R3, en: T2}`. No
  `"delta"` ni `"pre-corte"`.
- Como K3 queda consumida antes de calcular el crédito, `creditoAcreditable` da crédito **0**
  (K1, K2 y K3 consumidas). **Cero** mutaciones de este SKU y **ningún** `mutar` con `13`
  (`12 + 1`). Ningún `guardar` con `pendiente[sku]`. Ninguna línea L17 ni `[ERROR]` para el SKU.
- La libreta sigue en `contabilium 12`, `skus 12`, `escrito 12`, `destinos 9010001`;
  `resembradoPor[sku] = "absoluto"` y `resembradoEn[sku] = T1` sin cambios.
- `[RESUMEN] dot`: `error=0`, `causa_venta_shopify=0`, `universales_pendientes=0`. Que el SKU cuente
  como `saltado` (atajo del incremental, `src/sync.js:1087-1091`, posible porque el crédito da 0) o
  como `universales=1` con `sin_cambios` no lo fija esta evidencia: el test no lo exige en ningún
  sentido.

**1d-ctrl — el mismo caso sin la marca: la falla que R-16 evita.** El mismo disco de 1b, con
`resembradoPor[sku]` y `resembradoEn[sku]` **quitados a mano** de la libreta (todo lo demás
igual, K1 y K2 consumidas), y la misma corrida 1d (T2, K3 con R3, Contabilium 12, 12×5).

- `aplicarCortes` **no** consume K3 (`R3 > contab.corte` y no hay `resembradoEn`). Entonces
  `creditoAcreditable` da `{credito: 1, claves: [K3]}` (R3 < T1 < T2 − margen), no aplica el
  atajo, y el camino (c) calcula referencia 12, delta 0, `nuevoValor = 12 + 0 + 1 = 13`: hay
  mutaciones con **13** (y, con la lógica de hoy, `consumos[K3]` termina con `motivo: "delta"` y
  `causa_venta_shopify=1`).
- Eso es re-inflar en 1 unidad stock ya vendido online: K3 ya estaba descontada en el absoluto
  `12` que escribió la compuerta. Es exactamente lo que la resiembra anotada impide en 1d.
- El test corre 1d y 1d-ctrl y compara: en 1d **ningún** `mutar` lleva 13; en 1d-ctrl sí. Si una
  implementación no escribe `resembradoEn[sku]` en 1b, 1d se comporta como 1d-ctrl y el test de
  1d falla. De 1d-ctrl el test fija **solo** esto: hay al menos un `mutar` de este SKU y todos
  llevan 13. El resto (consumo `"delta"`, `causa_venta_shopify`, journal marcado por R-17, log)
  describe el código de hoy y no se exige acá (el pendiente con crédito es de CA-12 §3).

## 1c — Variantes que ya tienen el absoluto (R-16)

El estado de 1 (sin crédito), con respuesta 12/0/12/0/0.
Exactamente 3 mutaciones, `(9010002, 12, 0)`, `(9010004, 12, 0)` y `(9010005, 12, 0)`. V1 y V3 no
reciben ninguna. Log `… 5 variantes -> 12 (escritas=3, ya_estaban=2)`. Libreta final como en 1.
Compuerta: aplicado.

## 2 — Compuerta sobre un pendiente trabado por R-11(c) (R-16 "prioridad sobre el journal")

**Estado inicial**, el que dejan CA-7 §2 y §5: un pendiente **sin** marca, con una variante que se
movió.

| Campo | Valor |
|---|---|
| Caché / `destinos[sku]` | `9010001` / `9010001` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `pendiente[sku]` | `{nuevoValor: 8, contabiliumObjetivo: 13, variantes: [V1…V5, cada una con desde 5]}`, **sin** marca |
| `escrito[sku]` | ninguno |
| Contabilium | `12` |
| Respuesta | **8/8/4/8/8** |
| Corrida | con compuerta |

**Resultado exacto**

- No se emite el `[ERROR]` de R-11(c) (`… cambio durante un pendiente universal …`): la compuerta
  no evalúa la entrada vieja.
- Antes del primer `mutar`, el primer `guardar` de la corrida tiene `pendiente[sku] =
  {nuevoValor: 12, contabiliumObjetivo: 12, variantes: [V1 desde 8, V2 desde 8, V3 desde 4, V4
  desde 8, V5 desde 8], marca}`. La entrada vieja `{8, 13, …}` no aparece en **ningún** `guardar`
  de esta corrida.
- Exactamente **5** mutaciones, con valor 12: `(9010001, 12, 8)`, `(9010002, 12, 8)`,
  `(9010003, 12, 4)`, `(9010004, 12, 8)` y `(9010005, 12, 8)`. Ninguna lleva 8 (el `nuevoValor`
  del pendiente viejo) ni `desde 5` (el `desde` viejo).
- Último `guardar`: `pendiente[sku]` ausente, `contabilium 12`, `skus 12`, `escrito 12`,
  `destinos 9010001`.
- Compuerta: aplicado. `universales=1`, `universales_pendientes=0`, `error=0`.

## 3 — Compuerta con fallo parcial (R-16, R-17)

Las tres corridas de este escenario llevan el **crédito activo K1, K2** del encabezado en el
registro de comprobantes, sin cambios entre corridas.

**Corrida 3.1, con compuerta.** El estado inicial de 1b (el de 1 más K1, K2). La mutación de
**V4** (`9010004`) rechaza.

- Antes del primer `mutar`: el mismo `guardar` de 1, `{12, 12, desde 7/0/0/0/0, marca}`.
- `mutar` exitosos: `(9010001, 12, 7)`, `(9010002, 12, 0)`, `(9010003, 12, 0)` y
  `(9010005, 12, 0)`. El de V4 falla. Ninguna mutación de reversión.
- En disco al terminar: `pendiente[sku] = {12, 12, desde 7/0/0/0/0, marca}`, `contabilium 10`,
  `skus 10`, `escrito 7`, `destinos 9010001` (baseline, destino y `escrito` sin cambios).
- **El crédito no se marca si la compuerta no termina:** `K1` y `K2` **no** están en `consumos`
  en ningún `guardar` de esta corrida ni en disco al terminar.
- Log: una línea que empieza con `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: ` (por V4),
  y `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 12 PENDIENTE (escritas=4, ya_estaban=0, fallidas=1)`.
- Compuerta: **no aplicado** (`compuertaNoAplicados = ["APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E"]` y
  la línea `[COMPUERTA][ERROR]` literal del encabezado).
- `error=1`, `universales=0`, `universales_pendientes=1`.

**Corrida 3.2, automática, sobre el disco de 3.1.** Contabilium `12`, respuesta
**12/12/12/0/12**.

- **Cero** mutaciones de este SKU. En particular ninguna `(9010004, 12, 0)`: la entrada marcada
  no se reintenta sola (R-17). Tampoco se calcula delta ni se usa `escrito`.
- En disco: la entrada `{12, 12, desde 7/0/0/0/0, marca}` sin cambios, `contabilium 10`,
  `escrito 7`. `K1` y `K2` siguen **sin** consumir (ni con `"absoluto"` ni con `"delta"`).
  Ningún `mutar` lleva 14 ni 2 (el crédito no se aplica en una corrida automática sobre una
  entrada marcada).
- Log: la línea literal de R-17, idéntica a la de un pendiente con crédito o siembra (CA-12):
  `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: pendiente universal requiere compuerta manual -> no se escribe`.
- `error=1`, `universales_pendientes=1`, `universales=0`.

**Corrida 3.3, con compuerta, sobre el disco de 3.2.** Contabilium `12`, respuesta
12/12/12/0/12.

- La entrada marcada se descarta y se reemplaza por `{12, 12, desde 12/12/12/0/12, marca}`,
  persistida antes de mutar.
- Exactamente **1** mutación: `(9010004, 12, 0)`.
- Último `guardar`: `pendiente` ausente, `contabilium 12`, `skus 12`, `escrito 12`,
  `destinos 9010001`, y en esa misma persistencia `consumos[K1]` y `consumos[K2]` con
  `motivo: "absoluto"` y `cantidad: 1` (recién ahora, cuando la compuerta termina; una sola vez
  por SKU, como en 1b), y la **resiembra anotada** con el T1 de **esta** corrida 3.3:
  `resembradoPor[sku] = "absoluto"`, `resembradoEn[sku] = T1(3.3)`. En disco al terminar 3.1 y
  3.2, `resembradoPor[sku]` y `resembradoEn[sku]` están **ausentes**: la marca, igual que el
  consumo, va solo con la resolución.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 12 (escritas=1, ya_estaban=4)`.
- Compuerta: aplicado. `universales=1`, `universales_pendientes=0`.

## 4 — Conteo distinto del esperado bajo la compuerta (R-16 → R-7)

Estado inicial de 1, con compuerta. Respuesta **V1…V4** solamente (7/0/0/0), `hasNextPage:
false`: 4 exactas, 5 esperadas.

- **Cero** `guardar` con `pendiente[sku]` y **cero** mutaciones (tampoco en V1…V4).
- Log: una línea que empieza con `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: `. Ninguna
  línea `[UNIVERSAL]`.
- Libreta: `contabilium 10`, `skus 10`, `escrito 7`, `destinos 9010001`, sin `pendiente`.
- Compuerta: **no aplicado** (línea `[COMPUERTA][ERROR]` literal del encabezado). `error=1`.

**4b — 6 exactas.** Respuesta V1…V5 más V6 (`8010006`/`9010006`, sku exacto, `available` 0).
El mismo resultado exacto que 4.

## 5 — Caso (b) de R-18 bajo la compuerta: algunas activadas, otra no (R-16 → R-18)

Catálogo inconsistente: unas variantes activadas en la location del par y otra no. Es **error**.

Estado inicial de 1, con compuerta. Respuesta V1…V5 con **7/0/0/0/null** (V5 sin nivel de
inventario en la location DOT; V1…V4 activadas).

- **Cero** `guardar` con `pendiente[sku]` y **cero** mutaciones, tampoco en V1…V4, que sí están
  activadas.
- Log, caracter a caracter (literal de R-18), **una sola** línea, por V5:
  `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: variante gid://shopify/ProductVariant/8010005 no esta activada en la location del par, no se resuelve`.
  Ninguna línea de R-18 por V1…V4 (`8010001…8010004`), que están activadas. Ninguna línea
  `[UNIVERSAL]`.
- Libreta: `contabilium 10`, `skus 10`, `escrito 7`, `destinos 9010001`, sin `pendiente`.
- Compuerta: **no aplicado**. El SKU está en `compuertaNoAplicados` y la corrida imprime la línea
  `[COMPUERTA][ERROR]` literal del encabezado. El SKU **no** está en `compuertaSkus.noActivados`
  (el caso (b) no es el `no_activado` benigno de hoy, `src/sync.js:1196-1197`).
- `error=1`, `no_activado=0`.

## 5b — Caso (a) de R-18 bajo la compuerta: las 5 variantes sin activar (R-16 → R-18)

SKU no activado todavía en la location del par. **No** es error: la compuerta no tiene nada que
aplicar, igual que hoy con un SKU no universal `no_activado`.

Estado inicial de 1, con compuerta. Respuesta V1…V5 con **null/null/null/null/null**.

**Resultado exacto en el par**

- **Cero** `guardar` con `pendiente[sku]` y **cero** mutaciones.
- **Ninguna** línea `[ERROR]` de R-18 (ni ninguna otra `[ERROR]`) para el SKU. Ninguna línea
  `[UNIVERSAL]`. La línea `[SKIP] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: el item no esta activado en esa location`
  de hoy (`src/sync.js:1147`) puede aparecer o no: el test no la exige ni la prohíbe.
- Libreta sin cambios para el SKU: `contabilium 10`, `skus 10`, `escrito 7`, `destinos 9010001`,
  sin `pendiente`.
- `[RESUMEN] dot`: `error=0`, `no_activado=1`, `actualizado=0`, `universales=0`,
  `universales_pendientes=0`.
- Reporte de la compuerta del par: el SKU está en `compuertaSkus.noActivados` y **no** en
  `compuertaSkus.aplicados` (lo reporta como no activado, no como fallo: `src/resultado.js:113`
  no lo cuenta como fallido en ese par). La pertenencia a `compuertaNoAplicados` sigue la
  tolerancia entre pares que ya existe **solo en la compuerta** (`compuertaNoAplicadaEn`), sin
  cambios por R-18: ver 5b-i (aplicado en otro par) y 5b-ii (un solo par). `detalle.dot.ok` no lo
  decide esa tolerancia sino la regla general de `evaluarCorrida`: con el universal como único SKU
  de DOT, `false` por corrida vacía (`src/resultado.js:50-58`), igual que el control no universal.

**5b-i — tolerancia entre pares de la compuerta.** `correrTodosLosPares` con DOT y Galerías Pacífico (datos del
`README.md`), los dos con la compuerta sobre el SKU. DOT como en 5b (null×5). En Galerías, las
5 variantes **activadas** en `gid://shopify/Location/7100000001`, libreta propia con
`contabilium 10`, `skus 10`, `escrito 7`, `destinos 9010001`, Contabilium del depósito `7100001`
en `12` y respuesta 7/0/0/0/0.

- Galerías: 5 mutaciones con 12 en `gid://shopify/Location/7100000001`, compuerta aplicada ahí.
- DOT: lo de 5b.
- Veredicto: `compuertaNoAplicados = []` y la salida **no** contiene `[COMPUERTA][ERROR]`: el
  no activado de DOT queda tolerado **en el reporte de la compuerta** porque el SKU se aplicó en
  Galerías (`compuertaNoAplicadaEn`, `src/resultado.js:104-118`). Esa tolerancia es solo de la
  compuerta y solo decide `compuertaNoAplicados`; no toca `detalle.dot` (`src/resultado.js:86-89`).
- `detalle.dot` sigue la regla general de `evaluarCorrida`: en este escenario el universal es el
  **único** SKU de DOT y termina `no_activado`, que no es error pero tampoco es efectivo, así que
  `detalle.dot.ok = false` por corrida vacía (`src/resultado.js:50-58`), igual que con un SKU no
  universal en la misma situación. Por eso el veredicto global da `ok: false`
  (`src/resultado.js:144-145`), **sin** `[COMPUERTA][ERROR]`. Ese rojo no es un error de R-18:
  `[RESUMEN] dot` sigue con `error=0`.

**5b-ii — un solo par: la tolerancia existente no cambia (R-18, última oración).** La corrida de la
compuerta toca **solo** el par DOT, en el estado de 5b (null×5). R-18 no introduce ni modifica el
mecanismo de "aplicado"/"no aplicado" entre pares (`src/resultado.js:109,115`): el SKU cuenta según
esa lógica **ya existente**, que para un SKU que no se aplicó en **ningún** par de la corrida lo
pone en `compuertaNoAplicados`.

Control en la **misma** forma: una segunda corrida, también de un solo par DOT, con la compuerta
sobre el SKU no universal `FUNDA-MAGSAFE-MATE-IPHONE16` (fuera de la lista curada, ids inventados
`gid://shopify/ProductVariant/8090001` / `gid://shopify/InventoryItem/9090001`, como en
`escenarios-ca9-ventas-individuales.md`), con libreta `contabilium 10`, `skus 10`,
`destinos 9090001`, Contabilium `12` y la variante con `available` **null** en la location DOT
(hoy `no_activado`, `src/sync.js:1146-1148`).

**Resultado exacto**

- En el par: todo lo de 5b, sin cambios. En particular **ninguna** línea `[ERROR]` para el SKU,
  `[RESUMEN] dot` con `error=0` y `no_activado=1`, cero `guardar` con `pendiente[sku]`, cero
  mutaciones y el SKU en `compuertaSkus.noActivados` del par.
- Veredicto global igual al del control: `evaluarCorridaMultiPar(porPar, umbral,
  {escrituraAbsoluta})` devuelve, para el universal, los mismos `ok`, `detalle.dot` y la misma
  pertenencia a `compuertaNoAplicados` que para `FUNDA-MAGSAFE-MATE-IPHONE16` en el control.
  Con la lógica de hoy eso es: el SKU **está** en `compuertaNoAplicados` (no se aplicó en
  ningún par, `src/resultado.js:109,115`), el veredicto queda `ok: false` y la salida contiene la
  línea `[COMPUERTA][ERROR]` del encabezado. Ese "no aplicado" **no** es un error nuevo de R-18:
  sale del mecanismo existente de la compuerta, idéntico al del no universal.
- Lo que R-18 prohíbe y el test verifica: que el universal agregue algo que el control no tiene.
  Ninguna línea `[ERROR]` de R-18 (`… no esta activada en la location del par, no se resuelve`),
  `error` del `[RESUMEN] dot` igual al del control (`0`), y `detalle.dot.ok` igual al del control.

## 5c — Caso (b) con un pendiente previo

El estado inicial de 2 (pendiente `{8, 13, desde 5×5}` sin marca), con compuerta, y respuesta
8/8/4/8/null. Cero mutaciones, el `[ERROR]` de R-18 solo con `8010005`, compuerta no aplicado, y
la entrada `{8, 13, desde 5×5}` sigue **igual** en la libreta (R-18: "la entrada sigue pendiente
sin cambios"). La compuerta no llegó a reemplazarla porque no pasó los controles.

## 5d — Caso (a) con un pendiente previo

El estado inicial de 2 (pendiente `{8, 13, desde 5×5}` sin marca), con compuerta, solo el par
DOT, y respuesta **null/null/null/null/null**. Cero mutaciones, ningún `[ERROR]` de R-18,
`error=0`, `no_activado=1`, el SKU en `compuertaSkus.noActivados` del par, y la entrada
`{8, 13, desde 5×5}` sigue **igual**, campo por campo, en todo `guardar` de esta corrida (si lo
hay) y en disco al terminar: no se reemplaza por una entrada de la compuerta ni se descarta
(R-18: "el pendiente no se toca ni se descarta: simplemente espera a que se reactiven").
`contabilium 10`, `skus 10`, `destinos 9010001`. El veredicto global sigue la lógica existente,
como en 5b-ii.

## 6 — DRY_RUN con la compuerta (R-16)

Estado inicial de 1b (con el crédito activo K1, K2), con compuerta y `DRY_RUN=true`.

- **Cero** eventos `guardar` y **cero** `mutar`. En particular, ningún crédito queda marcado
  consumido: `K1` y `K2` no aparecen en `consumos` de ninguna libreta persistida (no hay ninguna).
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 12 (no se escribe, DRY_RUN=true)`.
- `dry=1`, `universales=0`, `universales_pendientes=0`.
- Si el SKU cuenta como aplicado o no aplicado en DRY_RUN no lo fija el contrato. Hoy un `dry`
  cuenta como aplicado (`src/sync.js:1194`). El test no lo exige en ningún sentido.

---

## Notas y dudas de esta evidencia

1. **Línea de 3.2, resuelta.** R-17 fija que la entrada marcada por una compuerta fallida emite
   la **misma** línea literal que una marcada por crédito o siembra, sin distinguir la causa. El
   test de CA-11 la verifica literal en 3.2.
2. **Consumo de crédito bajo la compuerta, resuelto.** R-16 exige consumir con motivo
   `absoluto` las líneas de crédito anteriores, una vez por SKU, en la misma persistencia que
   resuelve el SKU (escenarios 1b, 1b′, 3.3), y no hacerlo si la compuerta no termina (3.1, 3.2)
   ni en DRY_RUN (6). R-16 exige **además**, en esa misma persistencia, la resiembra anotada
   (`resembradoPor[sku] = "absoluto"`, `resembradoEn[sku]` = inicio de lectura de la corrida,
   `src/sync.js:1213-1215`), una vez por SKU: el test la exige en 1, 1b y 3.3, la prohíbe antes de
   la resolución (3.1, 3.2) y prueba en 1d / 1d-ctrl por qué es obligatoria (una línea de crédito
   tardía con referencia anterior al corte no se vuelve a acreditar, `src/sync.js:875-879`).
3. **5b con un solo par, resuelto.** La última oración de R-18 fija que el caso (a) no cambia el
   mecanismo de "aplicado"/"no aplicado" que la compuerta ya tiene (`src/resultado.js:109,115`):
   con un solo par y las 5 variantes null, el SKU sigue esa lógica existente sin cambios
   (tolerado si se aplicó en otro par de la corrida, 5b-i; no tolerado si no se aplicó en
   ninguno, 5b-ii). R-18 solo exige que el caso (a) no agregue ruido nuevo (`[ERROR]` o contador
   de error) respecto de un no universal en la misma situación. El "no como fallo" de 5b se
   refiere al reporte **del par** (`compuertaSkus.noActivados`, `error=0`), no al veredicto global.
   5b-ii lo verifica contra un control no universal.
