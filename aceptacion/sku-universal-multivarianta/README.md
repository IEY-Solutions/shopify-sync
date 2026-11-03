# Aceptación — `sku-universal-multivarianta`

Evidencia de aceptación escrita **antes** de implementar, a partir del contrato final de
`.agents/.arn/feature.md` (bloque `arn-contrato`, R-1 a R-19 y CA-1 a CA-14). Sirve también la
lógica actual de `src/sync.js` y `src/shopify.js` como referencia de comportamiento (no de
código nuevo), junto con `docs/contratos/verificar-cache-sku.md`, el ADR 0001 y el informe
`docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md`. Fija entradas y salidas observables
exactas. No prescribe estructura interna. Los ejemplos normativos del contrato (los `texto:` de
R-4, R-11, CA-2, CA-3, CA-7 a CA-14) se usan tal cual, con los mismos números.

Ningún criterio es de superficie `ui`: esta carpeta no lleva `DESIGN.md` ni mocks.

## Qué hace la feature (resumen)

Para los 7 SKUs de la lista curada (R-1), el sync escribe el mismo `nuevoValor` entero en
**todas** las variantes con ese SKU exacto (R-2, R-5). El baseline sigue siendo uno por SKU
(R-3). El `shopifyActual` de referencia sale de uno de tres caminos excluyentes (R-4): siembra,
bootstrap (máximo, sin `escrito`) o camino normal (`escrito − Σ max(0, escrito − available_i)`).
Antes de la primera mutación se persiste un journal `pendiente` (R-10). Si la escritura queda a
medias, la corrida siguiente retoma el mismo `nuevoValor` sin recalcular (R-11). Mientras hay un
pendiente, Contabilium espera (R-12). Al confirmar se guarda `escrito` (R-13). Los 7 SKUs se
resuelven en todas las corridas, aunque Contabilium no haya cambiado (R-14). El resto del
catálogo no cambia (R-6). Los tests de `verificar-cache-sku` que usaban un SKU curado como fixture
migran a un duplicado no curado (R-15). La compuerta absoluta manual escribe en las N variantes y
es la única salida de un pendiente trabado (R-16). Un pendiente calculado con crédito o con siembra
no se reintenta solo (R-17). Si algunas variantes no están activadas y otras sí, es error y frena
todo el SKU; si ninguna está activada, es el `no_activado` benigno de hoy (R-18). La corrida
`--sku` sigue el mismo camino y devuelve 1 si un curado queda sin resolver (R-19).

## Correspondencia R-# → CA-# → archivo

