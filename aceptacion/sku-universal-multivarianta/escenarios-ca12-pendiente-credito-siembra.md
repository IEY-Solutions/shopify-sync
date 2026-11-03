# CA-12 — Pendiente calculado con crédito o con siembra: no se reintenta solo

Cubre: **R-17** (y R-16 en el escenario 5, incluido el consumo del crédito con motivo
`absoluto` y la resiembra anotada `resembradoPor`/`resembradoEn`; R-11 en el control 4).

Comando de referencia: `node --test test/sku-universal-pendiente-credito-siembra.test.js`.

SKU: `APPLYFIT-CLEAR-S24-S25`, con V1 (`gid://shopify/ProductVariant/8030001`,
`gid://shopify/InventoryItem/9030001`) y V2 (`gid://shopify/ProductVariant/8030002`,
`gid://shopify/InventoryItem/9030002`) de `escenarios-ca3-dos-variantes.md`. Par `dot`. Todos los
valores son **inventados**.

**Contexto.** C0 del `README.md`, **salvo** el crédito donde el escenario lo diga. "Crédito +2"
quiere decir que el registro de comprobantes inyectado trae, para este SKU y el depósito `127356`,
dos líneas Shopify acreditables de 1 unidad cada una, con claves de consumo `K1` y `K2`, todavía
no consumidas, de modo que `creditoAcreditable` da `{credito: 2, claves: [K1, K2]}`. Corridas
automáticas (sin compuerta) salvo en 5. Mismo registro de eventos que CA-7.

**Línea literal de R-17**, que esta evidencia llama **L17**:

```
  [ERROR] dot/APPLYFIT-CLEAR-S24-S25: pendiente universal requiere compuerta manual -> no se escribe
```

`pendiente[sku] = {…, marca}` indica una entrada marcada "requiere compuerta". El nombre del campo
lo decide el implementador.

---

## 1 — Crédito con fallo parcial

**Corrida 1.1**

| Campo | Valor |
|---|---|
| Caché / `destinos[sku]` | `9030001` / `9030001` |
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `pendiente[sku]` | ninguna |
| `escrito[sku]` | `5` |
| Contabilium | `10` (sin cambios; el atajo igual no aplica: crédito ≠ 0, y además R-14) |
| Crédito | **+2** (`K1`, `K2`) |
| Respuesta | 5/5 |
| Falla | la mutación de V2 rechaza |

**Resultado exacto**

- Camino (c): referencia `5 − 0 = 5`. Delta `0`. `nuevoValor = Math.round(5 + 0 + 2) = 7`,
  calculado una vez (R-3).
- Antes del primer `mutar`, un `guardar` con `pendiente[sku] = {nuevoValor: 7,
  contabiliumObjetivo: 10, variantes: [V1 desde 5, V2 desde 5], marca}`.
- `mutar(9030001, 7, 5, DOT)` exitoso. El de V2 falla. Ninguna reversión.
- En disco al terminar: `pendiente[sku] = {7, 10, desde 5/5, marca}`, `contabilium 10`,
  `skus 10`, `escrito 5`, `destinos 9030001`. Las claves `K1` y `K2` **no** están en los consumos
  de la libreta: el crédito no se consumió.
- Log, en esta corrida:
  - una línea que empieza con `  [ERROR] dot/APPLYFIT-CLEAR-S24-S25: ` (por V2, R-5);
  - `  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 7 PENDIENTE (escritas=1, ya_estaban=0, fallidas=1)`;
  - **L17**, exactamente una vez.
- `error=1`, `universales=0`, `universales_pendientes=1`, `causa_venta_shopify=0`.

**Corrida 1.2, sobre el disco de 1.1.** Contabilium `10`, el **mismo** crédito +2 (`K1`, `K2`
siguen sin consumir), respuesta **7/5**.

- **Cero** mutaciones de este SKU. En particular, ningún `mutar` con valor 7 sobre V2 (lo que
  haría un reintento de R-11 b) ni con valor 9 (`7 + 2`, crédito aplicado dos veces), en ninguna
  variante.
- No se calcula delta, no se toma máximo, no se usa `escrito` ni el Contabilium de la corrida.
- Log: **L17** otra vez, exactamente una vez. Ninguna línea del `[ERROR]` de R-11(c).
- En disco: la entrada `{7, 10, desde 5/5, marca}` sin cambios, `contabilium 10`, `skus 10`,
  `escrito 5`. `K1` y `K2` siguen sin consumir.
