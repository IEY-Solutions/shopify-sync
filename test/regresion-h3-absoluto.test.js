// R-1 / CA-9 — Regresion del hallazgo H3 (docs/diagnostico-2026-08-19.md),
// atada a la correccion de la semantica de escritura (R-1).
//
// H3 real: en un runner limpio, .cache/ no existe. guardarCache/guardarSnapshot
// tiraban ENOENT al escribir, lo que dejaba TODOS los SKUs como "error" y la
// corrida salia en VERDE igual (2.396 errores de 2.480, exit 0). Esa parte del
// bug (el directorio) ya esta corregida (ver "H3: guardarSnapshot crea el
// directorio" en test/libreta.test.js) y el guard de salida esta en
// test/resultado.test.js.
//
// Lo que ESTE archivo cubre es el angulo que une H3 con R-1: un arranque en
// frio (sin .cache, sin libreta) es EXACTAMENTE la situacion en la que
// `baseline` no existe. Si el codigo corregido alguna vez tratara "no hay
// libreta" como baseline=0 (en vez de null/ausente), el delta resultante
// re-inflaria o destruiria el stock real de Shopify en el primer dia de cada
// par -- una version nueva, disfrazada de "delta", del mismo bug de fondo que
// el ADR 0001 vino a resolver (escribir un valor que no corresponde al estado
// real). Este test reproduce el arranque en frio REAL contra las funciones
// corregidas y falla si alguna vuelve a tratar "sin dato" como cero.
//
// INTERFAZ ASUMIDA: calcularEscritura (src/sync.js, ver DISENO-INTERFAZ.md
// seccion 2). cargarLibretaCompleta ya existe y ya devuelve
// `contabilium: null` en un arranque en frio (ver test/libreta.test.js) --
// eso NO es nuevo. Lo nuevo es que calcularEscritura reciba ESE null
// directamente y lo distinga de 0.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cargarLibretaCompleta, calcularEscritura, ejecutarPar } from "../src/sync.js";

function conDirTemporal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h3-cold-start-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("el caso real de H3 (runner limpio, .cache inexistente) no hace catastrofe bajo deltas", () => {
  conDirTemporal((dir) => {
    // Ruta que NUNCA se escribio: exactamente la condicion de un runner limpio.
    const rutaInexistente = join(dir, "cache-que-no-existe", "last-sync.json");

    const libreta = cargarLibretaCompleta(rutaInexistente);
    assert.equal(libreta.contabilium, null, "H3: sin archivo, el baseline tiene que ser null, no {}");

    // Un SKU con stock real en Contabilium y en Shopify (sin venta web todavia).
    const baseline = libreta.contabilium?.["IEY-103-NEGRO"] ?? null;
    const r = calcularEscritura({ baseline, contabiliumActual: 10, shopifyActual: 10 });

    assert.equal(r.sembrado, true, "sin baseline, tiene que sembrar, no inventar un delta");
    assert.equal(r.nuevoValor, 10);
  });
});

test("tratar la ausencia de libreta como baseline=0 reintroduciria el bug: se verifica la distincion", () => {
  // Si una implementacion defectuosa hiciera `baseline ?? 0` en vez de
  // `baseline ?? null` en la capa que llama a calcularEscritura, el siguiente
  // caso (Shopify ya en 8 por una venta web, Contabilium en 10) calcularia un
  // delta de +10 sobre un shopifyActual de 8 (resultado 18, inventado) en vez
  // de sembrar 10. Este test fija el contrato de calcularEscritura: baseline
  // null y baseline 0 TIENEN que dar resultados distintos para que esa capa
  // de arriba no pueda confundirlos por accidente.
  const conNull = calcularEscritura({ baseline: null, contabiliumActual: 10, shopifyActual: 8 });
  const conCero = calcularEscritura({ baseline: 0, contabiliumActual: 10, shopifyActual: 8 });
  assert.notEqual(conNull.nuevoValor, conCero.nuevoValor);
  assert.equal(conNull.sembrado, true);
  assert.equal(conCero.sembrado, false);
  assert.equal(conCero.nuevoValor, 18, "con baseline=0 real, delta=+10 sobre shopifyActual=8 es correcto");
  assert.equal(conNull.nuevoValor, 10, "con baseline ausente, se siembra el valor de Contabilium");
});

