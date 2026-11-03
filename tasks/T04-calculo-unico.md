# T04 — Cálculo único de `shopifyActual` y `nuevoValor` (función pura)

- **Departamento:** backend
- **Dificultad:** media
- **Presupuesto:** 2 intentos
- **Depende de:** T01
- **Requisitos:** R-3, R-4 (los tres caminos sin pendiente)
- **Criterios:** ningún CA completo. Test de apoyo `test/sku-universal-calculo.test.js` con los
  ejemplos normativos de R-4 y los números de CA-2 y CA-3. CA-2 y CA-3 se cierran en T06.

## Resultado verificable

`src/sync.js` exporta una función pura, sin I/O, que recibe el baseline, el Contabilium actual,
`escrito` (o su ausencia), el crédito acreditable y los `available` de las N variantes. Elige
**uno** de los tres caminos excluyentes:

- (a) siembra si el baseline es `null`: absoluto de Contabilium;
- (b) bootstrap sin `escrito`: el valor común o el **máximo** si las variantes divergen;
- (c) normal con `escrito`: `max(0, escrito − Σ max(0, escrito − available_i))`, con doble piso 0.

Después calcula `nuevoValor` **una vez** reutilizando `calcularEscritura` (`src/sync.js:283`). El
crédito se suma una sola vez, con la misma fórmula que hoy (`src/sync.js:1159`). El resultado es
un entero con `Math.round` y nunca es negativo ni `NaN`. Devuelve también qué camino tomó, que
T10 necesita para la marca de R-17.

Casos obligatorios del test, con estos números exactos:

- R-4: 5/5/5/5/5 → 4/5/5/5/5 con Contabilium −1 da 3; piso total: `escrito` 1, 0/0 da 0;
  suba ignorada: 8/5/5/5/5 con `escrito` 5 da 5.
- CA-2: bootstrap 7/0/0/0/0 toma 7; `escrito` 5 con 4/4/5/5/5 y 10→9 da 2.
- CA-3: bootstrap 5/0 toma 5; `escrito` 6, 5/6 y 10→9 da 4.
- Siembra con decimal: CA-2 B. Crédito una vez: CA-2 H.

El contrato de R-18 no deja que `null` llegue a esta función con variantes mezcladas. Si llega,
la función lo rechaza y no lo trata como 0.

## Archivos permitidos

- Editar: `src/sync.js` (solo agregar la función exportada; no tocar `ejecutarParEnCorrida` ni
  `procesarSku`)
- Crear: `test/sku-universal-calculo.test.js`
- Editar solo para agregar: `test/_helpers-sku-universal.js`

## Evidencia a seguir

- `escenarios-ca2-cinco-variantes.md` A, A′, B, C, D, D2, H
- `escenarios-ca3-dos-variantes.md` B, C, D, E
- Texto de R-4 en el contrato (ejemplos normativos)

## Gate

```
node --test test/sku-universal-calculo.test.js
npm test
```

## Fuera de alcance

Elegir el camino según el estado de la libreta (pendiente o no), que es de T06 y T07. La escritura
y el log también quedan afuera.
