// R-2/R-3/R-7/R-9 — hallazgos bloqueante 2 e importante de `revisor-alcance`
// (2026-10-29): ningun test anterior ejercitaba el loop de pares REAL (el que
// hoy no existe en src/index.js). test/multi-par.test.js y
// test/no-tocar-central.test.js solo prueban funciones puras
// (construirPares, armarPlanDeEscritura); nada confirmaba que el locationId
// correcto llegue de verdad desde el par hasta resolverSku ->
// buscarVariantePorSku/leerStockActual -> setearStock, ni que el marcado de
// "SKU resuelto" de un par sea independiente del otro cuando los dos corren
// en la misma invocacion del proceso.
//
// INTERFAZ ASUMIDA (no existe hoy; ver
// aceptacion/deltas-dot-mas-isla-galerias/DISENO-INTERFAZ.md seccion 7):
//
//   ejecutarPar(par, deps) en src/sync.js
//     par  — { nombre, stateKey, depositoId, locationId, pendiente }
//     deps — { getStockDeposito, resolverSku, setearStock,
//              cargarLibretaCompleta, guardarSnapshot, rutaSnapshotPara }
//     Para un par pendiente: devuelve { pendiente: true, motivo } SIN llamar
//     ninguna dependencia. Para un par activo: lee Contabilium via
//     deps.getStockDeposito(par.depositoId), resuelve/escribe en Shopify via
//     deps.resolverSku(sku, par.locationId) y deps.setearStock(..., par.locationId),
//     y actualiza la libreta de ESE par via deps.cargarLibretaCompleta/guardarSnapshot
//     contra la ruta que devuelve deps.rutaSnapshotPara(par.stateKey).
//
// Este archivo falla hoy porque ejecutarPar no existe en src/sync.js.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { construirPares } from "../src/pares.js";
import {
  ejecutarPar,
  cargarLibretaCompleta,
  guardarSnapshot,
  rutaSnapshotPara,
} from "../src/sync.js";

function conDirTemporal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "orquestacion-pares-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ENV_DOS_PARES_ACTIVOS = {
  CONTABILIUM_DOT_DEPOSITO_ID: "127356",
  SHOPIFY_DOT_LOCATION_ID: "gid://shopify/Location/83342655574",
  CONTABILIUM_ISLA_DEPOSITO_ID: "999001",
  SHOPIFY_ISLA_LOCATION_ID: "gid://shopify/Location/99988877766",
};

// Fabrica de deps fake: Contabilium y Shopify en memoria (sin red), pero
// cargarLibretaCompleta/guardarSnapshot/rutaSnapshotPara REALES contra un
// directorio temporal, igual que test/libreta-multi-location.test.js, para
// que el aislamiento de la libreta se pruebe contra el I/O de verdad y no
// contra otro fake que podria estar ocultando el mismo bug que se busca.
function depsFake({ dir, stockPorDeposito, shopifyPorLocation, llamadas }) {
  return {
    cargarLibretaCompleta: (ruta) => cargarLibretaCompleta(ruta),
    guardarSnapshot: (snap, ruta, contabilium) => guardarSnapshot(snap, ruta, contabilium),
    rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey, dir),

    getStockDeposito: async (depositoId) => {
      llamadas.getStockDeposito.push(depositoId);
      return stockPorDeposito.get(depositoId) ?? new Map();
    },

    // Simula Shopify: cada location tiene su propio mapa sku -> available.
    // Un SKU ausente del mapa de esa location == "no encontrado" (resolverSku
    // devuelve null), igual que el contrato real.
    resolverSku: async (sku, locationId) => {
      llamadas.resolverSku.push({ sku, locationId });
      const porSku = shopifyPorLocation.get(locationId);
      if (!porSku || !porSku.has(sku)) return null;
      return { inventoryItemId: `inv-${locationId}-${sku}`, available: porSku.get(sku) };
    },

    setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      llamadas.setearStock.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      const porSku = shopifyPorLocation.get(locationId);
      // Actualiza el fake para que una segunda lectura (si la hubiera) sea consistente.
      for (const [sku, inv] of porSku ?? []) {
        if (`inv-${locationId}-${sku}` === inventoryItemId) porSku.set(sku, quantity);
      }
    },
  };
}

