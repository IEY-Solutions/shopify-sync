# Estado

- Feature: ninguna abierta. Se cerró clasificador-causa-comprobante (diseño B, registro persistente de comprobantes). `arn juzgar` dio APRUEBA (`juez-20261102T161440Z`), el juez opus independiente dio APROBADO CON OBSERVACIONES y `arn cerrar` dio `cerrable: si`. Contrato archivado en `docs/contratos/clasificador-causa-comprobante.md`.
- Último paso: cierre con evidencia `clasificador-causa-comprobante/20261102T161345Z`: CA-1 a CA-15 en verde, `npm test` 341/341 y `verify.sh` con `VERIFY_PASS`. Todavía sin commitear en `main`.
- Próximo paso: commitear y pushear a `main`. Producción toma el cambio en la corrida siguiente, que llega desde cron-job.org cada ~30 min. Después, controlar la primera corrida con el clasificador: el resumen `[RESUMEN]` del DOT con `clasificador=ok` o `no_requerido`, y los créditos `pre-corte` de la primera vez.
  Aparte:
  - La isla de Galerías Pacífico sigue en rojo cada 30 min hasta que la persona habilite los productos en la location `96849756246` de Shopify (2.629 `no_activado`). Además, 608 SKUs del depósito no existen en Shopify, 50 están duplicados (`ambiguo`) y hay que confirmar que esa location tenga el retiro en tienda habilitado.
  - Al usar la compuerta desde la interfaz de GitHub, hay que poner `dry_run=false`: con el valor por defecto (`true`) solo simula y la corrida sale en verde.
  - Las notas N-2 a N-8 y las demás observaciones de los jueces quedaron fuera de alcance; la lista está en la sección "Cierre" del contrato archivado.
  - El transporte vía BrokerContabilium sigue bloqueado en ese repo.
- Departamento: direccion
