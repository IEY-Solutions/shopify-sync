# Estado

- Feature: ninguna abierta. Última cerrada: verificar-cache-sku. Antes de escribir, el sync verifica en Shopify el SKU exacto aunque lo tenga en caché, y lleva el destino por par en la libreta. Los dos jueces aprobaron: `arn juzgar` (`juez-20261102T191442Z`) y el juez opus independiente. `arn cerrar` dio `cerrable: si`. El contrato está en `docs/contratos/verificar-cache-sku.md`.
- Último paso:
  - Cierre con la evidencia `verificar-cache-sku/20261102T191238Z`: 391/391 tests y `verify.sh` con exit 0.
  - La versión anterior, `07a9f99` (clasificador), ya estaba en producción.
  - Galerías ya tiene los productos habilitados en Shopify, pero Contabilium todavía no tiene stock en el depósito 139916. La isla abre el viernes.
- Próximo paso:
  - Mergear `verificar-cache-sku` a `main` justo antes de una corrida del cron (:00 o :30), sin disparar DRY_RUN a mano hasta que cada par guarde su primera corrida real (riesgo I-1 aceptado, ver la sección "Cierre" del contrato).
  - Revisar el log de esa primera corrida: `[RESUMEN]` con `duplicados` y `cache_invalidada`, y las líneas `[AVISO]`.
  - Después, la persona aplica las 15 correcciones de SKU de `docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md`, empezando por el par invertido del combo Qi2 Carbon Azul, al que además hay que intercambiarle el stock del DOT.
  - Aparte:
    - Decisiones pendientes de la persona: los 57 pares iPhone 16e/17e ("No sé, lo averiguo") y cómo mostrar los universales ("Por ahora como está").
    - En el combo Car Funda Carbon Negro, las variantes iPhone 17 muestran 125/114/46/14 unidades en el DOT con SKUs que no están en Contabilium DOT.
    - Falta habilitar el retiro en tienda en Galerías.
    - R-9 (destinos por par) lo propuso el planificador como mecanismo para la decisión aprobada.
- Departamento: direccion
