# CA-8 — Contabilium cambia mientras hay un pendiente

Cubre: **R-12** (y R-11 y R-13 en el cierre).

Comando de referencia: `node --test test/sku-universal-pendiente-contabilium.test.js`.

SKU: `APPLYFIT-CLEAR-S24-S25`, con V1 (`8030001`/`9030001`) y V2 (`8030002`/`9030002`) de
`escenarios-ca3-dos-variantes.md`. Par `dot`. Corridas incrementales **encadenadas sobre la misma
libreta** (cada una arranca con lo que la anterior dejó en disco). Todos los valores son
**inventados** (los del ejemplo normativo de CA-8). Contexto común **C0** del `README.md` en
todas: clasificador `ok`, sin líneas acreditables ni notas de crédito (`credito 0`), compuerta
que no alcanza y `DRY_RUN=false`. La caché `sku-map.json` es `{sku: "gid://shopify/InventoryItem/9030001"}`
en todas las corridas.

## Cadena principal: Contabilium sube de 13 a 15 durante el pendiente

### Corrida 1 — nace el pendiente

| Estado inicial | Valor |
|---|---|
| `contabilium[sku]` / `skus[sku]` | `10` / `10` |
| `destinos[sku]` | `9030001` |
| `pendiente[sku]` / `escrito[sku]` | ninguna / `5` |
| Contabilium | `13` |
| Respuesta | 5/5 |
| Falla inyectada | la mutación de V2 (`9030002`) rechaza |

**Resultado:** camino (c), referencia `5 − 0 = 5`, delta `+3`, `nuevoValor 8`. Se persiste
`pendiente[sku] = {8, 13, desde 5/5}` antes de mutar. `mutar(9030001, 8, 5)` sale bien y la de
V2 falla. En disco: `pendiente {8, 13, desde 5/5}`, `contabilium 10`, `skus 10`, `escrito 5`.
Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 8 PENDIENTE (escritas=1, ya_estaban=0, fallidas=1)`.
`universales_pendientes=1`.

### Corrida 2 — Contabilium ya está en 15: se termina lo pendiente

| Estado inicial | Valor |
|---|---|
| Libreta | la que dejó la corrida 1 (`pendiente {8, 13, desde 5/5}`, baseline 10, `skus` 10, `escrito` 5) |
| Contabilium | **`15`** |
| Respuesta | 8/5 |

**Resultado exacto**

- El 15 no se usa para nada de este SKU. Exactamente 1 mutación: `mutar(9030002, 8, 5, DOT)`.
  Ninguna mutación con valor 10 (`8 + 15 − 13`) ni 13 (`5 + 15 − 10`).
- En disco, en una sola persistencia: `pendiente` ausente, `contabilium 13` y `skus 13` (el
  `contabiliumObjetivo`, **no** 15), y `escrito 8`.
- Log: `  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 8 (escritas=1, ya_estaban=1) [reintento]`.
- `universales=1`, `universales_pendientes=0`.

### Corrida 3 — el cambio que esperó se aplica como delta normal

| Estado inicial | Valor |
|---|---|
| Libreta | la que dejó la corrida 2 (sin `pendiente`, baseline 13, `skus` 13, `escrito` 8) |
| Contabilium | `15` |
| Respuesta | 8/8 |

**Resultado exacto:** hay búsqueda (`skus 13 ≠ 15`; y de todos modos aplicaría R-14). Camino (c):
referencia `8 − 0 = 8`, delta `15 − 13 = +2`, `nuevoValor 10`. Se persiste
`pendiente {10, 15, desde 8/8}`. 2 mutaciones: `mutar(9030001, 10, 8)` y `mutar(9030002, 10, 8)`.
Libreta final: `contabilium 15`, `skus 15`, `escrito 10`, sin `pendiente`. Log:
`  [UNIVERSAL] dot/APPLYFIT-CLEAR-S24-S25: 2 variantes -> 10 (escritas=2, ya_estaban=0)`.

En toda la cadena el +2 se aplicó **una sola vez** y el +3 **una sola vez**: el resultado final
(10) es `5 + 3 + 2`.

## Cadena espejo: Contabilium baja de 13 a 11 durante el pendiente

Mismo estado inicial y misma corrida 1.

- **Corrida 2'**, Contabilium **`11`**, respuesta 8/5: exactamente 1 mutación,
  `mutar(9030002, 8, 5)` (nunca 6 = `8 + 11 − 13`). Cierre: `contabilium 13`, `skus 13`,
  `escrito 8` y sin `pendiente`.
- **Corrida 3'**, Contabilium `11`, respuesta 8/8: delta `11 − 13 = −2` y `nuevoValor 6`. 2
  mutaciones, `mutar(9030001, 6, 8)` y `mutar(9030002, 6, 8)`. Libreta: `contabilium 11`,
  `escrito 6`.
