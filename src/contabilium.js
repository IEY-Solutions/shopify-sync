// contabilium.js
// -----------------------------------------------------------------------------
// Lee el stock del deposito DOT Baires desde la API REST de Contabilium.
//
// Concepto: este modulo es un "lector". Su unica responsabilidad es devolver,
// para cada SKU del deposito, cuanto stock hay. No sabe nada de Shopify.
//
// Auth: OAuth2 client_credentials (POST /token). El token dura 24h.
// Stock: GET /api/inventarios/getStockByDeposito?id=...&page=...&pageSize=50
//        La respuesta trae { TotalItems, Items: [{ Codigo, StockActual, ... }] }
//        donde Codigo = SKU y StockActual = unidades disponibles.
//
// Patron copiado del cliente real de Prediktia (src/lib/integrations/contabilium).
// -----------------------------------------------------------------------------

const PAGE_SIZE = 50;
const DELAY_ENTRE_REQUESTS_MS = 500; // rate limit Contabilium AR: 25 req/10s

// Pausa simple (rate limiting preventivo)
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// authenticate — obtiene un access token de Contabilium
// -----------------------------------------------------------------------------
async function authenticate(baseUrl, clientId, clientSecret) {
  const res = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Contabilium auth fallo (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Contabilium auth: respuesta sin access_token");
  }
  return data.access_token;
}

// -----------------------------------------------------------------------------
// fetchStockPage — trae UNA pagina de stock del deposito
// -----------------------------------------------------------------------------
async function fetchStockPage(baseUrl, token, depositoId, page) {
  const url = new URL(`${baseUrl}/api/inventarios/getStockByDeposito`);
  url.searchParams.set("id", depositoId);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(PAGE_SIZE));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Contabilium getStockByDeposito fallo (HTTP ${res.status}): ${body.slice(0, 200)}`
    );
  }

  return res.json();
}

// -----------------------------------------------------------------------------
// getStockDeposito — devuelve el stock COMPLETO del deposito DOT
// -----------------------------------------------------------------------------
// Retorna un Map: SKU (string, normalizado a MAYUSCULAS) -> stock (numero entero).
//
// Si algo falla (auth, HTTP, datos invalidos) lanza un Error. El llamador
// (sync.js) NO debe actualizar Shopify si esto falla (requisito 15).
// -----------------------------------------------------------------------------
export async function getStockDeposito() {
  const baseUrl = process.env.CONTABILIUM_API_URL;
  const clientId = process.env.CONTABILIUM_CLIENT_ID;
  const clientSecret = process.env.CONTABILIUM_CLIENT_SECRET;
  const depositoId = process.env.CONTABILIUM_DOT_DEPOSITO_ID;

  if (!baseUrl || !clientId || !clientSecret || !depositoId) {
    throw new Error(
      "Faltan variables de Contabilium en .env: " +
        "CONTABILIUM_API_URL, CONTABILIUM_CLIENT_ID, CONTABILIUM_CLIENT_SECRET, CONTABILIUM_DOT_DEPOSITO_ID"
    );
  }

  console.log(`[Contabilium] Autenticando...`);
  const token = await authenticate(baseUrl, clientId, clientSecret);
  console.log(`[Contabilium] Token obtenido. Leyendo deposito ${depositoId}...`);

  const stockPorSku = new Map();
  let page = 1;
  let totalPaginas = 1;

  while (page <= totalPaginas) {
    await delay(DELAY_ENTRE_REQUESTS_MS); // respetar rate limit
    const respuesta = await fetchStockPage(baseUrl, token, depositoId, page);

    // Validacion defensiva de la forma de la respuesta (requisito 15)
    const totalItems = Number(respuesta?.TotalItems);
    const items = respuesta?.Items;
    if (!Number.isFinite(totalItems) || !Array.isArray(items)) {
      throw new Error(
        `Contabilium devolvio datos invalidos en pagina ${page} (TotalItems/Items)`
      );
    }

    totalPaginas = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    for (const item of items) {
      const sku = String(item?.Codigo ?? "").trim().toUpperCase();
      const stock = Math.round(Number(item?.StockActual));
      if (!sku || !Number.isFinite(stock)) continue; // fila invalida -> saltear
      stockPorSku.set(sku, stock);
    }

    console.log(
      `[Contabilium] Pagina ${page}/${totalPaginas} leida (${items.length} items, acumulado ${stockPorSku.size} SKUs)`
    );
    page++;
  }

  if (stockPorSku.size === 0) {
    throw new Error("Contabilium devolvio 0 SKUs para el deposito DOT (sospechoso, no se actualiza Shopify)");
  }

  console.log(`[Contabilium] OK. ${stockPorSku.size} SKUs leidos del deposito DOT.`);
  return stockPorSku;
}