// -----------------------------------------------------------------------------
// (a) cada par escribe/lee contra exactamente su propio locationId
// -----------------------------------------------------------------------------

test("ejecutarPar con DOS pares en una sola invocacion: cada uno usa su propio locationId, nunca el del otro", async () => {
  await conDirTemporal(async (dir) => {
    const [dot, isla] = construirPares(ENV_DOS_PARES_ACTIVOS);

    const llamadas = {
      getStockDeposito: [],
      resolverSku: [],
      setearStock: [],
    };

    const deps = depsFake({
      dir,
      stockPorDeposito: new Map([
        [dot.depositoId, new Map([["IEY-103-NEGRO", 10]])],
        [isla.depositoId, new Map([["IEY-103-NEGRO", 7]])],
      ]),
      shopifyPorLocation: new Map([
        [dot.locationId, new Map([["IEY-103-NEGRO", 10]])], // sin cambios
        [isla.locationId, new Map([["IEY-103-NEGRO", 3]])], // hay delta: debe escribir
      ]),
      llamadas,
    });

    await ejecutarPar(dot, deps);
    await ejecutarPar(isla, deps);

    // Cada llamada a resolverSku llevo el locationId del par que la origino.
    const locationsUsadasPorResolverSku = llamadas.resolverSku.map((l) => l.locationId);
    assert.ok(locationsUsadasPorResolverSku.includes(dot.locationId));
    assert.ok(locationsUsadasPorResolverSku.includes(isla.locationId));

    // setearStock de la isla (habia delta) usa el locationId de la isla, NUNCA el del DOT.
    const escriturasIsla = llamadas.setearStock.filter((l) => l.locationId === isla.locationId);
    assert.ok(escriturasIsla.length > 0, "la isla tenia delta: tiene que haber escrito");
    for (const e of escriturasIsla) {
      assert.notEqual(e.locationId, dot.locationId);
    }

    // getStockDeposito se llamo una vez por cada depositoId, nunca con el del otro par.
    assert.deepEqual(new Set(llamadas.getStockDeposito), new Set([dot.depositoId, isla.depositoId]));
  });
});

// -----------------------------------------------------------------------------
// (b) el par pendiente no genera NINGUNA llamada de lectura/escritura a Shopify
// -----------------------------------------------------------------------------

test("un par pendiente, corrido junto a uno activo, no genera ninguna llamada a Shopify", async () => {
  await conDirTemporal(async (dir) => {
    const ENV_ISLA_PENDIENTE = {
      CONTABILIUM_DOT_DEPOSITO_ID: "127356",
      SHOPIFY_DOT_LOCATION_ID: "gid://shopify/Location/83342655574",
      // Sin datos de la isla: queda pendiente.
    };
    const [dot, isla] = construirPares(ENV_ISLA_PENDIENTE);
    assert.equal(isla.pendiente, true);
    assert.equal(dot.pendiente, false);

    const llamadas = { getStockDeposito: [], resolverSku: [], setearStock: [] };
    const deps = depsFake({
      dir,
      stockPorDeposito: new Map([[dot.depositoId, new Map([["IEY-103-NEGRO", 10]])]]),
      shopifyPorLocation: new Map([[dot.locationId, new Map([["IEY-103-NEGRO", 10]])]]),
      llamadas,
    });

    const resultadoDot = await ejecutarPar(dot, deps);
    const resultadoIsla = await ejecutarPar(isla, deps);

    assert.equal(resultadoIsla.pendiente, true);
    assert.equal(resultadoDot.pendiente, undefined);

    // Ninguna llamada de Shopify/Contabilium menciona el locationId/depositoId de la isla.
    assert.ok(!llamadas.resolverSku.some((l) => l.locationId === isla.locationId));
    assert.ok(!llamadas.getStockDeposito.includes(isla.depositoId));
    assert.ok(!llamadas.setearStock.some((l) => l.locationId === isla.locationId));
  });
});

// -----------------------------------------------------------------------------
// (c) R-7 a nivel de dos pares reales: un SKU no resuelto en A no se marca
// resuelto en el snapshot de A por efecto de lo que paso en B, y viceversa.
// -----------------------------------------------------------------------------

