// _helpers-clasificador.js
// -----------------------------------------------------------------------------
// Helpers compartidos por los tests de `clasificador-causa-comprobante`, diseño B
// (registro persistente de comprobantes, aprobado el 02/11/2026). NO termina en
// `.test.js` a proposito: `node --test test/*.test.js` no lo corre como suite.
//
// Interfaz asumida: aceptacion/clasificador-causa-comprobante/DISENO-INTERFAZ.md.
//
// Los simbolos NUEVOS de src/ se usan via import de namespace (`* as sync`), no
// con import nombrado: si todavia no existen, cada test falla por su cuenta con
// un TypeError claro, en vez de que el archivo entero no cargue (y arrastre los
// tests que no dependen de ellos).
// -----------------------------------------------------------------------------

import fs, { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as sync from "../src/sync.js";

// Raiz del repo (test/..). La usa la guardia de escrituras de abajo.
export const RAIZ_REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));

// true si `ruta` (string, URL o Buffer) cae dentro de `raiz` (o es `raiz`).
export function rutaDentroDe(raiz, ruta) {
  if (!(typeof ruta === "string" || ruta instanceof URL || Buffer.isBuffer(ruta))) return false;
  let abs;
  try {
    abs = resolve(ruta instanceof URL ? fileURLToPath(ruta) : String(ruta));
  } catch {
    return false;
  }
  const rel = relative(resolve(raiz), abs);
  return rel === "" || (rel.split(sep)[0] !== ".." && !isAbsolute(rel));
}

// Directorio temporal ASINCRONO: el `finally` espera a que el callback termine.
// (El helper viejo devolvia la promesa sin esperarla y borraba el directorio en
// cuanto ejecutarPar hacia su primer `await`.)
export async function conDirTemporal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "clasificador-b-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- constantes
export const DEPOSITO_DOT = "127356";
export const LOCATION_DOT = "gid://shopify/Location/83342655574";
export const DEPOSITO_ISLA = "999001";
export const LOCATION_ISLA = "gid://shopify/Location/99988877766";
export const DEPOSITO_CENTRAL = "96667";
export const DEPOSITO_FULL_ML = "97094";

export const PAR_DOT = { nombre: "dot", stateKey: "dot", depositoId: DEPOSITO_DOT, locationId: LOCATION_DOT, pendiente: false };
export const PAR_ISLA = {
  nombre: "galerias-pacifico",
  stateKey: "galerias-pacifico",
  depositoId: DEPOSITO_ISLA,
  locationId: LOCATION_ISLA,
  pendiente: false,
};

// Dato REAL, verificado por la persona en su Postman el 02/11/2026
// (GET /api/comprobantes/?id=177960828). Censo de agosto, orden Shopify #4586,
// facturada a mano contra el DOT. Las fechas vienen SIN zona horaria.
export const COMPROBANTE_REAL_177960828 = Object.freeze({
  Id: 177960828,
  FechaAlta: "2026-08-12T19:14:11.633",
  FechaEmision: "2026-08-12T19:14:29.66",
  Numero: "0002-00044596",
  TipoFc: "FCB",
  Inventario: 127356,
  Items: [
    {
      Id: 350018769,
      IdConcepto: 19592558,
      Cantidad: 1,
      Concepto: "MagPower - Batería Inalámbrica Pro 10000mAh - Gris Azulado / No Incluido",
      Codigo: "IEY-C09-GRIS",
      Tipo: "P",
    },
  ],
  Observaciones: "Numero de Orden: #4586",
  IDIntegracion: 25020,
  Origen: "Shopify",
  IDVentaIntegracion: "4586",
});
// 2026-08-12T19:14:29.66 hora de Argentina (UTC-3) = 22:14:29.660Z.
export const REFERENCIA_REAL_177960828 = "2026-08-12T22:14:29.660Z";
export const SKU_CENSO = "IEY-C09-GRIS";

// Copia profunda del comprobante real (los tests no pueden mutar el fixture).
export function comprobanteReal() {
  return JSON.parse(JSON.stringify(COMPROBANTE_REAL_177960828));
}

