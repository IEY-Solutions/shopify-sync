# T14 — Pasada final: suite completa y los 14 CA juntos

- **Departamento:** backend
- **Dificultad:** fácil
- **Presupuesto:** 1 intento. La tarea no edita nada: corre y reporta. Si algo da rojo no se
  arregla acá. El orquestador reabre la `T#` dueña del CA rojo con su presupuesto.
- **Depende de:** T01 a T13
- **Requisitos:** R-9, R-15
- **Criterios:** CA-6, más la verificación conjunta de CA-1 a CA-14

## Resultado verificable

- `npm test` en verde, con la cuenta de tests y sin ningún `skip`, `todo` ni `only` nuevo.
- Los 14 comandos de CA del contrato, en verde.
- `git diff --stat` contra `3abeda7` muestra cambios **solo** en:
  - `src/shopify.js` y `src/sync.js`;
  - los 5 archivos de fixture migrados por T02;
  - los tests nuevos de CA y de apoyo;
  - `test/_helpers-sku-universal.js`.
  
  No hay cambios en `aceptacion/**`, `.agents/.arn/feature.md`, `src/main.js`, `src/argv.js`,
  `src/resultado.js` ni `.github/**`.
- `ai/scripts/verify.sh` en verde.
- Ningún test existente borrado: la lista de `test/*.test.js` de `3abeda7` está completa.

## Archivos permitidos

Ninguno (solo lectura y comandos).

## Gate

```
npm test
node --test test/skus-universales-lista.test.js
node --test test/sku-universal-5-variantes.test.js
node --test test/sku-universal-2-variantes.test.js
node --test test/sku-no-universal-sin-regresion.test.js
node --test test/resumen-universales.test.js
node --test test/sku-universal-pendiente.test.js
node --test test/sku-universal-pendiente-contabilium.test.js
node --test test/sku-universal-ventas-individuales.test.js
node --test test/migracion-fixture-cache-sku.test.js
node --test test/sku-universal-compuerta-absoluta.test.js
node --test test/sku-universal-pendiente-credito-siembra.test.js
node --test test/sku-universal-no-activada.test.js
node --test test/sku-universal-sku-puntual.test.js
ai/scripts/verify.sh
```

Después va el cierre de `arn` (`arn verificar`, `arn juzgar`, `arn cerrar`). Lo corre el
orquestador, no el implementador. Quien implementó no aprueba.
