// R-1 / CA-1 (parte 1) — cliente de solo lectura de comprobantes, diseño B.
//
// Interfaz: aceptacion/clasificador-causa-comprobante/DISENO-INTERFAZ.md, seccion 1.
//   crearSesionContabilium({ baseUrl, clientId, clientSecret, ritmoComprobantesMs, dormir })
//   buscarComprobantes({ fechaDesde, fechaHasta }, sesion)   -> resumenes de /search
//   fetchComprobantesDetalle(ids, sesion) -> [{ id, ok, detalle } | { id, ok:false, error, definitivo }]
//   DEPS_REALES (exportado por src/sync.js) sin fetchComprobanteById.
//
// `fetch` y `dormir` son falsos: ningun test pega a la red ni duerme de verdad.
// La sesion compartida y el presupuesto por corrida estan en
// test/sesion-contabilium.test.js (mismo CA-1).
//
// Corre con: node --test test/comprobantes-contabilium.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as contab from "../src/contabilium.js";
import * as sync from "../src/sync.js";
import * as clasif from "../src/clasificador-causa.js";
import { comprobanteReal } from "./_helpers-clasificador.js";

const BASE = "https://contabilium.falso.test";

function respuesta(status, cuerpo, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h] ?? headers[String(h).toLowerCase()] ?? null },
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  };
}

// Instala un fetch falso que anota cada request en `linea` (linea de tiempo
// compartida con `dormir`) y mide cuantos requests hay en vuelo a la vez.
function instalarFetch(rutear, linea) {
  const original = globalThis.fetch;
  const estado = { enVuelo: 0, maxEnVuelo: 0, requests: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const req = { metodo: opts.method ?? "GET", url: u, auth: opts.headers?.Authorization ?? null };
    estado.requests.push(req);
    linea.push({ tipo: "fetch", req });
    estado.enVuelo++;
    estado.maxEnVuelo = Math.max(estado.maxEnVuelo, estado.enVuelo);
    try {
      await new Promise((r) => setImmediate(r)); // da lugar a que se solapen si hubiera paralelismo
      return rutear(req);
    } finally {
      estado.enVuelo--;
    }
  };
  return { estado, restaurar: () => (globalThis.fetch = original) };
}

function sesionDePrueba(linea, extra = {}) {
  return contab.crearSesionContabilium({
    baseUrl: BASE,
    clientId: "id-prueba",
    clientSecret: "secreto-prueba",
    dormir: async (ms) => {
      linea.push({ tipo: "dormir", ms });
    },
    ...extra,
  });
}

const esToken = (req) => req.metodo === "POST" && req.url.pathname.endsWith("/token");
const esSearch = (req) => req.url.pathname.endsWith("/api/comprobantes/search");
const esDetalle = (req) => req.url.pathname.endsWith("/api/comprobantes/") || req.url.pathname.endsWith("/api/comprobantes");

// -----------------------------------------------------------------------------
// buscarComprobantes
// -----------------------------------------------------------------------------

test("CA-1: buscarComprobantes manda fechaDesde/fechaHasta YYYY-MM-DD y page, sin id de deposito, y pagina hasta traer todo", async () => {
  const linea = [];
  const total = 120;
  const f = instalarFetch((req) => {
    if (esToken(req)) return respuesta(200, { access_token: "tok" });
    if (esSearch(req)) {
      const page = Number(req.url.searchParams.get("page"));
      const desde = (page - 1) * 50;
      const items = [];
      for (let i = desde; i < Math.min(desde + 50, total); i++) items.push({ Id: 1000 + i, TipoFc: "FCB" });
      return respuesta(200, { TotalItems: total, Items: items });
    }
    throw new Error(`request inesperado: ${req.url}`);
  }, linea);
  try {
    const resumenes = await contab.buscarComprobantes({ fechaDesde: "2026-08-12", fechaHasta: "2026-08-12" }, sesionDePrueba(linea));
    assert.equal(resumenes.length, total);
    assert.equal(resumenes[0].Id, 1000);
    assert.equal(resumenes[total - 1].Id, 1000 + total - 1);
    const searches = f.estado.requests.filter(esSearch);
    assert.deepEqual(searches.map((r) => r.url.searchParams.get("page")), ["1", "2", "3"]);
    for (const r of searches) {
      assert.equal(r.url.searchParams.get("fechaDesde"), "2026-08-12");
      assert.equal(r.url.searchParams.get("fechaHasta"), "2026-08-12");
      assert.equal(r.url.searchParams.get("id"), null, "/search no tiene filtro de deposito server-side");
      assert.equal(r.auth, "Bearer tok");
    }
  } finally {
    f.restaurar();
  }
});

