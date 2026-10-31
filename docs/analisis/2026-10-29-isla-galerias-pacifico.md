# Análisis: stock de la isla Galerías Pacífico → Shopify

Fecha: 2026-10-29 · Estado: análisis, sin implementación · Fuentes: exploración read-only de
`shopify-sync`, `../BrokerContabilium` y `../iey-ai` (citas abajo). Shopify **no** se consultó en
vivo: el conector no estuvo disponible en la sesión.

## 1. La pregunta está mal partida

"¿Broker o cron?" mezcla dos ejes independientes:

| Eje | Opciones | Costo de cambiar después |
|---|---|---|
| **Disparo** (quién despierta al sync) | cron-job.org → `workflow_dispatch` (hoy), Vercel cron, webhook | bajo |
| **Transporte** a Contabilium | directo (hoy) o vía broker | **bajo**: es un solo módulo (`src/contabilium.js:197-236`); iey-ai ya lo resolvió con un toggle por env (`iey-ai/src/lib/integrations/contabilium/broker-transport.ts:34-39`) |
| **Semántica de escritura** en Shopify | absoluto o deltas contra línea base | **alto**: si está mal, hay sobreventa en producción |
| **Dónde vive la lógica** | extender shopify-sync, repo nuevo para la isla, módulo en iey-ai | medio |

Un cron puede hablar a través del broker. La decisión cara de revertir no es la del transporte: es
**la semántica de escritura**, y esa depende de un dato de negocio que hoy no está en ningún repo.

## 2. El dato que decide todo: ¿la isla vende online?

- **Si la location de la isla en Shopify despacha pedidos online** (retiro en tienda o envío
  asignado por las reglas de ruteo), hay **dos sumideros** sobre el mismo stock, igual que en el DOT.
  Escribir el absoluto de Contabilium re-infla lo vendido online → sobreventa (invariante 1).
  En ese caso se necesitan los deltas del ADR 0001, que **todavía no están implementados**.
- **Si la isla solo informa** ("hay stock en la isla" sin que Shopify le asigne pedidos),
  Contabilium es el único sumidero y escribir el absoluto es **correcto y más simple**.
  Ojo: el widget nativo de disponibilidad en tienda de Shopify suele requerir retiro activado en esa
  location, y eso la vuelve sumidero. Una alternativa que evita el problema es un metafield por
  variante (`stock_isla`) que el theme muestra, sin inventario en esa location. **A verificar con
  el conector de Shopify antes de diseñar.**

## 3. Lo que muestran los tres repos

### shopify-sync (este repo)
- Disparo: cron-job.org cada 30 min → `workflow_dispatch`, sin `schedule:` (`.github/workflows/sync.yml:5-28`, `docs/README.md:6-10`).
- Contabilium **directo**: ~53 requests por corrida (1 de auth + 52 páginas de 50), ~15,7 req/10 s (`src/contabilium.js:144-148,220-236`; `docs/diagnostico-2026-08-19.md:173-177`).
- Multi-depósito barato: no hay ids literales en `src/`. El depósito y la location vienen de env, y `getStockDeposito(id)` ya acepta un argumento (`src/contabilium.js:197,201`; `src/shopify.js:277,316,392`). Falta separar `last-sync.json` por location (`src/sync.js:26`) y agregar el loop de pares en `src/index.js`.
- **Deuda grave:** el código escribe el **absoluto**, con `changeFromQuantity` como guarda (`src/sync.js:172`; `src/shopify.js:345-354`). Contradice el ADR 0001 (`docs/adr/0001-semantica-de-escritura-de-stock.md:16-18`) y el invariante 1.
- **A verificar:** el cronjob manda `{"ref":"main"}` sin inputs, y `dry_run` vale `true` por defecto (`sync.yml:11-28`; `docs/PROMPT-SESION-LIMPIA.md:87-89`). O producción corre en dry-run y no escribe nada, o la doc está desactualizada.
- El estado vive en `actions/cache`, que vence a los 7 días sin uso (`sync.yml:58-66,100-106`).
- El plan escrito es archivar este repo y rehacerlo en iey-ai (`docs/specs/001-dot-stock-sync/spec.md:89-91`), pero esa spec está en `revision_required` con 12 bloqueantes (`docs/specs/001-dot-stock-sync/README.md:3-16`).
- La app de Shopify no tiene `read_locations` (`src/shopify.js:423-427`): el gid de la location de la isla hay que conseguirlo por otra vía.

### BrokerContabilium
- Passthrough opaco: `POST /v1/calls` + polling. **Sin cache, sin réplica, sin endpoints de dominio** (`src/http/app.ts:23-94`; `docs/specs/spec.md:37`).
- Un único limiter global de 25/10 s en memoria y **un solo worker serial**, FIFO **sin cupo ni prioridad por cliente** (`src/worker/limiter.ts:3-24`; `src/mailbox/sqlite-mailbox.ts:170-174`).
- No ve el tráfico que sale directo a Contabilium (por ejemplo, el de shopify-sync).
- Operación: una VPS compartida con Brand Protection, systemd con `MemoryMax=256M`, sin backups. El monitoreo de health es un plan sin config (`infra/systemd/broker-contabilium.service:8-19`; `docs/specs/spec.md:63-64`).
- Bug inferido: una llamada en `running` durante un reinicio no se reencola y puede tener `/health/ready` en 503 hasta que vence el TTL de 36 h (`src/mailbox/sqlite-mailbox.ts:170-173,226-246`).
- Alta de cliente nuevo: editar `BROKER_CLIENTS_JSON` a mano y reiniciar. Los grants admiten `exactPaths` (`src/config.ts:43-57`).
- v0.1.0, ADRs en "Propuesto". En la práctica iey-ai ya lo usa: 1.333 llamadas en 36 h, 0 respuestas 429 (`iey-ai/docs/specs/sync-ventas-bloqueado/diagnostico.md:32`).

