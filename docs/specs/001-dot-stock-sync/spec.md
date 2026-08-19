# Spec 001 v2 — Sync de stock DOT Baires (Contabilium → Shopify)

- **Estado:** SPEC_DRAFT v2 — reescrita tras P0. Pendiente de SPEC_CHALLENGE 02.
- **Fecha:** 2026-08-19 · **Reemplaza:** v1 (`revision_required`, 11 bloqueantes)
- **Evidencia:** `findings/p0-*.md` · **Decisiones:** `iey-ai › evidence/p0-decisiones.md`
- **Diagnóstico de origen:** `docs/diagnostico-2026-08-19.md`

## Problema

IEY vende online con retiro en su local del DOT Baires. Para que eso funcione, la location
"IEY Shopping Dot Baires" de Shopify (`gid://shopify/Location/83342655574`) tiene que reflejar el
stock del depósito `LOCAL DOT BAIRES` (`127356`) de Contabilium.

La integración nativa de Contabilium con Shopify (`IDIntegracion=25020`) ya ocupa su lugar con el
depósito `DEPOSITO OFICINA` (`96667`), así que el DOT se sincroniza con un middleware propio.

Ese middleware no sincroniza desde el 2026-08-09 y, cuando corría, entregaba el 5 % de lo programado.
Tiene tres bugs que pierden o corrompen datos en silencio y una semántica de escritura que puede
sobrevender. El costo de negocio es concreto: un cliente compra online para retirar en el DOT algo
que no hay.

## Lo que P0 verificó (y que cambia el diseño)

| # | Hallazgo | Fuente |
|---|---|---|
| V1 | Las ventas de Shopify se facturan contra **CENTRAL** (`96667`) por configuración de la integración `25020`. **La regla de deltas es correcta.** | `p0-s1` §2 |
| V2 | Pero una venta de Shopify **puede** facturarse a mano contra el DOT. Observado 1/36 (jun–jul) y **3/6 (censo de agosto)**. Bajo deltas eso **descuenta dos veces**. | `p0-s2` §5, §5b |
| V3 | Esa rama **es detectable**: el comprobante trae `Origen`, `IDIntegracion`, `Inventario`, `IDVentaIntegracion`. | `p0-s2` §5b |
| V4 | `getStockByDeposito?id=127356` **lista los ceros**: 442 de 2.562 (17,3 %). Paginación completa y consistente. | `p0-s3` |
| V5 | `StockReservado = 0` en los 2.562 items del DOT; en CENTRAL hay 187 SKUs con reserva. **Contabilium reserva al entrar la orden, no al facturar.** | `p0-s2` §6 |
| V6 | Los `X-INCLUIDO` son **combos que contienen al SKU base**. Comparten unidades físicas. 29 pares en el DOT. | `p0-s3` §F-21 |
| V7 | `Canal` está vacío en toda la cuenta. El discriminador es `Origen` + `IDIntegracion`. | `p0-s2` §3 |
| V8 | Una integración **no** implica un depósito fijo: existe `Depósito` y `Depósito Fulfillment`. | `p0-s1` §3 |
| V9 | Existe la integración del DOT: **`IDIntegracion=29489`**, Depósito `LOCAL DOT BAIRES`, con URL Callback editable. | `p0-s1` §5 |
| V10 | La cuenta tenía **sólo lectura** sobre `IEY-Solutions/shopify-sync`; se otorgó `admin` el 2026-08-19. | `p0-disparo-externo` |
| V11 | Scopes reales de la app: **`write_inventory, read_inventory, read_products`**. No hay `read_orders` → P4 bloqueado de hecho. | `p0-shopify-app` |
| V12 | **`compareQuantity` se elimina en la API 2026-04** y `changeFromQuantity` pasa a obligatorio. **Fecha límite: 2027-01-01.** `setearStock` usa `compareQuantity`. | `p0-shopify-app` |
| V13 | El DOT se repone a mano: **156 movimientos `Oficina → DOT` en 60 días**, tipo "Actualización masiva". No son comprobantes → el clasificador no los ve. | `p0-movimientos-dot` |
| V14 | Contabilium documenta que **el stock de un combo se calcula desde sus componentes** y no es un dato propio. | `p0-movimientos-dot` |

