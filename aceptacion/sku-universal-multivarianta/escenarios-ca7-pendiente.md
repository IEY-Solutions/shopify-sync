# CA-7 — Journal pendiente, fallo parcial, reintento y crash (hallazgo B-1)

Cubre: **R-4, R-5, R-10, R-11**.

Comando de referencia: `node --test test/sku-universal-pendiente.test.js`.

SKU: `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`, con las variantes V1…V5 y los ids de
`escenarios-ca2-cinco-variantes.md`. Par `dot`. Todos los valores de Contabilium y los
`available` de este archivo son **inventados** (son los del ejemplo normativo de R-11 y CA-7).
Contexto común **C0** del `README.md` en todos los pasos: clasificador `ok`, sin líneas
acreditables ni notas de crédito (`credito 0`), compuerta que no alcanza, incremental y
`DRY_RUN=false`, salvo que el paso diga otra cosa.

**Registro de eventos.** El test inyecta la persistencia de la libreta y la mutación, y anota en
un único array ordenado cada evento: `guardar(libreta)` (con una copia profunda del contenido
persistido) y `mutar(inventoryItemId, valor, desde, locationId)`. "En disco" quiere decir el
contenido del último `guardar` exitoso.

## Estado inicial S0 (se usa en 1, 2, 4, 7 y 8)

| Campo | Valor |
|---|---|
| Caché `sku-map.json` | `{sku: "gid://shopify/InventoryItem/9010001"}` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `destinos[sku]` | `gid://shopify/InventoryItem/9010001` |
| `pendiente[sku]` | ninguna |
| `escrito[sku]` | ninguno (camino de bootstrap; con las 5 iguales da la misma referencia que el camino normal) |
| Contabilium | `13` |
| Respuesta | V1…V5 con 5/5/5/5/5, `hasNextPage: false` |

`nuevoValor = 5 + (13 − 10) = 8`.

---

## 1 — Orden: el journal se persiste ANTES de la primera mutación (R-10)

S0, sin fallas.

- Hay un evento `guardar` cuyo contenido incluye `pendiente[sku] = {nuevoValor: 8,
  contabiliumObjetivo: 13, variantes: [{8010001, 9010001, desde 5}, {8010002, 9010002, 5},
  {8010003, 9010003, 5}, {8010004, 9010004, 5}, {8010005, 9010005, 5}]}`, y su índice en el
  registro es **menor** que el de cualquier `mutar` de este SKU.
- En ese `guardar`, `contabilium[sku]` sigue en 10 (el baseline no avanzó antes de escribir).
- Después vienen 5 `mutar(9010001…9010005, 8, 5, DOT)`.
- El último `guardar` tiene `pendiente[sku]` ausente, `contabilium 13`, `skus 13` y `escrito 8`, y
  **no** existe ningún `guardar` intermedio sin el pendiente y con el baseline todavía en 10.

## 2 — Fallo parcial: falla la mutación de la tercera (R-5, R-10)

S0, con la mutación de V3 (`9010003`) rechazando.

- `mutar` exitosos: V1, V2, V4 y V5, cada uno con `(…, 8, 5)`. El de V3 falla. No hay ninguna
  mutación de reversión.
- En disco al terminar: `pendiente[sku] = {8, 13, desde 5/5/5/5/5}` (idéntica a la de 1),
  `contabilium 10`, `skus 10`, `destinos 9010001` y `escrito` ninguno.
- Log: una línea que empieza con `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: ` (por V3),
  y la línea
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 PENDIENTE (escritas=4, ya_estaban=0, fallidas=1)`.
- `error=1`, `universales=0`, `universales_pendientes=1`.

Llamamos **S2** al estado en disco que deja este paso (con la caché todavía en `9010001`).

## 3 — Reintento: retoma el MISMO nuevoValor (R-11; ejemplo normativo de B-1)

Estado inicial **S2**: `pendiente[sku] = {8, 13, desde 5/5/5/5/5}`, baseline 10, `skus` 10,
`destinos 9010001`, sin `escrito`. Contabilium **13**. Respuesta **8/8/5/8/8**.

- Sin delta, sin máximo y sin `escrito`: V1, V2, V4 y V5 están en `nuevoValor`, así que caen en
  (a). V3 está en `desde`, así que cae en (b).
- Exactamente **una** mutación en la corrida: `mutar(9010003, 8, 5, DOT)`. **Ninguna** mutación
  con el valor 11 (lo que daría `max 8 + delta 3`).
- Un solo `guardar` posterior cierra todo: `pendiente[sku]` ausente, `contabilium 13`, `skus 13` y
  `escrito 8`.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 (escritas=1, ya_estaban=4) [reintento]`.
- `actualizado=1`, `error=0`, `universales=1`, `universales_pendientes=0`.

## 4 — Crash a mitad de las escrituras (R-10)

S0. La **3.ª** llamada a `mutar` simula la muerte del proceso: el test toma una copia de lo que hay
en disco en ese instante y aborta la corrida (la llamada rechaza con un error que el test marca
como fatal; lo posterior se descarta). Antes hubo 2 mutaciones exitosas, V1 y V2.

- En disco en el instante del crash: `pendiente[sku] = {8, 13, desde 5/5/5/5/5}`, `contabilium 10`
  y `escrito` ninguno.
