# Riesgo 1 cerrado — sobre qué location escribe la integración nativa `25020`

- **Fecha:** 2026-08-20 · **Método:** lectura de la Admin API de Shopify · **Escrituras: 0**
- **Evidencia:** corrida `32318957335` (`node src/index.js --locations`)
- **Cierra:** el riesgo abierto 1 de la spec y el hallazgo **G2-09** del SPEC_CHALLENGE 02

## La pregunta

La integración nativa de Contabilium con Shopify (`IDIntegracion = 25020`, depósito
`DEPOSITO OFICINA` / CENTRAL `96667`) publica stock en Shopify. **¿Sobre qué location escribe?**

Si escribiera sobre la location del DOT, habría un **tercer escritor absoluto** sobre el mismo
inventario y el rediseño a deltas quedaría invalidado, igual que si S-2 fuera falso. Era la última
premisa abierta de esa familia, y la única sin invariante vigilada, sin criterio de aceptación y
sin gate.

## Por qué se pudo verificar ahora

La spec la daba por no verificable: *"requiere acceso al admin de Shopify"*. **No lo requiere.** La
app tiene `read_products` y `read_inventory`, que alcanzan para leer los niveles de un SKU en
**todas** las locations. Eso responde la pregunta sin tocar el admin y sin escribir nada.

## Método

Se comparan SKUs donde CENTRAL y DOT tienen valores **distintos** — los únicos que discriminan: si
ambos depósitos dijeran 5, una location con 5 no revela a cuál espeja. Se descartan además los
ceros, que son ambiguos.

## Resultado

```
  IEY-103-C-NEGRO       Contabilium: CENTRAL=426  DOT=4    Shopify: 69883428950=426  83342655574=4
  IEY-103-NEGRO         Contabilium: CENTRAL=271  DOT=5    Shopify: 69883428950=271  83342655574=5
  IEY-105-NEGRO         Contabilium: CENTRAL=230  DOT=19   Shopify: 69883428950=230  83342655574=19
  IEY-105-PLATA         Contabilium: CENTRAL=248  DOT=7    Shopify: 69883428950=248  83342655574=7
  IEY-105-S-PLATA       Contabilium: CENTRAL=106  DOT=5    Shopify: 69883428950=106  83342655574=5
  … 10 SKUs en total

  --- Coincidencias por location ---
  69883428950: coincide con CENTRAL en 10/10, con DOT en  0/10
  83342655574: coincide con CENTRAL en  0/10, con DOT en 10/10   <-- location DOT
```

## Conclusión

**La integración `25020` escribe sobre la location `69883428950`, no sobre la del DOT.**

Diez de diez sin excepción, con magnitudes que no admiten coincidencia (426 contra 4, 271 contra 5,
230 contra 19). **No hay un tercer escritor sobre la location del DOT.** La premisa que sostiene el
diseño de deltas queda verificada con dato directo.

Es coherente con lo que ya se observaba de forma indirecta: si `25020` escribiera sobre el DOT,
nuestras reconciliaciones mostrarían correcciones grandes y constantes. Muestran lo contrario — 0
actualizados sobre 2.586 SKUs, y sólo decrementos de una unidad que corresponden a ventas de
mostrador.

## Lo que NO cierra

- **Sigue siendo una invariante vigilada, no un hecho permanente** (regla 12 de la spec). Es
  configuración: alguien puede cambiar el depósito o el *Depósito Fulfillment* de la integración sin
  tocar una línea de código, y la semántica se invierte. Lo que cambia es que ahora el estado
  **actual** está medido en vez de supuesto.
- **AC-13b (la vigilancia automática de ese cambio) sigue sin ser implementable** por lo que
  documenta **G2-11**: la configuración de la integración sólo es legible desde el admin
  autenticado. Este diagnóstico se puede **re-correr a mano** cuando haga falta, que es mejor que
  nada y es lo que hay.
- La app **no tiene `read_locations`**: ni la query raíz `locations` ni `Location.name` son
  accesibles (`ACCESS_DENIED`, verificado en la corrida `32318874707`). Las locations se identifican
  por id. Hay un test que congela ese límite para que nadie vuelva a pedir `name` y tumbe la corrida.
