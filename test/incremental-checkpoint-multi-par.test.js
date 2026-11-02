// R-12 / CA-13 — el loop multi-par saltea SKUs sin cambio (salvo
// reconciliacion completa explicita) y persiste el progreso periodicamente,
// no solo al final.
//
// INTERFAZ ASUMIDA (no existe hoy; ver
// aceptacion/deltas-dot-mas-isla-galerias/DISENO-INTERFAZ.md, "Ronda 3",
// seccion R-12/CA-13):
//
//   ejecutarPar(par, deps, { full = false, checkpointCada = CHECKPOINT_CADA } = {})
//     - full=false (default): un SKU cuyo valor en stock coincide con el de
//       la libreta previa de ESTE par se saltea SIN llamar deps.resolverSku
//       (contadores.saltado++).
//     - full=true: ignora la libreta previa y reconsulta todos los SKUs.
//     - deps.guardarSnapshot se llama cada `checkpointCada` SKUs procesados
//       (los NO salteados), ademas del guardado final -- no en su lugar.
//
// HALLAZGO que motiva este test (revisor-codigo): ejecutarPar hoy no tiene
// ni el atajo incremental ni el checkpointing que si tiene syncTodos (el
// camino legado, src/sync.js:322-326 y 349-352): siempre reconsulta todo y
// guarda la libreta una sola vez, al final. Este archivo falla hoy porque
// ejecutarPar no acepta un tercer parametro de opciones ni ignora los SKUs
// sin cambio.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { construirPares } from "../src/pares.js";
import { ejecutarPar, cargarLibretaCompleta, guardarSnapshot, rutaSnapshotPara } from "../src/sync.js";
// Helpers del diseño B (registro de comprobantes), solo para los casos (e).
import * as H from "./_helpers-clasificador.js";

function conDirTemporal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "incremental-checkpoint-multi-par-"));
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

function depsFake({ dir, stockPorDeposito, shopifyPorLocation, llamadas }) {
  return {
    cargarLibretaCompleta: (ruta) => cargarLibretaCompleta(ruta),
    guardarSnapshot: (snap, ruta, contabilium) => {
      // Copia defensiva: el `for` de ejecutarPar sigue mutando el mismo
      // objeto `snapshotNuevo` despues de esta llamada, asi que si
      // guardaramos la referencia todas las entradas de llamadas.guardarSnapshot
      // quedarian con el contenido FINAL (el bug que el hallazgo de
      // revisor-alcance senala: un conteo puede pasar sin que el contenido
      // intermedio sea real). { ...snap } es suficiente porque los valores
      // son numeros (primitivos), no hace falta deep clone.
      llamadas.guardarSnapshot.push({ ruta, cantidad: Object.keys(snap).length, snap: { ...snap } });
      return guardarSnapshot(snap, ruta, contabilium);
    },
    rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey, dir),
    esDryRun: () => false,

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
      const porSku = shopifyPorLocation.get(locationId);
      for (const [sku, inv] of porSku ?? []) {
        if (`inv-${locationId}-${sku}` === inventoryItemId) porSku.set(sku, quantity);
      }
    },
  };
}

// -----------------------------------------------------------------------------
// (a) un SKU sin cambio respecto de la libreta previa se saltea SIN tocar
// Shopify: ni siquiera se le llama resolverSku.
// -----------------------------------------------------------------------------

test("un SKU sin cambio desde la libreta previa se saltea sin llamar resolverSku", async () => {
  await conDirTemporal(async (dir) => {
    const [dot] = construirPares(ENV_DOS_PARES_ACTIVOS);
    const rutaDot = rutaSnapshotPara(dot.stateKey, dir);

    // Libreta previa: "SIN-CAMBIO" ya estaba en 5 la corrida anterior
    // (Contabilium decia 5 y quedo marcado como resuelto).
    guardarSnapshot({ "SIN-CAMBIO": 5 }, rutaDot, new Map([["SIN-CAMBIO", 5]]));

    const llamadas = { getStockDeposito: [], resolverSku: [], setearStock: [], guardarSnapshot: [] };
    const deps = depsFake({
      dir,
      stockPorDeposito: new Map([
        // Contabilium AHORA sigue diciendo lo mismo para "SIN-CAMBIO", y
        // ademas trae un SKU nuevo que si cambio.
        [dot.depositoId, new Map([["SIN-CAMBIO", 5], ["CON-CAMBIO", 8]])],
      ]),
      shopifyPorLocation: new Map([
        [dot.locationId, new Map([["SIN-CAMBIO", 5], ["CON-CAMBIO", 2]])],
      ]),
      llamadas,
    });

    const resultado = await ejecutarPar(dot, deps);

    const skusConsultados = llamadas.resolverSku.map((l) => l.sku);
    assert.ok(!skusConsultados.includes("SIN-CAMBIO"), "el SKU sin cambio nunca llega a resolverSku");
    assert.ok(skusConsultados.includes("CON-CAMBIO"), "el SKU que si cambio si se consulta");
    assert.equal(resultado.saltado, 1);
  });
});

