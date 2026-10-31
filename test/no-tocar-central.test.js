// R-4 / CA-4 — Nunca se escribe sobre el deposito CENTRAL ni su location: solo
// sobre los pares declarados explicitamente en la configuracion.
//
// INTERFAZ ASUMIDA: igual que test/multi-par.test.js (construirPares,
// armarPlanDeEscritura) -- ver DISENO-INTERFAZ.md secciones 1 y 4.
//
// No hay ningun id de CENTRAL confirmado en AGENTS.md (solo se confirmaron los
// del DOT: deposito 127356, location gid://shopify/Location/83342655574), asi
// que este test no puede comparar contra un id real de CENTRAL. En cambio
// verifica la PROPIEDAD que hace imposible tocar CENTRAL por construccion:
// toda escritura planeada lleva el locationId de un par EXPLICITAMENTE
// declarado, nunca un valor que no vino de ese par.
//
// Corre con: node --test test/
// 5to veredicto del juez (2026-10-29): "CA-4 no cumple: La parte que
// alimenta un stock [...] ejercita armarPlanDeEscritura, que es codigo
// muerto en produccion. El input real se arma en ejecutarPar -> setearStock
// -> construirInputSet. [...] no recibe ningun stock como pide el
// criterio." Los dos casos que antes llamaban armarPlanDeEscritura se
// reemplazan por el camino real: ejecutarPar con deps fake y un spy de
// setearStock (mismo patron que test/orquestacion-pares.test.js y el caso
// CA-2 de test/multi-par.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { construirPares } from "../src/pares.js";
import { ejecutarPar, cargarLibretaCompleta, guardarSnapshot, rutaSnapshotPara } from "../src/sync.js";

const mapa = (o) => new Map(Object.entries(o));

const LOCATION_CENTRAL_HIPOTETICA = "gid://shopify/Location/11111111111";
const DEPOSITO_CENTRAL_HIPOTETICO = "999999-central";

const ENV = {
  CONTABILIUM_DOT_DEPOSITO_ID: "127356",
  SHOPIFY_DOT_LOCATION_ID: "gid://shopify/Location/83342655574",
  CONTABILIUM_ISLA_DEPOSITO_ID: "999001",
  SHOPIFY_ISLA_LOCATION_ID: "gid://shopify/Location/99988877766",
};

function conDirTemporal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "no-tocar-central-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("construirPares nunca incluye CENTRAL: solo los pares declarados explicitamente", () => {
  const pares = construirPares(ENV);
  assert.equal(pares.length, 2, "con env de 2 pares, exactamente 2 pares, nunca un tercero implicito");
  for (const p of pares) {
    assert.notEqual(p.locationId, LOCATION_CENTRAL_HIPOTETICA);
    assert.notEqual(p.depositoId, DEPOSITO_CENTRAL_HIPOTETICO);
  }
});

test("CA-4: ejecutarPar real, corriendo DOT e isla, jamas llama a setearStock con el locationId de CENTRAL", async () => {
  await conDirTemporal(async (dir) => {
    const [dot, isla] = construirPares(ENV);

    const llamadasGetStockDeposito = [];
    const llamadasSetearStock = [];

    // El fixture de stock de Contabilium incluye, a proposito, un SKU bajo un
    // deposito que simula CENTRAL -- pero ejecutarPar solo recibe el
    // depositoId del par que le toca (par.depositoId), nunca el de CENTRAL,
    // porque construirPares ni siquiera lo declara (test de arriba). Este
    // caso confirma la consecuencia end-to-end: ningun getStockDeposito ni
    // setearStock del camino real se llama jamas con algo de CENTRAL.
    function depsFake(stockDelPar, shopifyDelPar) {
      return {
        cargarLibretaCompleta: (ruta) => cargarLibretaCompleta(ruta),
        guardarSnapshot: (snap, ruta, contabilium) => guardarSnapshot(snap, ruta, contabilium),
        rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey, dir),
        getStockDeposito: async (depositoId) => {
          llamadasGetStockDeposito.push(depositoId);
          // Si alguna vez a ejecutarPar se le pasara el depositoId de
          // CENTRAL, este fake tiene stock de sobra ahi para que, si el bug
          // existiera, el test lo detectara por una escritura con el
          // locationId de CENTRAL.
          if (depositoId === DEPOSITO_CENTRAL_HIPOTETICO) {
            return mapa({ "SKU-TAMBIEN-EN-CENTRAL": 999 });
          }
          return stockDelPar;
        },
        resolverSku: async (sku, locationId) => {
          if (!shopifyDelPar.has(sku)) return null;
          return { inventoryItemId: `inv-${locationId}-${sku}`, available: shopifyDelPar.get(sku) };
        },
        setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
          llamadasSetearStock.push({ inventoryItemId, quantity, locationId });
        },
      };
    }

    // Un SKU que (en la realidad del catalogo) tambien existe en CENTRAL,
    // con delta para forzar escritura en los dos pares declarados.
    await ejecutarPar(dot, depsFake(mapa({ "SKU-TAMBIEN-EN-CENTRAL": 10 }), mapa({ "SKU-TAMBIEN-EN-CENTRAL": 4 })));
    await ejecutarPar(isla, depsFake(mapa({ "SKU-TAMBIEN-EN-CENTRAL": 7 }), mapa({ "SKU-TAMBIEN-EN-CENTRAL": 1 })));

    assert.ok(llamadasSetearStock.length > 0, "los pares declarados tenian delta: tienen que haber escrito");

    for (const llamada of llamadasSetearStock) {
      assert.notEqual(llamada.locationId, LOCATION_CENTRAL_HIPOTETICA);
      assert.ok(
        llamada.locationId === dot.locationId || llamada.locationId === isla.locationId,
        "toda escritura real tiene que llevar el locationId de un par declarado, nunca otro"
      );
    }
    for (const depositoId of llamadasGetStockDeposito) {
      assert.notEqual(depositoId, DEPOSITO_CENTRAL_HIPOTETICO);
    }
  });
});

test("un par sin locationId configurado (hueco de datos) no escribe silenciosamente hacia CENTRAL", async () => {
  await conDirTemporal(async (dir) => {
    // Si por error un par quedara con locationId null (dato faltante, no un
    // bug de CENTRAL), ejecutarPar tiene que usar ese null explicito al
    // llamar a sus deps, nunca rellenarlo con el locationId de CENTRAL (ni
    // con ningun otro valor por default).
    const parRoto = { nombre: "roto", stateKey: "roto", depositoId: "1", locationId: null, pendiente: false };

    const llamadasSetearStock = [];
    const llamadasResolverSku = [];
    const deps = {
      cargarLibretaCompleta: (ruta) => cargarLibretaCompleta(ruta),
      guardarSnapshot: (snap, ruta, contabilium) => guardarSnapshot(snap, ruta, contabilium),
      rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey, dir),
      getStockDeposito: async () => mapa({ X: 1 }),
      resolverSku: async (sku, locationId) => {
        llamadasResolverSku.push(locationId);
        return { inventoryItemId: `inv-${locationId}-${sku}`, available: 5 }; // hay delta
      },
      setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
        llamadasSetearStock.push({ inventoryItemId, quantity, locationId });
      },
    };

    await ejecutarPar(parRoto, deps);

    for (const locationId of llamadasResolverSku) {
      assert.equal(locationId, null);
      assert.notEqual(locationId, LOCATION_CENTRAL_HIPOTETICA);
    }
    for (const llamada of llamadasSetearStock) {
      assert.equal(llamada.locationId, null);
      assert.notEqual(llamada.locationId, LOCATION_CENTRAL_HIPOTETICA);
    }
  });
});