| R | Resumen | CA | Archivo y escenarios |
|---|---|---|---|
| R-1 | Lista curada explícita de 7 pares `{sku, variantes}` (3, 2, 2, 5, 2, 2, 2; total 18), pertenencia por string exacto | CA-1, CA-14 | `escenarios-ca1-lista-curada.md` §1, §2, §3; `escenarios-ca14-sku-puntual.md` F1, F2, F3 (prefijo o extensión, NO-2); `escenarios-ca4-no-regresion.md` C |
| R-2 | Búsqueda exacta: TODAS las variantes exactas como candidatas, con su `variantId`/`inventoryItemId`/`available`; nunca `SkuAmbiguoError` para un curado, sea cual sea la caché | CA-2, CA-3, CA-14 | `escenarios-ca2-cinco-variantes.md` A, F2; `escenarios-ca3-dos-variantes.md` A, F; `escenarios-ca14-sku-puntual.md` A, D1, D2, D3 (caché, IM-1, por `--sku` y por la corrida completa) |
| R-3 | Baseline único por SKU; `nuevoValor` calculado una vez, con el crédito acreditable sumado una vez | CA-2, CA-3 | `escenarios-ca2-cinco-variantes.md` A, B, D, H; `escenarios-ca3-dos-variantes.md` A, B |
| R-4 | Tres caminos excluyentes: siembra / bootstrap (máximo) / normal (`escrito − Σ max(0, …)`) | CA-2, CA-3, CA-7, CA-9 | `escenarios-ca2-cinco-variantes.md` A, A', B, C, D, D2, I, I' (sin siembra por `cambioDeDestino` con destino heredado); `escenarios-ca3-dos-variantes.md` B, C, D, E; `escenarios-ca9-ventas-individuales.md` pasos 1, 2, 2b, 4, 8 |
| R-5 | Escribir `nuevoValor` en las que difieren, `changeFromQuantity` por variante, resuelto solo con las N confirmadas, sin revertir; `destinos[sku]` al `inventoryItemId` numéricamente más chico; mismo contador `error` | CA-2, CA-3, CA-7 | `escenarios-ca2-cinco-variantes.md` A, E, G, I; `escenarios-ca3-dos-variantes.md` E, F, G; `escenarios-ca7-pendiente.md` 2 |
| R-6 | SKU repetido no curado: comportamiento viejo sin cambios | CA-4 | `escenarios-ca4-no-regresion.md` A, B, C |
| R-7 | Conteo contra la cantidad ESPERADA de la lista curada: error con menos o más exactas, y con tope sin completar | CA-2 | `escenarios-ca2-cinco-variantes.md` F1 (tope, 3 de 5), F2 (tope, 5 de 5, no error), F3 (4 de 5), F4 (6 de 5) |
| R-8 | Línea `[UNIVERSAL]` literal con prefijo `<par>/<sku>` (3 formas + ` [reintento]`), prefijo en los `[ERROR]` nuevos, y claves `universales`/`universales_pendientes` | CA-5 | `escenarios-ca5-resumen.md` A a H; `escenarios-ca3-dos-variantes.md` F (otro par); `escenarios-ca7-pendiente.md` 5, 7; `escenarios-ca13-no-activada.md` (prefijo `galerias-pacifico/`); `escenarios-ca14-sku-puntual.md` A a C (por `--sku`) |
| R-9 | Contratos existentes, coincidencia exacta, deltas y enteros | CA-2, CA-4, CA-6, CA-10 | `escenarios-ca2-cinco-variantes.md` A, C, F2; `escenarios-ca3-dos-variantes.md` A; `escenarios-ca4-no-regresion.md`; `escenarios-ca10-migracion-fixture.md`; `npm test` (ver nota de CA-6) |
| R-10 | Journal `pendiente` en disco ANTES de la primera mutación | CA-7 | `escenarios-ca7-pendiente.md` 1, 2, 4, 7, 8, 9 |
| R-11 | Con pendiente: reintentar el mismo `nuevoValor`, por variante (a)/(b)/(c) | CA-7 | `escenarios-ca7-pendiente.md` 3, 4, 5, 5b, 5c, 6 |
| R-12 | Contabilium cambia durante un pendiente: termina lo pendiente, baseline al `contabiliumObjetivo` | CA-8 | `escenarios-ca8-pendiente-contabilium.md` corridas 1 a 3 y 2' a 3' |
| R-13 | Persistencia de `escrito` (último `nuevoValor` confirmado) | CA-2, CA-3, CA-9 | `escenarios-ca9-ventas-individuales.md` pasos 1, 3, 6, 7, 8, 9; `escenarios-ca3-dos-variantes.md` D |
| R-14 | Bypass del atajo del incremental solo para los 7 curados | CA-9 | `escenarios-ca9-ventas-individuales.md` pasos 2, 2b, 3, 5; `escenarios-ca3-dos-variantes.md` D, E |
| R-15 | Migración del fixture `SKU_APPLYFIT` a `IEY-COMBO-CARBON-VERDE-IP16E` sin cambiar aserciones | CA-6, CA-10 | `escenarios-ca10-migracion-fixture.md` §1 (byte a byte sin comentarios, N1 a N7), §2 (conteos), §3 (a) a (d); copias en `fixtures-originales/`; `npm test` |
| R-16 | Compuerta absoluta multi-variante: mismo absoluto en las N, sin sumar crédito pero consumiéndolo con motivo `absoluto` una vez por SKU al resolver, con `resembradoPor[sku]='absoluto'` y `resembradoEn[sku]` obligatorios en esa misma resolución, prioridad sobre el journal, entrada marcada si falla (sin consumir crédito ni anotar la resiembra) | CA-11, CA-12 | `escenarios-ca11-compuerta-absoluta.md` 1 y 1b (resiembra anotada; en 1b, además, crédito K1/K2 consumido), 1b′, 1d y 1d-ctrl (línea de crédito tardía K3 con referencia anterior a `resembradoEn`: no se reacredita), 1c, 2, 3 (3.1 a 3.3; crédito sin consumir y sin resiembra hasta 3.3), 4, 4b, 5, 5b, 5b-i, 5b-ii, 5c, 5d, 6; `escenarios-ca12-pendiente-credito-siembra.md` 5, 5′ (crédito real consumido y resiembra anotada) |
| R-17 | Pendiente con crédito o siembra: marcado "requiere compuerta", no se reintenta solo, línea `[ERROR]` literal | CA-12, CA-11, CA-14 | `escenarios-ca12-pendiente-credito-siembra.md` 1 (1.1 a 1.3), 2 (2.1 a 2.3), 3, 4 (control), 5; `escenarios-ca11-compuerta-absoluta.md` 3.2; `escenarios-ca14-sku-puntual.md` G |
| R-18 | Dos casos: (b) algunas variantes null y otras activadas, error con `[ERROR]` literal solo por las no activadas; (a) todas null, `no_activado` benigno, sin `[ERROR]` ni contador de errores; la tolerancia "aplicado en otro par" es solo de la compuerta (`compuertaNoAplicadaEn`), y fuera de ella el par sigue la regla general de corrida vacía de `evaluarCorrida` | CA-13, CA-11, CA-14 | `escenarios-ca13-no-activada.md` caso (b): B-1, B-2, B-3 (los tres caminos de R-4), B-4 (DRY_RUN), B-5 (con pendiente), B-6 (otro par); caso (a): A-1, A-2 (único SKU: `ok:false` por corrida vacía, igual que el control no universal), A-3 (el otro par en la misma corrida, con un SKU de control resuelto en Galerías; A-3.1 sin compuerta, A-3.2 con la tolerancia de la compuerta), A-4 y A-4′ (pendiente previo intacto hasta la reactivación, `universales_pendientes=1`); `escenarios-ca11-compuerta-absoluta.md` 5, 5c (caso b), 5b, 5b-i (tolerancia de la compuerta; `detalle.dot.ok=false` por corrida vacía), 5b-ii (un solo par: tolerancia existente sin cambios, contra control no universal), 5d (caso a con pendiente); `escenarios-ca14-sku-puntual.md` H (caso b), I (caso a) |
| R-19 | Mismo comportamiento por `--sku` (`syncUnSku`/`procesarSku`) que por `ejecutarPar`, salvo R-14 y R-16; un curado no resuelto lanza y `main()` devuelve 1 (`DRY_RUN=false node src/index.js --sku <sku>`) | CA-14 | `escenarios-ca14-sku-puntual.md` A, B (B1, B2, B2′, B3), C, D, E1, E2, E3, F, G, H, I y la tabla de código de salida |

