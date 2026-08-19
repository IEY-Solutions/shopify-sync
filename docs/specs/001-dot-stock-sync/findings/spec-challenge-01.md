# SPEC_CHALLENGE 01 — Spec 001

- **Fecha:** 2026-08-19 · **Actor:** `spec-challenger` (read-only)
- **Veredicto: `revision_required`** — 11 bloqueantes, 12 importantes, 3 menores

> La regla de deltas es la dirección correcta **para el caso que la spec tenía en mente**. Pero ese
> no es el único caso, el supuesto que la sostiene está sin verificar y **podría invertir la
> decisión**, y no hay ninguna decisión de arquitectura escrita para los tres artefactos nuevos.

## BLOQUEANTES

### F-01 — `S-2` no es un supuesto: es la premisa que decide entre delta y absoluto
Si S-2 es **falso** (las ventas online descuentan del DOT en Contabilium), el delta **duplica** el
descuento: base=10, venta online de 1 → Shopify 9 **y** Contabilium 9 → delta −1 → Shopify 8.
Faltante permanente por cada venta. En ese mundo **el absoluto es lo correcto y la spec está
invertida**. Hay un tercer mundo no contemplado: que el depósito se elija **por comprobante**
(pickup→DOT, envío→CENTRAL); ahí ni delta ni absoluto sirven y hace falta dato a nivel orden.
→ Verificar S-2 **antes** de aprobar, o definir las tres ramas.

### F-02 — El delta es incorrecto donde el negocio más lo va a usar: la corrección manual
`getStockByDeposito` devuelve un **valor**, no un movimiento; el webhook notifica sólo `?sku=`. El
sistema **no puede saber por qué** cambió el número. Contraejemplo: base=10, Shopify=8 (2 vendidas
online), físico=8, Contabilium sigue 10. El personal cuenta y **corrige Contabilium a 8** → delta −2
→ Shopify queda en **6** con 8 en el estante. El absoluto habría dejado 8.
El delta sirve para **movimientos** (venta mostrador, reposición, transferencia). Falla en
**redeclaraciones absolutas** (conteo, ajuste) — que es justo lo que hace un local cuando nota que el
sistema miente.

### F-03 — AC-1 y AC-7 se contradicen
Mismo estado estructural (Shopify < Contabilium por ventas online) con veredictos opuestos. Como las
ventas online son invisibles, la reconciliación no puede calcular un valor esperado: marcaría
cientos de SKUs por día, nadie lo lee, y el "tilde verde vacío" muta en "el reporte que nadie mira".
→ La base necesita **dos** campos: `base_contabilium` y `shopify_esperado`. Divergencia positiva =
anomalía dura; negativa = compatible con venta online, métrica y no alerta por SKU.

### F-04 — No hay camino de reparación
Con deltas **todo error es permanente**: nada fija un valor. Y el arranque es lo peor — Shopify hoy
**está corrupto de hecho** (sin sync desde 08-09, más lo escrito en la variante equivocada por H4).
AC-3 toma ese valor corrupto como línea de partida y **lo congela para siempre**.
→ Hace falta una **compuerta de escape absoluta**, explícita y auditada (re-baseline por conteo
físico), y definir el cutover inicial.

### F-05 — Los deltas no son idempotentes; se pierde la protección que el código actual sí tiene
El código usa `compareQuantity` (compare-and-set real). AC-10 sólo prueba replay **secuencial**. Dos
entregas concurrentes del webhook leen base=10, ambas calculan −2, ambas escriben → **−4**. Error
permanente y silencioso. El `concurrency` de Actions no protege: el webhook no corre ahí.
→ Definir lock por SKU y usar `changeFromQuantity` como guarda.