// -----------------------------------------------------------------------------
// (b) full=true ignora el atajo y reconsulta todo, aunque la libreta diga
// que no cambio nada.
// -----------------------------------------------------------------------------

test("con full:true, se reconsultan todos los SKUs aunque la libreta diga que no cambiaron", async () => {
  await conDirTemporal(async (dir) => {
    const [dot] = construirPares(ENV_DOS_PARES_ACTIVOS);
    const rutaDot = rutaSnapshotPara(dot.stateKey, dir);

    guardarSnapshot({ "SIN-CAMBIO": 5 }, rutaDot, new Map([["SIN-CAMBIO", 5]]));

    const llamadas = { getStockDeposito: [], resolverSku: [], setearStock: [], guardarSnapshot: [] };
    const deps = depsFake({
      dir,
      stockPorDeposito: new Map([[dot.depositoId, new Map([["SIN-CAMBIO", 5]])]]),
      shopifyPorLocation: new Map([[dot.locationId, new Map([["SIN-CAMBIO", 5]])]]),
      llamadas,
    });

    const resultado = await ejecutarPar(dot, deps, { full: true });

    const skusConsultados = llamadas.resolverSku.map((l) => l.sku);
    assert.ok(skusConsultados.includes("SIN-CAMBIO"), "con full:true, se reconsulta igual");
    assert.equal(resultado.saltado, 0, "en modo full no hay atajo incremental: nada se cuenta como salteado");
  });
});

// -----------------------------------------------------------------------------
// (c) checkpoint periodico: con varios SKUs que cambian y un checkpointCada
// chico, guardarSnapshot se llama mas de una vez durante la corrida de UN
// mismo par, no solo al final.
// -----------------------------------------------------------------------------

test("con checkpointCada chico, la libreta se persiste mas de una vez durante la corrida de un par", async () => {
  await conDirTemporal(async (dir) => {
    const [dot] = construirPares(ENV_DOS_PARES_ACTIVOS);

    // 5 SKUs, todos con delta real: ninguno se saltea.
    const stockContabilium = new Map([
      ["SKU-1", 1], ["SKU-2", 2], ["SKU-3", 3], ["SKU-4", 4], ["SKU-5", 5],
    ]);
    const stockShopify = new Map([
      ["SKU-1", 0], ["SKU-2", 0], ["SKU-3", 0], ["SKU-4", 0], ["SKU-5", 0],
    ]);

    const llamadas = { getStockDeposito: [], resolverSku: [], setearStock: [], guardarSnapshot: [] };
    const deps = depsFake({
      dir,
      stockPorDeposito: new Map([[dot.depositoId, stockContabilium]]),
      shopifyPorLocation: new Map([[dot.locationId, stockShopify]]),
      llamadas,
    });

    const resultado = await ejecutarPar(dot, deps, { checkpointCada: 2 });

    // 5 SKUs procesados, checkpoint cada 2: checkpoints a mitad de camino
    // (en 2 y en 4) MAS el guardado final -- nunca una sola llamada.
    assert.ok(
      llamadas.guardarSnapshot.length > 1,
      `esperaba mas de un guardarSnapshot durante la corrida, hubo ${llamadas.guardarSnapshot.length}`
    );

    // --- Lo que el conteo solo no puede probar (hallazgo de revisor-alcance) ---
    // La PRIMERA llamada intermedia (antes de que termine el for) tiene que
    // tener contenido real: ni vacia, ni con el snapshot final adelantado, ni
    // con SKUs ajenos.
    const intermedia = llamadas.guardarSnapshot[0];
    const final = llamadas.guardarSnapshot[llamadas.guardarSnapshot.length - 1];

    assert.notEqual(llamadas.guardarSnapshot.length, 0, "tiene que haber al menos una llamada");
    assert.ok(
      Object.keys(intermedia.snap).length > 0,
      "la llamada intermedia no puede estar vacia"
    );
    assert.ok(
      Object.keys(intermedia.snap).length < Object.keys(final.snap).length,
      "la llamada intermedia tiene que tener MENOS SKUs que la final -- si tuviera " +
        "los mismos, el snapshot final estaria adelantado en vez de ser progreso parcial real"
    );
    // Con checkpointCada=2, la primera llamada intermedia ocurre justo
    // despues de procesar SKU-1 y SKU-2 (los dos primeros del stock,
    // Map preserva orden de inserciòn): exactamente esos dos, con sus
    // valores de Contabilium (1 y 2), ni un valor de otro SKU ni del otro par.
    assert.deepEqual(
      intermedia.snap,
      { "SKU-1": 1, "SKU-2": 2 },
      "la llamada intermedia tiene que tener exactamente los SKUs procesados hasta ese punto, con sus valores correctos"
    );
    assert.deepEqual(
      final.snap,
      { "SKU-1": 1, "SKU-2": 2, "SKU-3": 3, "SKU-4": 4, "SKU-5": 5 },
      "la llamada final si tiene que tener los 5 SKUs"
    );
    assert.equal(resultado.actualizado, 5);
  });
});

