# Criterios de aceptación — Spec 001 v2

Cada criterio es testeable (Given/When/Then) con resultado o estado esperado.
Trazabilidad al challenger entre paréntesis.

## Semántica de escritura

### AC-1 — El delta preserva las ventas de Shopify
- **Given** `base[SKU] = 10` y Shopify tiene 9 en la location DOT (1 vendida online)
- **When** Contabilium pasa a 8 (2 vendidas en el mostrador) y **ningún comprobante del DOT con
  `Origen="Shopify"` menciona ese SKU en la ventana**
- **Then** se aplica un ajuste de **−2** y Shopify queda en **7**
- **And** `base[SKU]` pasa a 8
- **And** no se emite ninguna mutación de valor absoluto.

### AC-1b — Una venta de Shopify facturada contra el DOT no se descuenta dos veces *(F-01, V2/V3)*
- **Given** `base[SKU] = 10`, Shopify en 9 (1 vendida online, ya descontada por Shopify)
- **When** esa misma venta se factura a mano contra el depósito `127356` y Contabilium pasa a 9
- **And** existe un comprobante con `Origen="Shopify" ∧ IDIntegracion=25020 ∧ Inventario=127356` que
  incluye ese SKU con cantidad 1
- **Then** el delta calculado es **0** (`Δ_contabilium=−1` + `Δ_shopify_dot=+1`)
- **And** **no se escribe** en Shopify
- **And** `base[SKU]` pasa a 9.

### AC-1c — Un cambio no explicado por comprobantes se marca, pero NO alerta *(F-02, V13)*
- **Given** un SKU cuyo valor en Contabilium cambió en −3
- **When** los comprobantes del DOT de la ventana explican sólo −1
- **Then** se aplica el delta de −3
- **And** el SKU queda registrado con `causa_desconocida` y aparece en el reporte de reconciliación
- **And** eso **no** genera una alerta por SKU: la reposición manual del DOT produce ~2,6 eventos
  `causa_desconocida` por día que son normales (156 movimientos en 60 días)
- **And** sólo escala a alerta si además hay divergencia **positiva** contra Shopify (AC-3b).

### AC-2 — Auto-curación ante webhooks perdidos
- **Given** `base[SKU] = 10` y tres notificaciones que nunca llegaron
- **When** llega la cuarta y Contabilium dice 4
- **Then** se aplica un único ajuste de **−6** y `base[SKU]` queda en 4
- **And** el test provoca la pérdida descartando notificaciones en el ingress, de modo que el Given
  sea observable *(F-24)*.

### AC-16 — Cantidades enteras, no negativas, y sesgo a subestimar *(F-13, D-01)*
- **Given** que la fuente es `StockConReservas`
- **When** se calcula el objetivo para Shopify
- **Then** se redondea **hacia abajo** a entero (subestimar, D-01), de forma documentada
- **And** si el delta llevaría la cantidad de Shopify por debajo de cero, se registra la anomalía y
  **no** se escribe un valor negativo
- **And** los SKUs de la lista de no sincronizables (`COMISIONES`, `ENVIO-01`, `BONIFICACIONES-01`,
  `DERECHOS-ADUANEROS`…) nunca se escriben.

## Línea base y reparación

### AC-3 — Arranque en frío no escribe, y distingue "nuevo" de "perdido" *(F-11)*
- **Given** no existe línea base para un SKU
- **When** se procesa ese SKU
- **Then** se registra `base[SKU]` y **no se escribe nada en Shopify**
- **And** el evento se cuenta como `sembrado`, distinguible de `sin_cambios`
- **And** si en una misma corrida faltan **más del 5 %** de las bases esperadas, la corrida
  **aborta y alerta** en vez de re-sembrar.

### AC-3b — La base guarda dos campos *(F-03)*
- **Given** cualquier SKU sincronizado
- **Then** la base persiste `base_contabilium` **y** `shopify_esperado`
- **And** la reconciliación clasifica: divergencia **positiva** (Shopify > esperado) = anomalía dura
  que alerta; divergencia **negativa** = compatible con venta online, va a métrica agregada.

