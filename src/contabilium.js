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
// H8 — reintentos ante fallos transitorios
// -----------------------------------------------------------------------------
// Hasta ahora no habia ninguno: UN solo 429, 5xx o corte de red en cualquiera de
// las ~52 paginas abortaba la corrida entera y tiraba todo el progreso. Es el
// unico hallazgo del diagnostico que quedaba sin corregir.
//
// Un 429 de Contabilium bloquea TODOS sus endpoints por ~1 minuto, y el cupo
// esta compartido con iey-ai (que presupuesta 18 de 25 req/10s). Por eso ante un
// 429 se respeta el `Retry-After` y, si no viene, se espera un minuto: insistir
// antes solo profundiza el bloqueo, y encima se lo profundiza al otro consumidor.
export const MAX_INTENTOS = 4;
export const ESPERA_429_POR_DEFECTO_MS = 60_000;
// Techo de espera acumulada por corrida. Regla heredada del cliente de iey-ai:
// si esperar nos pasa del presupuesto, NO dormimos — abortamos. Dormir 40 min
// dentro de un job con timeout de 50 es perder la corrida igual, pero tarde y
// sin diagnostico.
export const PRESUPUESTO_ESPERA_MS = 5 * 60_000;

const ESTADOS_TRANSITORIOS = new Set([408, 425, 429, 500, 502, 503, 504]);

// Decide si vale la pena reintentar. Pura a proposito: la logica de reintentos
// es exactamente el codigo que nunca se ejercita en produccion hasta el dia que
// importa, asi que tiene que poder testearse sin red.
//   status = null  -> fallo de red (fetch tiro), tambien transitorio
export function decidirReintento({ status, intento, retryAfter, esperaAcumuladaMs = 0 }) {
  if (intento >= MAX_INTENTOS) {
    return { reintentar: false, esperaMs: 0, motivo: `agotados los ${MAX_INTENTOS} intentos` };
  }

  const esRed = status === null || status === undefined;
  if (!esRed && !ESTADOS_TRANSITORIOS.has(status)) {
    // 400, 401, 403, 404: el reintento va a fallar igual. Fallar rapido y fuerte.
    return { reintentar: false, esperaMs: 0, motivo: `HTTP ${status} no es transitorio` };
  }

  let esperaMs;
  if (status === 429) {
    const seg = Number(retryAfter);
    esperaMs = Number.isFinite(seg) && seg > 0 ? seg * 1000 : ESPERA_429_POR_DEFECTO_MS;
  } else {
    esperaMs = 1000 * 2 ** (intento - 1); // 1s, 2s, 4s
  }

  if (esperaAcumuladaMs + esperaMs > PRESUPUESTO_ESPERA_MS) {
    return {
      reintentar: false,
      esperaMs: 0,
      motivo: `esperar ${Math.round(esperaMs / 1000)}s excede el presupuesto de la corrida`,
    };
  }

  return { reintentar: true, esperaMs, motivo: esRed ? "fallo de red" : `HTTP ${status}` };
}

// Envuelve una llamada con la politica de reintentos de arriba.
async function conReintentos(descripcion, fn, estado) {
  for (let intento = 1; ; intento++) {
    let status = null;
    let retryAfter = null;
    try {
      const res = await fn();
      if (res.ok) return res;
      status = res.status;
      retryAfter = res.headers?.get?.("Retry-After") ?? null;
      if (!ESTADOS_TRANSITORIOS.has(status)) return res; // el llamador arma el error
    } catch (err) {
      estado.ultimoError = err;
    }

    const d = decidirReintento({
      status,
      intento,
      retryAfter,
      esperaAcumuladaMs: estado.esperaAcumuladaMs,
    });
    if (!d.reintentar) {
      if (status !== null) return { ok: false, status, text: async () => `(${d.motivo})` };
      throw new Error(`Contabilium ${descripcion}: ${d.motivo} — ${estado.ultimoError?.message ?? "sin detalle"}`);
    }

    estado.esperaAcumuladaMs += d.esperaMs;
    console.warn(
      `  [reintento] ${descripcion}: ${d.motivo}, espero ${Math.round(d.esperaMs / 1000)}s ` +
        `(intento ${intento}/${MAX_INTENTOS})`
    );
    await delay(d.esperaMs);
  }
}