// -----------------------------------------------------------------------------
// (c-bis) interrupcion real: si el checkpoint mismo falla a mitad de camino,
// lo ya procesado antes del corte queda persistido en disco de verdad -- no
// solo en el spy en memoria. Mismo patron de archivo real que
// test/libreta-multi-location.test.js y test/orquestacion-pares.test.js.
// -----------------------------------------------------------------------------

test("si el checkpoint periodico mismo falla a mitad de camino, lo persistido en el checkpoint ANTERIOR sigue en disco de verdad", async () => {
  await conDirTemporal(async (dir) => {
    const [dot] = construirPares(ENV_DOS_PARES_ACTIVOS);
    const rutaDot = rutaSnapshotPara(dot.stateKey, dir);

    const stockContabilium = new Map([
      ["SKU-1", 1], ["SKU-2", 2], ["SKU-3", 3], ["SKU-4", 4], ["SKU-5", 5],
    ]);
    const stockShopify = new Map([
      ["SKU-1", 0], ["SKU-2", 0], ["SKU-3", 0], ["SKU-4", 0], ["SKU-5", 0],
    ]);

    // resolverSku/setearStock nunca fallan: el fallo real que corta la
    // corrida (ejemplos reales: disco lleno, ENOSPC, permiso de .cache/)
    // esta en la ESCRITURA del checkpoint mismo, igual que el código real de
    // guardarSnapshot (mkdirSync + writeFileSync, src/sync.js:102-108) hace
    // IO real que puede fallar. El primer checkpoint (en SKU-2) escribe
    // real a disco; el segundo (en SKU-4) explota ANTES de escribir --
    // ejecutarPar no envuelve esa llamada en try/catch (mismo patron no
    // defensivo que ya tiene syncTodos, src/sync.js:349-352), asi que la
    // excepcion se propaga sin tragarse.
    let llamadasCheckpoint = 0;
    const deps = {
      cargarLibretaCompleta: (ruta) => cargarLibretaCompleta(ruta),
      guardarSnapshot: (snap, ruta, contabilium) => {
        llamadasCheckpoint++;
        if (llamadasCheckpoint === 2) {
          throw new Error("ENOSPC simulado: fallo real de IO al escribir el segundo checkpoint");
        }
        return guardarSnapshot(snap, ruta, contabilium); // escritura REAL a disco
      },
      rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey, dir),
      esDryRun: () => false,

      getStockDeposito: async () => stockContabilium,
      resolverSku: async (sku) => ({ inventoryItemId: `inv-${sku}`, available: stockShopify.get(sku) }),
      setearStock: async () => {},
    };

    await assert.rejects(
      () => ejecutarPar(dot, deps, { checkpointCada: 2 }),
      /ENOSPC simulado/,
      "el fallo de IO del segundo checkpoint tiene que propagarse, no tragarse en silencio"
    );

    // Leemos el archivo REAL, no el spy ni el objeto en memoria: el primer
    // checkpoint (SKU-1, SKU-2) tiene que seguir en disco aunque la corrida
    // haya terminado explotando antes del segundo.
    const libretaEnDisco = cargarLibretaCompleta(rutaDot);
    assert.deepEqual(
      libretaEnDisco.skus,
      { "SKU-1": 1, "SKU-2": 2 },
      "el progreso del primer checkpoint tiene que quedar persistido en disco de verdad, aunque el segundo haya fallado"
    );
    assert.equal(
      libretaEnDisco.skus["SKU-3"],
      undefined,
      "lo procesado despues del ultimo checkpoint exitoso (SKU-3, SKU-4) no llego a persistirse: se reintenta en la proxima pasada (R-7)"
    );
  });
});

