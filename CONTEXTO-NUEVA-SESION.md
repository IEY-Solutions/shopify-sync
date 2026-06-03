# CONTEXTO: Middleware de sync de stock Contabilium → Shopify (proyecto iey-shopify-sync)

Soy Agustín, fundador de IEY Innovations. Estoy aprendiendo a programar, así que
explicame paso a paso, en español, qué hacés y por qué (modo educativo). Confirmá
antes de operaciones de riesgo. NUNCA leas ni muestres el contenido del archivo .env
(regla de seguridad: contiene secretos).

## Qué es este proyecto
Un middleware Node.js LOCAL e independiente (NO es una app Shopify con UI, NO es parte
de Prediktia/Next.js). Sincroniza el stock del depósito "DOT BAIRES" de Contabilium
hacia la location "IEY Shopping Dot Baires" de Shopify. Contabilium no soporta multi-
depósito con Shopify, por eso lo hacemos propio.

Arquitectura:
  Contabilium (depósito DOT, id 127356)
   → este middleware Node.js
   → Shopify Admin GraphQL API (mutation inventorySetQuantities, cantidad absoluta)
   → Location DOT (gid://shopify/Location/83342655574)

Regla clave: Contabilium es la fuente de verdad. NUNCA tocar el depósito principal,
solo escribir la location DOT.

## Ubicación y stack
- Carpeta: ~/Desktop/iey-shopify-sync (abrir en VS Code con: code ~/Desktop/iey-shopify-sync)
- Node.js v24, ES modules ("type": "module" en package.json)
- Dependencias ya instaladas: dotenv, node-cron

## Archivos ya creados (proyecto COMPLETO y con sintaxis verificada)
- package.json        → scripts: "sync", "sync:sku", "cron"
- .gitignore          → ignora .env, node_modules/, .cache/
- .env                → secretos reales (NO leer). Variables abajo.
- .env.example        → plantilla sin secretos
- .cache/sku-map.json → cache SKU → inventory_item_id (se crea solo)
- src/contabilium.js  → auth OAuth2 + lee stock del depósito DOT (paginado)
- src/shopify.js      → busca inventory_item por SKU (con cache) + setea stock
- src/sync.js         → orquesta: compara Contabilium vs Shopify y decide qué actualizar
- src/index.js        → entry point, parsea args y elige modo

## Variables de entorno (.env) — solo nombres, NO pedir valores
SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SHOPIFY_API_VERSION (2026-01),
SHOPIFY_DOT_LOCATION_ID, CONTABILIUM_API_URL, CONTABILIUM_CLIENT_ID,
CONTABILIUM_CLIENT_SECRET, CONTABILIUM_DOT_DEPOSITO_ID (=127356), DRY_RUN.

## Hechos técnicos verificados (no re-investigar)
- Contabilium auth: OAuth2 client_credentials, POST {API_URL}/token, token dura 24h.
- Contabilium stock: GET /api/inventarios/getStockByDeposito?id=127356&page=N&pageSize=50
  Respuesta: { TotalItems, Items:[{ Codigo (=SKU), StockActual (=stock), ... }] }.
- Shopify: dos operaciones GraphQL YA validadas contra el schema 2026-01:
    1) productVariants(query:"sku:XXX") → inventoryItem.id + available en la location.
    2) inventorySetQuantities (name:"available", reason:"correction", con compareQuantity
       para concurrencia segura).
- Scopes del token Shopify: read_products, read_inventory, write_inventory.
- Nota API: desde 2026-04 inventorySetQuantities requerirá @idempotent (en 2026-01 opcional).

## Protecciones implementadas (requisitos del negocio)
- DRY_RUN=true → simula, no escribe en Shopify.
- SKU no existe en Shopify → loguea [SKIP] y continúa.
- Contabilium falla / devuelve 0 SKUs → lanza error y NO toca Shopify.
- Stock ya coincide → no escribe.
- Item no activado en la location DOT → loguea [SKIP] y saltea (no auto-activa).
- Solo escribe la location DOT. Cantidades absolutas con compareQuantity.

## Modos de ejecución
  node src/index.js --sku IEY-XXX            → prueba 1 SKU (lee stock real de Contabilium)
  node src/index.js --sku IEY-XXX --qty 5    → prueba 1 SKU con cantidad fija (test puro Shopify)
  node src/index.js                          → sync completo, una vez
  node src/index.js --cron                   → sync completo cada 3 min (guard anti-solapamiento)

## ESTADO ACTUAL Y PRÓXIMO PASO
Falta probar end-to-end. Pendiente:
1. [GOTCHA A CORREGIR] El SHOPIFY_ADMIN_TOKEN del .env empieza con "shpss_" (ese es el
   API secret key, NO sirve). Necesito el Admin API access token que empieza con "shpat_",
   que aparece tras INSTALAR la app custom en Shopify admin. Verificar esto primero.
2. Con DRY_RUN=true, correr: node src/index.js --sku <SKU real del DOT>
   y revisar que la línea [DRY] muestre "actualizaría X -> Y" con números coherentes.
3. Si OK, pasar DRY_RUN=false y escribir 1 SKU real; verificar en Shopify admin.
4. Recién después: sync completo y luego cron cada 3 min.

Arrancá ayudándome a verificar el punto 1 (el token shpat_) y guiándome para correr la
prueba del punto 2.
