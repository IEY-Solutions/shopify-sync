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
      porPresupuesto: true,
    };
  }

  return { reintentar: true, esperaMs, motivo: esRed ? "fallo de red" : `HTTP ${status}` };
}

// Ritmo minimo entre pedidos de comprobantes (R-1): el cupo de 25 req/10 s es
// de la cuenta y se comparte con iey-ai.
export const RITMO_MINIMO_COMPROBANTES_MS = 1500;

const MENSAJE_AGOTADO = "presupuesto de espera de la corrida agotado";

// -----------------------------------------------------------------------------
// Sesion por corrida (R-1): un token y un presupuesto de espera compartidos por
// el stock, /search y los detalles. Todo lo que duerme usa `sesion.dormir`.
// -----------------------------------------------------------------------------
export function crearSesionContabilium({
  baseUrl = process.env.CONTABILIUM_API_URL,
  clientId = process.env.CONTABILIUM_CLIENT_ID,
  clientSecret = process.env.CONTABILIUM_CLIENT_SECRET,
  ritmoComprobantesMs = RITMO_MINIMO_COMPROBANTES_MS,
  dormir = delay,
} = {}) {
  const ritmo = Number(ritmoComprobantesMs);
  return {
    baseUrl,
    clientId,
    clientSecret,
    token: null,
    tokenPendiente: null,
    estado: { esperaAcumuladaMs: 0, ultimoError: null, agotado: false },
    ritmoComprobantesMs: Number.isFinite(ritmo) ? Math.max(RITMO_MINIMO_COMPROBANTES_MS, ritmo) : RITMO_MINIMO_COMPROBANTES_MS,
    dormir,
  };
}

// Envuelve una llamada con la politica de reintentos de arriba. El presupuesto
// es el de la sesion: si se agota, la sesion queda cortada y ninguna llamada
// posterior vuelve a hacer un request.
async function conReintentos(descripcion, fn, sesion) {
  const estado = sesion.estado;
  for (let intento = 1; ; intento++) {
    if (estado.agotado) throw new Error(`Contabilium ${descripcion}: ${MENSAJE_AGOTADO}`);
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
      if (d.porPresupuesto) estado.agotado = true;
      if (status !== null) return { ok: false, status, text: async () => `(${d.motivo})` };
      throw new Error(`Contabilium ${descripcion}: ${d.motivo} — ${estado.ultimoError?.message ?? "sin detalle"}`);
    }

    estado.esperaAcumuladaMs += d.esperaMs;
    console.warn(
      `  [reintento] ${descripcion}: ${d.motivo}, espero ${Math.round(d.esperaMs / 1000)}s ` +
        `(intento ${intento}/${MAX_INTENTOS})`
    );
    await sesion.dormir(d.esperaMs);
  }
}

// Token de la sesion: se pide una sola vez por corrida.
async function tokenDe(sesion) {
  if (sesion.token) return sesion.token;
  if (!sesion.tokenPendiente) {
    sesion.tokenPendiente = authenticate(sesion.baseUrl, sesion.clientId, sesion.clientSecret, sesion).then(
      (t) => {
        sesion.token = t;
        return t;
      },
      (err) => {
        sesion.tokenPendiente = null;
        throw err;
      }
    );
  }
  return sesion.tokenPendiente;
}