### iey-ai
- Todas sus lecturas pasan por el broker cuando `BROKER_CONTABILIUM_*` están definidas, sin fallback automático (`client.ts:682-711`).
- **Con broker activo, el limitador 18/25 de Postgres no se aplica** (`client.ts:682-719`; `scheduler-kernel/rate-limiter.service.ts:40-44`).
- **Ya modela multi-depósito:** `Warehouse` con rol `SATELLITE_LOCAL`, alta desde Settings > Nuevo satélite. `syncStockSateliteLocal` sincroniza todos los satélites locales a `stock_levels` (`prisma/schema.prisma:604-677`; `stock-sync.service.ts:1070-1093`). La isla podría darse de alta ahí sin código.
- Frescura del stock satélite: cadencia de 300 min y un cron de Vercel cada 2 h (`cadencia.ts:91`; `vercel.json:12-14`). Es demasiado lento para "¿hay stock en la isla?".
- No tiene código de Shopify.

## 4. El cuello de botella real: un broker serial

El límite del broker no es el 25/10 s: es **1 / latencia de Contabilium**, porque procesa una llamada
a la vez. Con dos depósitos, una corrida de shopify-sync encola unas 106 páginas de golpe, y iey-ai
queda detrás en la FIFO con un deadline de 25 s (`iey-ai/.../broker-transport.ts:5`):

| Latencia por página | Ocupación del broker por corrida (106 páginas) | Efecto sobre iey-ai |
|---|---|---|
| ~1 s (cuadra con el incremental de ~1 min del DOT) | ~2 min cada 30 min | deadlines y reintentos durante esa ventana |
| ~9 s (lo que iey-ai mide para el CENTRAL, `cadencia.ts:78-83`) | ~16 min cada 30 min | inaceptable |

Hay que medirlo antes de mover tráfico. Ya existe una spec `orquestador-contabilium-lento` en iey-ai,
lo que sugiere que el broker serial ya se nota.

## 5. Opciones

| | A. Cron nuevo solo para la isla | B. Extender shopify-sync a N pares, directo | C. Extender shopify-sync a N pares, vía broker | D. Leer la isla desde el Postgres de iey-ai |
|---|---|---|---|---|
| Código duplicado | sí (y hereda el bug del absoluto) | no | no | no |
| Requests a Contabilium | +53, sin coordinar | +53, sin coordinar | +53, coordinadas | **0** |
| Riesgo de 429 compartido | sube | sube (más duración, mismo pico) | baja, si el broker es el único consumidor | nulo |
| Frescura | 30 min | 30 min | 30 min + cola | 2–5 h |
| Depende de la VPS | no | no | **sí** (SPOF) | no (depende de iey-ai) |
| Trabajo previo | ninguno | chico | chico acá + **fair-queue en el broker** | acoplar repos, subir cadencia |
| Encaja con el plan de migrar a iey-ai | no | neutro | **sí** (mismo transporte) | sí |

## 6. Recomendación

1. **No hacer un cron aparte para la isla (A).** Duplica código, estado y el bug del absoluto.
2. **Un solo sync multi-par:** extender shopify-sync a una lista `depósito → location → semántica`
   (B/C). El cambio es chico porque el código ya está parametrizado por env.
3. **Transporte: el broker como destino (C), en dos fases.** El límite es por cuenta, y un único
   punto de salida es la única forma real de respetarlo. Hoy el limitador de iey-ai queda
   desactivado con el broker y shopify-sync pega directo sin que nadie lo cuente. Pero el broker no
   está listo para un consumidor en ráfaga:
   - Fase 1: la isla entra en shopify-sync **en dry-run** y con transporte directo, como el DOT hoy.
   - Fase 2: el transporte pasa al broker detrás de un toggle por env, como iey-ai, recién cuando el
     broker tenga (a) cupo o turnos justos por cliente, para que una ráfaga de stock no deje sin
     servicio a iey-ai, (b) el arreglo del `running` huérfano tras un reinicio, (c) el health
     monitoreado de verdad, y (d) un cliente `shopify-sync` con `exactPaths` GET
     `/api/inventarios/getStockByDeposito`.
4. **Antes de escribir en la location de la isla,** resolver la sección 2. Si la isla despacha
   pedidos online, la escritura queda bloqueada hasta tener los deltas del ADR 0001.
5. **Dejar D como plan de largo plazo** (la migración a iey-ai), no como atajo: 2–5 h de atraso no
   sirve para mostrar stock a un cliente.

## 7. Pendientes que no salen de los repos

- [ ] ¿La isla despacha pedidos online (retiro o envío)? Lo decide la persona y se verifica con Shopify.
- [ ] gid de la location de la isla en Shopify y su configuración de fulfillment.
- [ ] id del depósito de la isla en Contabilium.
- [ ] ¿El 25/10 s es por cuenta o por IP? Si es por IP, la VPS y los runners de GitHub no compiten.
- [ ] Latencia real por página de `getStockByDeposito` vía broker.
- [ ] ¿Producción escribe o corre en dry-run? Ver los logs de Actions de las últimas corridas.
- [ ] ¿Vercel de iey-ai tiene `BROKER_CONTABILIUM_*`? ¿Hay otros consumidores directos (pymepilot)?