test("CA-1: buscarComprobantes rechaza una fecha con hora (formato no probado en produccion) sin hacer ningun request a /search", async () => {
  const linea = [];
  const f = instalarFetch((req) => {
    if (esToken(req)) return respuesta(200, { access_token: "tok" });
    return respuesta(200, { TotalItems: 0, Items: [] });
  }, linea);
  try {
    for (const rango of [
      { fechaDesde: "2026-08-12T19:15:00", fechaHasta: "2026-08-12" },
      { fechaDesde: "2026-08-12", fechaHasta: "2026-08-13T01:30:00.000Z" },
      { fechaDesde: "12/08/2026", fechaHasta: "2026-08-12" },
    ]) {
      await assert.rejects(() => contab.buscarComprobantes(rango, sesionDePrueba(linea)), undefined, JSON.stringify(rango));
    }
    assert.equal(f.estado.requests.filter(esSearch).length, 0);
  } finally {
    f.restaurar();
  }
});

test("CA-1: el dia que se consulta es el de Argentina: a las 22:30 ART del 12/08 (01:30Z del 13/08) es 2026-08-12, no 2026-08-13", () => {
  assert.equal(clasif.diaArgentina(new Date("2026-08-13T01:30:00.000Z")), "2026-08-12");
  assert.notEqual(clasif.diaArgentina(new Date("2026-08-13T01:30:00.000Z")), new Date("2026-08-13T01:30:00.000Z").toISOString().slice(0, 10));
});

// -----------------------------------------------------------------------------
// fetchComprobantesDetalle
// -----------------------------------------------------------------------------

function rutearDetalles(porId) {
  return (req) => {
    if (esToken(req)) return respuesta(200, { access_token: "tok" });
    if (esDetalle(req)) {
      const id = Number(req.url.searchParams.get("id"));
      const r = porId(id, req);
      if (r) return r;
      return respuesta(200, { ...comprobanteReal(), Id: id });
    }
    throw new Error(`request inesperado: ${req.url}`);
  };
}

function pausasEntreDetalles(linea) {
  // Para cada par de requests de detalle CONSECUTIVOS, la mayor pausa dormida entre ellos.
  const pausas = [];
  let ultimo = -1;
  let maxDesdeUltimo = 0;
  for (const ev of linea) {
    if (ev.tipo === "dormir") maxDesdeUltimo = Math.max(maxDesdeUltimo, ev.ms);
    if (ev.tipo === "fetch" && esDetalle(ev.req)) {
      if (ultimo !== -1) pausas.push(maxDesdeUltimo);
      ultimo = Number(ev.req.url.searchParams.get("id"));
      maxDesdeUltimo = 0;
    }
  }
  return pausas;
}

test("CA-1: fetchComprobantesDetalle pide GET /api/comprobantes/?id= de a uno, en orden, nunca en paralelo, con >= 1500 ms entre pedidos", async () => {
  const linea = [];
  const f = instalarFetch(rutearDetalles(() => null), linea);
  try {
    const res = await contab.fetchComprobantesDetalle([10, 20, 30, 40], sesionDePrueba(linea));
    const detalles = f.estado.requests.filter(esDetalle);
    assert.deepEqual(detalles.map((r) => r.url.searchParams.get("id")), ["10", "20", "30", "40"]);
    assert.equal(f.estado.maxEnVuelo, 1, "nunca dos requests a la vez (cupo de 25/10 s compartido con iey-ai)");
    const pausas = pausasEntreDetalles(linea);
    assert.equal(pausas.length, 3);
    for (const p of pausas) assert.ok(p >= 1500, `pausa de ${p} ms entre detalles: tiene que ser >= 1500`);
    assert.deepEqual(res.map((r) => [r.id, r.ok]), [[10, true], [20, true], [30, true], [40, true]]);
    assert.equal(res[2].detalle.Id, 30);
    for (const r of detalles) assert.equal(r.auth, "Bearer tok");
  } finally {
    f.restaurar();
  }
});