### F-06 — Atomicidad entre el write en Shopify y la actualización de la base
La spec nunca dice si `base[SKU]` avanza antes o después del write. Antes → el delta se pierde para
siempre. Después → se aplica dos veces al reintentar. Y AC-9 dice que el fallo "lo levanta la
reconciliación" mientras AC-7 dice que la reconciliación **no escribe**: **nadie** lo levanta.
Todos los modos de falla sesgan hacia sobreventa.
→ Journal de deltas `pendiente`/`confirmado` + clave de idempotencia.

### F-07 — Tres ejes de arquitectura sin decidir, sin `design.md` ni ADR
(1) **Almacén** de la línea base — es el artefacto central y no tiene sede; el cache de Actions está
descartado por evidencia (H3). (2) **Ingress** del webhook. (3) **Plataforma de disparo**.
Sin esto, AC-3/11/12/13/14 son inverificables. Ausencia de decisión = hallazgo bloqueante.

### F-08 — SKU que desaparece del listado: estado no definido
Si S-3 es falso, un SKU que llega a cero desaparece, el delta nunca se calcula y Shopify sigue
ofreciendo lo que no hay — el escenario de sobreventa exacto. Segundo caso no cubierto aunque S-3 sea
verdadero: un producto **dado de baja** del depósito también desaparece.

### F-09 — Secuenciar P1 mal provoca el daño que la spec quiere evitar
`sync.yml` sigue con `schedule` y `DRY_RUN: "false"`, y `sync.js:92` sigue llamando `setearStock`
(absoluto). **Commitear los tests de P1 reactiva el cron**, que en su primera corrida escribe
absolutos sobre una location sin sincronizar desde el 08-09 → re-infla todo lo vendido online.
→ P1 debe incluir sacar el `schedule:` / forzar `DRY_RUN=true` como primer commit.

### F-10 — `no_activado` está ignorado por completo y envenena la base igual que H5
AC-6 sólo nombra `no_encontrado`. Si la base se siembra con el item inactivo y después lo activan,
el nivel arranca en 0 mientras la base dice 10 → delta −2 deja Shopify en **−2**.

### F-11 — Pérdida parcial de la base: AC-3 la vuelve una catástrofe silenciosa
AC-3 trata "SKU nuevo" y "perdimos el estado" como el mismo evento. Perder el 30% de la base
re-siembra 700 SKUs con valores desalineados y los congela (F-04).
→ Chequeo de integridad **de conjunto** con umbral: si faltan >5% de las bases, **abortar y alertar**.

## IMPORTANTES

- **F-12 Decimales**: la base debe guardar el **entero redondeado**; si guarda el crudo, la deriva es
  acumulativa (tres cambios de +0,4 → deltas 0/0/0 mientras la base avanza 1,2).
- **F-13 Negativos y sesgo seguro**: base=10, Shopify=2, Contabilium 10→3 → Shopify **−5**. Falta
  regla explícita "ante incertidumbre se subestima el stock" — es decisión de negocio del dueño.
- **F-14 Resolución de SKU**: (1) SKU duplicado en dos variantes — Shopify no impone unicidad, y con
  `first: 1` el `sku` devuelto coincide exacto y AC-4 pasa igual → pedir `first: N`, filtrar, y si
  hay >1 marcar `ambiguo` y **no escribir**; (2) `no_encontrado` mezcla "no existe" con "la búsqueda
  falló" y AC-6 lo reintenta eternamente; (3) case-sensitivity sin definir (`toUpperCase()` en
  `contabilium.js:122`); (4) escapado de la query; (5) el `sku-map.json` actual puede tener mapeos
  envenenados por H4 y nadie lo invalida en el cutover.
- **F-15 Contrato del webhook**: secreto en query string queda en logs de proxies; sin firma no hay
  autenticidad; y cada `POST ?sku=` consume el presupuesto compartido → vector de amplificación que
  puede tumbar también a iey-ai. Falta AC de rate-limit del endpoint.
- **F-16 AC-13 es un hombre-muerto que se vigila a sí mismo**: si el evaluador vive en el sistema que
  murió, no evalúa nada. La causa raíz del diagnóstico es justamente que nadie se enteró en 10 días.
  Falta evaluador **externo**, canal concreto que Agustín lea, y definición de "alerta accionable".
