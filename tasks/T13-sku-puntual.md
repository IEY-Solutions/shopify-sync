# T13 — `--sku` por el mismo camino universal

- **Departamento:** backend
- **Dificultad:** difícil
- **Presupuesto:** 3 intentos. `procesarSku` y `syncUnSku` (`src/sync.js:327-515`) son un camino
  aparte de `ejecutarPar`, con su propio guardado de libreta (`:484-496`). Tienen que reutilizar el
  camino universal de T06, T07, T10 y T11 sin duplicarlo, y el test mide el código de salida real
  de `main()`.
- **Depende de:** T11 (no necesita T12: la compuerta no se conecta a `--sku`)
- **Requisitos:** R-19, más R-1, R-2, R-11, R-17 y R-18 por este punto de entrada
- **Criterios:** CA-14

## Resultado verificable

- Si el SKU pedido es curado (igualdad exacta), `procesarSku` y `syncUnSku` siguen el camino
  universal:
  - las N variantes y el conteo;
  - los tres caminos de R-4;
  - el journal, el reintento y la marca;
  - `escrito`;
  - `[UNIVERSAL]` con prefijo `<par>/<sku>`;
  - nunca `[AVISO]` ni `SkuAmbiguoError`.
- Si el curado queda sin resolver, **lanzan**: fallo de escritura, pendiente trabado (R-11(c) o
  marcado) o caso (b) de R-18. La excepción llega al `catch` existente de `src/main.js:121`, que
  ya devuelve 1. En el caso (a) de R-18 y cuando se resuelve, no lanzan y `main()` devuelve 0.
- Un SKU no curado, incluidos el prefijo y la extensión de un curado (F1 a F3), sigue exactamente
  igual que hoy, también con el código de salida 0 aunque falle.
- No hay bypass que aplicar (no hay atajo) ni compuerta.
- No hay flag nuevo. El modo real es `DRY_RUN=false node src/index.js --sku <sku>`.

## Archivos permitidos

- Editar: `src/sync.js` (`procesarSku`, `syncUnSku` y la extracción a helpers compartidos del
  camino universal si hace falta para no duplicarlo)
- Crear: `test/sku-universal-sku-puntual.test.js`
- Editar solo para agregar: `test/_helpers-sku-universal.js`
- Solo lectura: `src/main.js`, `src/argv.js`, `src/index.js`

## Evidencia a seguir

- `escenarios-ca14-sku-puntual.md` completo: A, B (B1, B2, B2′, B3), C, D1-D3, E1-E3, F1-F3, G, H,
  I y la tabla de código de salida.

## Gate

```
node --test test/sku-universal-sku-puntual.test.js
node --test test/sku-individual-usa-libreta-por-par.test.js test/index-argv.test.js
npm test
```
