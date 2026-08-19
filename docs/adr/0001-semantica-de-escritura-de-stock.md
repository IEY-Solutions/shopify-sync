# ADR 0001 — Semántica de escritura del stock del DOT

- **Fecha:** 2026-08-19 · **Estado:** aceptada · **Supera a:** la regla implícita del código original
- **Evidencia:** `docs/specs/001-dot-stock-sync/findings/p0-s2-comprobantes.md`,
  `iey-ai › evidence/p0-recomendacion-semantica.md`

## Contexto

Hay **dos sumideros independientes** sobre el mismo stock físico del local del DOT: el mostrador
(se registra en Contabilium) y la web (lo descuenta Shopify). El código original escribía el
**valor absoluto** de Contabilium sobre Shopify, lo que re-infla lo ya vendido online.

La pregunta que decidía todo era de qué depósito descuenta Contabilium una venta de Shopify. Estaba
sin verificar y admitía tres respuestas incompatibles.

## Decisión

**Deltas contra una línea base durable**, con dos defensas obligatorias:

1. **Clasificador de causa por comprobantes.** `getStockByDeposito` emite **valores**, pero
   `/api/comprobantes/` emite **movimientos con causa**. Cruzarlos permite distinguir un movimiento
   de una redeclaración, que es el requisito que el challenger declaró indispensable.
2. **Compuerta de escritura absoluta, manual y auditada.** Es el único camino que puede reparar un
   delta mal aplicado, y el único autorizado a escribir un valor absoluto.

## Fundamento

- **S-2 verificado:** la integración Shopify `#25020` factura contra `DEPOSITO OFICINA` (`96667`).
  35 de 36 comprobantes lo confirman. **La regla de deltas es correcta.**
- **Pero no es un invariante:** una venta de Shopify facturada a mano puede ir contra el DOT. 1/36 en
  jun–jul, **3/6 en el censo de agosto**. Bajo deltas, cada una descuenta dos veces.
- **Esa rama es detectable** por `Origen="Shopify" ∧ IDIntegracion=25020 ∧ Inventario=127356`, así
  que deja de ser un punto ciego y pasa a ser un caso cubierto.
- **Las redeclaraciones absolutas no son detectables** (no existe endpoint de lectura de
  movimientos), y por eso la compuerta manual no es opcional.

## Consecuencias

- La reconciliación necesita `base_contabilium` **y** `shopify_esperado`: divergencia positiva es
  anomalía dura, negativa es compatible con venta online.
- Los deltas no son idempotentes: hacen falta `changeFromQuantity` como guarda, lock por SKU y
  journal `pendiente`/`confirmado`.
- **S-2 queda como invariante vigilada.** El modal de la integración tiene un campo *Depósito
  Fulfillment* que, apuntado al DOT, invertiría la semántica sin que nadie toque código.
- `causa_desconocida` es **métrica agregada, nunca alerta por SKU**: la reposición manual del DOT
  genera ~2,6 eventos normales por día.

## Alternativas descartadas

- **Escritura absoluta** (el statu quo): re-infla lo vendido online. Hoy el daño medido es cero
  —ningún producto sube en la reconciliación completa— pero es una propiedad del estado actual, no
  una garantía del diseño.
- **Deltas puros sin compuerta:** los deltas no se autocorrigen nunca. Todo error es permanente.
