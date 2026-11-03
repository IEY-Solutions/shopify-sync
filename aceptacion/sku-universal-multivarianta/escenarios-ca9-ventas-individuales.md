# CA-9 — `escrito`, ventas individuales y bypass del atajo

Cubre: **R-4, R-13, R-14** (y R-10 en los cierres).

Comando de referencia: `node --test test/sku-universal-ventas-individuales.test.js`.

SKU universal: `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`, con V1…V5 de
`escenarios-ca2-cinco-variantes.md`. SKU de control **fuera de la lista**:
`FUNDA-MAGSAFE-MATE-IPHONE16` (nombre real, citado en `AGENTS.md`; ids **inventados**
`gid://shopify/ProductVariant/8090001` / `gid://shopify/InventoryItem/9090001`). Par `dot`.
Consulta, mutación y libreta inyectadas, sin red, con el registro de eventos de CA-7
(`guardar` / `mutar` / búsquedas). Contexto común **C0** del `README.md` en todas las corridas:
clasificador `ok`, sin líneas acreditables ni notas de crédito (`credito 0`), compuerta que no
alcanza, **incremental** (no `--full`) y `DRY_RUN=false`, salvo el paso 9.

Los `available` del paso 1 son **reales** (informe:179-183). El resto de los valores es
**inventado** (los del ejemplo normativo de CA-9).

La caché `sku-map.json` es la misma en todas las corridas:
`{"APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E": "gid://shopify/InventoryItem/9010001", "FUNDA-MAGSAFE-MATE-IPHONE16": "gid://shopify/InventoryItem/9090001"}`.

El control tiene, en todas las corridas, `contabilium 3`, `skus 3`, `destinos 9090001`, sin
`pendiente` ni `escrito`, y Contabilium 3.

## Cadena encadenada (pasos 1 → 2 → 3 → 4, misma libreta)

### Paso 1 — bootstrap → `escrito` (R-4 b, R-13)

| Estado inicial del universal | Valor |
|---|---|
| Formato de la libreta | v2 **sin** ningún campo de `escrito` ni de pendientes |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `destinos[sku]` | `9010001` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / ninguno |
| Contabilium | `10` (sin cambios: sin R-14 sería `saltado`) |
| Respuesta | **7/0/0/0/0** |

**Resultado exacto:** hay búsqueda exacta. Camino (b): referencia `max = 7`, delta 0 y
`nuevoValor 7`. Se persiste `pendiente {7, 10, desde 7/0/0/0/0}` antes de mutar. 4 mutaciones,
`mutar(9010002…9010005, 7, 0)`. V1 ya está en 7 y no recibe ninguna (las 5 terminan en 7, como
pide CA-9). El `guardar` que borra el pendiente es **el mismo** que trae `escrito[sku] = 7`;
`contabilium` sigue en 10. Log:
`  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 7 (escritas=4, ya_estaban=1)`.

### Paso 2 — venta online con Contabilium sin cambios (R-14; resuelve I-2)

Estado inicial: la libreta del paso 1 (`escrito 7`, baseline 10, `skus` 10, sin `pendiente`).
Contabilium **10**. Respuesta **7/6/7/7/7** (una venta online en V2).

**Resultado exacto**

- Hay búsqueda `sku:"APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E"` en esta corrida, aunque
  `skus[sku] === 10 === Contabilium` (un SKU común se saltearía). `saltado` no suma por él.
- Camino (c): referencia `7 − (0+1+0+0+0) = 6`. Delta **0**. `nuevoValor 6`.
- Se persiste `pendiente {6, 10, desde 7/6/7/7/7}`. 4 mutaciones: `mutar(9010001, 6, 7)`,
  `mutar(9010003, 6, 7)`, `mutar(9010004, 6, 7)` y `mutar(9010005, 6, 7)`. V2 no recibe ninguna.
