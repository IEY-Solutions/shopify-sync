# Diagnóstico: sync de stock Contabilium (DOT Baires) → Shopify

- **Fecha:** 2026-08-19
- **Estado:** diagnóstico cerrado; implementación no iniciada
- **Alcance:** por qué el sync dejó de funcionar y qué hay que decidir antes de tocar código
- **Siguiente paso:** spec-driven development sobre los temas listados al final

## Contexto

`~/iey/shopify-sync` es un middleware Node.js que copia el stock del depósito **DOT Baires** de
Contabilium (id `127356`) a la location **IEY Shopping Dot Baires** de Shopify
(`gid://shopify/Location/83342655574`). Existe porque Contabilium sólo puede registrar **un**
depósito contra Shopify, y ese lugar lo ocupa el depósito CENTRAL. Sin este middleware, el local
del DOT no puede vender online con retiro en tienda.

**Veredicto:** el cron **no corre desde el 2026-08-09** (GitHub lo auto-desactivó) y, antes de eso,
venía corriendo **20× menos seguido de lo diseñado desde el 2026-06-10**. Además hay tres bugs de
código que pierden o corrompen datos en silencio, y un problema de diseño que hace derivar el stock
sin corrección posible. **La hipótesis inicial (rate limit de Contabilium) queda refutada con datos.**

Fuentes: API de GitHub Actions sobre `IEY-Solutions/shopify-sync` (2.806 corridas, 06-03 → 08-09),
logs de producción, código del repo, docs oficiales de Shopify, y el prior art de `~/iey/iey-ai`.

---

## Hallazgos

### H1 — El cron está muerto (causa raíz del síntoma actual)

```
$ gh workflow list --all
Sync stock Contabilium -> Shopify   disabled_inactivity   288210605
```

GitHub desactiva los workflows `schedule` tras 60 días sin actividad en el repo. Único commit:
**2026-06-03** (hace 76 días). Última corrida: **2026-08-09 13:25 UTC**. Desde entonces el stock del
DOT **no se sincroniza en absoluto**.

### H2 — Degradación previa: de cada 5 min a cada ~100 min

El workflow pide `*/5 * * * *` (288 corridas/día). Medido por número de corrida:

| Período | Corridas | Cadencia real | Entrega |
|---|---|---|---|
| 06-04 → 06-10 11:00 UTC | #106 → #2007 | cada ~5 min | **~100%** |
| 06-10 11:00 → 08-09 | #2007 → #2806 | cada ~94-100 min | **~5%** |

Corte abrupto y ubicable entre la corrida **#2007 (06-10 11:00 UTC)** y la **#2032 (06-10 19:55 UTC)**.
Total histórico: 2.806 corridas donde el schedule pedía ~19.300. *(Causa de la degradación: sin
verificar — GitHub no la expone. El hecho medido es firme.)*

Los 2 "fallos" del historial no fueron fallos de código: **cancelaciones a los 15 min exactos con
`steps: []`** — corridas que nunca arrancaron, encoladas en el `concurrency` group.

### H3 — BUG CRÍTICO: el arranque en frío sincroniza CERO y reporta éxito

`src/shopify.js:40-42` escribe el cache sin crear el directorio:

```js
function guardarCache() {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");  // .cache/ puede no existir
}
```

`.cache/` está en `.gitignore` → en un runner limpio no existe. La excepción se propaga por
`resolverSku()` y la captura `src/sync.js:53-58`, que la reporta como *"fallo al consultar Shopify"*
—un mensaje que **oculta la causa real**. `syncTodos` no relanza: exit 0 y **workflow en verde**.

