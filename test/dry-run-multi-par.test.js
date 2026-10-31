// R-10 / CA-11 — DRY_RUN respetado por TODOS los pares: ninguna escritura
// real contra Shopify cuando esta activo, y se reporta explicitamente que
// se habria escrito.
//
// INTERFAZ ASUMIDA (no existe hoy; ver
// aceptacion/deltas-dot-mas-isla-galerias/DISENO-INTERFAZ.md, "Ronda 3",
// seccion R-10/CA-11):
//
//   DEPS_REALES de ejecutarPar agrega una entrada `esDryRun` (la misma
//   funcion privada que ya usan procesarSku/syncTodos), ahora inyectable.
//   ejecutarPar, antes de llamar deps.setearStock, chequea deps.esDryRun():
//   si es true, nunca llama deps.setearStock ni deps.guardarSnapshot, y
//   acumula en `planDry` (parte del valor devuelto) que habria escrito.
//
// HALLAZGO que motiva este test (revisor-codigo, sobre la implementacion
// actual): ejecutarPar (src/sync.js) hoy llama deps.setearStock directo
// cuando hay delta, sin chequear nada de DRY_RUN -- a diferencia del camino
// legado (procesarSku), que si lo hace. Este archivo falla hoy porque
// ejecutarPar no acepta/usa ninguna dep `esDryRun`, y porque nunca deja de
// llamar setearStock en modo dry.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { construirPares } from "../src/pares.js";
import { ejecutarPar, cargarLibretaCompleta, guardarSnapshot, rutaSnapshotPara } from "../src/sync.js";

function conDirTemporal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "dry-run-multi-par-"));
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

// Mismo patron que test/orquestacion-pares.test.js: fakes en memoria para
// Contabilium/Shopify, IO real contra un directorio temporal para la
// libreta, y ahora tambien un `esDryRun` inyectable como dep.
function depsFake({ dir, stockPorDeposito, shopifyPorLocation, llamadas, dryRun }) {
  return {
    cargarLibretaCompleta: (ruta) => cargarLibretaCompleta(ruta),
    guardarSnapshot: (snap, ruta, contabilium) => {
      llamadas.guardarSnapshot.push(ruta);
      return guardarSnapshot(snap, ruta, contabilium);
    },
    rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey, dir),
    esDryRun: () => dryRun,

    getStockDeposito: async (depositoId) => {
      llamadas.getStockDeposito.push(depositoId);
      return stockPorDeposito.get(depositoId) ?? new Map();
    },

    resolverSku: async (sku, locationId) => {
      llamadas.resolverSku.push({ sku, locationId });
      const porSku = shopifyPorLocation.get(locationId);
      if (!porSku || !porSku.has(sku)) return null;
      return { inventoryItemId: `inv-${locationId}-${sku}`, available: porSku.get(sku) };
    },

    setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
      llamadas.setearStock.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    },
  };
}

function fixture() {
  return {
    stockPorDeposito: new Map([
      ["127356", new Map([["IEY-103-NEGRO", 10]])], // depositoId del DOT
      ["999001", new Map([["IEY-103-NEGRO", 7]])], // depositoId de la isla
    ]),
    shopifyPorLocation: new Map([
      // Las dos locations tienen delta real respecto de Contabilium: si
      // DRY_RUN no se respeta, las dos escribirian.
      ["gid://shopify/Location/83342655574", new Map([["IEY-103-NEGRO", 3]])],
      ["gid://shopify/Location/99988877766", new Map([["IEY-103-NEGRO", 1]])],
    ]),
  };
}

// -----------------------------------------------------------------------------
// (a)+(b) con DRY_RUN activo: ningun par escribe, y lo que habria escrito
// queda reportado explicitamente en el valor devuelto.
// -----------------------------------------------------------------------------

test("con DRY_RUN activo, ningun par de los dos llama setearStock, y cada uno reporta que habria escrito", async () => {
  await conDirTemporal(async (dir) => {
    const [dot, isla] = construirPares(ENV_DOS_PARES_ACTIVOS);
    const llamadas = { getStockDeposito: [], resolverSku: [], setearStock: [], guardarSnapshot: [] };
    const deps = depsFake({ dir, ...fixture(), llamadas, dryRun: true });

    const resultadoDot = await ejecutarPar(dot, deps);
    const resultadoIsla = await ejecutarPar(isla, deps);

    assert.equal(llamadas.setearStock.length, 0, "DRY_RUN activo: ninguna escritura real a Shopify");

    assert.ok(Array.isArray(resultadoDot.planDry), "el resultado reporta explicitamente que habria escrito");
    assert.ok(resultadoDot.planDry.length > 0, "el DOT tenia delta: tiene que aparecer en planDry");
    assert.equal(resultadoDot.planDry[0].sku, "IEY-103-NEGRO");
    assert.equal(resultadoDot.planDry[0].locationId, dot.locationId);
    assert.equal(resultadoDot.planDry[0].nuevoValor, 10); // sembrado: baseline null -> contabiliumActual

    assert.ok(resultadoIsla.planDry.length > 0, "la isla tambien tenia delta: tiene que aparecer en planDry");
    assert.equal(resultadoIsla.planDry[0].locationId, isla.locationId);
    assert.notEqual(resultadoIsla.planDry[0].locationId, dot.locationId);
  });
});

test("con DRY_RUN activo, ningun par persiste snapshot (no deja rastro de una sincronizacion que no paso)", async () => {
  await conDirTemporal(async (dir) => {
    const [dot, isla] = construirPares(ENV_DOS_PARES_ACTIVOS);
    const llamadas = { getStockDeposito: [], resolverSku: [], setearStock: [], guardarSnapshot: [] };
    const deps = depsFake({ dir, ...fixture(), llamadas, dryRun: true });

    await ejecutarPar(dot, deps);
    await ejecutarPar(isla, deps);

    assert.equal(llamadas.guardarSnapshot.length, 0, "DRY_RUN activo: la libreta no se persiste para ningun par");
  });
});

// -----------------------------------------------------------------------------
// (d) control negativo: con DRY_RUN apagado, si escribe y si persiste.
// -----------------------------------------------------------------------------

test("control negativo: con DRY_RUN apagado, los pares con delta si llaman setearStock y si persisten", async () => {
  await conDirTemporal(async (dir) => {
    const [dot, isla] = construirPares(ENV_DOS_PARES_ACTIVOS);
    const llamadas = { getStockDeposito: [], resolverSku: [], setearStock: [], guardarSnapshot: [] };
    const deps = depsFake({ dir, ...fixture(), llamadas, dryRun: false });

    const resultadoDot = await ejecutarPar(dot, deps);
    const resultadoIsla = await ejecutarPar(isla, deps);

    assert.ok(llamadas.setearStock.length > 0, "sin DRY_RUN, el delta real tiene que escribirse");
    assert.ok(llamadas.guardarSnapshot.length > 0, "sin DRY_RUN, la libreta si se persiste");
    assert.deepEqual(resultadoDot.planDry, [], "sin DRY_RUN no hay nada que reportar como 'lo que habria escrito'");
    assert.deepEqual(resultadoIsla.planDry, []);
  });
});
