# T03 — Resolución multi-variante en `src/shopify.js`

- **Departamento:** backend
- **Dificultad:** media
- **Presupuesto:** 2 intentos
- **Depende de:** T02 (sin la migración, los tests de `verificar-cache-sku` se rompen acá)
- **Requisitos:** R-2, R-7, R-6 (la resolución de un no curado no cambia)
- **Criterios:** ningún CA completo. Test de apoyo `test/sku-universal-resolucion.test.js`, que
  cubre a nivel resolución los subcasos de CA-2 (conteo F1-F4, caché en sus tres estados) y de
  CA-14 D1-D3. CA-2 se cierra en T06.

## Resultado verificable

Para un SKU de la lista curada (T01), con la misma `QUERY_POR_SKU` (`sku:"..."` entre comillas),
el mismo tope `CANDIDATOS_POR_SKU` y la misma verificación de `node.sku` exacto, la resolución
devuelve **todas** las variantes exactas. Cada una trae su `variantId`, su `inventoryItemId` y su
`available`; un `null` se conserva tal cual para que T11 distinga los casos de R-18.

- Para un curado nunca lanza `SkuAmbiguoError`, haya o no entrada en caché, esté vencida o no.
  La caché no elige "la" candidata.
- Control de R-7 contra la cantidad **esperada** de la lista: con menos o más exactas sin llegar
  al tope, es error. Si llega al tope sin completar la cantidad esperada, también es error.
  Exactamente la cantidad esperada al tope no es error (F2). Cómo se señala el error (excepción
  propia o resultado marcado) lo decide el implementador, pero tiene que permitir que T06 emita
  `[ERROR] <par>/<sku>: …` sin escribir nada.
- Para cualquier SKU no curado, `resolverSku` devuelve exactamente lo mismo que hoy. Lo prueban
  los `test/cache-sku-*.test.js` y `test/sku-match.test.js` sin cambios.

Decisión de forma: el camino de un curado no tiene que cambiar lo que hoy reciben `ejecutarPar` y
`procesarSku` para los no curados. Puede ser una función nueva exportada o una forma de retorno
distinta solo para curados; elegí el diff más chico.

## Archivos permitidos

- Editar: `src/shopify.js`
- Crear: `test/sku-universal-resolucion.test.js`, `test/_helpers-sku-universal.js` (fixtures V1…V5
  de CA-2, `803000k` de CA-3, consulta inyectada)

## Evidencia a seguir

- `escenarios-ca2-cinco-variantes.md` F1, F2, F3, F4 y A (ids V1…V5 `801000k`/`901000k`)
- `escenarios-ca14-sku-puntual.md` D1, D2, D3 (caché sin entrada, vencida con `9010099`, presente)
- `README.md` de la evidencia, "Contexto común C0" (`first: 10`, `hasNextPage`)

## Gate

```
node --test test/sku-universal-resolucion.test.js
npm test
```

## Fuera de alcance

Escribir stock, libreta, `ejecutarPar` y `procesarSku`.
