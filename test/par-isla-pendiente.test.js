// R-9 / CA-10 — El par de Galerias Pacifico se declara con valores de prueba
// mientras el gid/depositoId reales no estan confirmados, corre en modo
// seguro (sin escribir en una location real) y lo reporta explicitamente, sin
// fallar en silencio ni requerir valores reales para compilar/testear.
//
// INTERFAZ ASUMIDA (ver DISENO-INTERFAZ.md secciones 1, 3, 3.1, 6 y 7):
//   construirPares(env) marca `pendiente: true` cuando falta el depositoId o
//     el locationId de un par, o cuando valen el sentinel "PENDIENTE".
//   evaluarCorridaMultiPar(porPar) en src/resultado.js agrega el veredicto de
//     varios pares, sin exigir que un par pendiente haya sincronizado nada,
//     pero sin dejar pasar una corrida donde NINGUN par activo hizo algo.
//   ejecutarPar(par, deps) en src/sync.js orquesta UN par; para un par
//     pendiente, corta ANTES de llamar ninguna dependencia de Shopify.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { construirPares, VALOR_PENDIENTE } from "../src/pares.js";
import { evaluarCorridaMultiPar } from "../src/resultado.js";
import { ejecutarPar } from "../src/sync.js";

const ENV_SIN_DATOS_DE_ISLA = {
  CONTABILIUM_DOT_DEPOSITO_ID: "127356",
  SHOPIFY_DOT_LOCATION_ID: "gid://shopify/Location/83342655574",
  // Sin CONTABILIUM_ISLA_DEPOSITO_ID ni SHOPIFY_ISLA_LOCATION_ID: el estado
  // real hoy (29/10/2026), segun el contrato -- dato pendiente de una
  // consulta de solo lectura en curso.
};

const ENV_CON_PLACEHOLDER = {
  ...ENV_SIN_DATOS_DE_ISLA,
  CONTABILIUM_ISLA_DEPOSITO_ID: VALOR_PENDIENTE,
  SHOPIFY_ISLA_LOCATION_ID: VALOR_PENDIENTE,
};

test("sin los datos reales de la isla, el par queda pendiente -- no falta, no rompe construirPares", () => {
  const pares = construirPares(ENV_SIN_DATOS_DE_ISLA);
  const isla = pares.find((p) => p.nombre === "galerias-pacifico");
  assert.ok(isla, "el par de la isla tiene que poder declararse aunque falten los datos reales");
  assert.equal(isla.pendiente, true);
});

test("declarar el par con el sentinel de valores de prueba tambien lo marca pendiente", () => {
  const pares = construirPares(ENV_CON_PLACEHOLDER);
  const isla = pares.find((p) => p.nombre === "galerias-pacifico");
  assert.equal(isla.depositoId, VALOR_PENDIENTE);
  assert.equal(isla.pendiente, true, "un placeholder de prueba nunca cuenta como dato real");
});

test("el DOT, con sus datos reales, nunca queda pendiente", () => {
  const pares = construirPares(ENV_SIN_DATOS_DE_ISLA);
  const dot = pares.find((p) => p.nombre === "dot");
  assert.equal(dot.pendiente, false);
});

// -----------------------------------------------------------------------------
// El reporte agregado: pendiente se nombra, nunca se esconde ni se festeja
// -----------------------------------------------------------------------------

const resumenOk = (extra) => ({
  actualizado: 1, dry: 0, sin_cambios: 0, no_encontrado: 0, no_activado: 0,
  error: 0, ambiguo: 0, saltado: 0, total: 1, ...extra,
});

test("DOT sincronizado + isla pendiente: la corrida global puede salir en verde", () => {
  const v = evaluarCorridaMultiPar({
    dot: resumenOk(),
    "galerias-pacifico": { pendiente: true, motivo: "gid/depositoId de la isla sin confirmar" },
  });
  assert.equal(v.ok, true);
  assert.equal(v.detalle["galerias-pacifico"].pendiente, true);
  assert.match(v.detalle["galerias-pacifico"].motivo, /sin confirmar/);
});