- Corrida siguiente desde ese disco, con Contabilium 13 y respuesta **8/8/5/5/5**: exactamente 3
  mutaciones, `mutar(9010003, 8, 5)`, `mutar(9010004, 8, 5)` y `mutar(9010005, 8, 5)`. Ninguna en
  V1 ni V2, y ninguna con el valor 11.
- Al cerrar: `pendiente` ausente, `contabilium 13`, `escrito 8`. Log:
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 (escritas=3, ya_estaban=2) [reintento]`.

## 5 — Variante movida durante el pendiente (R-11 c)

Estado inicial S2. Contabilium 13. Respuesta **8/8/4/8/8** (una venta online en V3 después del
intento anterior: `desde` era 5).

- **Cero** mutaciones.
- Log, caracter a caracter:
  `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: variante gid://shopify/ProductVariant/8010003 cambio durante un pendiente universal (desde=5, actual=4, pendiente=8) -> no se escribe`
  y `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 PENDIENTE (escritas=0, ya_estaban=4, fallidas=1) [reintento]`.
- En disco: `pendiente[sku] = {8, 13, …}` sigue, `contabilium 10`, `escrito` ninguno.
- `error=1`, `universales=0`, `universales_pendientes=1`.

**5d — una variante en (b) y otra en (c) en la misma corrida.** S2, respuesta **8/5/4/8/8**.
Exactamente 1 mutación, `mutar(9010002, 8, 5)` (V2 cae en b). V3 cae en (c) y no se escribe, con
el `[ERROR]` literal de arriba. Sigue pendiente. Log:
`  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 PENDIENTE (escritas=1, ya_estaban=3, fallidas=1) [reintento]`.

**5b — falta una variante de la entrada.** S2, respuesta con V1…V4 solamente (8/8/5/8). **Cero**
mutaciones, ni siquiera en V3. Una línea que empieza con
`  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: `. El `pendiente` sigue en disco y
`universales_pendientes=1`.

**5c — aparece una variante exacta nueva.** S2, respuesta con V1…V5 en 8/8/5/8/8 más **V6**
(`gid://shopify/ProductVariant/8010006`, `gid://shopify/InventoryItem/9010006`, sku exacto,
`available` 0). Cero mutaciones (ni en V3 ni en V6). Una línea que empieza con
`  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: `. El `pendiente` sigue.

## 6 — El atajo del incremental no saltea un SKU con pendiente (R-11, R-14)

Estado inicial S2 (`skus[sku] = 10`). Contabilium **10**: igual al valor del atajo, así que un SKU
común quedaría `saltado`. Respuesta 8/8/5/8/8.

- Hay búsqueda exacta para el SKU, y `saltado` no suma por él.
- Exactamente 1 mutación, `mutar(9010003, 8, 5)`. Se termina el pendiente con su `nuevoValor` 8;
  el 10 de esta corrida no se usa (R-12).
- Al cerrar: `contabilium 13` y `skus 13` (el `contabiliumObjetivo`, no el 10 de esta corrida), y
  `escrito 8`. La corrida siguiente verá el delta `10 − 13 = −3`.

**6b — `--full`.** El mismo paso con `full: true`: el mismo resultado exacto.

## 7 — Falla la persistencia del journal (R-10)

S0. El primer `guardar` que intenta incluir `pendiente[sku]` rechaza; los siguientes funcionan.

- **Cero** mutaciones de este SKU.
- Log, caracter a caracter (literal de R-10):
  `  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: no se pudo persistir la entrada pendiente, no se escribe`
- La salida **no** contiene ninguna línea que empiece con
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E` (R-10: esa línea implica que se intentó
  escribir).
- En disco al terminar: `pendiente[sku]` ausente, `contabilium 10`, `skus 10`, `escrito` ninguno.
- `error=1`, `universales=0`, `universales_pendientes=0`.

## 8 — DRY_RUN (R-10)

S0 con `DRY_RUN=true`.

- **Cero** eventos `guardar` y **cero** `mutar`.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 8 (no se escribe, DRY_RUN=true)`.
- `dry=1`, `universales=0`, `universales_pendientes=0`.

## 9 — Otras persistencias, libreta vieja y entrada mal formada (R-10)

**9a — un checkpoint no borra el pendiente.** S0 más un segundo SKU después en el stock,
`FUNDA-TEST-UNICA` (el de CA-5 B: caché y `destinos` en `9060001`, baseline 2, Contabilium 3,
`available` 2), con `checkpointCada: 1` y la misma falla en V3 del paso 2. **Todo** `guardar`
posterior al primero que incluyó el pendiente (el checkpoint tras cada SKU y el guardado final)
contiene `pendiente[sku] = {8, 13, desde 5/5/5/5/5}` sin cambios.

**9b — libreta v2 sin los campos nuevos.** S0 cargado desde una libreta v2 cuyo JSON no tiene
ningún campo de pendientes ni de `escrito`. La carga es válida: no hay `[ERROR]` de libreta y el
resultado es exactamente el del paso 1.

**9c — entrada pendiente mal formada.** S0, pero la libreta trae para el SKU una entrada pendiente
sin la lista de variantes (p. ej. solo `{nuevoValor: 8}`), y además `FUNDA-TEST-UNICA` con
baseline 2. Resultado: una línea que empieza con
`  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: `. La entrada se descarta y el SKU sigue sin pendiente por el
camino de R-4 (bootstrap): con 5/5/5/5/5 escribe 8 en las 5. `FUNDA-TEST-UNICA` conserva su baseline
2 y se procesa normal (`nuevoValor 3`): el resto de la libreta no se invalida.