## Reglas de negocio / invariantes

1. **Contabilium es la fuente de verdad del stock físico del DOT, pero no es el único que lo
   descuenta**: Shopify descuenta al vender online con retiro en el DOT. Toda escritura respeta
   ambos sumideros.
2. **Se aplican deltas contra una línea base durable**, no el valor absoluto de Contabilium. Única
   excepción: la compuerta de re-baseline de la regla 9.
3. **Sólo se escribe la location DOT.** CENTRAL y su location no se tocan jamás.
4. **Una divergencia se reporta, no se pisa** automáticamente.
5. **Un SKU que no resuelve a una variante no bloquea a los demás**, y nunca se marca como resuelto.
6. **La coincidencia de SKU es exacta.** 671 de 2.562 SKUs (26,2 %) son prefijo estricto de otro, y
   el campo `sku` de Shopify es tokenizado con coincidencia parcial.
7. **Fallar en silencio está prohibido.** Una corrida que no sincronizó nada no termina en verde.
8. **El presupuesto de la API de Contabilium es compartido** (25 req/10 s por cuenta/IP). Ningún
   componente lo consume sin coordinarse.
9. **La reparación es explícita.** Sólo una compuerta de re-baseline manual y auditada puede escribir
   un valor absoluto, y sólo tras un conteo físico. **(D-02)**
10. **Ante incertidumbre se subestima el stock.** **(D-01)**
11. **La cantidad de origen es `StockConReservas`**, no `StockActual`. **(D-04, V5)**
12. **`S-2` es una invariante vigilada, no un hecho.** Si el *Depósito Fulfillment* de la integración
    `25020` apuntara al DOT, la semántica se invertiría sin que nadie toque código. **(V8)**
13. **Un cambio en un componente cambia la disponibilidad de sus combos.** Toda notificación se
    expande al conjunto de SKUs afectados. **(V6, D-06)**

## Semántica de escritura

Tres tipos de cambio, tres tratamientos:

| Causa del cambio en Contabilium | Detección | Escritura en Shopify |
|---|---|---|
| Movimiento del DOT (mostrador, reposición, transferencia) | por descarte | **delta** |
| Venta de Shopify facturada contra el DOT | **comprobante** con `Origen="Shopify" ∧ IDIntegracion=25020 ∧ Inventario=127356` | **ninguna** — Shopify ya descontó |
| Redeclaración absoluta (conteo, ajuste) | **no detectable** | delta (queda mal) → lo repara la regla 9 |

```
Δ_contabilium = stock_conreservas(SKU) − base[SKU]
Δ_shopify_dot = Σ cantidades del SKU en comprobantes del DOT con Origen="Shopify"
delta         = Δ_contabilium + Δ_shopify_dot
```

Fundamento completo en `iey-ai › evidence/p0-recomendacion-semantica.md`.

## Arquitectura (cierra F-07)

- **Almacén de la línea base:** Postgres de `iey-ai`. **(D-09)**
- **Ingress del webhook:** endpoint en `iey-ai` sobre Vercel; secreto de alta entropía en el path
  (Contabilium no firma ni manda headers de auth); rate limit por origen; responde 2xx siempre.
- **Plataforma de disparo:** cron-job.org → endpoint corto en Vercel → trabajo largo en Actions.
- **Dónde vive el código:** módulo nuevo en `iey-ai`. `shopify-sync` se archiva. Además de la razón
  de arquitectura (Postgres, rate limiter compartido, Vercel), hoy es **la única opción ejecutable**:
  la cuenta no tiene push sobre `shopify-sync` y sí sobre `iey-ai`. **(V10)**
