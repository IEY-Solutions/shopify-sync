# Prompt para una sesión limpia

> Copiá desde `--- INICIO ---` hasta `--- FIN ---` y pegalo como primer mensaje.
> Está escrito para que la sesión **no vuelva a preguntar lo ya decidido** y arranque
> ejecutando, no investigando.

--- INICIO ---

Retomamos el sync de stock del depósito DOT Baires (Contabilium → Shopify).
Trabajo en `~/iey/shopify-sync` y en `~/iey/iey-ai`. Hablame en español.

## Leé esto ANTES de preguntarme nada

1. `~/iey/iey-ai/docs/specs/dot-stock-sync/evidence/p0-decisiones.md` — **empezá acá**.
   Nueve decisiones ya tomadas. Lo que está ahí no se vuelve a preguntar.
2. `~/iey/shopify-sync/docs/README.md` — mapa de toda la documentación.
3. `~/iey/shopify-sync/docs/specs/001-dot-stock-sync/README.md` — índice de la spec y orden de lectura.
4. `~/iey/iey-ai/docs/specs/dot-stock-sync/spec.md` — la spec del módulo nuevo en iey-ai.
5. `~/iey/shopify-sync/AGENTS.md` — invariantes del dominio.

## Estado actual (2026-08-19)

**El sync funciona y está convergido.** La última reconciliación completa verificó los 2.562 SKUs
contra Shopify: 2.434 coinciden, 87 no existen en Shopify, 41 son ambiguos, **0 errores**.

Ya está hecho, en `main` de `IEY-Solutions/shopify-sync` (commits `f000eb5` → `587c8bd`):

- **H3** `guardarCache()` sin `mkdirSync` → 2.475 errores en verde. Corregido.
- **H4** SKU tokenizado → escritura en la variante equivocada. Corregido; destapó 41 SKUs duplicados.
- **H5** libreta envenenada → 87 SKUs invisibles. Corregido con invalidación por versión (`__v: 2`).
- **H12** API 2026-04: `compareQuantity` → `changeFromQuantity` **y** directiva `@idempotent`.
  Verificado con una escritura real (run `32280857387`).
- Guardarraíl de salida ≠ 0, `schedule:` eliminado, modo `--full` expuesto, `npm test` con 13 casos.

## Decisiones tomadas — NO las vuelvas a preguntar

| # | Decisión |
|---|---|
| D-01 | Ante incertidumbre se **subestima** el stock. Venta perdida antes que sobreventa. |
| D-02 | La compuerta de escritura absoluta es **manual y auditada**. Sin corrección automática. |
| D-04 | La fuente de cantidad es **`StockConReservas`**, no `StockActual`. |
| D-05 | El riesgo de F-09 fue evaluado y asumido; hoy está medido en cero. |
| D-06 | Los combos **se publican**, igual que la integración nativa sobre CENTRAL. |
| D-07 | Canal de alerta: **WhatsApp**. |
| D-08 | El workflow **no declara `schedule:`**. Disparo externo. |
| D-09 | Línea base en **Postgres de iey-ai**; webhook en Vercel con secreto de alta entropía en el path; `no_activado` se **reporta**, no se activa. |

Además: **el código nuevo vive en `iey-ai` como módulo**; `shopify-sync` se archiva. No es sólo
arquitectura — la cuenta tiene push sobre `iey-ai` y sólo lectura sobre `shopify-sync`.

## Hechos verificados — NO los re-investigues

- **S-2 verdadero**: las ventas de Shopify se facturan contra CENTRAL (`96667`). La regla de deltas
  es correcta. **Pero no es invariante**: una venta facturada a mano puede ir contra el DOT
  (3 de 6 en el censo de agosto), y eso descuenta dos veces bajo deltas.
- Esa rama **es detectable**: `Origen="Shopify" ∧ IDIntegracion=25020 ∧ Inventario=127356`.
- **S-3 verdadero**: `getStockByDeposito?id=127356` lista los ceros (442 de 2.562).
- **S-1 verdadero**: integración del DOT creada, `IDIntegracion = 29489`, con URL Callback editable.
- Los `X-INCLUIDO` son **combos que contienen al SKU base**; Contabilium calcula su stock desde los
  componentes. **401 de 406 cambios reales fueron combos.**