Cada R-# tiene al menos un escenario con estado inicial completo, entradas numéricas exactas y
resultado exacto (mutaciones, libreta persistida, contadores y líneas de log).

## Índice de archivos

1. `escenarios-ca1-lista-curada.md`: CA-1 (R-1). Literal exacto de pares `{sku, variantes}`,
   suma 18 y control contra heurísticas.
2. `escenarios-ca2-cinco-variantes.md`: CA-2 (R-2, R-3, R-4, R-5, R-7, R-9, R-13). Caso real de 5
   variantes `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`: iguales (bootstrap y normal), bootstrap
   divergente 7/0/0/0/0, siembra con decimal, ventas individuales, fallo parcial, conteo contra
   las 5 esperadas (tope, 4 y 6 exactas), orden de respuesta no estable, crédito acreditable y
   destino heredado que no es el más chico (se actualiza sin siembra, I e I').
3. `escenarios-ca3-dos-variantes.md`: CA-3 (R-2, R-3, R-4, R-5, R-13). `APPLYFIT-CLEAR-S24-S25`:
   iguales con decimal, bootstrap 5/0, ventas individuales 5/6, piso 0, suba ignorada 8/5, el
   par Galerías Pacífico y el orden numérico del gid para `destinos[sku]`.
4. `escenarios-ca4-no-regresion.md`: CA-4 (R-6, R-9). A4 con variante establecida (caché y
   `destinos` en la misma variante), A4 sin establecida (ninguna de las dos), y control
   inventado con forma de universal.
5. `escenarios-ca5-resumen.md`: CA-5 (R-8). Las tres formas literales de `[UNIVERSAL]` con
   prefijo `<par>/<sku>`, el sufijo ` [reintento]`, las dos claves nuevas del `[RESUMEN]`, la
   excepción del ADR 0001 y el prefijo obligatorio.
6. `escenarios-ca7-pendiente.md`: CA-7 (R-4, R-5, R-10, R-11). Journal antes de escribir, fallo
   parcial, reintento, crash, variante movida, atajo, persistencia fallida y DRY_RUN.
7. `escenarios-ca8-pendiente-contabilium.md`: CA-8 (R-12). Contabilium sube (13 → 15) y baja
   (13 → 11) mientras hay un pendiente.
8. `escenarios-ca9-ventas-individuales.md`: CA-9 (R-4, R-13, R-14). Cadena de corridas
   encadenadas sobre la misma libreta, con un SKU de control fuera de la lista.
9. `escenarios-ca10-migracion-fixture.md`: CA-10 (R-15). Comparación byte a byte contra las
   copias congeladas (sin git), qué es comentario, casos de rechazo, conteos de `test(`,
   `describe(` y `assert`, y los cuatro chequeos sobre el SKU de reemplazo
   `IEY-COMBO-CARBON-VERDE-IP16E`.
10. `escenarios-ca11-compuerta-absoluta.md`: CA-11 (R-16, R-18, R-3, R-13, R-17). Compuerta sin
    pendiente, con crédito K1/K2 consumido con motivo `absoluto` una vez por SKU y la resiembra
    anotada, una línea de crédito tardía K3 que no se reacredita gracias a `resembradoEn` (con su
    control sin la marca), sobre un pendiente trabado, con fallo parcial (crédito sin consumir
    hasta el cierre con una segunda compuerta), conteo distinto, los dos casos de R-18 (con la
    tolerancia entre pares de la compuerta) y DRY_RUN.
11. `escenarios-ca12-pendiente-credito-siembra.md`: CA-12 (R-17). Crédito con fallo parcial,
    siembra con fallo parcial, crédito sin fallo, control sin crédito y cierre por la compuerta,
    que consume el crédito real y una corrida posterior que ya no lo vuelve a sumar.
12. `escenarios-ca13-no-activada.md`: CA-13 (R-18). `APPLYFIT-CLEAR-IP16PM-17PM` en Galerías
    Pacífico, con los dos casos separados: (b) una activada y otra null (error) en los tres
    caminos de R-4, DRY_RUN, con pendiente previo y el par DOT en la misma corrida; (a) las dos
    null (benigno, `no_activado`), en los tres caminos, con el otro par en la misma corrida (y la
    tolerancia entre pares que solo tiene la compuerta) y con un pendiente previo que queda
    intacto hasta que las variantes se reactivan.
13. `escenarios-ca14-sku-puntual.md`: CA-14 (R-1, R-2, R-11, R-17, R-18, R-19). `--sku` con el
    curado de 5 variantes (sin caché, fallo y reintento, camino c, los tres estados de caché,
    entrada marcada, los dos casos de R-18), control A4 con y sin variante establecida y con
    fallo, controles de extensión y recorte del curado, y el código de salida real de `main()`
    en cada caso (`DRY_RUN=false node src/index.js --sku <sku>`).
14. `fixtures-originales/`: copias literales de los 5 archivos de `test/` en el commit `3abeda7`,
    que lee CA-10. Las congeló otro autor; ver su `README.md`. No se editan.

### Nota sobre CA-6 (`npm test`, R-9, R-15)

CA-6 no tiene datos propios. Exige que `npm test` pase completo sin debilitar, saltear ni borrar
tests, incluidos `test/cache-sku-*.test.js` (con el fixture migrado por R-15),
`test/sku-match.test.js`, `test/libreta.test.js` y los trece tests nuevos de CA-1 a CA-5 y CA-7 a
CA-14. Lo específico de R-9 (coincidencia exacta, deltas, enteros) se ejercita en los escenarios
citados en la tabla. Que la migración de R-15 no cambió aserciones lo prueba CA-10.

### Ids nuevos de esta ronda

- `APPLYFIT-CLEAR-IP16PM-17PM` (CA-13): `gid://shopify/ProductVariant/813000k` /
  `gid://shopify/InventoryItem/913000k`, k = 1, 2.
- Recorte inventado `APPLYFIT-CLEAR-IP13-13PRO-14-16E` (CA-14 F2): `8019911` / `9019911`.
- Segunda variante del P1 de CA-2 (CA-14 F1): `8019902` / `9019902`.
- Variante inexistente para la caché vencida (CA-14 D2): `gid://shopify/InventoryItem/9010099`.

El resto reusa los ids de CA-2 (V1…V5, `801000k`/`901000k`), CA-3 (`803000k`/`903000k`) y CA-4
(`804000k`/`904000k`).

## Convenciones (valen para todos los archivos)

### Notación de la libreta del par

El implementador decide los nombres de los campos nuevos (R-10, R-13). Esta evidencia usa esta
notación, que **no** es un nombre de campo:

- `contabilium[sku]`: el baseline, tal como hoy (`libreta.contabilium`, `src/sync.js:1038`).
  `ausente` = sin entrada = `null` (siembra).
- `skus[sku]`: el valor que usa el atajo del incremental (`libreta.skus`, el `snapshotPrevio` de
  `src/sync.js:1032` y `:1087`). Hoy avanza junto con el baseline.
- `destinos[sku]`: el `inventoryItemId` del destino por par (R-9 de `verificar-cache-sku`). Para
  un universal, al avanzar queda en el `inventoryItemId` más chico de las N, comparando el número
  del gid (R-5), sin importar el orden de la respuesta.
- `pendiente[sku]`: la entrada del journal de R-10, escrita como
  `{nuevoValor, contabiliumObjetivo, variantes: [{variantId, inventoryItemId, desde}, …]}`.
  `ninguna` = el SKU no tiene entrada.
- `escrito[sku]`: el último `nuevoValor` confirmado (R-13). `ninguno` = sin entrada.

La **caché** es otra cosa: `.cache/sku-map.json`, única para todos los pares, `{sku:
inventoryItemId}`, inyectada con `opciones.rutaCache` (`docs/contratos/verificar-cache-sku.md`
R-1). Cada escenario fija por separado la caché y `destinos[sku]` (resuelve B-3).

### Contexto común C0 (explícito, lo cita cada escenario)

Salvo que el escenario diga otra cosa **por escrito**, cada corrida tiene:

- Clasificador de comprobantes `ok`. El registro **no tiene ninguna línea** Shopify del depósito
  del par para ese SKU, así que `creditoAcreditable` da `credito 0` y no hay notas de crédito
  (resuelve I-5). `causa_venta_shopify=0` y `causa_desconocida=0` en el `[RESUMEN]`.
- `ESCRITURA_ABSOLUTA` no alcanza al SKU (la compuerta manual no interviene).
- Modo incremental (no `--full`), `DRY_RUN=false`, y `checkpointCada` mayor que la cantidad de
  SKUs de la corrida (un solo guardado final, más las persistencias del journal de R-10).
- Una sola búsqueda `QUERY_POR_SKU` por SKU y corrida, con variables
  `query: 'sku:"<sku>"'`, `first: 10` y `locationId` del par. La respuesta inyectada trae, por
  candidato, `node.id` (`variantId`), `node.sku`, `inventoryItem.id` y el `available` de esa
  location, y `pageInfo.hasNextPage: false` salvo que el escenario diga `true`.
- Ninguna variante se mueve entre la lectura y la escritura (la guarda `changeFromQuantity`
  pasa), salvo que el escenario diga lo contrario.

### Pares

| Par | `nombre` (prefijo de log) | `locationId` | Depósito Contabilium | Origen |
|---|---|---|---|---|
| DOT | `dot` | `gid://shopify/Location/83342655574` | `127356` | real, `AGENTS.md` |
| Galerías Pacífico | `galerias-pacifico` | `gid://shopify/Location/7100000001` | `7100001` | **inventados** (el real viene de env, `src/pares.js:33-39`) |

Cada par tiene su propia libreta. La caché es una sola.

### Ids y datos

- Los `variantId` (`gid://shopify/ProductVariant/80…`) y los `inventoryItemId`
  (`gid://shopify/InventoryItem/90…`) son **inventados** y consistentes entre archivos: la misma
  variante tiene el mismo id en todos.
- Cada escenario dice qué datos son **reales** (del informe) y cuáles son **inventados**
  (resuelve N-5). Los `available` del informe son de la location DOT al 02/11/2026. Ningún valor
  de Contabilium de esta carpeta es real: el informe no los trae.
- "Mutación" es una llamada exitosa a `setearStock(inventoryItemId, nuevoValor, desde,
  locationId)`, con `desde` como `changeFromQuantity`. "Ninguna mutación" quiere decir cero
  llamadas para ese SKU, no una llamada con el mismo valor.
- `<V>/<V>/…` lista los `available` en el orden V1, V2, … de la tabla de variantes del archivo.
- Un contador del `[RESUMEN]` "+1" es por SKU, no por variante. Los contadores de resultado
  existentes (`actualizado`, `sin_cambios`, `error`, `dry`, `saltado`) son uno por SKU, porque
  `total` es la cantidad de SKUs (`src/sync.js:1255`).
- Toda línea `[UNIVERSAL]` y todo `[ERROR]` nuevo de esta feature lleva el prefijo
  `<par>/<sku>` (R-8): en el par DOT, `  [UNIVERSAL] dot/<sku>: …` y `  [ERROR] dot/<sku>: …`.

Última actualización: 03/11/2026, alineada con el contrato final (R-1 a R-19, CA-1 a CA-14).
