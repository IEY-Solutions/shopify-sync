# T05 — Libreta: campos opcionales `pendiente` y `escrito`

- **Departamento:** backend
- **Dificultad:** media
- **Presupuesto:** 2 intentos
- **Depende de:** T01
- **Requisitos:** R-10 (forma, persistencia y preservación), R-13 (forma y validación)
- **Criterios:** ningún CA completo. Test de apoyo `test/libreta-universales.test.js`, que cubre a
  nivel libreta CA-7 §9 y CA-9 §8. Los CA se cierran en T06, T07 y T08.

## Resultado verificable

La libreta v2 del par admite dos campos opcionales nuevos, con nombres que decide el
implementador. `SNAPSHOT_VERSION` no se sube.

1. **Entrada pendiente por SKU universal:** `{nuevoValor, contabiliumObjetivo,
   variantes: [{variantId, inventoryItemId, desde}], requiereCompuerta?}`. La marca se usa recién
   en T10 y T12, pero el campo se reserva acá para no migrar la forma dos veces.
2. **`escrito` por SKU universal:** un entero mayor o igual a 0.

Comportamiento:

- `parsearContabilidad` y `cargarLibretaCompleta` los leen como opcionales, igual que `destinos`.
  Una libreta sin ellos sigue siendo válida.
- Una entrada pendiente mal formada se descarta con `[ERROR]`. Un `escrito` no entero o negativo
  también. Ninguno de los dos invalida el resto de la libreta.
- Una función de persistencia **inmediata** escribe en disco la entrada pendiente de un SKU antes
  de cualquier mutación. Si falla, el llamador se entera: devuelve error o lanza, y no falla en
  silencio.
- `guardarSnapshot` (checkpoint, guardado final, `--full`) **no pisa ni borra** entradas
  pendientes que no le pidieron borrar. Las conserva igual que hoy `destinos`
  (`src/sync.js:166-168`).
- Hay una operación que, en **una sola** persistencia, borra la entrada, fija `escrito` y avanza
  baseline y destino. T06 a T08 la usan.
- En DRY_RUN no se persiste nada, igual que hoy.

## Archivos permitidos

- Editar: `src/sync.js` (solo `parsearContabilidad`, `cargarLibretaCompleta`, `guardarSnapshot` y
  helpers nuevos de libreta; no tocar `ejecutarParEnCorrida` ni `procesarSku`)
- Crear: `test/libreta-universales.test.js`

## Evidencia a seguir

- `escenarios-ca7-pendiente.md` §9 (otras persistencias, libreta vieja, entrada mal formada)
- `escenarios-ca9-ventas-individuales.md` paso 8 (`escrito` −3 y 2.5)
- `README.md` de la evidencia, "Notación de la libreta del par"

## Gate

```
node --test test/libreta-universales.test.js
node --test test/libreta.test.js test/migracion-libreta-legada.test.js test/libreta-multi-location.test.js test/libreta-ledger-checkpoint.test.js
npm test
```

## Fuera de alcance

Decidir cuándo se escribe la entrada pendiente o `escrito` dentro de la corrida, que es de T06.