test("un arranque en frio con DOS pares en la misma corrida siembra cada uno de forma independiente", () => {
  // H3 tumbaba la corrida ENTERA. La correccion multi-par (R-2/R-3) no puede
  // reintroducir una version donde el arranque en frio de un par contamine al
  // otro: cada libreta vive en su propio archivo inexistente al principio.
  conDirTemporal((dir) => {
    const rutaDot = join(dir, "last-sync.dot.json");
    const rutaIsla = join(dir, "last-sync.galerias-pacifico.json");

    const libretaDot = cargarLibretaCompleta(rutaDot);
    const libretaIsla = cargarLibretaCompleta(rutaIsla);
    assert.equal(libretaDot.contabilium, null);
    assert.equal(libretaIsla.contabilium, null);

    const rDot = calcularEscritura({ baseline: null, contabiliumActual: 10, shopifyActual: 999 });
    const rIsla = calcularEscritura({ baseline: null, contabiliumActual: 3, shopifyActual: 999 });
    assert.equal(rDot.nuevoValor, 10);
    assert.equal(rIsla.nuevoValor, 3);
  });
});

// -----------------------------------------------------------------------------
// Arreglo post-juez (2026-10-29): el juez rechazo CA-9 porque los tres casos de
// arriba solo ejercitan calcularEscritura/cargarLibretaCompleta directo, y
// "si procesarSku o ejecutarPar volvieran a escribir el absoluto de
// Contabilium [...] los tres casos seguirian en verde". Este caso corre el
// camino REAL de escritura (ejecutarPar, con deps.setearStock espia)
// reproduciendo H3: baseline previo, Shopify ya descontado por una venta web,
// Contabilium con una reposicion en el medio. Si ejecutarPar volviera a
// escribir `cantidad` (el valor crudo de Contabilium) en vez del resultado de
// calcularEscritura, este test explota.
// -----------------------------------------------------------------------------

test("el camino real (ejecutarPar) escribe el DELTA via setearStock, no el absoluto crudo de Contabilium", async () => {
  const llamadasSetearStock = [];

  const par = {
    nombre: "dot",
    stateKey: "dot",
    depositoId: "127356",
    locationId: "gid://shopify/Location/83342655574",
    pendiente: false,
  };

  // Baseline previo: la ultima corrida vio Contabilium en 10 para este SKU.
  // Ahora Contabilium subio a 12 (reposicion), pero Shopify ya esta en 8
  // porque vendio 2 unidades por la web en el medio. El delta correcto es
  // +2 sobre el 8 real de Shopify = 10. El bug de H3 habria escrito el 12
  // crudo de Contabilium, re-inflando stock ya vendido online.
  const deps = {
    rutaSnapshotPara: () => "ruta-fake-no-se-lee-ni-se-escribe",
    cargarLibretaCompleta: () => ({
      skus: { "IEY-103-NEGRO": 10 },
      contabilium: { "IEY-103-NEGRO": 10 },
    }),
    getStockDeposito: async () => new Map([["IEY-103-NEGRO", 12]]),
    resolverSku: async () => ({ inventoryItemId: "gid://shopify/InventoryItem/1", available: 8 }),
    setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      llamadasSetearStock.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    },
    guardarSnapshot: () => {},
    esDryRun: () => false,
  };

  await ejecutarPar(par, deps);

  assert.equal(
    llamadasSetearStock.length,
    1,
    "tenia que escribir: hay diferencia entre el available real (8) y el delta esperado (10)"
  );
  assert.equal(
    llamadasSetearStock[0].quantity,
    10,
    "DELTA correcto: Contabilium +2 (10->12) aplicado sobre el Shopify real (8) da 10. " +
      "Si ejecutarPar volviera a escribir el absoluto crudo de Contabilium (H3), este valor seria 12."
  );
  assert.equal(
    llamadasSetearStock[0].changeFromQuantity,
    8,
    "el compare-and-set va contra el available real leido de Shopify, no contra el baseline ni el absoluto"
  );
  assert.equal(llamadasSetearStock[0].locationId, par.locationId);
});