// -----------------------------------------------------------------------------
// authenticate — obtiene un access token de Contabilium
// -----------------------------------------------------------------------------
async function authenticate(baseUrl, clientId, clientSecret, estado) {
  const res = await conReintentos("auth", () =>
    fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }), estado);

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
async function fetchStockPage(baseUrl, token, depositoId, page, estado) {
  const url = new URL(`${baseUrl}/api/inventarios/getStockByDeposito`);
  url.searchParams.set("id", depositoId);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(PAGE_SIZE));

  const res = await conReintentos(`pagina ${page}`, () =>
    fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }), estado);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Contabilium getStockByDeposito fallo (HTTP ${res.status}): ${body.slice(0, 200)}`
    );
  }

  return res.json();
}

// -----------------------------------------------------------------------------
// cantidadDeItem — que numero de Contabilium es "el stock" (D-04, regla 11)
// -----------------------------------------------------------------------------
// `StockActual` NO descuenta la mercaderia reservada; `StockConReservas` si
// (StockConReservas = StockActual - StockReservado). Contabilium reserva al
// ENTRAR la orden, no al facturar, asi que publicar StockActual ofrece unidades
// que ya tienen dueño. Hoy en el DOT son identicos porque StockReservado = 0 en
// los 2.562 items, pero en CENTRAL hay 187 SKUs con reserva: la diferencia
// aparece el dia que el DOT empiece a reservar, y ese dia nadie va a estar
// mirando.
//
// Fallback a StockActual si el campo no viene: preferimos el valor viejo antes
// que un NaN que saltee el SKU en silencio.
export function cantidadDeItem(item) {
  const conReservas = Number(item?.StockConReservas);
  if (Number.isFinite(conReservas)) return Math.floor(conReservas);
  const actual = Number(item?.StockActual);
  return Number.isFinite(actual) ? Math.floor(actual) : NaN;
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

  // El presupuesto de espera es de la CORRIDA, no de cada request: si nos comimos
  // 4 minutos en la pagina 3, la pagina 40 ya no puede dormir un minuto mas.
  const estado = { esperaAcumuladaMs: 0, ultimoError: null };

  console.log(`[Contabilium] Autenticando...`);
  const token = await authenticate(baseUrl, clientId, clientSecret, estado);
  console.log(`[Contabilium] Token obtenido. Leyendo deposito ${depositoId}...`);

  const stockPorSku = new Map();
  let reservados = 0; // SKUs con mercaderia reservada: hoy son 0 en el DOT
  let page = 1;
  let totalPaginas = 1;

  while (page <= totalPaginas) {
    await delay(DELAY_ENTRE_REQUESTS_MS); // respetar rate limit
    const respuesta = await fetchStockPage(baseUrl, token, depositoId, page, estado);

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
      const stock = cantidadDeItem(item);
      if (!sku || !Number.isFinite(stock)) continue; // fila invalida -> saltear
      const reservado = Number(item?.StockReservado);
      if (Number.isFinite(reservado) && reservado > 0) reservados++;
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

  if (reservados > 0) {
    // Deja de ser cierto que StockActual y StockConReservas son lo mismo.
    console.warn(
      `[Contabilium] ${reservados} SKUs del DOT tienen mercaderia RESERVADA. ` +
        `Se publica StockConReservas (D-04): esas unidades ya tienen dueño.`
    );
  }
  console.log(`[Contabilium] OK. ${stockPorSku.size} SKUs leidos del deposito DOT.`);
  return stockPorSku;
}
