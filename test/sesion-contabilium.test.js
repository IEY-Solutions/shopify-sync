// R-1 / CA-1 (parte 2) — una sesion de Contabilium por corrida: un solo token y
// un solo presupuesto de espera (5 min) compartidos por getStockDeposito,
// buscarComprobantes y fetchComprobantesDetalle (hallazgo 3 del segundo juez).
//
// Interfaz: aceptacion/clasificador-causa-comprobante/DISENO-INTERFAZ.md, seccion 1.
//
// Hoy cada funcion autentica por su cuenta (3 POST /token por corrida) y
// fetchComprobanteById arma un `estado` nuevo POR ID, asi que el techo de 5 min
// vale por id: 5 ids con 429 sostenido esperan 5 x 3 min. Estos tests fallan con
// ese codigo.
//
// `dormir` es falso (anota, no duerme). Si la implementacion usara el `delay`
// real para un 429 (60 s), el test cae por el `timeout` de 15 s: rojo, no cuelgue.
//
// Corre con: node --test test/sesion-contabilium.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as contab from "../src/contabilium.js";
import * as sync from "../src/sync.js";
import {
  conDirTemporal,
  depsFake,
  llamadasVacias,
  reloj,
  sembrarLibreta,
  comprobanteDetalle,
  escriturasDe,
  PAR_DOT,
  PAR_ISLA,
  DEPOSITO_DOT,
  DEPOSITO_ISLA,
  LOCATION_DOT,
  LOCATION_ISLA,
  HORA,
} from "./_helpers-clasificador.js";

const BASE = "https://contabilium.falso.test";
const LIMITE = { timeout: 15_000 };

function respuesta(status, cuerpo, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h] ?? null },
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  };
}
const r429 = () => respuesta(429, { error: "Too Many Requests" }, { "Retry-After": "60" });

function instalarFetch(rutear) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, opts = {}) => {
    const req = { metodo: opts.method ?? "GET", url: new URL(String(url)), auth: opts.headers?.Authorization ?? null };
    requests.push(req);
    return rutear(req);
  };
  return { requests, restaurar: () => (globalThis.fetch = original) };
}

const esToken = (req) => req.metodo === "POST" && req.url.pathname.endsWith("/token");
const esStock = (req) => req.url.pathname.endsWith("/getStockByDeposito");
const esSearch = (req) => req.url.pathname.endsWith("/api/comprobantes/search");
const esDetalle = (req) => /\/api\/comprobantes\/?$/.test(req.url.pathname);

function sesionDePrueba(esperas) {
  return contab.crearSesionContabilium({
    baseUrl: BASE,
    clientId: "id-prueba",
    clientSecret: "secreto-prueba",
    dormir: async (ms) => {
      esperas.push(ms);
    },
  });
}

// Esperas por reintento (429 = 60 s) vs pausas de ritmo (500 ms / 1,5 s).
const sumaEsperasDeReintento = (esperas) => esperas.filter((ms) => ms >= 10_000).reduce((a, b) => a + b, 0);

function paginaStock(sku, cantidad) {
  return respuesta(200, { TotalItems: 1, Items: [{ Codigo: sku, StockActual: cantidad, StockConReservas: cantidad }] });
}

// -----------------------------------------------------------------------------
// Un solo token
// -----------------------------------------------------------------------------

test("CA-1: stock + /search + detalle con la misma sesion autentican UNA sola vez y usan ese token", LIMITE, async () => {
  const esperas = [];
  const f = instalarFetch((req) => {
    if (esToken(req)) return respuesta(200, { access_token: "tok-unico" });
    if (esStock(req)) return paginaStock("IEY-A", 3);
    if (esSearch(req)) return respuesta(200, { TotalItems: 2, Items: [{ Id: 1, TipoFc: "FCB" }, { Id: 2, TipoFc: "FCB" }] });
    if (esDetalle(req)) return respuesta(200, { Id: Number(req.url.searchParams.get("id")), Items: [] });
    throw new Error(`request inesperado ${req.url}`);
  });
  try {
    const sesion = sesionDePrueba(esperas);
    await contab.getStockDeposito(DEPOSITO_DOT, sesion);
    await contab.buscarComprobantes({ fechaDesde: "2026-08-12", fechaHasta: "2026-08-12" }, sesion);
    await contab.fetchComprobantesDetalle([1, 2], sesion);
    assert.equal(f.requests.filter(esToken).length, 1, "un solo POST /token por corrida (hoy son 3)");
    for (const r of f.requests.filter((x) => !esToken(x))) assert.equal(r.auth, "Bearer tok-unico");
  } finally {
    f.restaurar();
  }
});

// -----------------------------------------------------------------------------
// Un solo presupuesto de espera
// -----------------------------------------------------------------------------