// Hora de Argentina SIN zona, como la manda Contabilium, a partir de un instante
// UTC. "2026-08-12T22:14:29.660Z" -> "2026-08-12T19:14:29.660".
export function textoArgentina(isoUtc) {
  const ms = new Date(isoUtc).getTime() - 3 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 23);
}

// Fabrica el DETALLE de un comprobante (lo que devuelve GET /api/comprobantes/?id=).
//   items: [[codigo, cantidad], ...]
//   referenciaUtc: instante UTC de FechaEmision (FechaAlta 10 s antes, salvo que se pase).
export function comprobanteDetalle({
  id,
  tipoFc = "FCB",
  inventario = Number(DEPOSITO_DOT),
  origen = "Shopify",
  idIntegracion = 25020,
  referenciaUtc,
  fechaAltaUtc = null,
  items = [],
}) {
  const emision = textoArgentina(referenciaUtc);
  const alta = textoArgentina(fechaAltaUtc ?? new Date(new Date(referenciaUtc).getTime() - 10_000).toISOString());
  return {
    Id: id,
    FechaAlta: alta,
    FechaEmision: emision,
    TipoFc: tipoFc,
    Inventario: inventario,
    Items: items.map(([Codigo, Cantidad], i) => ({ Id: id * 10 + i, Codigo, Cantidad, Tipo: "P" })),
    IDIntegracion: idIntegracion,
    Origen: origen,
  };
}

// Resumen de /search (lo que trae cada item de buscarComprobantes).
export function resumenSearch(id, tipoFc = "FCB") {
  return { Id: id, TipoFc: tipoFc };
}

// ------------------------------------------------------------- reloj fijable
export function reloj(isoInicial) {
  const r = {
    ms: new Date(isoInicial).getTime(),
    fijar(iso) {
      r.ms = new Date(iso).getTime();
    },
    avanzar(ms) {
      r.ms += ms;
    },
    ahora() {
      return new Date(r.ms);
    },
  };
  return r;
}

export const MIN = 60_000;
export const HORA = 60 * MIN;
export const DIA = 24 * HORA;

// ------------------------------------------------------------ disco: rutas
// Rutas FIJADAS por DISENO-INTERFAZ.md (secciones 3 y 4). Los tests siembran y
// leen los archivos crudos por estas rutas, sin pasar por el codigo bajo prueba.
export function rutaRegistro(dir) {
  return join(dir, "comprobantes.json");
}
export function rutaLibreta(dir, stateKey = "dot") {
  return join(dir, `last-sync.${stateKey}.json`);
}

export function sembrarLibreta(dir, stateKey, { skus = {}, contabilium = null, corte = null, consumos = null, extra = {} }) {
  const crudo = { __v: 2, skus, ...extra };
  if (contabilium) crudo.contabilium = contabilium;
  if (corte) crudo.corte = corte;
  if (consumos) crudo.consumos = consumos;
  mkdirSync(dir, { recursive: true });
  writeFileSync(rutaLibreta(dir, stateKey), JSON.stringify(crudo, null, 2), "utf-8");
}

export function leerLibretaCruda(dir, stateKey = "dot") {
  const ruta = rutaLibreta(dir, stateKey);
  if (!existsSync(ruta)) return null;
  return JSON.parse(readFileSync(ruta, "utf-8"));
}

// Entrada del registro en el formato de DISENO-INTERFAZ.md seccion 3.
export function entradaShopify({ id, sku, cantidad = 1, referencia, inventario = DEPOSITO_DOT, tipoFc = "FCB", dia = null }) {
  return {
    id,
    dia: dia ?? diaArtDeIso(referencia),
    tipoFc,
    estado: "ok",
    intentos: 0,
    vistoEn: referencia,
    inventario: String(inventario),
    notaCreditoShopify: false,
    lineas: [{ comprobanteId: id, sku, cantidad, referencia }],
  };
}

export function entradaSinLineas({ id, dia, tipoFc = "FCB", estado = "ok", intentos = 0 }) {
  return { id, dia, tipoFc, estado, intentos, vistoEn: `${dia}T15:00:00.000Z`, inventario: null, notaCreditoShopify: false, lineas: [] };
}