- **F-17 AC-11**: presupuesto sin número (el prior art usa 18/25 con jitter), sin mecanismo, y la
  regla 8 da por resuelto lo que el diagnóstico deja como contradicción documental.
- **F-18 Fallo parcial**: AC-5 cubre el fallo total; el caso real fue **80 de 2.562** en verde. Falta
  umbral de tasa de error y un AC de **liveness** ("no cambió nada" vs "no miré nada").
- **F-19 H11 y H6 huérfanos**: H11 (1 request por SKU, 26 min) ni corregido ni fuera de alcance, y
  choca con AC-12/AC-13. La solución (`Location.inventoryLevels`) no se nombra.
- **F-20 H12 vacuo**: si la regla 2 prohíbe `inventorySetQuantities`, "corregir H12" no significa
  nada — salvo que el camino de reparación (F-04) sí use `set`, y entonces la regla 2 tiene una
  excepción no escrita.
- **F-21 Combos y devoluciones**: los 28 pares `X`/`X-INCLUIDO` huelen a producto compuesto → doble
  descuento si componente y combo mapean a variantes distintas (**sin verificar**). Y una devolución
  puede sumar +1 por Shopify y +1 por Contabilium.
- **F-22 ¿`available`, `on_hand` o `committed`?** La spec nunca lo nombra pero AC-1 lo asume. Al
  entrar una orden Shopify mueve unidades de `available` a `committed` sin tocar `on_hand`; elegir
  mal produce doble conteo en el ciclo pedido→retiro.
- **F-23 No-goals**: el flujo inverso "se deja diseñado" pero no hay diseño en ningún lado; y
  "sincronizar precios" no es gratis — si el webhook es uno solo para stock y precio, cada cambio de
  precio consume cuota.

## MENORES

- **F-24 Criterios no testeables**: AC-14 (no se puede esperar 60 días → test de contrato sobre el
  YAML), AC-8 (sin disparador), AC-5 ("nombra la causa real" no es afirmable → taxonomía de códigos),
  AC-2 (Given inobservable), AC-12 ("sin repetir trabajo" sin métrica).
- **F-25 Sin kill switch ni plan de reversión**; `DRY_RUN` existe en el código y la spec no lo nombra.
- **F-26 Higiene**: `CONTEXTO-NUEVA-SESION.md` sigue desactualizado y es lo primero que lee la próxima
  sesión.

## Preguntas abiertas para el usuario

1. **S-2 (verificar antes de aprobar)**: ¿de qué depósito descuenta Contabilium una venta de Shopify?
2. **S-3 (verificar antes de aprobar)**: ¿`getStockByDeposito?id=127356` lista los SKUs en cero?
3. **Almacén de la línea base**: ¿dónde vive, con qué atomicidad y durabilidad?
4. **Ingress del webhook**: ¿qué expone y con qué autenticación?
5. **Plataforma de disparo/deploy**.
6. **Compuerta absoluta**: ¿se acepta un re-baseline con escritura absoluta, supervisado y auditado?
7. **Sesgo ante incertidumbre**: ¿sobreventa o venta perdida? Decisión del dueño.
8. **Estado del workflow durante P1**: ¿se saca el `schedule:` en el primer commit?
9. **Ítems no activados en la location DOT**: ¿el sistema los activa o los reporta?
10. **Canal y evaluador de las alertas**.

## Invariante destilada

> Una semántica por deltas sólo es correcta si la fuente emite **movimientos**. Si emite **valores
> absolutos** (como `getStockByDeposito`), toda redeclaración externa —conteo físico, ajuste manual—
> se aplica como movimiento y produce error permanente. Un diseño por deltas exige, sin excepción:
> distinción movimiento/redeclaración, escritura exactly-once, atomicidad del par `(write, base)`, y
> una compuerta absoluta auditada — porque los deltas no se autocorrigen nunca.