test("CA-1: el ritmo es configurable, pero nunca menor a 1500 ms (pedir 100 da 1500; pedir 2500 da 2500)", async () => {
  for (const [pedido, minimo] of [[100, 1500], [2500, 2500]]) {
    const linea = [];
    const f = instalarFetch(rutearDetalles(() => null), linea);
    try {
      await contab.fetchComprobantesDetalle([1, 2, 3], sesionDePrueba(linea, { ritmoComprobantesMs: pedido }));
      const pausas = pausasEntreDetalles(linea);
      assert.equal(pausas.length, 2);
      for (const p of pausas) assert.ok(p >= minimo, `ritmo pedido ${pedido}: pausa ${p} < ${minimo}`);
    } finally {
      f.restaurar();
    }
  }
  assert.equal(contab.RITMO_MINIMO_COMPROBANTES_MS, 1500);
});

test("CA-1 / R-4: un id que da 404 no corta el lote: los demas se piden igual y vuelven ok", async () => {
  const linea = [];
  const f = instalarFetch(rutearDetalles((id) => (id === 20 ? respuesta(404, { error: "no existe" }) : null)), linea);
  try {
    const res = await contab.fetchComprobantesDetalle([10, 20, 30], sesionDePrueba(linea));
    assert.deepEqual(f.estado.requests.filter(esDetalle).map((r) => r.url.searchParams.get("id")), ["10", "20", "30"]);
    assert.equal(res.length, 3);
    assert.deepEqual(res.map((r) => r.id), [10, 20, 30]);
    assert.equal(res[0].ok, true);
    assert.equal(res[1].ok, false);
    assert.equal(res[1].definitivo, true, "404 no es transitorio");
    assert.match(String(res[1].error), /404/);
    assert.equal(res[2].ok, true);
  } finally {
    f.restaurar();
  }
});

test("CA-1: un 503 transitorio en un id se reintenta y termina ok (mismo conReintentos que el stock)", async () => {
  const linea = [];
  let vecesId20 = 0;
  const f = instalarFetch(
    rutearDetalles((id) => {
      if (id !== 20) return null;
      vecesId20++;
      return vecesId20 === 1 ? respuesta(503, { error: "ocupado" }) : null;
    }),
    linea
  );
  try {
    const res = await contab.fetchComprobantesDetalle([10, 20], sesionDePrueba(linea));
    assert.equal(vecesId20, 2);
    assert.deepEqual(res.map((r) => r.ok), [true, true]);
  } finally {
    f.restaurar();
  }
});

// -----------------------------------------------------------------------------
// Ronda 3 (CA-1 ampliado): cuando el cliente REAL marca `definitivo`.
//
// `definitivo: true` lleva un id a `ilegible` al tercer error (R-4): si el
// cliente marca definitivo un error transitorio, un comprobante legitimo deja de
// pedirse para siempre (su credito se pierde: subventa permanente de ese SKU);
// si nunca marca definitivo un 400 o un 200 basura, el caso real 173386407 deja
// la corrida en rojo para siempre. Tabla en DISENO-INTERFAZ.md seccion 1.
// -----------------------------------------------------------------------------

const pedidosDe = (f, id) => f.estado.requests.filter((r) => esDetalle(r) && r.url.searchParams.get("id") === String(id)).length;