- **Canal de alerta:** WhatsApp. **(D-07)**

## En alcance

- Webhook de cambios de stock (integración `29489`) y aplicación del delta.
- Línea base durable por SKU, con `base_contabilium` y `shopify_esperado`.
- Clasificador de causa por comprobantes.
- Expansión componente → combos.
- Reconciliación periódica: snapshot completo contra la línea base + lectura masiva de Shopify por
  `bulkOperationRunQuery` para **detectar y reportar** divergencia.
- Compuerta de re-baseline manual y auditada.
- Corrección de H3, H4, H5, H8, H12.
- Observabilidad: exit distinto de cero ante fallo masivo, alerta por reconciliación vencida y
  alerta por cambio de la invariante S-2.

## Fuera de alcance

- **Flujo inverso Shopify → Contabilium** (`POST /notificador/ecommerce`): se deja diseñado, no se
  implementa. Requiere scopes de Shopify que no están disponibles.
- Sincronizar precios.
- Sincronizar CENTRAL, ML Full o Megatone (`133432`).
- Arreglar la facturación automática de Shopify (ver `p0-s2` §6). **No inflaba stock** (V5), pero es
  un problema de negocio abierto.
- Migrar el sync de catálogo o de ventas de iey-ai.
- Interfaz de usuario más allá de la compuerta de re-baseline.

## Restricciones técnicas verificadas

- `inventoryAdjustQuantities` acepta deltas negativos y requiere sólo `write_inventory`, que la app
  ya tiene. Expone `changeFromQuantity` como guarda de concurrencia.
  (https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventoryAdjustQuantities)
- **La API 2026-04 elimina `compareQuantity` e `ignoreCompareQuantity` y vuelve obligatorio
  `changeFromQuantity`.** El proyecto está fijado en `2026-01`, así que hoy funciona, pero el
  Dev Dashboard marca la llamada como obsoleta con **fecha límite 2027-01-01**. La migración forzada
  por Shopify y el rediseño a deltas **son la misma migración**.
- `bulkOperationRunQuery`: hasta 5 operaciones concurrentes, su ejecución no cuenta contra el rate
  limit, resultados en JSONL por URL firmada.
- El campo `sku` de Shopify es tokenizado con coincidencia parcial.
  (https://shopify.dev/docs/api/usage/search-syntax)
- Contabilium: `pageSize` fijo en 50; 25 req/10 s por cuenta/IP; sin sandbox. Paginación 1-based y
  completa, verificada sobre las 52 páginas del DOT.
- `GET /api/conceptos/search` devuelve `Tipo: "Producto" | "Combo"` — necesario para la regla 13.
- El webhook de Contabilium no firma ni envía headers de autenticación.

## Riesgos abiertos

1. **Sobre qué location de Shopify escribe la integración `25020`.** Si escribiera sobre la del DOT,
   Contabilium y el middleware se pisan. **Sin verificar** — requiere acceso al admin de Shopify.
2. **Qué notifica el webhook ante un cambio de componente de un combo.** **Sin verificar** — sólo se
   puede observar cuando el endpoint exista.
3. **Alcance del webhook**: si notifica sólo cambios del depósito `127356` o de todos. **Sin verificar.**
4. **Sobre-oferta por combos** (D-06): aceptada, pero pesa más en el DOT que en CENTRAL porque las
   cantidades son de uno o dos dígitos.
5. **Fecha dura: 2027-01-01.** Cuando Shopify suba el piso a 2026-04, `setearStock` deja de
   funcionar (V12). No es una mejora opcional: es la fecha de vencimiento de la integración actual.
6. **`causa_desconocida` es ruido si se trata como alerta**: la reposición manual del DOT genera
   ~2,6 eventos/día perfectamente normales (V13). Va a métrica agregada, no a alerta por SKU.
