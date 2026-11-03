# T02 — Migración del fixture de los tests de `verificar-cache-sku`

- **Departamento:** backend
- **Dificultad:** fácil
- **Presupuesto:** 2 intentos
- **Depende de:** T01 (CA-10 (a) importa la lista curada de `src/shopify.js`)
- **Requisitos:** R-15, R-9 (parte: la suite sigue verde)
- **Criterios:** CA-10; CA-6 parcial (`npm test` verde con el fixture migrado)

## Por qué va antes que todo el comportamiento nuevo

`SKU_APPLYFIT` hoy vale `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`, que es un SKU curado. Desde T03 ese
SKU deja de comportarse como "variante establecida + [AVISO]" y esos 4 tests empezarían a fallar.
Hay que migrarlos antes. Hoy son los únicos usos de SKUs curados en `src/` y `test/`
(`test/_helpers-cache-sku.js` y `test/cache-sku-duplicados.test.js`).

## Resultado verificable

Toda aparición del string `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E` en los 5 archivos pasa a
`IEY-COMBO-CARBON-VERDE-IP16E`, también dentro de títulos de `test()`/`describe()`. La constante se
sigue llamando `SKU_APPLYFIT`. En comentarios solo se ajusta la descripción del caso real. No cambia
ninguna aserción, ningún id, ningún `available` ni la cantidad de variantes inyectadas. El test de
CA-10 compara contra las copias congeladas, sin git.

## Archivos permitidos

- Editar: `test/_helpers-cache-sku.js`, `test/cache-sku-duplicados.test.js`,
  `test/cache-sku-verificada.test.js`, `test/cache-sku-caminos-de-escritura.test.js`,
  `test/cache-sku-resumen.test.js`
- Crear: `test/migracion-fixture-cache-sku.test.js`
- Solo lectura (prohibido editar): `aceptacion/sku-universal-multivarianta/fixtures-originales/**`

## Evidencia a seguir

- `aceptacion/sku-universal-multivarianta/escenarios-ca10-migracion-fixture.md` §1 (byte a byte
  ignorando solo líneas de comentario, N1 a N7), §2 (conteos de `test(`, `describe(`, `assert`),
  §3 (a) a (d).
- `aceptacion/sku-universal-multivarianta/fixtures-originales/README.md`.

## Gate

```
node --test test/migracion-fixture-cache-sku.test.js
npm test
```

## Fuera de alcance

Cualquier cambio en `src/`. Elegir otro SKU de reemplazo que no sea el default de R-15, salvo que
un test lo necesite. En ese caso se anota en Dudas con el motivo.
