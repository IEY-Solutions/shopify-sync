# T09 — Línea `[UNIVERSAL]`, `[RESUMEN]` y no-regresión de duplicados no curados

- **Departamento:** backend
- **Dificultad:** media
- **Presupuesto:** 2 intentos
- **Depende de:** T08 (CA-5 necesita el reintento para el sufijo ` [reintento]` y la forma
  PENDIENTE)
- **Requisitos:** R-8, R-6
- **Criterios:** CA-4, CA-5

## Resultado verificable

- Una línea por SKU universal procesado que no quedó sin cambios, carácter a carácter:
  - `  [UNIVERSAL] <par>/<sku>: <N> variantes -> <V> (escritas=<E>, ya_estaban=<Y>)`
  - `  [UNIVERSAL] <par>/<sku>: <N> variantes -> <V> PENDIENTE (escritas=<E>, ya_estaban=<Y>, fallidas=<F>)`
  - `  [UNIVERSAL] <par>/<sku>: <N> variantes -> <V> (no se escribe, DRY_RUN=true)`

  Al retomar un pendiente lleva el sufijo ` [reintento]`. No se emite si falló la persistencia de
  R-10, ni para un SKU sin cambios (salvo `[OK]` en modo verboso, como hoy).
- `[RESUMEN]` del par (`src/sync.js:1276`) con `universales=<k>` y `universales_pendientes=<p>`
  siempre presentes, también en 0, junto a las claves existentes y sin nombrar SKUs.
  - `universales` cuenta el universal que ya estaba en `nuevoValor` y queda en 0 en DRY_RUN.
  - `universales_pendientes` cuenta las entradas pendientes al terminar.
  - Un universal nunca incrementa `duplicados`.
- Un duplicado no curado (`IEY-COMBO-CARBON-VERDE-IP16E` y el control inventado de CA-4 C) sigue
  byte a byte con "variante establecida + `[AVISO]`" o con `SkuAmbiguoError` sin escritura.

## Archivos permitidos

- Editar: `src/sync.js` (log y resumen de `ejecutarParEnCorrida`)
- Crear: `test/sku-no-universal-sin-regresion.test.js`, `test/resumen-universales.test.js`
- Editar solo para agregar: `test/_helpers-sku-universal.js`

Nota: `src/resultado.js` es de solo lectura. Si `evaluarCorrida` rechazara las claves nuevas, va
en Dudas.

## Evidencia a seguir

- `escenarios-ca4-no-regresion.md` A, B, C
- `escenarios-ca5-resumen.md` A a H (H: prefijo obligatorio también en los `[ERROR]` de T06, T07)

## Gate

```
node --test test/sku-no-universal-sin-regresion.test.js
node --test test/resumen-universales.test.js
npm test
```