- `error=1`, `universales=0`, `universales_pendientes=1`.

**Corrida 1.3, sobre el disco de 1.2, con `--full`.** Mismo resultado exacto que 1.2 (R-17: "en
cada corrida siguiente").

## 2 — Siembra con fallo parcial

**Corrida 2.1**

| Campo | Valor |
|---|---|
| Caché | sin entrada |
| `contabilium[sku]` / `skus[sku]` | ausente / ausente (baseline `null`) |
| `destinos[sku]` | ausente |
| `pendiente[sku]` / `escrito[sku]` | ninguna / ninguno |
| Contabilium | `6` |
| Crédito | 0 (C0) |
| Respuesta | 0/0 |
| Falla | la mutación de V2 rechaza |

**Resultado exacto**

- Camino (a): `nuevoValor = Math.round(6) = 6`.
- Antes del primer `mutar`: `pendiente[sku] = {6, 6, desde 0/0, marca}`.
- `mutar(9030001, 6, 0, DOT)` exitoso, el de V2 falla.
- En disco: `pendiente[sku] = {6, 6, desde 0/0, marca}`. `contabilium[sku]`, `skus[sku]`,
  `destinos[sku]` y `escrito[sku]` siguen **ausentes**. `resembradoEn[sku]` y `resembradoPor[sku]`
  no se escriben.
- Log: `[ERROR]` por V2 con prefijo `dot/APPLYFIT-CLEAR-S24-S25`,
  `  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 6 PENDIENTE (escritas=1, ya_estaban=0, fallidas=1)`
  y **L17**.
- `error=1`, `universales_pendientes=1`.

**Corrida 2.2, sobre el disco de 2.1.** Contabilium `6`, respuesta **6/0**.

- **Cero** mutaciones. Ningún `mutar(9030002, 6, 0)`.
- Log: **L17**.
- En disco: la entrada marcada sin cambios. El baseline sigue ausente.
- `error=1`, `universales_pendientes=1`.

**Corrida 2.3, sobre el disco de 2.2.** Contabilium **`9`**, respuesta 6/0. Mismo resultado
exacto que 2.2. Ningún `mutar` lleva 9 (una nueva siembra) ni 3 (un delta contra el 6).

## 3 — Crédito sin fallo: se resuelve normal

El estado de la corrida 1.1, **sin** falla.

- El primer `guardar` antes de mutar tiene la entrada `{7, 10, desde 5/5, marca}` (se persiste
  marcada igual, R-17).
- Exactamente 2 mutaciones: `(9030001, 7, 5)` y `(9030002, 7, 5)`.
- Último `guardar`: `pendiente[sku]` ausente, `contabilium 10`, `skus 10`, `escrito 7`,
  `destinos 9030001`. `K1` y `K2` quedan consumidas, cada una una sola vez (como una resolución
  normal de hoy, `src/sync.js:1223-1228`).
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 7 (escritas=2, ya_estaban=0)`.
  **No** contiene L17.
- `error=0`, `universales=1`, `universales_pendientes=0`, `causa_venta_shopify=2`.

## 4 — Control: sin crédito ni siembra, el pendiente se reintenta solo (R-11)

**Corrida 4.1.** Igual que 1.1, salvo **crédito 0** y Contabilium **`12`**. La mutación de V2
rechaza.

- Camino (c): referencia 5, delta `+2`, `nuevoValor 7`.
- Antes de mutar: `pendiente[sku] = {7, 12, desde 5/5}`, **sin** marca.
- `mutar(9030001, 7, 5)` exitoso, V2 falla.
- Log: `[ERROR]` por V2 y la línea `[UNIVERSAL] … 2 variantes -> 7 PENDIENTE (escritas=1, ya_estaban=0, fallidas=1)`.
  **No** contiene L17.
- En disco: `pendiente {7, 12, desde 5/5}` sin marca, `contabilium 10`, `escrito 5`.

**Corrida 4.2, sobre el disco de 4.1.** Contabilium `12`, crédito 0, respuesta 7/5.

- Exactamente **1** mutación: `(9030002, 7, 5)` (R-11 b).
- Último `guardar`: `pendiente` ausente, `contabilium 12`, `skus 12`, `escrito 7`.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 7 (escritas=1, ya_estaban=1) [reintento]`.
  **No** contiene L17.
- `universales=1`, `universales_pendientes=0`, `error=0`.

## 5 — La compuerta de R-16 cierra una entrada marcada

**Corrida 5, con compuerta** (`escrituraAbsoluta = new Set(["APPLYFIT-CLEAR-S24-S25"])`), sobre
el disco de la corrida 1.2: `pendiente {7, 10, desde 5/5, marca}`, `contabilium 10`, `escrito 5`,
`K1` y `K2` sin consumir. Contabilium `10`, respuesta 7/5. El registro de comprobantes es el
**mismo** de 1.1 y 1.2: `K1` y `K2` siguen ahí, activas, con `referencia` anterior al inicio de
la lectura de esta corrida (la condición de consumo de la compuerta, `src/sync.js:1219`).

- La entrada marcada se descarta. Antes del primer `mutar`, un `guardar` con `pendiente[sku] =
  {nuevoValor: 10, contabiliumObjetivo: 10, variantes: [V1 desde 7, V2 desde 5], marca}`.
- Valor absoluto `Math.round(10) = 10`, **sin** crédito (ningún `mutar` lleva 12).
- Exactamente 2 mutaciones: `(9030001, 10, 7)` y `(9030002, 10, 5)`. Ninguna lleva 7 (el
  `nuevoValor` de la entrada marcada).
- El `guardar` previo al primer `mutar` **no** tiene `K1` ni `K2` en `consumos`.
- Último `guardar`: `pendiente[sku]` ausente, `contabilium 10`, `skus 10`, `escrito 10`,
  `destinos 9030001` y, en esa **misma** persistencia, el crédito marcado consumido:
  `consumos[K1]` y `consumos[K2]` con `motivo: "absoluto"` y `cantidad: 1` cada una. Exactamente
  esas 2 claves para el SKU, una vez por SKU (no una por variante: ninguna `cantidad` 2) y ninguna
  con `motivo: "delta"`. Ninguna queda sin marcar.
- En esa **misma** persistencia, la resiembra anotada que exige R-16: `resembradoPor[sku] =
  "absoluto"` y `resembradoEn[sku]` igual al `ahora()` inyectado de la corrida 5 (inicio de la
  lectura, en ISO), una sola clave por SKU, como hoy para un no universal
  (`src/sync.js:1213-1215`). En disco al terminar 1.1 y 1.2, las dos están **ausentes**. El
  motivo de que sea obligatoria (una línea de crédito que llega tarde al registro con referencia
  anterior a ese corte no se vuelve a acreditar, `src/sync.js:875-879`) lo prueba
  `escenarios-ca11-compuerta-absoluta.md` 1d / 1d-ctrl.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 10 (escritas=2, ya_estaban=0)`. **No**
  contiene L17.
- Compuerta: aplicado (`compuertaNoAplicados = []`, sin `[COMPUERTA][ERROR]`).
- `universales=1`, `universales_pendientes=0`, `causa_venta_shopify=0`.

**Corrida 5′, automática, sobre el disco de 5.** El **mismo** registro de comprobantes, con `K1`
y `K2` todavía presentes (ahora consumidas en la libreta). Contabilium 10, respuesta 10/10.

- `creditoAcreditable` da crédito **0** porque `K1` y `K2` están consumidas, no porque el
  registro venga vacío. La entrada marcada ya no existe, así que vuelve el camino normal:
  referencia 10, delta 0, `nuevoValor 10`, **cero** mutaciones. Ningún `mutar` lleva 12 (`10 + 2`,
  el crédito sumado otra vez sobre el valor recién emparejado).
- Sin L17. `consumos[K1]` y `consumos[K2]` siguen con `motivo: "absoluto"`.
  `causa_venta_shopify=0`, `universales=1`, `universales_pendientes=0`.

---

## Qué no fija esta evidencia

- Si en las corridas 1.2, 1.3, 2.2 y 2.3 hay o no una línea `[UNIVERSAL]` además de L17. R-17 solo
  nombra L17 para las corridas siguientes, y R-8 no aclara este caso. El test no la exige ni la
  prohíbe.
- (Ya no figura acá la resiembra anotada de la compuerta del escenario 5: R-16 ahora la exige y
  el escenario 5 la fija.)