export function sembrarRegistro(dir, { ultimoRefrescoOk = null, diasCerrados = [], comprobantes = [] } = {}) {
  const crudo = { v: 1, ultimoRefrescoOk, diasCerrados, comprobantes: {} };
  for (const c of comprobantes) crudo.comprobantes[String(c.id)] = c;
  mkdirSync(dir, { recursive: true });
  writeFileSync(rutaRegistro(dir), JSON.stringify(crudo, null, 2), "utf-8");
}

export function leerRegistroCrudo(dir) {
  const ruta = rutaRegistro(dir);
  if (!existsSync(ruta)) return null;
  return JSON.parse(readFileSync(ruta, "utf-8"));
}

// Dia ART de un ISO, calculado a mano en el test (independiente del codigo bajo prueba).
export function diaArtDeIso(iso) {
  return new Date(new Date(iso).getTime() - 3 * HORA).toISOString().slice(0, 10);
}

// ------------------------------------------------------------- llamadas/spies
export function llamadasVacias() {
  return {
    crearSesion: 0,
    sesiones: [], // cada sesion recibida por getStockDeposito/buscar/detalle, en orden
    getStockDeposito: [],
    resolverSku: [],
    setearStock: [],
    guardarSnapshot: [],
    guardarRegistro: [],
    // Una entrada por INVOCACION de buscarComprobantes: { fechaDesde, fechaHasta, args }.
    buscarComprobantes: [],
    // Contadores SEPARADOS (hallazgo del juez): invocaciones de la FUNCION
    // fetchComprobantesDetalle (cada una con la lista de ids que recibio) y,
    // aparte, cada id individual pedido.
    fetchComprobantesDetalle: [],
    idsDetalle: [],
  };
}

function clon(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x, (k, v) => (v instanceof Map ? Object.fromEntries(v) : v)));
}

// ----------------------------------------------------------------- deps fake
// stock:   Map(depositoId -> Map(sku -> cantidad)). Se puede mutar entre corridas.
// shopify: Map(locationId -> Map(sku -> available)). setearStock lo actualiza.
// search:  array de resumenes, o fn({fechaDesde, fechaHasta}, n) -> array.
// detalles: Map(id -> detalle).
// idsQueFallan: Set de ids cuyo detalle vuelve { ok:false } (mutable).
// fallaBusqueda: bool o fn(n) -> bool.  fallaDetalleEntero: bool (rechaza la llamada entera).
// skusConError: Set de skus cuyo resolverSku lanza (mutable).
// alLeerStock: fn() que corre dentro de getStockDeposito (para mover el reloj).
// guardarSnapshotEnvoltorio: fn(real) -> fn, para inyectar fallas de IO en checkpoints.
// guardarRegistroEnvoltorio: fn(real) -> fn, idem para guardarRegistroComprobantes (ronda 4).
// encierro: objeto de encierroVacio() (ronda 4). Si se pasa, TODA dependencia que lee
//   o escribe disco (rutaSnapshotPara, cargarLibretaCompleta, guardarSnapshot,
//   migrarLibretaLegada, cargar/guardarRegistroComprobantes) anota la ruta y LANZA
//   ANTES de tocar el disco si la ruta no esta dentro de `dir` (o si no es una ruta:
//   un guardarSnapshot sin ruta caeria en el SNAPSHOT_PATH real del repo).
export function encierroVacio() {
  return { violaciones: [], rutaSnapshotPara: [], cargarLibretaCompleta: [], guardarSnapshot: [], migrarLibretaLegada: [], registro: [] };
}

function encerrar(encierro, dir, nombre, ruta) {
  if (!encierro) return;
  if (!rutaDentroDe(dir, ruta)) {
    const msj = `${nombre} con una ruta fuera del directorio temporal del test: ${String(ruta)}`;
    encierro.violaciones.push(msj);
    throw new Error(`encierro: ${msj}`);
  }
}