// -----------------------------------------------------------------------------
// (c-ter) R-12/CA-13 — veredicto del juez (2026-10-29), ver
// aceptacion/deltas-dot-mas-isla-galerias/rojo-2026-10-29.md, "Veredicto del
// juez sobre el cierre": el baseline de `contabilium` que persiste el
// checkpoint tiene que tener EXACTAMENTE los SKUs procesados hasta el corte,
// nunca el stock COMPLETO de Contabilium (que incluiria SKUs que el loop
// todavia no alcanzo). Si el checkpoint guardara el stock completo como
// baseline, la corrida siguiente veria esos SKU pendientes con delta 0 y los
// marcaria resueltos sin haberse escrito nunca: el trabajo pendiente se
// perderia para siempre. Distinto del caso (c-bis): ese verificaba el
// contenido de `skus`, este verifica especificamente `contabilium`.
// -----------------------------------------------------------------------------

test("el baseline de contabilium del checkpoint nunca incluye SKUs que el loop todavia no alcanzo", async () => {
  await conDirTemporal(async (dir) => {
    const [dot] = construirPares(ENV_DOS_PARES_ACTIVOS);
    const rutaDot = rutaSnapshotPara(dot.stateKey, dir);

    const stockContabilium = new Map([
      ["SKU-1", 1], ["SKU-2", 2], ["SKU-3", 3], ["SKU-4", 4], ["SKU-5", 5],
    ]);
    const stockShopify = new Map([
      ["SKU-1", 0], ["SKU-2", 0], ["SKU-3", 0], ["SKU-4", 0], ["SKU-5", 0],
    ]);

    // Mismo patron que el caso (c-bis): el SEGUNDO checkpoint explota antes
    // de escribir, asi que solo el primero (procesado hasta SKU-2) llega a
    // disco de verdad.
    let llamadasCheckpoint = 0;
    const deps = {
      cargarLibretaCompleta: (ruta) => cargarLibretaCompleta(ruta),
      guardarSnapshot: (snap, ruta, contabilium) => {
        llamadasCheckpoint++;
        if (llamadasCheckpoint === 2) {
          throw new Error("ENOSPC simulado: fallo real de IO al escribir el segundo checkpoint");
        }
        return guardarSnapshot(snap, ruta, contabilium); // escritura REAL a disco
      },
      rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey, dir),
      esDryRun: () => false,

      getStockDeposito: async () => stockContabilium,
      resolverSku: async (sku) => ({ inventoryItemId: `inv-${sku}`, available: stockShopify.get(sku) }),
      setearStock: async () => {},
    };

    await assert.rejects(
      () => ejecutarPar(dot, deps, { checkpointCada: 2 }),
      /ENOSPC simulado/,
      "el fallo de IO del segundo checkpoint tiene que propagarse, no tragarse en silencio"
    );

    // Leemos el archivo REAL, no el spy en memoria.
    const libretaEnDisco = cargarLibretaCompleta(rutaDot);
    assert.deepEqual(
      libretaEnDisco.contabilium,
      { "SKU-1": 1, "SKU-2": 2 },
      "el baseline de contabilium del checkpoint tiene que tener EXACTAMENTE los SKUs " +
        "procesados hasta el corte, nunca el stock completo de Contabilium (5 SKUs)"
    );
    for (const skuPendiente of ["SKU-3", "SKU-4", "SKU-5"]) {
      assert.equal(
        libretaEnDisco.contabilium?.[skuPendiente],
        undefined,
        `${skuPendiente} todavia no se habia procesado cuando se corto: su baseline de ` +
          `contabilium no puede existir, o la proxima corrida lo veria con delta 0 y lo ` +
          `marcaria resuelto sin escribirlo nunca (R-12)`
      );
    }
  });
});