Verificado en el log de la primera corrida real (run #2, id `26862054076`, 2026-06-03):

```
Cache not found for input keys: sync-state-26862054076, sync-state-
[ERROR] IEY-103-NEGRO: fallo al consultar Shopify -> ENOENT: no such file or directory,
        open '/home/runner/work/shopify-sync/shopify-sync/.cache/sku-map.json'
...
--- Resumen INCREMENTAL (331.4s) ---
  Total SKUs Contabilium : 2480
  Actualizados           : 0
  Errores                : 2396     ← 2396 ENOENT
```

**2.396 errores, 0 SKUs sincronizados, tilde verde.** Y **va a volver a pasar apenas se reactive el
workflow**: `gh cache list` devuelve vacío (GitHub expira caches a los 7 días de no usarse), así que
la próxima corrida es un arranque en frío idéntico. Agravante: si esa corrida excede
`timeout-minutes: 30`, `guardarSnapshot()` (`src/sync.js:187`, el único que hace `mkdirSync`) nunca
llega a crear `.cache/` y el ciclo se repite indefinidamente.

### H4 — BUG CRÍTICO: la búsqueda por SKU puede escribir stock en el producto equivocado

`src/shopify.js:197-224` consulta con el valor **sin comillas** y toma el primer resultado **sin
verificar que el SKU devuelto sea el pedido**:

```js
productVariants(first: 1, query: $query)   // query = `sku:${sku}`
```

Doc oficial de Shopify: `sku` es un campo **tokenizado** con matching parcial.

> "For tokenized fields, equality exists if the term is found anywhere in the field."
> — https://shopify.dev/docs/api/usage/search-syntax
> `sku:element*` → prefix matching — https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariants

El catálogo real es un campo minado: sobre los 2.477 SKUs extraídos del log de producción,
**647 (26,1%) son prefijo estricto de otro SKU**.

```
FUNDA-MAGSAFE-MATE-IPHONE16  →  ...IPHONE16PRO, ...IPHONE16PROMAX, ...IPHONE16PLUS
FUNDA-MAGSAFE-MATE-IPHONE15  →  ...IPHONE15PRO, ...IPHONE15PROMAX
IEY-103-NEGRO                →  IEY-103-NEGRO-INCLUIDO
```

Los 28 SKUs `*-INCLUIDO` tienen los 28 su SKU base también presente. Riesgo: escribir el stock del
DOT en la variante equivocada, en silencio y sin error.

### H5 — BUG: la "libreta" incremental se envenena y nunca reintenta

`src/sync.js:176-183` marca como resuelto en el snapshot no sólo lo actualizado, sino también
`no_encontrado` y `no_activado`. Como el incremental saltea todo SKU cuyo valor de Contabilium no
cambió (`src/sync.js:165`), un SKU que aún no existía en Shopify **nunca se reintenta**, aunque
después se cree el producto.

Observado: la corrida `31283400762` (08-08) registró **`No encontrados Shopify: 80`** cuando el total
saltó de 2.482 a 2.562 SKUs. Esos 80 quedaron marcados como resueltos.

### H6 — DISEÑO: la libreta espeja Contabilium, no Shopify → deriva sin corrección

El incremental compara Contabilium contra la libreta local, **nunca contra Shopify**. Si el stock
cambia del lado de Shopify (venta online con retiro en DOT), Contabilium no se entera, la libreta
sigue igual, y el SKU se saltea para siempre. La reconciliación que corregiría esto está
**desactivada a propósito** (`src/index.js:70-73`):

```js
// Reconciliacion completa diaria: DESACTIVADA por ahora. Mientras no exista el
// flujo inverso (ventas DOT -> Contabilium), un --full podria re-inflar en
// Shopify stock ya vendido online desde DOT.
```

El sistema **sabe** que deriva y no tiene cómo corregirlo. Síntoma consistente: las últimas 13
corridas (~11 h del 08-09) reportaron `Saltados: 2562 / Actualizados: 0`.

El prior art **confirma el supuesto**: en todo el ecosistema IEY nadie escribe stock de vuelta a
Contabilium por API. El único write-back es **manual por CSV**
(`Deposito Origen;Deposito Destino;SKU;Cantidad`, `iey-ai/src/lib/modules/dot-replenishment/`).
La API sí expone `POST /api/inventarios/modificarStock` y `POST /api/inventarios/movimientoInterno`,
pero nadie los usa.

### H7 — Stock fantasma: riesgo MENOR al esperado (hipótesis corregida)

`getStockDeposito()` sólo devuelve lo que Contabilium lista; un SKU ausente no se toca nunca. Pero
tres fuentes independientes indican que **el endpoint devuelve TODOS los SKUs del depósito,
incluidos los que están en cero**:

1. El ejemplo del proveedor en la colección Postman: **49 de 50 items con `StockActual: 0`**.
2. `iey-ai/src/lib/integrations/contabilium/client.ts:570-574`: *"Devuelve TODOS los SKUs del
   depósito, incluyendo los que están en cero (no requiere zero-out manual)."*
3. `iey-ai/src/lib/integrations/contabilium/stock-sync.service.ts:4-7`: *"el catalogo de Contabilium
   devuelve TODOS los SKUs del deposito incluyendo los que estan en cero (~5156 items / ~104 paginas)"*.

**Contrapeso honesto:** la spec más reciente de iey-ai declara esto formalmente **sin verificar** y
lo convierte en gate bloqueante G-01 (`docs/specs/stock-sync-reliability/spec.md:98-104`), y
**ese gate nunca se ejecutó**. Queda como verificación pendiente, pero con prior evidence fuerte a
favor de que no es un bug activo.

### H8 — Sin reintentos del lado Contabilium

`src/contabilium.js:27-48` y `:53-75` no tienen reintento, backoff ni manejo de `Retry-After`. Un
solo 429/5xx/timeout en cualquiera de las ~52 páginas aborta la corrida entera y pierde todo el
progreso. Es la única parte donde la intuición original apunta a algo real — pero por **fragilidad
ante fallos**, no por exceso de tráfico (ver H9).

### H9 — Hipótesis inicial REFUTADA: no hay rate limiting de Contabilium

Medido sobre el log de `31315759015`: 12 páginas entre `13:25:48.102` y `13:25:55.755` = 7,653 s →
**1,57 req/s ≈ 15,7 req cada 10 s** contra un límite de 25/10 s → **63% de utilización**. Además:
**0 errores** de Contabilium en las 298 corridas exitosas muestreadas. El `delay(500)` de
`src/contabilium.js:17` hace bien su trabajo. Contabilium documenta para inventarios un límite
*más alto* aún (30 req/10 s).

**No se pierden peticiones por rate limit.** El problema es H1-H8.

### H10 — Paginación VERIFICADA correcta (riesgo descartado)

La colección Postman del proveedor dice que `getStockByDeposito` es **0-based**
(*"page = 0 es la primera"*), mientras `src/contabilium.js:103` arranca en `page = 1`. Eso sería un
hueco silencioso de 50 SKUs. **Refutado por aritmética sobre el log real:**

```
TotalItems = 2562, pageSize = 50 → 52 páginas
Log: "Pagina 52/52 leida (12 items, acumulado 2562 SKUs)"
1-based: 51 páginas × 50 + 12 = 2562  ✓ coincide
0-based: leería 2512 y perdería 50    ✗ no coincide
```

En la práctica el endpoint responde 1-based y la paginación es completa. *(iey-ai tiene el mismo
conflicto documental sin resolver — para nosotros queda cerrado.)*

### H11 — Ineficiencia estructural: 1 request de Shopify por SKU

Aun con el `inventoryItemId` cacheado, `resolverSku()` (`src/shopify.js:268-285`) llama a
`leerStockActual()` → **una query GraphQL por SKU**, ~2.500 por corrida completa. Shopify expone
`Location.inventoryLevels` (conexión paginada) para leer el inventario de una location de una sola
vez, e `inventorySetQuantities` acepta un **array** de cantidades.

### H12 — Deuda programada: `@idempotent` pasa a ser obligatorio

`inventorySetQuantities` requiere la directiva `@idempotent` **desde la API 2026-04**. El proyecto
está fijado en `2026-01`, así que hoy funciona, pero cualquier upgrade rompe la escritura.
Ya anotado en `CONTEXTO-NUEVA-SESION.md:53`.

---

## Prior art de `~/iey/iey-ai` (reutilizable)

**No hay solapamiento de código**: iey-ai **no tiene integración con Shopify**. `SalesChannel.SHOPIFY`
es sólo un enum derivado del string `Canal` de Contabilium. Lo valioso es el patrón.

**1. Patrón de continuation en GitHub Actions** (`.github/workflows/stock-sync-continuation.yml` +
`scripts/continue-stock-sync.ts`). El trabajo largo vive en el endpoint, el **checkpoint vive en la
base**, y la Action es sólo un driver que vuelve a golpear hasta cerrar el ciclo. Detalles: cron
`5-55/5 12 * * *`, `concurrency` sin cancel, `timeout-minutes: 12`, máx. 8 intentos, contador escrito
**antes** de invocar, y —clave— *"la respuesta HTTP no es señal: sólo la lectura posterior del
checkpoint confirma que hubo una corrida válida"*. Existe un test que congela el contrato del YAML.
**Advertencia:** el otro workflow (`stock-novedades.yml`) tuvo **38 fallos / 12 éxitos en 50 corridas
(76%)** entre 08-01 y 08-05 — GitHub Actions tampoco es confiable ahí.

**2. Rate limiter en tres capas**, listo para copiar:
`domain/rate-window.ts` (puro, decide `ok`/`retryAfterMs`) → `services/rate-limiter.service.ts`
(un `INSERT … ON CONFLICT … RETURNING` atómico sobre una tabla singleton, ventana calculada con el
reloj de Postgres) → inyectado como función en el cliente HTTP, que **no importa la base**.
Presupuesto **18 de 25** con jitter, deadline absoluto propagado hasta el `fetch`, y la regla de oro:
*"si esperar el `Retry-After` nos pasaría del budget, NO dormimos"*.

**3. Staging + publish atómico** (`stock-cycle-publish.service.ts`): las páginas van a staging y
recién al final un `DELETE + INSERT…SELECT` en una sola transacción reemplaza el depósito completo.
Es **el único mecanismo que detecta SKUs desaparecidos** y evita dejar la tabla mezclando páginas de
ciclos distintos.

**4. `GET /api/stock/Novedades`** — feed de movimientos de stock de los **últimos 7 días**, 500 filas
por página, con `FechaModificacion` por evento. La doc del proveedor dice *"disponible solo para
Chile y Uruguay"*, **pero la cuenta AR de IEY responde OK**. Sería la base de un incremental real
(pedir sólo lo que cambió) en vez de repaginar 52 páginas cada vez. Semántica crítica: en este feed
**ausencia = "sin cambio", nunca cero**.

**5. Datos verificados en vivo**: `96667` = DEPOSITO OFICINA (CENTRAL), `127356` = LOCAL DOT BAIRES,
`97094` = FULL MERCADO LIBRE. Token OAuth2 de 24 h sin refresh. `pageSize` fijo en 50, no modificable.

**6. Riesgo de cuota compartida**: iey-ai presupuesta 18/25 justamente porque hay otros consumidores
descoordinados (`pymepilot`). shopify-sync agrega un tercero a ~15,7/10 s. La doc dice que el límite
es **por IP** (lo que nos salvaría, al correr desde runners de GitHub), pero iey-ai presupuesta
conservador igual para consumidores de otras IPs — **contradicción documental sin resolver**.

---

## Verificación pendiente (necesita el Postman)

Dos preguntas que cambian el diseño de la solución:

1. **Cuando entra una venta de Shopify, ¿de qué depósito descuenta Contabilium?** Es decir, el campo
   `Inventario` de los comprobantes con `Canal` = Shopify: ¿trae `96667` (CENTRAL) o `127356` (DOT)?
   **Es la pregunta más importante que queda abierta**: define si el modelo actual tiene una fuga
   estructural (H6). Se responde con `GET /api/comprobantes/search` + `GET /api/comprobantes/?id=`.
2. **Confirmar que `getStockByDeposito?id=127356` devuelve los SKUs en cero** (gate G-01 sobre
   nuestro depósito). Cierra H7 de forma definitiva en vez de por analogía con CENTRAL.


---

## Estado del repo

Este documento es la fuente de verdad del diagnóstico. `CONTEXTO-NUEVA-SESION.md` quedó
**desactualizado**: describe un token `shpat_` que ya no se usa (el código migró a
`client_credentials` en `src/shopify.js:55-97`) y da por pendiente un end-to-end que en realidad
corrió 2.806 veces.

> ⚠️ **Antes de commitear:** cualquier commit a este repo **reactiva el workflow** desactivado por
> inactividad (H1). Conviene hacerlo recién cuando H3 esté arreglado — si no, la primera corrida
> repite los 2.396 errores del arranque en frío, otra vez con tilde verde.

## Segunda pasada — hallazgos que cambian la solución

### N1 — Contabilium soporta múltiples integraciones ecommerce, una por depósito

De la documentación oficial del proveedor
(https://documenter.getpostman.com/view/17702437/2s93shz9yz):

> *"Cada cuenta integrada tendrá un IDIntegracion distinto y se configuran independientemente."*
> Cada integración guarda su propio **IVA, Punto de venta, Depósito, Condición de venta y Lista de
> precios**, en Ventas → Integraciones → Ecommerce → Configuración.
> *"Depósito: valor por defecto al facturar las ventas de esta integración **e inventario que se
> utiliza para sincronizar stock**."*

La premisa del proyecto ("Contabilium sólo deja registrar un depósito") es cierta **por integración**,
no por cuenta. Se puede crear una segunda integración con Depósito = `LOCAL DOT BAIRES` (127356).

### N2 — Hay un webhook de cambios de stock, y nadie lo usa

> *"Recibir notificaciones en tu implementación sobre modificaciones de stock y/o precios […]
> (Webhook)"* · *"A la URL Callback configurada recibirás un POST como el siguiente
> `{{urlCallback}}?sku={0}`"*

`grep` de `idIntegracion` / `getInfoForEcommerce` / `notificador/ecommerce` sobre `iey-ai/src` y
`iey-ai/docs/*.md` devuelve **0**: el ecosistema entero está en polling pudiendo estar en push.

### N3 — Hay endpoint para empujar ventas, idempotente por contrato

`POST /notificador/ecommerce` registra una venta contra un `IDIntegracion`, y por lo tanto descuenta
de **su** depósito. > *"Contabilium identifica como valores únicos los campos **IDVentaIntegracion**
y **IDIntegracion**"* — reenviar el mismo par actualiza en vez de duplicar. Es la pieza que cierra el
ciclo y elimina H6 de raíz. Requiere leer órdenes de Shopify (scopes que hoy no tenemos).

### N4 — `/api/stock/Novedades` NO sirve como fuente incremental

Descartado por evidencia ajena: el gate G-01 de iey-ai lo probó contra la API real y falló —
*"orden no monotónico FAIL; páginas `skip` superpuestas FAIL; timestamps duplicados FAIL"*
(`iey-ai origin/main:docs/specs/stock-sync-reliability/findings/SSR-PROBE-01-delta-01.md`).
ADR-0007 lo sacó del camino operativo. El webhook es un mecanismo distinto y no comparte el problema:
notifica un SKU y nosotros releemos su valor actual.

### N5 — `disabled_inactivity` sólo aplica a workflows con `schedule:`

Verificado en iey-ai: `stock-sync-continuation`, `contabilium-stock-sync` y `stock-novedades` no
declaran `schedule` y siguen `state=active` pese a meses sin correr. El de `shopify-sync`, único con
`schedule`, fue desactivado a los 60 días. **Disparar desde afuera elimina H1 por completo.**

### N6 — La escritura absoluta es lo que causa sobreventa

Hay **dos sumideros independientes** sobre el mismo stock físico del DOT: el mostrador (se registra en
Contabilium) y la web (lo descuenta Shopify). Escribir el absoluto de Contabilium re-infla lo vendido
online. La corrección es aplicar **deltas** contra una línea base durable — ver
`docs/specs/001-dot-stock-sync/spec.md`, regla 2.

### N7 — El fix de GitHub Actions de iey-ai ya está aplicado

Ver `iey-ai › evidence/anexo-iey-ai-github-actions.md` (vive en el repo privado: describe internals de iey-ai). El checkout local está 146 commits atrás y describe código
muerto.

---

## Temas a debatir antes de implementar

En orden de impacto, para la próxima conversación:

1. **Dónde corre el cron.** GitHub Actions demostró 5% de entrega y auto-desactivación acá, y 76% de
   fallo en iey-ai. Opciones sobre la mesa: replicar el patrón de continuation, migrar a un runner
   con cadencia garantizada, o mover el sync a un endpoint de la app de iey-ai (que ya lee el DOT).
2. **Cómo se resuelve la deriva de H6** — depende de la verificación pendiente #1.
3. **Rediseño del incremental**: `Novedades` como fuente de cambios + `Location.inventoryLevels` para
   comparar contra Shopify, en lugar de una libreta local que espeja Contabilium.
4. **Los bugs H3/H4/H5** son fixes acotados, de bajo riesgo e independientes de lo anterior — se
   pueden separar en un paquete propio y salir primero.