function getConToken(url, token) {
  return fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

// -----------------------------------------------------------------------------
// authenticate — obtiene un access token de Contabilium
// -----------------------------------------------------------------------------
async function authenticate(baseUrl, clientId, clientSecret, sesion) {
  const res = await conReintentos("auth", () =>
    fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }), sesion);

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
async function fetchStockPage(sesion, token, depositoId, page) {
  const url = new URL(`${sesion.baseUrl}/api/inventarios/getStockByDeposito`);
  url.searchParams.set("id", depositoId);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(PAGE_SIZE));

  const res = await conReintentos(`pagina ${page}`, () => getConToken(url.toString(), token), sesion);

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
//
// `sesion`: la de la corrida (token y presupuesto compartidos). Sin sesion se
// crea una propia (syncUnSku, syncTodos, diagnostico-locations).
// -----------------------------------------------------------------------------
export async function getStockDeposito(depositoIdExplicito = null, sesion = null) {
  const s = sesion ?? crearSesionContabilium();
  const depositoId = depositoIdExplicito ?? process.env.CONTABILIUM_DOT_DEPOSITO_ID;

  if (!s.baseUrl || !s.clientId || !s.clientSecret || !depositoId) {
    throw new Error(
      "Faltan variables de Contabilium en .env: " +
        "CONTABILIUM_API_URL, CONTABILIUM_CLIENT_ID, CONTABILIUM_CLIENT_SECRET, CONTABILIUM_DOT_DEPOSITO_ID"
    );
  }

  console.log(`[Contabilium] Autenticando...`);
  const token = await tokenDe(s);
  console.log(`[Contabilium] Token obtenido. Leyendo deposito ${depositoId}...`);

  const stockPorSku = new Map();
  let reservados = 0; // SKUs con mercaderia reservada: hoy son 0 en el DOT
  let page = 1;
  let totalPaginas = 1;

  while (page <= totalPaginas) {
    await s.dormir(DELAY_ENTRE_REQUESTS_MS); // respetar rate limit
    const respuesta = await fetchStockPage(s, token, depositoId, page);

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
    throw new Error(`Contabilium devolvio 0 SKUs para el deposito ${depositoId} (sospechoso, no se actualiza Shopify)`);
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

// -----------------------------------------------------------------------------
// buscarComprobantes / fetchComprobantesDetalle — clasificador de causa (R-1)
// -----------------------------------------------------------------------------
// De solo lectura. /api/comprobantes/search NO tiene filtro de deposito
// server-side, trae `Items` null e `Inventario` 0: devuelve los comprobantes de
// TODA la cuenta en el rango de dias. El detalle real (lineas, deposito) sale de
// GET /api/comprobantes/?id=, de a uno y con ritmo.
//
// Fechas: solo "YYYY-MM-DD" (granularidad de dia, el unico formato probado en
// produccion por iey-ai). Cualquier otro formato se rechaza sin pedir nada.
const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

export async function buscarComprobantes({ fechaDesde, fechaHasta } = {}, sesion = null) {
  if (!FORMATO_DIA.test(String(fechaDesde ?? "")) || !FORMATO_DIA.test(String(fechaHasta ?? ""))) {
    throw new Error(`Contabilium comprobantes/search: fechas invalidas (se espera YYYY-MM-DD): ${fechaDesde} / ${fechaHasta}`);
  }
  const s = sesion ?? crearSesionContabilium();
  const token = await tokenDe(s);

  const resumenes = [];
  let page = 1;
  let totalPaginas = 1;

  while (page <= totalPaginas) {
    await s.dormir(s.ritmoComprobantesMs);
    const url = new URL(`${s.baseUrl}/api/comprobantes/search`);
    url.searchParams.set("fechaDesde", fechaDesde);
    url.searchParams.set("fechaHasta", fechaHasta);
    url.searchParams.set("page", String(page));

    const res = await conReintentos(`comprobantes/search pagina ${page}`, () => getConToken(url.toString(), token), s);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Contabilium comprobantes/search fallo (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }
    const respuesta = await res.json();

    const totalItems = Number(respuesta?.TotalItems);
    const items = respuesta?.Items;
    if (!Number.isFinite(totalItems) || !Array.isArray(items)) {
      throw new Error(`Contabilium comprobantes/search devolvio datos invalidos en pagina ${page}`);
    }

    totalPaginas = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    resumenes.push(...items);
    page++;
  }

  return resumenes;
}

// Un 200 es un comprobante interpretable solo si es un objeto JSON con Id
// numerico e Items arreglo (caso real 173386407).
function interpretarDetalle(texto) {
  let cuerpo;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return null;
  if (!Number.isFinite(Number(cuerpo.Id)) || cuerpo.Id === null || cuerpo.Id === "") return null;
  if (!Array.isArray(cuerpo.Items)) return null;
  return cuerpo;
}

// Pide el detalle de UN comprobante. Nunca lanza: devuelve el resultado del id.
// `definitivo` solo ante 400, 404 o un 200 que no es un comprobante.
async function pedirDetalle(s, token, id) {
  const url = new URL(`${s.baseUrl}/api/comprobantes/`);
  url.searchParams.set("id", String(id));
  let res;
  try {
    res = await conReintentos(`comprobantes/?id=${id}`, () => getConToken(url.toString(), token), s);
  } catch (err) {
    return { id, ok: false, error: err.message, definitivo: false };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      id,
      ok: false,
      error: `Contabilium comprobantes/?id=${id} fallo (HTTP ${res.status}): ${String(body).slice(0, 200)}`,
      definitivo: res.status === 400 || res.status === 404,
    };
  }
  const texto = await res.text().catch(() => "");
  const detalle = interpretarDetalle(texto);
  if (!detalle) {
    return { id, ok: false, error: `Contabilium comprobantes/?id=${id}: la respuesta no es un comprobante interpretable`, definitivo: true };
  }
  return { id, ok: true, detalle };
}

// fetchComprobantesDetalle — detalle de varios comprobantes, SECUENCIAL y con
// ritmo (>= 1500 ms): el cupo de Contabilium es compartido con iey-ai y un 429
// bloquea a los dos por ~1 min. Un id que falla no corta el lote; con el
// presupuesto de la corrida agotado, los restantes vuelven sin request.
export async function fetchComprobantesDetalle(ids, sesion = null) {
  const s = sesion ?? crearSesionContabilium();
  const resultados = [];
  let token = null;
  let errorDeToken = null;
  for (const id of ids) {
    if (s.estado.agotado) {
      resultados.push({ id, ok: false, error: MENSAJE_AGOTADO, definitivo: false });
      continue;
    }
    if (!token && !errorDeToken) {
      try {
        token = await tokenDe(s);
      } catch (err) {
        errorDeToken = err.message; // sin token no se pide ningun id (no se reintenta por id)
      }
    }
    if (errorDeToken) {
      resultados.push({ id, ok: false, error: errorDeToken, definitivo: false });
      continue;
    }
    await s.dormir(s.ritmoComprobantesMs);
    resultados.push(await pedirDetalle(s, token, id));
  }
  return resultados;
}
