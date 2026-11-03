# T08 — Contabilium durante un pendiente, y cadena `escrito` + bypass

- **Departamento:** backend
- **Dificultad:** media
- **Presupuesto:** 2 intentos
- **Depende de:** T07
- **Requisitos:** R-12, R-13 (cierre de pendiente → `escrito`, fallo parcial no lo toca, DRY_RUN),
  R-14 (bypass en corridas encadenadas, el control no curado sigue salteado)
- **Criterios:** CA-8, CA-9

## Resultado verificable

- **R-12.** Mientras haya una entrada pendiente, el Contabilium de la corrida no se usa para ese
  SKU. Al cerrarse la entrada, el baseline **y** el valor del atajo (`libreta.skus[sku]`) quedan
  en `contabiliumObjetivo`, y `escrito` queda en el `nuevoValor` de la entrada, no en lo leído en
  la corrida que la cerró. La corrida siguiente aplica el delta normal y, por R-14, se procesa.
- **CA-9.** Cadena de corridas incrementales sobre la **misma** libreta:
  bootstrap → venta online sin cambio en Contabilium → sin cambios → ventas individuales.
  El SKU de control fuera de la lista nunca tiene búsqueda en Shopify mientras Contabilium no
  cambie. Se suman los pasos sueltos 2b, 6, 7, 8 y 9.

Si T06 y T07 ya dejaron todo esto funcionando, esta tarea puede ser solo los dos tests. Si un
escenario falla, el arreglo va en `src/sync.js` dentro de lo que cubren R-12, R-13 y R-14.

## Archivos permitidos

- Editar: `src/sync.js` (camino universal de `ejecutarParEnCorrida`)
- Crear: `test/sku-universal-pendiente-contabilium.test.js`,
  `test/sku-universal-ventas-individuales.test.js`
- Editar solo para agregar: `test/_helpers-sku-universal.js`

## Evidencia a seguir

- `escenarios-ca8-pendiente-contabilium.md`, corridas 1 a 3 y 2′ a 3′ (sube 13→15 y baja 13→11)
- `escenarios-ca9-ventas-individuales.md`, cadena 1→5 y pasos sueltos 2b, 6, 7, 8, 9

## Gate

```
node --test test/sku-universal-pendiente-contabilium.test.js
node --test test/sku-universal-ventas-individuales.test.js
npm test
```