test("si TODOS los pares quedan pendientes, la corrida no puede salir en verde en silencio", () => {
  // Nunca "no hice nada en ningun lado" == exito (mismo principio de H3).
  const v = evaluarCorridaMultiPar({
    dot: { pendiente: true, motivo: "simulado para el test" },
    "galerias-pacifico": { pendiente: true, motivo: "gid/depositoId de la isla sin confirmar" },
  });
  assert.equal(v.ok, false);
  assert.match(v.motivo, /pendiente/i);
});

test("la isla pendiente jamas se cuenta como 'actualizado' ni 'sin_cambios'", () => {
  const v = evaluarCorridaMultiPar({
    dot: resumenOk(),
    "galerias-pacifico": { pendiente: true, motivo: "sin confirmar" },
  });
  const detalleIsla = v.detalle["galerias-pacifico"];
  assert.ok(!("actualizado" in detalleIsla) || detalleIsla.actualizado !== 1);
  assert.equal(detalleIsla.ok, undefined, "un par pendiente no tiene un 'ok' de exito/fallo propio, tiene pendiente+motivo");
});

// -----------------------------------------------------------------------------
// Hallazgo bloqueante 1 (revisor-alcance, 2026-10-29): el "modo seguro" tiene
// que ser imposible de violar por construccion, no solo por convencion. Un par
// pendiente JAMAS puede llegar a invocar las funciones de bajo nivel de
// Shopify (buscarVariantePorSku/leerStockActual/setearStock, indirectamente
// via resolverSku) con NINGUN locationId, ni siquiera el real del DOT via un
// default que se cuele. Se verifica con un spy que hace fallar el test si
// `ejecutarPar` llega a llamar cualquiera de esas dependencias para un par
// `pendiente: true`.
// -----------------------------------------------------------------------------

function depsQueExplotanSiSeLlaman() {
  const fallar = (nombre) => () => {
    throw new Error(`${nombre} NUNCA deberia llamarse para un par pendiente`);
  };
  return {
    getStockDeposito: fallar("getStockDeposito"),
    resolverSku: fallar("resolverSku"),
    setearStock: fallar("setearStock"),
    cargarLibretaCompleta: fallar("cargarLibretaCompleta"),
    guardarSnapshot: fallar("guardarSnapshot"),
    rutaSnapshotPara: fallar("rutaSnapshotPara"),
  };
}

test("ejecutarPar de un par pendiente no llama NINGUNA dependencia de Shopify/Contabilium/libreta", async () => {
  const pares = construirPares(ENV_CON_PLACEHOLDER);
  const isla = pares.find((p) => p.nombre === "galerias-pacifico");
  assert.equal(isla.pendiente, true);

  const resultado = await ejecutarPar(isla, depsQueExplotanSiSeLlaman());

  assert.equal(resultado.pendiente, true);
  assert.match(resultado.motivo, /galerias-pacifico/i, "el motivo nombra el par, no es un pendiente generico");
});

test("ejecutarPar de un par ACTIVO (DOT) si usa sus dependencias, con su propio locationId", async () => {
  // Control negativo del test anterior: si ejecutarPar nunca llamara a nada,
  // el test de arriba pasaria por una razon equivocada (la funcion rota, no
  // el guardarrail). Esto confirma que el corte temprano es especifico de
  // `pendiente: true`, no un cortocircuito que tambien afecta al DOT.
  const [dot] = construirPares(ENV_SIN_DATOS_DE_ISLA);
  assert.equal(dot.pendiente, false);

  let locationIdUsado = null;
  const deps = {
    getStockDeposito: async () => new Map([["IEY-103-NEGRO", 10]]),
    resolverSku: async (sku, locationId) => {
      locationIdUsado = locationId;
      return { inventoryItemId: "gid://shopify/InventoryItem/1", available: 10 };
    },
    setearStock: async () => {},
    cargarLibretaCompleta: () => ({ skus: {}, contabilium: {} }),
    guardarSnapshot: () => {},
    rutaSnapshotPara: (stateKey) => `/tmp/no-se-usa-${stateKey}.json`,
  };

  const resultado = await ejecutarPar(dot, deps);

  assert.equal(resultado.pendiente, undefined);
  assert.equal(locationIdUsado, dot.locationId);
  assert.notEqual(locationIdUsado, null);
});
