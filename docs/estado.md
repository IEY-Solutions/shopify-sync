# Estado

- Feature: ninguna abierta. Última cerrada: sku-universal-multivarianta. Para los 7 SKUs "universales" curados (APPLYFIT-CLEAR con 2 a 5 variantes por modelo de teléfono, mismo SKU exacto), el sync ahora escribe el mismo stock en TODAS las variantes, no solo en "la establecida". Journal "pendiente" persistido antes de escribir (para que un fallo parcial no duplique el delta), `escrito` guardado corrida a corrida, bypass del atajo del incremental solo para esos 7 SKUs, compuerta de escritura absoluta multi-variante con consumo de crédito. El juez aprobó: `arn juzgar` (`sku-universal-multivarianta/juez-20261103T164918Z`). `arn cerrar` dio `cerrable: si`. El contrato está en `docs/contratos/sku-universal-multivarianta.md` (sección "Cierre" con el detalle de las 5 rondas de revisión de alcance y las 5 de revisión de código).
- Último paso:
  - Cierre con la evidencia `sku-universal-multivarianta/20261103T164910Z`: 572/572 tests y los 14 CA en verde.
  - Commit `a162b5c` en `main`: 14 tareas de implementación (T01-T14) más un fix de formato de log y una corrección de dos bugs reales (reintento que no cerraba el pendiente; piso de 0 no documentado en el cálculo), encontrados por la revisión de código.
  - Caso real que motivó todo esto: `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`, hoy 7/0/0/0/0 entre sus 5 variantes (4 de 5 páginas de producto muestran agotado con 7 unidades reales en el local).
- Próximo paso:
  - Mirar la primera corrida real del cron (sin `DRY_RUN`) después de este despliegue: confirmar que las 7 variantes de ese SKU se emparejan en una sola pasada, y revisar las claves `universales`/`universales_pendientes` del `[RESUMEN]`.
  - Aparte:
    - Decisiones pendientes de la persona, sin tocar por esta feature: los 57 pares iPhone 16e/17e del grupo A4 ("No sé, lo averiguo") y cómo mostrar los universales de ese grupo ("Por ahora como está").
    - Riesgos aceptados y documentados en el cierre (no bloquean): la libreta se escribe sin `tmp`+`rename`; varios `catch` de `src/sync.js` leen `err.message` sin `?.` (si algo no-`Error` se lanza ahí, la corrida se cae en vez de contarlo como una variante fallida); `causa_desconocida` para universales queda sin definir.
    - En el combo Car Funda Carbon Negro, las variantes iPhone 17 muestran 125/114/46/14 unidades en el DOT con SKUs que no están en Contabilium DOT (sin tocar).
    - Falta habilitar el retiro en tienda en Galerías, y cargar el stock de Galerías en Contabilium (la isla abría el viernes 06/11).
- Departamento: backend