// -----------------------------------------------------------------------------
// (d) el checkpoint periodico tambien corre de forma independiente por par:
// el contador de un par no se mezcla con el del otro.
// -----------------------------------------------------------------------------

test("el checkpoint de un par no se ve afectado por cuantos SKUs proceso el otro par", async () => {
  await conDirTemporal(async (dir) => {
    const [dot, isla] = construirPares(ENV_DOS_PARES_ACTIVOS);

    const llamadas = { getStockDeposito: [], resolverSku: [], setearStock: [], guardarSnapshot: [] };
    const deps = depsFake({
      dir,
      stockPorDeposito: new Map([
        [dot.depositoId, new Map([["SKU-1", 1], ["SKU-2", 2]])],
        [isla.depositoId, new Map([["SKU-A", 1]])],
      ]),
      shopifyPorLocation: new Map([
        [dot.locationId, new Map([["SKU-1", 0], ["SKU-2", 0]])],
        [isla.locationId, new Map([["SKU-A", 0]])],
      ]),
      llamadas,
    });

    await ejecutarPar(dot, deps, { checkpointCada: 2 });
    const guardadosTrasDot = llamadas.guardarSnapshot.length;

    await ejecutarPar(isla, deps, { checkpointCada: 2 });

    const rutasUsadas = llamadas.guardarSnapshot.slice(guardadosTrasDot).map((g) => g.ruta);
    assert.ok(
      rutasUsadas.every((r) => r === rutaSnapshotPara(isla.stateKey, dir)),
      "los checkpoints de la isla solo tocan la ruta de la isla, nunca la del DOT"
    );
  });
});

// -----------------------------------------------------------------------------
// (e) REEMPLAZO AUTORIZADO (R-14, decision D-7 de la persona, 02/11/2026:
// "Sí, retiralos (Recommended)"). Aca habia dos casos sobre
// `ultimaCorridaExitosa`, el campo de la ventana temporal que el diseño B
// retira. La PROPIEDAD que protegian sigue valiendo y se prueba ahora sobre lo
// que la reemplaza, los CONSUMOS del registro: el checkpoint intermedio no
// puede borrar estado ya persistido de corridas anteriores, ni adelantar el de
// SKUs que el loop todavia no alcanzo. Si borrara un consumo viejo, ese credito
// se volveria a acreditar (Shopify arriba: sobreventa); si adelantara uno de un
// SKU no procesado, ese credito se perderia (doble descuento).
//
// Interfaz: aceptacion/clasificador-causa-comprobante/DISENO-INTERFAZ.md (4 y 5).
// Se leen los archivos REALES del directorio temporal.
// -----------------------------------------------------------------------------

const CONSUMO_VIEJO = {
  "111:SKU-VIEJO": { cantidad: 1, motivo: "delta", referencia: "2026-08-10T12:00:00.000Z", en: "2026-08-10T12:30:00.000Z" },
};

// 5 SKUs con delta -1 y una venta Shopify de 1 u. cada uno, ya registrada.
function sembrarCincoConCredito(dir) {
  const T = "2026-08-12T16:00:00.000Z";
  const hace1h = "2026-08-12T15:00:00.000Z";
  const skus = ["SKU-1", "SKU-2", "SKU-3", "SKU-4", "SKU-5"];
  H.sembrarLibreta(dir, "dot", {
    skus: Object.fromEntries(skus.map((s) => [s, 10])),
    contabilium: Object.fromEntries(skus.map((s) => [s, 10])),
    corte: "2026-08-01T00:00:00.000Z",
    consumos: CONSUMO_VIEJO,
  });
  H.sembrarRegistro(dir, {
    ultimoRefrescoOk: "2026-08-12T14:00:00.000Z",
    comprobantes: skus.map((s, i) => H.entradaShopify({ id: 200 + i, sku: s, referencia: hace1h })),
  });
  return {
    T,
    stock: new Map([[H.DEPOSITO_DOT, new Map(skus.map((s) => [s, 9]))]]),
    shopify: new Map([[H.LOCATION_DOT, new Map(skus.map((s) => [s, 9]))]]),
    search: skus.map((_, i) => H.resumenSearch(200 + i)),
  };
}

