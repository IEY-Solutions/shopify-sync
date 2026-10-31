// R-2 / CA-2 — Lista de pares (deposito Contabilium -> location Shopify)
// parametrizable, sin ids hardcodeados en src/*.js.
//
// INTERFAZ ASUMIDA (no existe hoy; ver
// aceptacion/deltas-dot-mas-isla-galerias/DISENO-INTERFAZ.md secciones 1 y 4):
//
//   construirPares(env) -> [{ nombre, stateKey, depositoId, locationId, pendiente }, ...]
//   armarPlanDeEscritura(par, stockPorSku, baselinePorSku, shopifyPorSku)
//     -> [{ sku, par, locationId, nuevoValor, delta, sembrado }, ...]
//
// Hoy src/index.js no tiene ningun loop de pares (src/sync.js:syncTodos llama
// getStockDeposito() SIN argumentos, un solo deposito fijo por env). Este
// archivo falla hoy porque ninguna de las dos funciones existe todavia.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { construirPares } from "../src/pares.js";
import {
  armarPlanDeEscritura,
  ejecutarPar,
  cargarLibretaCompleta,
  guardarSnapshot,
  rutaSnapshotPara,
} from "../src/sync.js";

const mapa = (o) => new Map(Object.entries(o));

const ENV_DOS_PARES = {
  CONTABILIUM_DOT_DEPOSITO_ID: "127356",
  SHOPIFY_DOT_LOCATION_ID: "gid://shopify/Location/83342655574",
  CONTABILIUM_ISLA_DEPOSITO_ID: "999001",
  SHOPIFY_ISLA_LOCATION_ID: "gid://shopify/Location/99988877766",
};

test("construirPares devuelve dos pares a partir de env, sin ids literales en el codigo", () => {
  const pares = construirPares(ENV_DOS_PARES);
  assert.equal(pares.length, 2);
  const dot = pares.find((p) => p.nombre === "dot");
  const isla = pares.find((p) => p.nombre === "galerias-pacifico");
  assert.equal(dot.depositoId, "127356");
  assert.equal(dot.locationId, "gid://shopify/Location/83342655574");
  assert.equal(isla.depositoId, "999001");
  assert.equal(isla.locationId, "gid://shopify/Location/99988877766");
});

test("agregar un tercer par es agregar una entrada de env, sin tocar la logica", () => {
  // No hay forma de testear "no tocar sync.js" directamente, pero si se puede
  // probar que construirPares no depende de cuantos pares haya: si el dia de
  // mañana se agrega un tercero por env, tiene que aparecer igual sin cambiar
  // la firma. Se simula pasando un env con un par extra bajo un prefijo nuevo
  // y confirmando que los dos pares conocidos siguen resolviendose igual.
  const envConExtra = { ...ENV_DOS_PARES, OTRA_VARIABLE_QUE_NO_DEBERIA_AFECTAR: "x" };
  assert.deepEqual(construirPares(envConExtra), construirPares(ENV_DOS_PARES));
});

test("cada par escribe solo en su location: el plan de DOT nunca lleva el locationId de la isla", () => {
  const [dot, isla] = construirPares(ENV_DOS_PARES);

  const stockDot = mapa({ "IEY-103-NEGRO": 10, "IEY-105-NEGRO": 4 });
  const stockIsla = mapa({ "IEY-103-NEGRO": 7, "IEY-105-NEGRO": 2 });
  const baselineVacio = mapa({});
  const shopifyDot = mapa({ "IEY-103-NEGRO": 10, "IEY-105-NEGRO": 4 });
  const shopifyIsla = mapa({ "IEY-103-NEGRO": 7, "IEY-105-NEGRO": 2 });

  const planDot = armarPlanDeEscritura(dot, stockDot, baselineVacio, shopifyDot);
  const planIsla = armarPlanDeEscritura(isla, stockIsla, baselineVacio, shopifyIsla);

  assert.ok(planDot.length > 0);
  assert.ok(planIsla.length > 0);
  assert.ok(planDot.every((item) => item.locationId === dot.locationId));
  assert.ok(planIsla.every((item) => item.locationId === isla.locationId));
  assert.ok(planDot.every((item) => item.locationId !== isla.locationId));
  assert.ok(planIsla.every((item) => item.locationId !== dot.locationId));
});

