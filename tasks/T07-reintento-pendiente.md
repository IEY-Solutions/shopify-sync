# T07 — Reintento de una entrada pendiente (hallazgo B-1)

- **Departamento:** backend
- **Dificultad:** difícil
- **Presupuesto:** 3 intentos. El test de CA-7 necesita un registro ordenado de eventos
  (persistencias y mutaciones) y simular un crash con una excepción no controlada a mitad de la
  corrida. Además, la clasificación por variante (a)/(b)/(c) convive con el bypass de T06.
- **Depende de:** T06
- **Requisitos:** R-11, R-10 (borrado únicamente al confirmar las N), R-5 (fallo parcial)
- **Criterios:** CA-7

## Resultado verificable

Para un SKU curado **con** entrada pendiente no marcada:

- No se calcula delta, no se toma máximo ni se usa `escrito`. Se reintenta el **mismo**
  `nuevoValor` persistido.
- Se procesa aunque Contabilium no haya cambiado, y también con `--full`.
- Con la búsqueda exacta de T03, para cada variante de la entrada:
  - (a) `available == nuevoValor`: queda satisfecha, sin mutación.
  - (b) `available == desde`: se escribe con `changeFromQuantity = desde`.
  - (c) cualquier otro valor: no se escribe y se emite exactamente
    `  [ERROR] <par>/<sku>: variante <variantId> cambio durante un pendiente universal (desde=<desde>, actual=<available>, pendiente=<V>) -> no se escribe`.
    La entrada sigue y el SKU no queda resuelto.
- Si la búsqueda no devuelve alguna variante de la entrada, o trae alguna que no estaba, no se
  escribe nada, se emite `[ERROR]` con prefijo y la entrada sigue.
- Cuando todas quedan en (a), se aplica la persistencia única de T05/T06.
- La resolución del baseline al `contabiliumObjetivo` se detalla y se prueba en T08. Acá el caso
  de CA-7 tiene Contabilium constante en 13.
- Una entrada marcada "requiere compuerta" no se reintenta. Hasta T10, esta tarea la deja intacta
  y sin mutar.

## Archivos permitidos

- Editar: `src/sync.js` (`ejecutarParEnCorrida` y helpers del camino universal)
- Crear: `test/sku-universal-pendiente.test.js`
- Editar solo para agregar: `test/_helpers-sku-universal.js`

## Evidencia a seguir

- `escenarios-ca7-pendiente.md` completo: S0, §1 a §9, incluidos 5b y 5c.

## Gate

```
node --test test/sku-universal-pendiente.test.js
npm test
```

## Fuera de alcance

Contabilium cambiando durante el pendiente (T08), el sufijo ` [reintento]` de `[UNIVERSAL]` (T09)
y la marca de crédito o siembra (T10).
