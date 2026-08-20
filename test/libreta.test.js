// Regresion de H5: la "libreta" incremental se envenenaba y nunca reintentaba.
//
// Hasta v1 se anotaban como resueltos los SKUs 'no_encontrado' y 'no_activado'.
// Como el incremental saltea todo SKU cuyo valor de Contabilium no cambio, esos
// SKUs no se reintentaban NUNCA, aunque despues se creara el producto en
// Shopify. La corrida 31283400762 registro 80 SKUs asi. La unica forma de
// recuperarlos es descartar la libreta una vez, y eso es lo que decide el
// versionado `__v`.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parsearLibreta,
  parsearSnapshotContabilium,
  cargarSnapshot,
  cargarLibretaCompleta,
  guardarSnapshot,
  SNAPSHOT_VERSION,
} from "../src/sync.js";

// -----------------------------------------------------------------------------
// parsearLibreta — decision pura: usar la libreta o descartarla
// -----------------------------------------------------------------------------

test("la version vigente de la libreta es la 2 (H5)", () => {
  assert.equal(SNAPSHOT_VERSION, 2);
});

test("una libreta v2 con skus se usa tal cual", () => {
  const skus = { "IEY-103-NEGRO": 4, "FUNDA-MAGSAFE-MATE-IPHONE16": 0 };
  assert.deepEqual(parsearLibreta({ __v: 2, skus }), skus);
});

test("la libreta v1 (sin __v) se DESCARTA: es la envenenada por H5", () => {
  // Formato viejo: el mapa de SKUs estaba en la raiz, sin version.
  assert.equal(parsearLibreta({ "IEY-103-NEGRO": 4 }), null);
});

test("una __v: 1 explicita tambien se descarta", () => {
  assert.equal(parsearLibreta({ __v: 1, skus: { "IEY-103-NEGRO": 4 } }), null);
});

test("una version FUTURA tambien se descarta: solo se acepta la exacta", () => {
  assert.equal(parsearLibreta({ __v: 3, skus: { "IEY-103-NEGRO": 4 } }), null);
});

test("v2 sin el campo skus se descarta", () => {
  assert.equal(parsearLibreta({ __v: 2 }), null);
});

test("null y undefined no rompen: se descartan", () => {
  assert.equal(parsearLibreta(null), null);
  assert.equal(parsearLibreta(undefined), null);
});

test("una libreta v2 VACIA es valida y no se descarta", () => {
  // {} es distinto de "no hay libreta": significa que nada quedo confirmado.
  assert.deepEqual(parsearLibreta({ __v: 2, skus: {} }), {});
});

// -----------------------------------------------------------------------------
// cargarSnapshot / guardarSnapshot — la IO alrededor de esa decision
// -----------------------------------------------------------------------------

function conDirTemporal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "libreta-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("sin archivo devuelve libreta vacia, sin excepcion", () => {
  conDirTemporal((dir) => {
    assert.deepEqual(cargarSnapshot(join(dir, "no-existe.json")), {});
  });
});

test("un JSON corrupto no rompe la corrida: devuelve libreta vacia", () => {
  conDirTemporal((dir) => {
    const ruta = join(dir, "last-sync.json");
    writeFileSync(ruta, "{esto no es json", "utf-8");
    assert.deepEqual(cargarSnapshot(ruta), {});
  });
});

test("una libreta v1 en disco se descarta y se arranca vacia", () => {
  conDirTemporal((dir) => {
    const ruta = join(dir, "last-sync.json");
    writeFileSync(ruta, JSON.stringify({ "IEY-103-NEGRO": 4 }), "utf-8");
    assert.deepEqual(cargarSnapshot(ruta), {});
  });
});

test("H3: guardarSnapshot crea el directorio si no existe", () => {
  // Mismo bug que dejo 2.396 SKUs en error con el workflow en verde: en un
  // runner limpio .cache/ no existe y writeFileSync tira ENOENT.
  conDirTemporal((dir) => {
    const ruta = join(dir, "cache-inexistente", "last-sync.json");
    assert.equal(existsSync(join(dir, "cache-inexistente")), false);
    guardarSnapshot({ "IEY-103-NEGRO": 4 }, ruta);
    assert.equal(existsSync(ruta), true);
  });
});