test("CA-1 (ronda 3): un 400 es definitivo, no se reintenta y no corta el lote", async () => {
  const linea = [];
  const f = instalarFetch(rutearDetalles((id) => (id === 20 ? respuesta(400, { error: "Bad Request" }) : null)), linea);
  try {
    const res = await contab.fetchComprobantesDetalle([10, 20, 30], sesionDePrueba(linea));
    assert.deepEqual(res.map((r) => [r.id, r.ok]), [[10, true], [20, false], [30, true]]);
    assert.equal(res[1].definitivo, true, "400 no es transitorio: definitivo");
    assert.equal(pedidosDe(f, 20), 1, "un 400 no se reintenta");
  } finally {
    f.restaurar();
  }
});

test("CA-1 (ronda 3): un 200 que no es un comprobante interpretable (cuerpo vacio, null, sin Id, Items mal formado) es definitivo y NUNCA ok:true", async () => {
  const linea = [];
  const vacio = {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    },
    text: async () => "",
  };
  const sinId = comprobanteReal();
  delete sinId.Id;
  const casos = new Map([
    [21, vacio], // cuerpo vacio
    [22, respuesta(200, null)], // JSON valido pero no es un objeto
    [23, respuesta(200, sinId)], // sin Id
    [24, respuesta(200, { ...comprobanteReal(), Id: 24, Items: "IEY-C09-GRIS x1" })], // Items no es arreglo
    [173386407, respuesta(200, { ...comprobanteReal(), Id: 173386407, Items: null })], // id del caso real, Items nulo
  ]);
  const f = instalarFetch(rutearDetalles((id) => casos.get(id) ?? null), linea);
  try {
    const ids = [10, ...casos.keys()];
    const res = await contab.fetchComprobantesDetalle(ids, sesionDePrueba(linea));
    assert.equal(res.length, ids.length);
    assert.equal(res[0].ok, true, "control: el 10 es un comprobante interpretable");
    for (const r of res.slice(1)) {
      assert.notEqual(r.ok, true, `id ${r.id}: un 200 basura no puede volver ok:true (se registraria como comprobante sin lineas)`);
      assert.equal(r.ok, false, `id ${r.id}`);
      assert.equal(r.definitivo, true, `id ${r.id}: un detalle que no es un comprobante es definitivo`);
    }
  } finally {
    f.restaurar();
  }
});

test("CA-1 (ronda 3): 503 sostenido con los 4 intentos agotados NO es definitivo", async () => {
  const linea = [];
  const f = instalarFetch(rutearDetalles((id) => (id === 20 ? respuesta(503, { error: "ocupado" }) : null)), linea);
  try {
    const res = await contab.fetchComprobantesDetalle([10, 20, 30], sesionDePrueba(linea));
    assert.equal(pedidosDe(f, 20), contab.MAX_INTENTOS, "precondicion: se agotaron los reintentos");
    assert.equal(res[1].ok, false);
    assert.equal(res[1].definitivo, false, "un 5xx es transitorio aunque se agoten los reintentos");
    assert.equal(res[2].ok, true, "el lote sigue");
  } finally {
    f.restaurar();
  }
});

test("CA-1 (ronda 3): 429 sostenido con los 4 intentos agotados (Retry-After 1 s, dentro del presupuesto) NO es definitivo", async () => {
  const linea = [];
  const f = instalarFetch(rutearDetalles((id) => (id === 20 ? respuesta(429, { error: "Too Many Requests" }, { "Retry-After": "1" }) : null)), linea);
  try {
    const res = await contab.fetchComprobantesDetalle([10, 20], sesionDePrueba(linea));
    assert.equal(pedidosDe(f, 20), contab.MAX_INTENTOS, "precondicion: se agotaron los reintentos, no el presupuesto");
    assert.equal(res[1].ok, false);
    assert.equal(res[1].definitivo, false, "un 429 es transitorio aunque se agoten los reintentos");
  } finally {
    f.restaurar();
  }
});

