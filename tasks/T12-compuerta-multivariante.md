# T12 — Compuerta `ESCRITURA_ABSOLUTA` multi-variante

- **Departamento:** backend
- **Dificultad:** difícil
- **Presupuesto:** 3 intentos. Toca la rama `alcanzaAbsoluta` (`src/sync.js:1151-1155`) y el
  consumo de crédito y resiembra (`src/sync.js:1213-1222`, `aplicarCortes` en `:862-879`).
  Además, reemplaza el journal con prioridad. CA-11 tiene unos 20 subescenarios, incluida una
  línea de crédito tardía (K3) que depende de `resembradoEn`.
- **Depende de:** T11
- **Requisitos:** R-16, más R-17 (marca si la compuerta falla) y R-18 (casos (a) y (b) bajo la
  compuerta)
- **Criterios:** CA-11; CA-12 §5 (se agrega al test de T10); CA-13 A-3.2 (se agrega al test de T11)

## Resultado verificable

Si la compuerta alcanza a un curado:

- Hace la búsqueda de T03 y los controles de R-7 y R-18. Si alguno falla, no hay ninguna mutación
  y el SKU queda no aplicado, con el `[COMPUERTA][ERROR]` que ya existe.
- Antes de la primera mutación descarta cualquier entrada pendiente, marcada o no, y persiste una
  propia, marcada, con el absoluto (`Math.round` de Contabilium, sin crédito) como `nuevoValor`.
  Si esa persistencia falla, aplica el `[ERROR]` de R-10 y no hay mutación.
- Escribe el absoluto en las N variantes, con `changeFromQuantity` por variante. Las que ya lo
  tienen no se tocan.
- Si las N quedan confirmadas, en **una** persistencia:
  - se borra la entrada y `escrito` queda en el absoluto;
  - el baseline avanza y el destino pasa al `inventoryItemId` más chico;
  - se consumen las líneas de crédito conocidas con motivo `absoluto`;
  - se escriben `resembradoPor[sku]='absoluto'` y `resembradoEn[sku]`, **una vez por SKU**.
  
  El SKU cuenta como aplicado.
- Si alguna falla: no aplicado, no avanza nada, el crédito no se consume y la entrada marcada
  queda. La corrida automática siguiente emite el `[ERROR]` de R-17.
- Caso (a) de R-18: no es fallo. Usa la tolerancia existente `compuertaNoAplicadaEn` sin cambios.
- DRY_RUN: no hay mutación, persistencia ni consumo.

## Archivos permitidos

- Editar: `src/sync.js`
- Crear: `test/sku-universal-compuerta-absoluta.test.js`
- Editar solo para **agregar** tests (sin cambiar los existentes):
  `test/sku-universal-pendiente-credito-siembra.test.js` (§5, 5′),
  `test/sku-universal-no-activada.test.js` (A-3.2), `test/_helpers-sku-universal.js`
- Solo lectura: `src/main.js`, `src/resultado.js` (R-16 reutiliza `[COMPUERTA][ERROR]` y
  `compuertaNoAplicadaEn` tal cual). Si hace falta tocarlos, la tarea queda `Bloqueado` con el
  motivo en Dudas.

## Evidencia a seguir

- `escenarios-ca11-compuerta-absoluta.md` completo: 1, 1b, 1b′, 1c, 1d, 1d-ctrl, 2, 3 (3.1 a 3.3),
  4, 4b, 5, 5b, 5b-i, 5b-ii, 5c, 5d, 6
- `escenarios-ca12-pendiente-credito-siembra.md` §5 y 5′
- `escenarios-ca13-no-activada.md` A-3.2

## Gate

```
node --test test/sku-universal-compuerta-absoluta.test.js
node --test test/sku-universal-pendiente-credito-siembra.test.js
node --test test/sku-universal-no-activada.test.js
node --test test/compuerta-manual-absoluta.test.js test/compuerta-no-aplicada.test.js
npm test
```

## Fuera de alcance

Conectar la compuerta a `--sku`. R-19 lo excluye explícitamente.