test("con dos pares en una sola invocacion, un SKU no resuelto en el par A no queda marcado resuelto por lo que paso en B", async () => {
  await conDirTemporal(async (dir) => {
    const [dot, isla] = construirPares(ENV_DOS_PARES_ACTIVOS);

    const llamadas = { getStockDeposito: [], resolverSku: [], setearStock: [] };
    const deps = depsFake({
      dir,
      stockPorDeposito: new Map([
        // Mismo SKU en los dos pares.
        [dot.depositoId, new Map([["SKU-COMPARTIDO", 5]])],
        [isla.depositoId, new Map([["SKU-COMPARTIDO", 5]])],
      ]),
      shopifyPorLocation: new Map([
        // El DOT SI lo tiene resuelto (existe en esa location).
        [dot.locationId, new Map([["SKU-COMPARTIDO", 5]])],
        // La isla NO lo tiene resuelto (no existe en esa location todavia):
        // shopifyPorLocation sin esa key para este sku -> resolverSku -> null.
        [isla.locationId, new Map()],
      ]),
      llamadas,
    });

    await ejecutarPar(dot, deps);
    await ejecutarPar(isla, deps);

    const libretaDot = cargarLibretaCompleta(rutaSnapshotPara(dot.stateKey, dir));
    const libretaIsla = cargarLibretaCompleta(rutaSnapshotPara(isla.stateKey, dir));

    assert.equal(
      libretaDot.skus["SKU-COMPARTIDO"],
      5,
      "el DOT si lo resolvio: tiene que quedar anotado en SU libreta"
    );
    assert.equal(
      libretaIsla.skus["SKU-COMPARTIDO"],
      undefined,
      "la isla NO lo resolvio: nunca se marca resuelto en la libreta de la isla, " +
        "ni siquiera porque el DOT si lo resolvio en la misma corrida"
    );
  });
});

// -----------------------------------------------------------------------------
// (d) R-7/CA-7 — veredicto del juez (2026-10-29), ver
// aceptacion/deltas-dot-mas-isla-galerias/rojo-2026-10-29.md, "Veredicto del
// juez sobre el cierre": un SKU no_activado/no_encontrado NO puede dejar un
// baseline de `contabilium`, porque ese baseline certifica "esto SI se
// escribio en Shopify", y un no_activado nunca llego a escribirse. Si quedara
// anotado, la corrida en la que el SKU se activa lo vería con baseline =
// contabiliumActual -> delta 0 -> "sin_cambios", y el valor real jamas se
// escribiria en Shopify ("resuelto sin escribirse").
// -----------------------------------------------------------------------------