export function depsFake({
  dir,
  reloj: r,
  stock,
  shopify,
  search = [],
  detalles = new Map(),
  idsQueFallan = new Set(),
  fallaBusqueda = false,
  fallaDetalleEntero = false,
  skusConError = new Set(),
  dryRun = false,
  llamadas = llamadasVacias(),
  alLeerStock = null,
  guardarSnapshotEnvoltorio = null,
  guardarRegistroEnvoltorio = null,
  encierro = null,
}) {
  const guardarReal = (...args) => {
    llamadas.guardarSnapshot.push({ ruta: args[1], snap: { ...args[0] }, contabilidad: clon(args[3] ?? null) });
    return sync.guardarSnapshot(...args);
  };
  const guardarConEnvoltorio = guardarSnapshotEnvoltorio ? guardarSnapshotEnvoltorio(guardarReal) : guardarReal;
  const guardarRegistroReal = (registro, ruta) => {
    llamadas.guardarRegistro.push({ ruta, registro: clon(registro) });
    return sync.guardarRegistroComprobantes(registro, ruta);
  };
  const guardarRegistroConEnvoltorio = guardarRegistroEnvoltorio ? guardarRegistroEnvoltorio(guardarRegistroReal) : guardarRegistroReal;
  return {
    SNAPSHOT_PATH: join(dir, "last-sync.json"),
    migrarLibretaLegada: (a, b) => {
      if (encierro) {
        encierro.migrarLibretaLegada.push([a, b]);
        for (const x of [a, b]) if (x !== undefined) encerrar(encierro, dir, "migrarLibretaLegada", x);
      }
      return sync.migrarLibretaLegada(a, b);
    },
    cargarLibretaCompleta: (ruta) => {
      if (encierro) encierro.cargarLibretaCompleta.push(ruta);
      encerrar(encierro, dir, "cargarLibretaCompleta", ruta);
      return sync.cargarLibretaCompleta(ruta);
    },
    guardarSnapshot: (...args) => {
      if (encierro) encierro.guardarSnapshot.push(args[1]);
      encerrar(encierro, dir, "guardarSnapshot", args[1]); // lanza ANTES de escribir
      return guardarConEnvoltorio(...args);
    },
    rutaSnapshotPara: (stateKey) => {
      const ruta = sync.rutaSnapshotPara(stateKey, dir);
      if (encierro) encierro.rutaSnapshotPara.push({ stateKey, ruta });
      return ruta;
    },
    esDryRun: () => dryRun,
    ahora: () => r.ahora(),

    rutaRegistroComprobantes: () => sync.rutaRegistroComprobantes(dir),
    cargarRegistroComprobantes: (ruta, ...resto) => {
      if (encierro) encierro.registro.push(ruta);
      encerrar(encierro, dir, "cargarRegistroComprobantes", ruta);
      return sync.cargarRegistroComprobantes(ruta, ...resto);
    },
    guardarRegistroComprobantes: (registro, ruta) => {
      if (encierro) encierro.registro.push(ruta);
      encerrar(encierro, dir, "guardarRegistroComprobantes", ruta);
      return guardarRegistroConEnvoltorio(registro, ruta);
    },

    crearSesion: () => {
      llamadas.crearSesion++;
      return { sesionFalsa: llamadas.crearSesion };
    },

    getStockDeposito: async (depositoId, sesion) => {
      llamadas.getStockDeposito.push({ depositoId, enMs: r.ms });
      llamadas.sesiones.push(sesion);
      if (alLeerStock) alLeerStock(depositoId);
      return new Map(stock.get(depositoId) ?? new Map());
    },

    resolverSku: async (sku, locationId) => {
      llamadas.resolverSku.push({ sku, locationId });
      if (skusConError.has(sku)) throw new Error(`Shopify caido para ${sku} (simulado)`);
      const porSku = shopify.get(locationId);
      if (!porSku || !porSku.has(sku)) return null;
      return { inventoryItemId: `inv|${locationId}|${sku}`, available: porSku.get(sku) };
    },

    setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      const sku = String(inventoryItemId).split("|")[2];
      llamadas.setearStock.push({ sku, quantity, changeFromQuantity, locationId });
      shopify.get(locationId)?.set(sku, quantity);
    },

    buscarComprobantes: async (...args) => {
      const n = llamadas.buscarComprobantes.length + 1;
      const rango = args[0] ?? {};
      llamadas.buscarComprobantes.push({ fechaDesde: rango.fechaDesde, fechaHasta: rango.fechaHasta, args });
      llamadas.sesiones.push(args[1]);
      const falla = typeof fallaBusqueda === "function" ? fallaBusqueda(n) : fallaBusqueda;
      if (falla) throw new Error("Contabilium comprobantes/search fallo (HTTP 503): fallo simulado de busqueda");
      return typeof search === "function" ? search(rango, n) : search.map((x) => ({ ...x }));
    },

    fetchComprobantesDetalle: async (ids, sesion) => {
      llamadas.fetchComprobantesDetalle.push([...ids]);
      llamadas.sesiones.push(sesion);
      llamadas.idsDetalle.push(...ids);
      if (fallaDetalleEntero) throw new Error("Contabilium comprobantes/?id fallo (red): fallo simulado del lote");
      return ids.map((id) => {
        if (idsQueFallan.has(id)) return { id, ok: false, error: `HTTP 503 simulado para ${id}`, definitivo: false };
        const d = detalles.get(id);
        if (!d) return { id, ok: false, error: `HTTP 404 simulado para ${id}`, definitivo: true };
        return { id, ok: true, detalle: JSON.parse(JSON.stringify(d)) };
      });
    },
  };
}