- Libreta: `contabilium 10` (no se mueve), `skus 10`, `escrito 6`, sin `pendiente`.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 6 (escritas=4, ya_estaban=1)`.

Este es el caso de **divergencia con delta 0 real**: con R-14 es el camino normal de cada corrida
para los 7 SKUs. La divergencia que deja una venta online se empareja hacia abajo, sin esperar a
que Contabilium se mueva y sin reportarla como anomalía (no es la divergencia positiva del ADR
0001).

### Paso 3 — sin cambios (R-14, R-8, R-13)

Estado inicial: la libreta del paso 2 (`escrito 6`). Contabilium 10. Respuesta 6/6/6/6/6.

**Resultado exacto:** hay búsqueda exacta. Cero mutaciones. Ningún `guardar` con `pendiente` para
el SKU. Ninguna línea `[UNIVERSAL]`. `escrito` sigue en 6 y `contabilium` en 10. `sin_cambios`
suma 1 por el SKU, `saltado` no suma por él y `universales=1` (R-8: cuenta aunque no emita
`[UNIVERSAL]`). `destinos[sku]` sigue en `9010001`.

### Paso 4 — ventas individuales después del bypass (R-4 c)

Estado inicial: la libreta del paso 3 (`escrito 6`, baseline 10, `skus` 10). Contabilium **9**.
Respuesta **6/6/5/6/6**.

**Resultado exacto:** referencia `6 − 1 = 5`, delta `−1` y `nuevoValor 4` (nunca 5, que daría el
máximo 6). 5 mutaciones: `mutar(9010001, 4, 6)`, `mutar(9010002, 4, 6)`, `mutar(9010003, 4, 5)`,
`mutar(9010004, 4, 6)` y `mutar(9010005, 4, 6)`. Libreta: `contabilium 9`, `skus 9`, `escrito 4`.
Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 4 (escritas=5, ya_estaban=0)`.

### Paso 5 — el control fuera de la lista sigue con el atajo (R-14)

En **cada una** de las corridas de los pasos 1 a 4: **cero** búsquedas para
`FUNDA-MAGSAFE-MATE-IPHONE16`, cero mutaciones para él, y suma `saltado=1` y `sin_cambios=1` como
hoy. En cada corrida hay exactamente **una** búsqueda en total, la del universal. La libreta nunca
guarda `escrito` ni `pendiente` para el control.

## Pasos sueltos (cada uno con su propio estado inicial)

### Paso 2b — suba y venta en la misma corrida, delta 0 (R-4 c)

Estado inicial: la libreta del paso 1 (`escrito 7`, baseline 10, `skus` 10). Contabilium 10.
Respuesta **8/6/7/7/7** (V1 repuesta a mano y una venta en V2). Referencia
`7 − (0+1+0+0+0) = 6` (la suba de V1 aporta 0) y `nuevoValor 6`. 4 mutaciones:
`mutar(9010001, 6, 8)` y `mutar(9010003…9010005, 6, 7)`. V2 no recibe ninguna. `escrito 6`.

### Paso 6 — el cierre de un pendiente deja `escrito` (R-13, R-10)

| Estado inicial | Valor |
|---|---|
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `destinos[sku]` | `9010001` |
| `pendiente[sku]` | `{8, 13, desde 5/5/5/5/5}` |
| `escrito[sku]` | `5` |
| Contabilium | `13` |
| Respuesta | 8/8/8/8/5 |

**Resultado exacto:** 1 mutación, `mutar(9010005, 8, 5)`. Un único `guardar` contiene a la vez
`pendiente` ausente, `escrito 8` (antes 5), `contabilium 13` y `skus 13`.

### Paso 7 — un fallo parcial no toca `escrito` (R-13)

Estado inicial: la libreta del paso 3 (`escrito 6`, baseline 10, `skus` 10, sin `pendiente`).
Contabilium 9. Respuesta 6/6/6/6/6. Falla la mutación de V5. `nuevoValor 5`. En disco al terminar:
`escrito 6` (sin cambios), `pendiente {5, 9, desde 6/6/6/6/6}`, `contabilium 10`.

### Paso 8 — `escrito` mal formado (R-13)

Dos variantes del paso: **8a** con `escrito[sku] = -3` y **8b** con `escrito[sku] = 2.5`. En
ambas: baseline 10, `skus` 10, `destinos 9010001`, sin `pendiente`, el control con baseline 3,
Contabilium 9 y respuesta 6/6/5/6/6.

**Resultado exacto (8a y 8b):** una línea que empieza con
`  [ERROR] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: `. El valor se descarta y el SKU usa el bootstrap: referencia
`max = 6`, delta `−1` y `nuevoValor 5`. Con un `escrito` válido 6 habría dado 4. 4 mutaciones:
`mutar(9010001, 5, 6)`, `mutar(9010002, 5, 6)`, `mutar(9010004, 5, 6)` y `mutar(9010005, 5, 6)`.
V3 ya está en 5. Libreta: `escrito 5`, `contabilium 9`. El control conserva su baseline 3 y sigue
`saltado`: el resto de la libreta no se invalida.

### Paso 9 — DRY_RUN no persiste `escrito` (R-13)

Estado inicial: la libreta del paso 3 (`escrito 6`). Contabilium 9. Respuesta 6/6/5/6/6.
**`DRY_RUN=true`**. Cero `guardar` y cero `mutar`. Log:
`  [UNIVERSAL] dot/APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: 5 variantes -> 4 (no se escribe, DRY_RUN=true)`.
En disco, `escrito` sigue en 6.