test("CA-1 (ronda 3): con el presupuesto de espera agotado, el id cortado y los que no se llegaron a pedir NO son definitivos", async () => {
  const linea = [];
  // Retry-After 200 s: el 1er reintento acumula 200 s; el 2do (400 s) excede los 300 s.
  const f = instalarFetch(rutearDetalles((id) => (id === 10 ? respuesta(429, { error: "Too Many Requests" }, { "Retry-After": "200" }) : null)), linea);
  try {
    let res = null;
    try {
      res = await contab.fetchComprobantesDetalle([10, 20], sesionDePrueba(linea));
    } catch {
      res = null; // rechazar entera tambien vale (DISENO seccion 1): ejecutarPar deja todo pendiente
    }
    assert.ok(pedidosDe(f, 10) >= 1 && pedidosDe(f, 10) < contab.MAX_INTENTOS, `precondicion: corto por presupuesto (${pedidosDe(f, 10)} pedidos del 10)`);
    assert.equal(pedidosDe(f, 20), 0, "con el presupuesto agotado no se pide el 20");
    if (res) {
      assert.equal(res.length, 2);
      for (const r of res) {
        assert.equal(r.ok, false, `id ${r.id}`);
        assert.equal(r.definitivo, false, `id ${r.id}: presupuesto agotado es transitorio (si no, al 3er corte el id queda ilegible)`);
      }
    }
  } finally {
    f.restaurar();
  }
});

// Ronda 4 (nota de revisor-alcance): el contrato marca `definitivo` SOLO ante 400,
// 404 o un 200 no interpretable. 401, 403 y 422 no son culpa del comprobante (token,
// permisos, validacion del lado de Contabilium): marcarlos definitivos llevaria un
// comprobante legitimo a `ilegible` al tercer error y su credito se perderia.
test("CA-1 (ronda 4): 401, 403 y 422 NO son definitivos (un problema de token o de permisos no es culpa del comprobante)", async () => {
  for (const status of [401, 403, 422]) {
    const linea = [];
    const f = instalarFetch(rutearDetalles((id) => (id === 20 ? respuesta(status, { error: `HTTP ${status}` }) : null)), linea);
    try {
      // Un id que falla no rechaza la promesa (DISENO seccion 1): sin try/catch.
      const res = await contab.fetchComprobantesDetalle([10, 20, 30], sesionDePrueba(linea));
      assert.ok(pedidosDe(f, 20) >= 1, `precondicion ${status}: se pidio el 20`);
      assert.equal(res.length, 3, `${status}: un resultado por id`);
      const r20 = res.find((r) => r.id === 20);
      assert.equal(r20?.ok, false, `${status}: el 20 no es ok`);
      assert.equal(r20.definitivo, false, `${status} no es definitivo: solo 400, 404 o un 200 no interpretable lo son`);
      for (const r of res) if (!r.ok) assert.equal(r.definitivo, false, `${status}: ningun id queda definitivo por un ${status}`);
    } finally {
      f.restaurar();
    }
  }
});

// -----------------------------------------------------------------------------
// DEPS_REALES
// -----------------------------------------------------------------------------

test("CA-1: DEPS_REALES no tiene fetchComprobanteById y cablea el cliente nuevo, la sesion, el reloj y el registro", () => {
  const deps = sync.DEPS_REALES;
  assert.ok(deps, "src/sync.js tiene que exportar DEPS_REALES");
  assert.equal("fetchComprobanteById" in deps, false, "fetchComprobanteById no es una dependencia de la corrida (hallazgo 10)");
  assert.equal(deps.buscarComprobantes, contab.buscarComprobantes);
  assert.equal(deps.fetchComprobantesDetalle, contab.fetchComprobantesDetalle);
  assert.equal(deps.getStockDeposito, contab.getStockDeposito);
  assert.equal(typeof deps.crearSesion, "function");
  assert.equal(typeof deps.ahora, "function");
  assert.ok(deps.ahora() instanceof Date);
  assert.equal(deps.rutaRegistroComprobantes, sync.rutaRegistroComprobantes);
  assert.equal(deps.cargarRegistroComprobantes, sync.cargarRegistroComprobantes);
  assert.equal(deps.guardarRegistroComprobantes, sync.guardarRegistroComprobantes);
  assert.match(sync.rutaRegistroComprobantes().replace(/\\/g, "/"), /\/\.cache\/comprobantes\.json$/);
  assert.equal(sync.rutaRegistroComprobantes("/tmp/x").replace(/\\/g, "/"), "/tmp/x/comprobantes.json");
});