// Escrituras a Shopify de un SKU (en orden).
export function escriturasDe(llamadas, sku, locationId = LOCATION_DOT) {
  return llamadas.setearStock.filter((s) => s.sku === sku && s.locationId === locationId).map((s) => s.quantity);
}

// Ids pedidos en detalle desde la posicion `desde` del contador de ids.
export function idsPedidosDesde(llamadas, desde) {
  return llamadas.idsDetalle.slice(desde);
}

// ------------------------------------------------- guardia de escrituras (ronda 4)
// Red de seguridad por debajo de `deps`: mientras dure el test `t`, CUALQUIER
// escritura del proceso (fs sincronico, con callback o con promesas) sobre una
// ruta dentro de `raiz` (por defecto, la raiz del repo, que incluye el .cache/
// real) LANZA antes de tocar el disco y queda anotada. Cubre al codigo que
// importo `writeFileSync`, `mkdirSync`, `renameSync`, etc. con import nombrado:
// `syncBuiltinESMExports()` actualiza esas ligaduras vivas de los modulos ESM
// de node:fs y node:fs/promises. Las lecturas no se bloquean. Los directorios
// temporales (os.tmpdir()) quedan fuera de `raiz` y se escriben normalmente.
// Devuelve el arreglo de violaciones (el test lo assierta vacio).
export function guardiaDeEscriturasEnRepo(t, raiz = RAIZ_REPO) {
  const violaciones = [];
  const restaurar = [];
  const abreParaEscribir = (flags) => {
    if (flags === undefined || flags === null) return false;
    if (typeof flags === "string") return /[wa+]/.test(flags);
    if (typeof flags === "number") {
      const c = fs.constants;
      return (flags & (c.O_WRONLY | c.O_RDWR | c.O_APPEND | c.O_CREAT | c.O_TRUNC)) !== 0;
    }
    return true;
  };
  const parchear = (obj, nombre, indices, { promesa = false, cuando = () => true } = {}) => {
    const orig = obj?.[nombre];
    if (typeof orig !== "function") return;
    obj[nombre] = function (...args) {
      if (cuando(args)) {
        for (const i of indices) {
          const p = Buffer.isBuffer(args[i]) ? args[i].toString() : args[i];
          if (rutaDentroDe(raiz, p)) {
            const msj = `${nombre}(${String(p)})`;
            violaciones.push(msj);
            const err = new Error(`guardia: escritura en el repo prohibida en este test: ${msj}`);
            if (promesa) return Promise.reject(err);
            throw err;
          }
        }
      }
      return orig.apply(this, args);
    };
    restaurar.push(() => {
      obj[nombre] = orig;
    });
  };
  const unaRuta = ["writeFile", "appendFile", "mkdir", "rm", "rmdir", "unlink", "truncate", "mkdtemp", "utimes", "chmod"];
  const destino = ["copyFile", "cp", "symlink", "link"];
  for (const n of unaRuta) {
    parchear(fs, `${n}Sync`, [0]);
    parchear(fs, n, [0]);
    parchear(fsp, n, [0], { promesa: true });
  }
  for (const n of destino) {
    parchear(fs, `${n}Sync`, [1]);
    parchear(fs, n, [1]);
    parchear(fsp, n, [1], { promesa: true });
  }
  parchear(fs, "renameSync", [0, 1]);
  parchear(fs, "rename", [0, 1]);
  parchear(fsp, "rename", [0, 1], { promesa: true });
  parchear(fs, "openSync", [0], { cuando: (a) => abreParaEscribir(a[1]) });
  parchear(fs, "open", [0], { cuando: (a) => abreParaEscribir(typeof a[1] === "function" ? undefined : a[1]) });
  parchear(fsp, "open", [0], { promesa: true, cuando: (a) => abreParaEscribir(a[1]) });
  parchear(fs, "createWriteStream", [0]);
  syncBuiltinESMExports();
  t.after(() => {
    for (const r of restaurar.reverse()) r();
    syncBuiltinESMExports();
  });
  return violaciones;
}