test("(R-14, reemplaza ultimaCorridaExitosa) un checkpoint intermedio conserva los consumos VIEJOS y no adelanta los de SKUs no procesados", async () => {
  await H.conDirTemporal(async (dir) => {
    const esc = sembrarCincoConCredito(dir);
    let enPrimerCheckpoint = null;
    let guardados = 0;
    const deps = H.depsFake({
      dir,
      reloj: H.reloj(esc.T),
      stock: esc.stock,
      shopify: esc.shopify,
      search: esc.search,
      guardarSnapshotEnvoltorio: (real) => (...args) => {
        guardados++;
        const v = real(...args);
        if (guardados === 1) enPrimerCheckpoint = H.leerLibretaCruda(dir, "dot");
        return v;
      },
    });

    await ejecutarPar(H.PAR_DOT, deps, { checkpointCada: 2 });

    assert.ok(guardados > 1, "al menos un checkpoint intermedio ademas del final");
    assert.ok(enPrimerCheckpoint, "el primer checkpoint ocurrio durante la corrida");
    assert.deepEqual(
      enPrimerCheckpoint.consumos?.["111:SKU-VIEJO"],
      CONSUMO_VIEJO["111:SKU-VIEJO"],
      "en el checkpoint intermedio el consumo de la corrida anterior sigue en disco, intacto"
    );
    assert.deepEqual(
      Object.keys(enPrimerCheckpoint.consumos).sort(),
      ["111:SKU-VIEJO", "200:SKU-1", "201:SKU-2"],
      "solo los consumos de SKU-1 y SKU-2 (procesados antes del checkpoint), ninguno adelantado"
    );

    // El guardado final si tiene todos.
    const final = H.leerLibretaCruda(dir, "dot");
    assert.deepEqual(
      Object.keys(final.consumos).sort(),
      ["111:SKU-VIEJO", "200:SKU-1", "201:SKU-2", "202:SKU-3", "203:SKU-4", "204:SKU-5"]
    );
  });
});

test("(R-14, reemplaza ultimaCorridaExitosa) si el checkpoint intermedio es el ultimo que llega a disco antes de una interrupcion, los consumos viejos siguen intactos en disco", async () => {
  await H.conDirTemporal(async (dir) => {
    const esc = sembrarCincoConCredito(dir);
    let guardados = 0;
    const deps = H.depsFake({
      dir,
      reloj: H.reloj(esc.T),
      stock: esc.stock,
      shopify: esc.shopify,
      search: esc.search,
      // Mismo patron que el caso (c-bis): el SEGUNDO checkpoint explota ANTES de
      // escribir; el fallo real de IO se propaga, no se traga.
      guardarSnapshotEnvoltorio: (real) => (...args) => {
        guardados++;
        if (guardados === 2) throw new Error("ENOSPC simulado: fallo real de IO al escribir el segundo checkpoint");
        return real(...args);
      },
    });

    await assert.rejects(
      () => ejecutarPar(H.PAR_DOT, deps, { checkpointCada: 2 }),
      /ENOSPC simulado/,
      "el fallo de IO del segundo checkpoint tiene que propagarse, no tragarse en silencio"
    );

    // Archivo REAL en disco despues de la interrupcion.
    const libreta = H.leerLibretaCruda(dir, "dot");
    assert.deepEqual(
      libreta.consumos?.["111:SKU-VIEJO"],
      CONSUMO_VIEJO["111:SKU-VIEJO"],
      "el consumo de la corrida anterior sigue intacto: no lo borro el checkpoint parcial"
    );
    assert.deepEqual(Object.keys(libreta.consumos).sort(), ["111:SKU-VIEJO", "200:SKU-1", "201:SKU-2"]);
    assert.equal(libreta.contabilium["SKU-3"], 10, "SKU-3 no llego a disco: ni baseline...");
    assert.equal(libreta.consumos["202:SKU-3"], undefined, "...ni consumo");
  });
});
