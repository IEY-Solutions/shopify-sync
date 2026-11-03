# T06 — Camino universal en `ejecutarPar` (sin pendiente previo)

- **Departamento:** backend
- **Dificultad:** difícil
- **Presupuesto:** 3 intentos. Es la integración central: une T03, T04 y T05 dentro de
  `ejecutarParEnCorrida` (`src/sync.js:922-1288`, unas 370 líneas con atajo, crédito, compuerta,
  `cambioDeDestino` y checkpoint entrelazados) y escribe dos archivos de test con muchos escenarios.
  Conviene darla a un escalón superior al `implementador` rápido.
- **Depende de:** T03, T04, T05
- **Requisitos:** R-2, R-3, R-4, R-5, R-7, R-9, R-10 (persistir antes de mutar, persistencia
  fallida, DRY_RUN), R-13 (guardar `escrito` al resolver), R-14 (bypass del atajo)
- **Criterios:** CA-2, CA-3

## Resultado verificable

En `ejecutarParEnCorrida`, para un SKU de la lista curada **sin entrada pendiente**:

1. **Bypass del atajo (R-14).** El atajo de `src/sync.js:1087` no aplica a los 7 curados, en
   corridas incrementales y con `--full`. Para el resto del catálogo sigue igual. Es una condición
   adicional, no reemplaza las otras.
2. **Resolución multi-variante (T03).** Si falla el conteo, se emite `[ERROR] <par>/<sku>: …`, no
   hay ninguna mutación y el SKU no queda resuelto. Nunca se emite `[AVISO]` de duplicados ni
   suma al contador `duplicados`.
3. **Cálculo único (T04).** El camino sale de la libreta: baseline `null` va a siembra; sin
   `escrito`, a bootstrap; con `escrito`, al camino normal. Para estos 7 SKUs **no aplica** el
   chequeo `cambioDeDestino` (`src/sync.js:1134-1151`): actualizar `destinos[sku]` nunca siembra,
   ni siquiera con un destino heredado distinto (CA-2 I, I′).
4. **Journal antes de mutar (R-10).** Si alguna variante difiere de `nuevoValor`, la entrada
   pendiente se persiste en disco antes de la primera mutación. Si esa persistencia falla, no hay
   ninguna mutación y se emite exactamente
   `  [ERROR] <par>/<sku>: no se pudo persistir la entrada pendiente, no se escribe`.
5. **N escrituras (R-5).** Se llama a `setearStock` solo en las variantes que difieren, con
   `changeFromQuantity` igual al `available` leído de esa variante.
   - Si las N quedan confirmadas: en **una** persistencia se borra la entrada, `escrito` pasa a
     `nuevoValor` (en siembra, al absoluto), el baseline avanza una vez y `destinos[sku]` pasa al
     `inventoryItemId` numéricamente más chico.
   - Si alguna falla: `[ERROR]` por variante fallida, no se revierte nada, baseline, destino y
     `escrito` no avanzan, la entrada queda y el SKU suma al mismo contador de errores de hoy.
6. **DRY_RUN.** No persiste ni muta.

La línea `[UNIVERSAL]` y las claves del `[RESUMEN]` son de T09. Acá se pueden dejar sin emitir,
pero los `[ERROR]` de este camino ya nacen con el prefijo `<par>/<sku>`. El reintento de un
pendiente existente es de T07: si una corrida encuentra uno, por ahora no escribe ni lo pisa.

## Archivos permitidos

- Editar: `src/sync.js` (`ejecutarParEnCorrida` y helpers nuevos; no tocar `procesarSku` ni
  `syncUnSku`)
- Crear: `test/sku-universal-5-variantes.test.js`, `test/sku-universal-2-variantes.test.js`
- Editar solo para agregar: `test/_helpers-sku-universal.js`

## Evidencia a seguir

- `escenarios-ca2-cinco-variantes.md` completo (A, A′, B, C, D, D2, E, F1-F4, G, H, I, I′)
- `escenarios-ca3-dos-variantes.md` completo (A a G, incluye Galerías Pacífico y el orden del gid)
- `README.md` de la evidencia, "Contexto común C0" y "Pares"

## Gate

```
node --test test/sku-universal-5-variantes.test.js
node --test test/sku-universal-2-variantes.test.js
npm test
```

## Fuera de alcance

Reintento (T07), `[UNIVERSAL]` y `[RESUMEN]` (T09), crédito y siembra con fallo (T10), `null`
(T11), compuerta (T12) y `--sku` (T13).