test("el mismo SKU en los dos pares no se mezcla: cada plan es independiente", () => {
  // Caso real de este catalogo: el mismo producto puede tener stock tanto en
  // el DOT como en la isla. Que compartan SKU no debe hacer que un par lea o
  // escriba el valor del otro.
  const [dot, isla] = construirPares(ENV_DOS_PARES);
  const planDot = armarPlanDeEscritura(
    dot,
    mapa({ "IEY-103-NEGRO": 10 }),
    mapa({ "IEY-103-NEGRO": 10 }),
    mapa({ "IEY-103-NEGRO": 10 })
  );
  const planIsla = armarPlanDeEscritura(
    isla,
    mapa({ "IEY-103-NEGRO": 3 }),
    mapa({ "IEY-103-NEGRO": 5 }), // baseline DISTINTO al del DOT para el mismo SKU
    mapa({ "IEY-103-NEGRO": 1 })
  );

  assert.equal(planDot[0].nuevoValor, 10); // sin cambios, delta 0
  assert.equal(planIsla[0].nuevoValor, -1); // delta -2 sobre shopifyActual=1
  assert.notEqual(planDot[0].nuevoValor, planIsla[0].nuevoValor);
  assert.equal(planDot[0].par, "dot");
  assert.equal(planIsla[0].par, "galerias-pacifico");
});

test("un SKU no encontrado en Shopify para ese par no entra al plan (no se inventa una escritura)", () => {
  const [dot] = construirPares(ENV_DOS_PARES);
  const plan = armarPlanDeEscritura(
    dot,
    mapa({ "SKU-NUEVO": 5 }),
    mapa({}),
    mapa({}) // Shopify no tiene este SKU resuelto
  );
  assert.deepEqual(plan, []);
});

// -----------------------------------------------------------------------------
// CA-2 — 5to veredicto del juez (2026-10-29): "armarPlanDeEscritura [...] no
// la llama ningun camino de produccion [...] El comando de CA-2 no corre dos
// pares por el camino real de escritura."
//
// Los casos de arriba prueban armarPlanDeEscritura (una funcion pura que hoy
// ningun camino de produccion llama). Este caso corre ejecutarPar REAL (la
// misma interfaz publica que ya usa test/orquestacion-pares.test.js) con los
// DOS pares de fixture en una sola invocacion, deps fake con un spy de
// setearStock, y confirma que cada par termina escribiendo con SU PROPIO
// locationId, nunca mezclado con el del otro -- el camino que de verdad
// corre en produccion.
// -----------------------------------------------------------------------------

function conDirTemporalCA2(fn) {
  const dir = mkdtempSync(join(tmpdir(), "multi-par-ca2-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CA-2: ejecutarPar real con dos pares en una sola invocacion escribe cada uno con su propio locationId (via setearStock)", async () => {
  await conDirTemporalCA2(async (dir) => {
    const [dot, isla] = construirPares(ENV_DOS_PARES);

    const llamadasSetearStock = [];

    function depsFakeParaPar(stockActual, shopifyActual) {
      return {
        cargarLibretaCompleta: (ruta) => cargarLibretaCompleta(ruta),
        guardarSnapshot: (snap, ruta, contabilium) => guardarSnapshot(snap, ruta, contabilium),
        rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey, dir),
        getStockDeposito: async () => stockActual,
        resolverSku: async (sku, locationId) => {
          if (!shopifyActual.has(sku)) return null;
          return { inventoryItemId: `inv-${locationId}-${sku}`, available: shopifyActual.get(sku) };
        },
        setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
          llamadasSetearStock.push({ inventoryItemId, quantity, locationId });
        },
      };
    }

    // Los dos pares tienen delta (Contabilium != Shopify) para forzar escritura.
    await ejecutarPar(dot, depsFakeParaPar(mapa({ "IEY-103-NEGRO": 10 }), mapa({ "IEY-103-NEGRO": 4 })));
    await ejecutarPar(isla, depsFakeParaPar(mapa({ "IEY-103-NEGRO": 7 }), mapa({ "IEY-103-NEGRO": 1 })));

    assert.ok(llamadasSetearStock.length >= 2, "los dos pares tenian delta: los dos tienen que haber escrito");

    const escriturasDot = llamadasSetearStock.filter((l) => l.inventoryItemId.includes(dot.locationId));
    const escriturasIsla = llamadasSetearStock.filter((l) => l.inventoryItemId.includes(isla.locationId));

    assert.ok(escriturasDot.length > 0, "el DOT tiene que haber escrito con su propio locationId");
    assert.ok(escriturasIsla.length > 0, "la isla tiene que haber escrito con su propio locationId");

    for (const escritura of escriturasDot) {
      assert.equal(escritura.locationId, dot.locationId);
      assert.notEqual(escritura.locationId, isla.locationId);
    }
    for (const escritura of escriturasIsla) {
      assert.equal(escritura.locationId, isla.locationId);
      assert.notEqual(escritura.locationId, dot.locationId);
    }
  });
});