test("guardarSnapshot escribe la version, no solo los skus", () => {
  conDirTemporal((dir) => {
    const ruta = join(dir, "last-sync.json");
    guardarSnapshot({ "IEY-103-NEGRO": 4 }, ruta);
    const crudo = JSON.parse(readFileSync(ruta, "utf-8"));
    assert.equal(crudo.__v, SNAPSHOT_VERSION);
    assert.deepEqual(crudo.skus, { "IEY-103-NEGRO": 4 });
  });
});

test("round-trip: lo que se guarda se vuelve a leer igual", () => {
  conDirTemporal((dir) => {
    const ruta = join(dir, "last-sync.json");
    const skus = {};
    for (let i = 0; i < 2562; i++) skus[`IEY-SKU-${i}`] = i % 7;
    guardarSnapshot(skus, ruta);
    const leido = cargarSnapshot(ruta);
    assert.equal(Object.keys(leido).length, 2562);
    assert.deepEqual(leido, skus);
  });
});

test("un checkpoint parcial se relee sin problema (corrida interrumpida)", () => {
  // El checkpoint persiste la libreta a mitad de corrida. La siguiente pasada
  // tiene que poder leerla y limitarse a re-verificar lo que falta.
  conDirTemporal((dir) => {
    const ruta = join(dir, "last-sync.json");
    guardarSnapshot({ "IEY-103-NEGRO": 4 }, ruta);
    assert.deepEqual(cargarSnapshot(ruta), { "IEY-103-NEGRO": 4 });
    guardarSnapshot({ "IEY-103-NEGRO": 4, "IEY-105-NEGRO": 2 }, ruta);
    assert.deepEqual(cargarSnapshot(ruta), { "IEY-103-NEGRO": 4, "IEY-105-NEGRO": 2 });
  });
});

// -----------------------------------------------------------------------------
// El snapshot de Contabilium que viaja en la libreta
// -----------------------------------------------------------------------------
// Es lo unico que permite detectar un SKU que DESAPARECE del deposito, porque el
// bucle del sync solo recorre lo que Contabilium devuelve hoy.

test("el snapshot de Contabilium se guarda y se relee", () => {
  conDirTemporal((dir) => {
    const ruta = join(dir, "last-sync.json");
    guardarSnapshot({ "A": 1 }, ruta, new Map([["A", 1], ["B", 0]]));
    const l = cargarLibretaCompleta(ruta);
    assert.deepEqual(l.skus, { "A": 1 });
    assert.deepEqual(l.contabilium, { "A": 1, "B": 0 });
  });
});

test("una libreta v2 SIN el campo nuevo sigue siendo valida", () => {
  // Compatibilidad hacia atras: la libreta que ya esta en el cache de Actions no
  // tiene `contabilium`. No puede invalidarse por eso — solo no compara todavia.
  conDirTemporal((dir) => {
    const ruta = join(dir, "last-sync.json");
    writeFileSync(ruta, JSON.stringify({ __v: SNAPSHOT_VERSION, skus: { "A": 1 } }), "utf-8");
    const l = cargarLibretaCompleta(ruta);
    assert.deepEqual(l.skus, { "A": 1 });
    assert.equal(l.contabilium, null);
  });
});

test("parsearSnapshotContabilium descarta las versiones que no son la vigente", () => {
  assert.deepEqual(parsearSnapshotContabilium({ __v: 2, contabilium: { "A": 1 } }), { "A": 1 });
  assert.equal(parsearSnapshotContabilium({ __v: 1, contabilium: { "A": 1 } }), null);
  assert.equal(parsearSnapshotContabilium({ __v: 2 }), null);
  assert.equal(parsearSnapshotContabilium(null), null);
});

test("sin snapshot de Contabilium no se persiste el campo (no ensucia la libreta)", () => {
  conDirTemporal((dir) => {
    const ruta = join(dir, "last-sync.json");
    guardarSnapshot({ "A": 1 }, ruta);
    const crudo = JSON.parse(readFileSync(ruta, "utf-8"));
    assert.ok(!("contabilium" in crudo));
  });
});

test("un archivo corrupto no rompe cargarLibretaCompleta", () => {
  conDirTemporal((dir) => {
    const ruta = join(dir, "last-sync.json");
    writeFileSync(ruta, "{roto", "utf-8");
    assert.deepEqual(cargarLibretaCompleta(ruta), { skus: {}, contabilium: null });
  });
});