### AC-4 — Compuerta de re-baseline manual y auditada *(F-04, F-20, D-02)*
- **Given** un SKU cuyo valor en Shopify se sabe incorrecto tras un conteo físico
- **When** una persona dispara el re-baseline para ese SKU o lote
- **Then** se escribe el valor absoluto con `@idempotent` y guarda `changeFromQuantity`
- **And** queda registrado quién, cuándo, valor anterior, valor nuevo y motivo
- **And** `base[SKU]` y `shopify_esperado` se alinean al valor escrito
- **And** **ningún** otro camino del sistema puede emitir una escritura absoluta.

### AC-6 — Los no resueltos se reintentan *(H5)*
- **Given** un SKU registrado como `no_encontrado`
- **When** el producto se crea en Shopify y el stock de Contabilium no cambió
- **Then** la siguiente pasada vuelve a intentar resolverlo y lo sincroniza
- **And** un SKU `no_encontrado` nunca se marca como resuelto.

### AC-6b — `no_activado` no siembra la base y se reporta *(F-10, D-09)*
- **Given** un inventory item existente en Shopify pero **no activado** en la location DOT
- **When** se procesa ese SKU
- **Then** **no** se siembra `base[SKU]`, **no** se escribe y **no** se activa el item
- **And** el SKU aparece en el reporte como `no_activado` con su conteo.

## Resolución de SKU y combos

### AC-5 — Coincidencia exacta de SKU *(H4)*
- **Given** el catálogo real, con 671 de 2.562 SKUs que son prefijo estricto de otro
- **When** se resuelve `FUNDA-MAGSAFE-MATE-IPHONE16`
- **Then** la query usa `sku:"..."` entre comillas **y** se verifica que el `sku` devuelto sea el
  pedido antes de escribir.

### AC-5b — SKU ambiguo no se escribe *(F-14)*
- **Given** un SKU que resuelve a **más de una** variante de Shopify
- **When** se pide `first: N` (N>1) y se filtra por coincidencia exacta
- **Then** si quedan ≥2 candidatos el SKU se marca `ambiguo` y **no se escribe**
- **And** `no_encontrado` (no existe) se distingue de `fallo_de_busqueda` (la consulta falló), y sólo
  el segundo se reintenta con backoff acotado.

### AC-17 — Los combos se expanden *(V6, D-06)*
- **Given** `IEY-105-NEGRO` (Producto) e `IEY-105-NEGRO-INCLUIDO` (Combo que lo contiene)
- **When** llega una notificación para `IEY-105-NEGRO`
- **Then** se recalculan y empujan **ambos** SKUs
- **And** la clasificación Producto/Combo sale de `GET /api/conceptos/search` (campo `Tipo`), nunca
  del sufijo del código
- **And** el caso `IEY-COMBO-CARBON-NEGRO-S25ULTRA` (combo sin sufijo `-INCLUIDO`) queda cubierto.

## Concurrencia, atomicidad e idempotencia

### AC-15 — Guarda de concurrencia con `changeFromQuantity` *(F-05, V12)*
> **Fecha dura:** `compareQuantity` se elimina en la API 2026-04; `changeFromQuantity` pasa a ser
> obligatorio. El código actual usa `compareQuantity` y deja de funcionar el **2027-01-01**.

- **Given** dos procesos que ajustan el mismo SKU en la misma location
- **When** el segundo aplica su delta después de que el primero ya escribió
- **Then** la mutación usa `changeFromQuantity` con el valor leído
- **And** si el valor cambió en el medio, Shopify devuelve `userError` y **no se pisa**
- **And** el SKU queda marcado para reintento, no como resuelto
- **And** existe un lock por SKU que impide dos escrituras simultáneas del mismo proceso.

### AC-18 — Atomicidad del par (escritura, base) *(F-06)*
- **Given** un delta pendiente para un SKU
- **When** se aplica
- **Then** el journal registra `pendiente` **antes** de escribir y `confirmado` **después**
- **And** si el proceso muere entre ambos, el reintento **no** duplica el ajuste (clave de
  idempotencia por `(sku, delta_id)`)
- **And** un delta que queda `pendiente` más de N minutos es levantado por la reconciliación
  **que sí puede escribirlo**, cerrando el hueco de "nadie lo levanta".

