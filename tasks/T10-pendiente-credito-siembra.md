# T10 — Pendiente con crédito o siembra: marcado "requiere compuerta"

- **Departamento:** backend
- **Dificultad:** media
- **Presupuesto:** 2 intentos
- **Depende de:** T09 (R-17 exige además la forma PENDIENTE de `[UNIVERSAL]` y
  `universales_pendientes`)
- **Requisitos:** R-17
- **Criterios:** CA-12 §1 a §4. El §5, el cierre por la compuerta, se agrega en T12.

## Resultado verificable

- Si `nuevoValor` salió con crédito acreditable distinto de 0 o por siembra (el camino que
  devuelve T04), la entrada pendiente se persiste antes de mutar **marcada** "requiere compuerta".
  No se guarda el consumo de crédito ni el estado de la siembra.
- Si las N quedan confirmadas en ese intento, el SKU se resuelve normal: se borra la entrada y se
  consume el crédito como hoy.
- Si no, además de los `[ERROR]` por variante y del `[UNIVERSAL] … PENDIENTE`, se emite
  exactamente `  [ERROR] <par>/<sku>: pendiente universal requiere compuerta manual -> no se escribe`.
- En corridas automáticas siguientes, con la entrada marcada: ninguna mutación, ningún cálculo, se
  repite la misma línea `[ERROR]`, el SKU suma al contador de errores y cuenta en
  `universales_pendientes`.
- Sin crédito ni siembra, el pendiente sigue siendo reintentable por T07 (control §4).

## Archivos permitidos

- Editar: `src/sync.js` (camino universal de `ejecutarParEnCorrida`)
- Crear: `test/sku-universal-pendiente-credito-siembra.test.js` (§1 a §4)
- Editar solo para agregar: `test/_helpers-sku-universal.js`

## Evidencia a seguir

- `escenarios-ca12-pendiente-credito-siembra.md` §1 (1.1 a 1.3), §2 (2.1 a 2.3), §3, §4

## Gate

```
node --test test/sku-universal-pendiente-credito-siembra.test.js
npm test
```

## Fuera de alcance

La compuerta que cierra la entrada marcada (T12).