- `Canal` está **vacío en toda la cuenta**; el discriminador es `Origen` + `IDIntegracion`.
- `StockReservado = 0` en el DOT, 187 SKUs con reserva en CENTRAL: Contabilium **reserva al entrar
  la orden**, no al facturar.
- **No existe endpoint de lectura de movimientos entre depósitos.** El punto ciego es estructural.
- Scopes de la app: `write_inventory, read_inventory, read_products`. **No hay `read_orders`.**
- `/api/comprobantes/search` **no puebla** `Canal` ni `Inventario`: hay que ir al detalle.

## Restricciones

- **Contabilium no tiene sandbox**: contra su API, **sólo lectura**. Presupuesto compartido 18/25 req/10 s.
- **Nunca leer, mostrar ni loguear `.env`.**
- **`IEY-Solutions/shopify-sync` es un repositorio PÚBLICO.** Antes de commitear cualquier documento,
  revisá que no lleve volúmenes de venta, precios ni datos de clientes.
- **El checkout de `iey-ai` está 146 commits atrás** (`fix/manual-dot-stock-sync` @ `bd33286`).
  Lo primero: `git fetch && git checkout main`. Toda referencia a código de iey-ai en la spec hay
  que reverificarla contra `main`.

## Qué quiero que hagas, en este orden

### Gate 1 — Dejar el sync corriendo solo (bloqueante, sin código nuevo)

Hoy sólo corre si alguien lo dispara a mano. Falta **un token válido** en el cronjob de
cron-job.org (job `7733389`). La URL, el método, el cuerpo y los headers ya están bien; el token da
**403** porque su identidad no tiene permiso sobre el repo tras la mudanza a la organización.
Instrucciones exactas en `iey-ai › evidence/p0-proximos-pasos.md`.

Ojo con dos detalles: el cronjob manda `{"ref":"main"}` **sin inputs**, y el workflow **simula por
defecto** — para que las corridas automáticas escriban hay que agregar
`"inputs":{"dry_run":"false"}`. Y la cadencia no puede ser `*/5`: una corrida completa tarda ~9 min.

### Gate 2 — Cerrar la deuda de calidad del paquete actual

1. Tests de regresión para lo que hoy no tiene red: el **versionado de la libreta** (`__v: 2`) y el
   **guardarraíl de salida ≠ 0**. Hay 13 casos que cubren H4 y el contrato de la mutation; falta esto.
2. `ai/scripts/verify.sh` tiene que correr `npm test` de verdad.
3. Hacer el trabajo **reanudable por checkpoint**: hoy la libreta se persiste recién al final, y por
   eso el `timeout-minutes` está en 50. Con checkpoint por página se puede bajar de nuevo.

### Gate 3 — SPEC_CHALLENGE 02

La spec v2 (`docs/specs/001-dot-stock-sync/spec.md`, 14 hallazgos verificados, 13 invariantes) y sus
24 criterios de aceptación están escritos y **nunca fueron desafiados**. Correlo con un revisor
independiente y traeme los hallazgos antes de que yo apruebe.

### Gate 4 — Implementar el módulo en iey-ai

Sólo después de que yo apruebe la spec. El plan de paquetes está en
`~/iey/iey-ai/docs/specs/dot-stock-sync/spec.md`, con sus 8 gates (G-01 a G-08).

### Trabajo para el negocio, no para vos

Reportámelo, no lo arregles: **41 variantes duplicadas en Shopify** (38 del iPhone 16e, 3 del
Samsung S26) y **87 SKUs de Contabilium que no existen en Shopify**.

## Cómo quiero que trabajes

Nivel de ingeniero backend senior. Ninguna afirmación técnica sin fuente: `archivo:línea`, la salida
de un comando que corriste, o documentación actual con su URL. Lo que no puedas verificar, marcalo
**"sin verificar"** — un supuesto marcado es honesto, uno sin marcar es un defecto. Investigá antes
de recomendar. Si encontrás que algo de lo que está acá escrito es falso, decímelo: ya pasó dos veces
en este proyecto y las dos veces importó.

--- FIN ---

## Notas para quien pega el prompt

- El prompt asume que la sesión tiene acceso a `gh` autenticado y a los dos repos locales.
- Si además querés que valide contra las APIs reales, necesita el MCP de Playwright y que vos
  inicies sesión en Contabilium y en el Dev Dashboard de Shopify.
- Los `findings/` son la memoria del proyecto: cada afirmación de este prompt tiene ahí su evidencia.