test("R-7/CA-7: un SKU no_activado no deja baseline de contabilium; al activarse se trata como sembrado y SI escribe (nunca 'sin_cambios')", async () => {
  await conDirTemporal(async (dir) => {
    const [dot] = construirPares(ENV_DOS_PARES_ACTIVOS);
    const rutaDot = rutaSnapshotPara(dot.stateKey, dir);

    // Corrida N: Contabilium dice 10, pero el SKU todavia no esta activado en
    // la location del DOT (available === null -> resultado "no_activado").
    const llamadasN = { getStockDeposito: [], resolverSku: [], setearStock: [] };
    const depsN = depsFake({
      dir,
      stockPorDeposito: new Map([[dot.depositoId, new Map([["SKU-NOACTIVADO", 10]])]]),
      shopifyPorLocation: new Map([[dot.locationId, new Map([["SKU-NOACTIVADO", null]])]]),
      llamadas: llamadasN,
    });

    const resultadoN = await ejecutarPar(dot, depsN);
    assert.equal(resultadoN.no_activado, 1, "la corrida N tiene que contar el SKU como no_activado");
    assert.equal(llamadasN.setearStock.length, 0, "no_activado nunca escribe nada en Shopify");

    const libretaTrasN = cargarLibretaCompleta(rutaDot);
    assert.equal(
      libretaTrasN.contabilium?.["SKU-NOACTIVADO"],
      undefined,
      "un SKU no_activado NUNCA puede dejar un baseline de contabilium: todavia no se " +
        "escribio nada real en Shopify para ese SKU"
    );
    assert.equal(
      libretaTrasN.skus["SKU-NOACTIVADO"],
      undefined,
      "tampoco puede quedar marcado como resuelto en la libreta de 'skus'"
    );

    // Corrida N+1: el SKU ya se activo en Shopify (available = 0) y
    // Contabilium sigue diciendo 10 (no cambio nada del lado de Contabilium).
    const llamadasN1 = { getStockDeposito: [], resolverSku: [], setearStock: [] };
    const depsN1 = depsFake({
      dir,
      stockPorDeposito: new Map([[dot.depositoId, new Map([["SKU-NOACTIVADO", 10]])]]),
      shopifyPorLocation: new Map([[dot.locationId, new Map([["SKU-NOACTIVADO", 0]])]]),
      llamadas: llamadasN1,
    });

    const resultadoN1 = await ejecutarPar(dot, depsN1);

    // Sin baseline previo esto tiene que tratarse como "sembrado" (primera
    // vez real): escribe el absoluto de Contabilium (10). Si el bug del
    // veredicto estuviera presente, el baseline habria quedado en 10 desde la
    // corrida N y esto saldria "sin_cambios" (10 === 10) sin escribir nunca.
    assert.equal(
      resultadoN1.sin_cambios,
      0,
      "al activarse por primera vez tiene que escribir, no puede salir 'sin_cambios'"
    );
    assert.equal(resultadoN1.actualizado, 1, "tiene que haber UNA escritura real");

    const escritura = llamadasN1.setearStock.find(
      (l) => l.inventoryItemId === `inv-${dot.locationId}-SKU-NOACTIVADO`
    );
    assert.ok(escritura, "setearStock tiene que haberse llamado para este SKU");
    assert.equal(
      escritura.quantity,
      10,
      "tiene que escribir el absoluto de Contabilium (10): es la primera vez real " +
        "que se escribe este SKU, el 10 de la corrida N nunca se persistio como baseline"
    );
  });
});

// -----------------------------------------------------------------------------
// (e) R-7/CA-7, caso borde — un SKU que YA tenia baseline de una corrida
// anterior y se desactiva: el baseline viejo se conserva intacto, no se borra
// ni se pisa con el valor nuevo (no escrito) de Contabilium.
// -----------------------------------------------------------------------------

test("R-7/CA-7 (borde): un SKU que ya tenia baseline y se desactiva conserva su baseline viejo intacto", async () => {
  await conDirTemporal(async (dir) => {
    const [dot] = construirPares(ENV_DOS_PARES_ACTIVOS);
    const rutaDot = rutaSnapshotPara(dot.stateKey, dir);

    // Libreta previa: "SKU-SE-DESACTIVA" ya estaba resuelto con Contabilium=7.
    guardarSnapshot({ "SKU-SE-DESACTIVA": 7 }, rutaDot, new Map([["SKU-SE-DESACTIVA", 7]]));

    const llamadas = { getStockDeposito: [], resolverSku: [], setearStock: [] };
    const deps = depsFake({
      dir,
      // Contabilium ahora dice 9 (cambio), pero el SKU se desactivo en Shopify.
      stockPorDeposito: new Map([[dot.depositoId, new Map([["SKU-SE-DESACTIVA", 9]])]]),
      shopifyPorLocation: new Map([[dot.locationId, new Map([["SKU-SE-DESACTIVA", null]])]]),
      llamadas,
    });

    const resultado = await ejecutarPar(dot, deps);
    assert.equal(resultado.no_activado, 1);
    assert.equal(llamadas.setearStock.length, 0);

    const libretaTrasCorrida = cargarLibretaCompleta(rutaDot);
    assert.equal(
      libretaTrasCorrida.contabilium?.["SKU-SE-DESACTIVA"],
      7,
      "el baseline viejo (7) se conserva tal cual: no se borra ni se pisa con el 9 " +
        "nuevo de Contabilium, que nunca se escribio de verdad en Shopify"
    );
    assert.equal(
      libretaTrasCorrida.skus["SKU-SE-DESACTIVA"],
      undefined,
      "en 'skus' (lo resuelto) si se desmarca: ya no esta activo, hay que reintentarlo"
    );
  });
});