### AC-10 — Idempotencia del webhook
- **Given** la misma notificación para el mismo SKU entregada dos veces
- **When** entre ambas no cambió el valor en Contabilium
- **Then** el segundo procesamiento aplica delta 0 y no emite escritura
- **And** dos entregas **concurrentes** tampoco duplican el ajuste.

## Webhook

### AC-9 — Responde rápido y nunca 5xx por un SKU
- **Given** una notificación `POST .../<secreto>?sku=XXX`
- **When** falla la consulta a Contabilium o la escritura a Shopify
- **Then** la respuesta HTTP es 2xx, el fallo queda registrado y lo levanta la reconciliación
- **And** el handler termina bien por debajo del techo de ~48 s de Vercel Hobby.

### AC-9b — Seguro ante invocación no autenticada *(F-15)*
- **Given** que cualquiera que conozca la URL puede invocarla
- **Then** la única acción posible es releer ese SKU de Contabilium y reconciliarlo; el cuerpo nunca
  es fuente de cantidades
- **And** un SKU inexistente o ajeno al depósito DOT no produce ninguna escritura
- **And** hay límite de tasa por origen, con un techo global que **no puede** agotar el presupuesto
  compartido de Contabilium
- **And** el secreto del path **nunca** se escribe en logs.

## Reconciliación y observabilidad

### AC-7 — Divergencia se reporta, no se pisa
- **Given** Contabilium 8, `base[SKU]=8` sin deltas pendientes, Shopify 6
- **When** corre la reconciliación
- **Then** no se escribe en Shopify
- **And** la divergencia queda reportada con SKU, valor de Contabilium, valor de Shopify y delta
- **And** se clasifica según AC-3b.

### AC-8 — Sólo se toca la location DOT
- **Then** el `locationId` de toda mutación es el de la location DOT, y ninguna referencia otra.

### AC-11 — Presupuesto compartido de Contabilium *(F-17)*
- **Given** el límite de 25 req/10 s por cuenta/IP
- **Then** todo componente consume cupo por el limitador compartido, con presupuesto **18/25** y
  jitter, deadline absoluto propagado hasta el `fetch`
- **And** ante `429` respeta `Retry-After`, y si esa espera excede el presupuesto de la corrida
  **aborta** en vez de dormir.

### AC-12 — Reconciliación reanudable, independiente del status HTTP
- **Then** retoma desde el checkpoint durable sin repetir trabajo confirmado
- **And** el resultado se determina leyendo el estado persistido, nunca el código HTTP de la
  invocación.

### AC-13 — Alerta accionable por WhatsApp *(F-16, D-07)*
- **Given** que no hubo reconciliación exitosa en más de 24 h
- **When** lo evalúa un **evaluador externo al sistema vigilado**
- **Then** llega un WhatsApp que nombra desde cuándo y qué hacer
- **And** la alerta se dispara aunque el sistema vigilado esté completamente caído.

### AC-13b — Alerta por cambio de la invariante S-2 *(V8, regla 12)*
- **Given** la integración `25020` con Depósito = `96667` y Depósito Fulfillment sin asignar
- **When** la verificación periódica detecta que alguna de las dos apunta a `127356`
- **Then** se emite alerta y **se suspenden las escrituras por delta** hasta revisión humana.

### AC-14 — Fallo parcial y liveness *(F-18)*
- **Given** una corrida donde falla una fracción de los SKUs
- **When** la tasa de error supera el umbral configurado
- **Then** el proceso sale con código distinto de cero
- **And** se distingue "no cambió nada" (correcto) de "no miré nada" (fallo): una corrida que no
  leyó el snapshot completo nunca termina en verde.

### AC-19 — El workflow no declara `schedule:` *(H1, D-08)*
- **Given** el YAML del workflow de reconciliación
- **When** lo inspecciona un test de contrato
- **Then** no declara `schedule:` y el disparo es externo
- **Nota:** bloqueado por permisos sobre `IEY-Solutions/shopify-sync`; aplica al workflow nuevo en
  `iey-ai`.

### AC-20 — Kill switch y reversión *(F-25)*
- **Given** el sistema corriendo
- **When** se activa el kill switch
- **Then** ninguna escritura llega a Shopify, la lectura y el reporte siguen funcionando, y el
  estado queda consistente para reanudar sin pérdida.