// ----------------------------------------------------------- consola
// Ronda 4: ademas de log/warn/error, se capturan info, debug, trace y dir (en
// node son funciones distintas: reemplazar console.log NO reemplaza console.info)
// y los fragmentos de TEXTO escritos directo en process.stdout/stderr (canal
// "stdout"/"stderr", sin el salto de linea final). Los fragmentos de stdout se
// reenvian igual (no se tragan): el runner de node --test puede usar ese canal.
export async function capturarConsola(fn) {
  const lineas = [];
  const canales = ["log", "warn", "error", "info", "debug", "trace", "dir"];
  const orig = Object.fromEntries(canales.map((c) => [c, console[c]]));
  const anotar = (canal) => (...a) => lineas.push({ canal, texto: a.map(String).join(" ") });
  for (const c of canales) console[c] = anotar(c);
  const flujos = [
    ["stdout", process.stdout],
    ["stderr", process.stderr],
  ];
  const writeOrig = flujos.map(([, s]) => s.write);
  flujos.forEach(([canal, s], i) => {
    s.write = function (chunk, ...resto) {
      if (typeof chunk === "string") {
        for (const linea of chunk.replace(/\n$/, "").split("\n")) lineas.push({ canal, texto: linea });
      }
      return writeOrig[i].call(this, chunk, ...resto);
    };
  });
  try {
    const valor = await fn();
    return { valor, lineas };
  } catch (err) {
    err.lineasDeConsola = lineas;
    throw err;
  } finally {
    for (const c of canales) console[c] = orig[c];
    flujos.forEach(([, s], i) => {
      s.write = writeOrig[i];
    });
  }
}

// La linea de resumen impresa de un par (DISENO-INTERFAZ.md seccion 6).
export function lineaResumen(lineas, nombrePar) {
  const encontradas = lineas.filter((l) => l.texto.includes(`[RESUMEN] ${nombrePar}:`));
  return encontradas;
}

export function valorEnResumen(texto, clave) {
  const m = texto.match(new RegExp(`(?:^|\\s)${clave}=(\\S+)`));
  return m ? m[1] : undefined;
}

export const CLAVES_NUEVAS_RESUMEN = [
  "clasificador",
  "causa_venta_shopify",
  "causa_desconocida",
  "creditos_pendientes",
  "creditos_pre_corte",
  "creditos_vencidos",
  "notas_credito_shopify",
  "comprobantes_pedidos",
  "comprobantes_pendientes",
  "comprobantes_ilegibles",
];

export { dirname };
