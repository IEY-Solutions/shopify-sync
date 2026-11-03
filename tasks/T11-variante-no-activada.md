# T11 — Variante universal no activada (los dos casos de R-18)

- **Departamento:** backend
- **Dificultad:** media
- **Presupuesto:** 2 intentos
- **Depende de:** T10
- **Requisitos:** R-18 (fuera de la compuerta)
- **Criterios:** CA-13 completo salvo A-3.2, que necesita la compuerta y se agrega en T12

## Por qué va antes de la compuerta (cambio respecto de la sugerencia)

CA-11 §5 y §5b prueban R-18 **bajo** la compuerta. Si R-18 ya está resuelto en la corrida normal,
T12 solo tiene que reutilizarlo.

## Resultado verificable

- **(a) Las N variantes en `available null`.** Es `no_activado` benigno, igual que un no curado
  hoy (`src/sync.js:1146-1148`). Sin `[ERROR]` nuevo, sin contador de errores, sin cálculo, sin
  entrada pendiente y sin mutación. Si es el único SKU del par, `evaluarCorrida` sigue con su regla
  de "corrida vacía" sin cambios (A-2).
- **(b) Algunas `null` y otras activadas.** Es error. Ningún camino de R-4, ninguna entrada
  pendiente, ninguna mutación en **ninguna** variante. Se emite una línea por cada variante
  `null`, exactamente
  `  [ERROR] <par>/<sku>: variante <variantId> no esta activada en la location del par, no se resuelve`.
  El SKU queda no resuelto y suma al contador de errores.
- Con una entrada pendiente previa, en (a) o en (b), la entrada queda intacta. `null` nunca entra
  en el máximo ni en la resta de T04.

## Archivos permitidos

- Editar: `src/sync.js` (camino universal de `ejecutarParEnCorrida`)
- Crear: `test/sku-universal-no-activada.test.js` (todo menos A-3.2)
- Editar solo para agregar: `test/_helpers-sku-universal.js`

## Evidencia a seguir

- `escenarios-ca13-no-activada.md`: B-1 a B-6, A-1, A-2, A-3.1, A-4, A-4′
  (`APPLYFIT-CLEAR-IP16PM-17PM`, ids `813000k`/`913000k`, par `galerias-pacifico`)

## Gate

```
node --test test/sku-universal-no-activada.test.js
npm test
```