test("CA-1: 429 en stock (3 min) + 429 en /search: el techo de 5 min es de la CORRIDA; /search corta y el detalle ya no pide nada", LIMITE, async () => {
  const esperas = [];
  let intentosStock = 0;
  const f = instalarFetch((req) => {
    if (esToken(req)) return respuesta(200, { access_token: "tok" });
    if (esStock(req)) {
      intentosStock++;
      return intentosStock <= 3 ? r429() : paginaStock("IEY-A", 3); // 3 esperas de 60 s = 180 s
    }
    if (esSearch(req) || esDetalle(req)) return r429(); // bloqueo sostenido
    throw new Error(`request inesperado ${req.url}`);
  });
  try {
    const sesion = sesionDePrueba(esperas);
    const stock = await contab.getStockDeposito(DEPOSITO_DOT, sesion);
    assert.equal(stock.get("IEY-A"), 3);
    assert.equal(sumaEsperasDeReintento(esperas), 180_000);

    await assert.rejects(() => contab.buscarComprobantes({ fechaDesde: "2026-08-12", fechaHasta: "2026-08-12" }, sesion));
    // Con presupuesto por funcion, /search podria esperar otros 180 s (total 360 s).
    assert.ok(
      sumaEsperasDeReintento(esperas) <= contab.PRESUPUESTO_ESPERA_MS,
      `espera acumulada ${sumaEsperasDeReintento(esperas)} ms > 5 min: el presupuesto no es de la corrida`
    );

    const detallesAntes = f.requests.filter(esDetalle).length;
    try {
      const res = await contab.fetchComprobantesDetalle([1, 2, 3], sesion);
      assert.ok(res.every((r) => r.ok === false), "con el presupuesto agotado ningun detalle puede volver ok");
    } catch {
      // Tambien vale que rechace: lo que importa es que no pida ni espere.
    }
    assert.equal(f.requests.filter(esDetalle).length - detallesAntes, 0, "con el presupuesto agotado no se hace ni un request mas");
    assert.ok(sumaEsperasDeReintento(esperas) <= contab.PRESUPUESTO_ESPERA_MS);
  } finally {
    f.restaurar();
  }
});

test("CA-1: con 429 sostenido en el detalle, la corrida corta al agotar 5 min en total, en vez de esperar 3 min POR ID", LIMITE, async () => {
  const esperas = [];
  const f = instalarFetch((req) => {
    if (esToken(req)) return respuesta(200, { access_token: "tok" });
    if (esDetalle(req)) return r429();
    throw new Error(`request inesperado ${req.url}`);
  });
  try {
    const sesion = sesionDePrueba(esperas);
    let res = null;
    try {
      res = await contab.fetchComprobantesDetalle([1, 2, 3, 4, 5], sesion);
    } catch {
      res = null;
    }
    if (res) {
      assert.equal(res.length, 5);
      assert.ok(res.every((r) => r.ok === false));
    }
    const requestsDetalle = f.requests.filter(esDetalle);
    // Presupuesto compartido: id 1 = 4 intentos (3 esperas, 180 s), id 2 = 3 intentos
    // (240 s, 300 s, y la tercera espera excede): 7 requests y 300 s. Con presupuesto
    // por id serian 20 requests y 900 s.
    assert.ok(requestsDetalle.length <= 7, `${requestsDetalle.length} requests de detalle: tiene que cortar al agotar el presupuesto`);
    const idsPedidos = new Set(requestsDetalle.map((r) => r.url.searchParams.get("id")));
    // Control positivo: el detalle SI uso la sesion (su token y su `dormir`) y
    // reintento el id 1 hasta MAX_INTENTOS; sin esto, una implementacion que
    // fallara antes de pedir nada pasaria las cotas de arriba.
    assert.ok(idsPedidos.has("1"), "el id 1 se tiene que haber pedido");
    assert.ok(
      sumaEsperasDeReintento(esperas) >= 180_000,
      `espero ${sumaEsperasDeReintento(esperas)} ms: los reintentos del id 1 tienen que usar el dormir de la sesion`
    );
    assert.ok(sumaEsperasDeReintento(esperas) <= contab.PRESUPUESTO_ESPERA_MS, `espero ${sumaEsperasDeReintento(esperas)} ms`);
    assert.ok(!idsPedidos.has("4") && !idsPedidos.has("5"), "despues de agotar el presupuesto no se pide ningun id mas");
  } finally {
    f.restaurar();
  }
});

// -----------------------------------------------------------------------------
// La corrida completa (correrTodosLosPares) con el cliente REAL
// -----------------------------------------------------------------------------

