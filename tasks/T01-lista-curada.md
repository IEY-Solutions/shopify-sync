# T01 — Lista curada de SKUs universales

- **Departamento:** backend
- **Dificultad:** fácil
- **Presupuesto:** 2 intentos
- **Depende de:** —
- **Requisitos:** R-1
- **Criterios:** CA-1

## Resultado verificable

`src/shopify.js` exporta una constante con exactamente 7 pares `{sku, variantes}`:
`APPLYFIT-CLEAR-IP16PRO-17-17PRO` 3, `APPLYFIT-CLEAR-S24-S25` 2, `APPLYFIT-CLEAR-IP15-16` 2,
`APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E` 5, `APPLYFIT-CLEAR-IP16PM-17PM` 2,
`APPLYFIT-CLEAR-IP13PM-14PLUS` 2 y `APPLYFIT-CLEAR-S24PLUS-S25PLUS` 2 (18 en total). También exporta
una forma de preguntar si un SKU es universal y cuántas variantes espera. La pertenencia se decide
por igualdad exacta del string completo, nunca por prefijo, extensión ni heurística. El nombre lo
decide el implementador (el contrato sugiere `SKUS_UNIVERSALES`). La lista todavía no cambia
ningún comportamiento.

## Archivos permitidos

- Editar: `src/shopify.js` (solo agregar la constante y su función de consulta)
- Crear: `test/skus-universales-lista.test.js`

## Evidencia a seguir

- `aceptacion/sku-universal-multivarianta/escenarios-ca1-lista-curada.md` §1, §2, §3 (literal
  exacto, suma 18, control contra heurísticas, prefijo y extensión).

## Gate

```
node --test test/skus-universales-lista.test.js
npm test
```

## Fuera de alcance

Usar la lista en `resolverSku`, `ejecutarPar` o `procesarSku`, que corresponde a T03 en adelante.