test("CA-1/R-3: una corrida de dos pares con el cliente real autentica una vez y consulta /search una vez", LIMITE, async () => {
  await conDirTemporal(async (dir) => {
    const envPrevio = {
      CONTABILIUM_API_URL: process.env.CONTABILIUM_API_URL,
      CONTABILIUM_CLIENT_ID: process.env.CONTABILIUM_CLIENT_ID,
      CONTABILIUM_CLIENT_SECRET: process.env.CONTABILIUM_CLIENT_SECRET,
    };
    // Si alguna funcion ignorara la sesion y autenticara por su cuenta, que lo
    // haga contra el fetch falso (y se cuente), no contra la red real.
    process.env.CONTABILIUM_API_URL = BASE;
    process.env.CONTABILIUM_CLIENT_ID = "id-prueba";
    process.env.CONTABILIUM_CLIENT_SECRET = "secreto-prueba";

    const T = "2026-08-12T22:30:00.000Z";
    const esperas = [];
    const detalle501 = comprobanteDetalle({
      id: 501,
      referenciaUtc: new Date(new Date(T).getTime() - HORA).toISOString(),
      items: [["SKU-D", 1]],
    });
    const f = instalarFetch((req) => {
      if (esToken(req)) return respuesta(200, { access_token: "tok" });
      if (esStock(req)) {
        const id = req.url.searchParams.get("id");
        if (id === DEPOSITO_DOT) return paginaStock("SKU-D", 4);
        if (id === DEPOSITO_ISLA) return paginaStock("SKU-I", 7);
      }
      if (esSearch(req)) return respuesta(200, { TotalItems: 1, Items: [{ Id: 501, TipoFc: "FCB" }] });
      if (esDetalle(req) && req.url.searchParams.get("id") === "501") return respuesta(200, detalle501);
      throw new Error(`request inesperado ${req.url}`);
    });

    try {
      sembrarLibreta(dir, "dot", { skus: { "SKU-D": 5 }, contabilium: { "SKU-D": 5 }, corte: "2026-08-01T00:00:00.000Z" });
      sembrarLibreta(dir, "galerias-pacifico", { skus: { "SKU-I": 8 }, contabilium: { "SKU-I": 8 }, corte: "2026-08-01T00:00:00.000Z" });

      const llamadas = llamadasVacias();
      const deps = {
        ...depsFake({
          dir,
          reloj: reloj(T),
          stock: new Map(),
          shopify: new Map([
            [LOCATION_DOT, new Map([["SKU-D", 4]])], // Shopify ya desconto la venta online
            [LOCATION_ISLA, new Map([["SKU-I", 8]])],
          ]),
          llamadas,
        }),
        getStockDeposito: contab.getStockDeposito,
        buscarComprobantes: contab.buscarComprobantes,
        fetchComprobantesDetalle: contab.fetchComprobantesDetalle,
        crearSesion: () => sesionDePrueba(esperas),
      };

      await sync.correrTodosLosPares([PAR_DOT, PAR_ISLA], deps);

      assert.equal(f.requests.filter(esToken).length, 1, "un solo token para toda la corrida, con dos pares");
      assert.equal(f.requests.filter(esSearch).length, 1, "el refresco del registro es uno por corrida, no uno por par");
      assert.equal(f.requests.filter(esDetalle).length, 1);
      // Y la contabilidad funciona con el formato real del cliente:
      assert.deepEqual(escriturasDe(llamadas, "SKU-D", LOCATION_DOT), [], "DOT: delta -1 explicado por la venta Shopify (501): no escribe");
      assert.deepEqual(escriturasDe(llamadas, "SKU-I", LOCATION_ISLA), [7], "isla: delta -1 sin credito propio: escribe 8 - 1");
    } finally {
      f.restaurar();
      for (const [k, v] of Object.entries(envPrevio)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

test("CA-1: correrTodosLosPares crea UNA sesion y le pasa ESA misma a stock, /search y detalle de todos los pares", async () => {
  await conDirTemporal(async (dir) => {
    const T = "2026-08-12T22:30:00.000Z";
    sembrarLibreta(dir, "dot", { skus: { "SKU-D": 5 }, contabilium: { "SKU-D": 5 }, corte: "2026-08-01T00:00:00.000Z" });
    sembrarLibreta(dir, "galerias-pacifico", { skus: { "SKU-I": 8 }, contabilium: { "SKU-I": 8 }, corte: "2026-08-01T00:00:00.000Z" });
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([
        [DEPOSITO_DOT, new Map([["SKU-D", 4]])],
        [DEPOSITO_ISLA, new Map([["SKU-I", 7]])],
      ]),
      shopify: new Map([
        [LOCATION_DOT, new Map([["SKU-D", 5]])],
        [LOCATION_ISLA, new Map([["SKU-I", 8]])],
      ]),
      search: [{ Id: 777, TipoFc: "FCB" }],
      detalles: new Map([[777, comprobanteDetalle({ id: 777, origen: "", referenciaUtc: "2026-08-12T20:00:00.000Z", items: [["SKU-D", 1]] })]]),
      llamadas,
    });

    await sync.correrTodosLosPares([PAR_DOT, PAR_ISLA], deps);

    assert.equal(llamadas.crearSesion, 1, "una sesion por corrida");
    assert.equal(llamadas.getStockDeposito.length, 2);
    assert.ok(llamadas.sesiones.length >= 4, "stock x2 + /search + detalle recibieron la sesion");
    for (const s of llamadas.sesiones) assert.equal(s, llamadas.sesiones[0], "todas las llamadas reciben la MISMA sesion");
    assert.ok(llamadas.sesiones[0] && llamadas.sesiones[0].sesionFalsa === 1);
  });
});
