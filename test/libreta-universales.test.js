// libreta-universales.test.js
// -----------------------------------------------------------------------------
// T05 — forma de los campos opcionales de la libreta `pendientes` (R-10) y
// `escritos` (R-13). Solo la FORMA: leer, validar y no invalidar el resto. La
// logica de journaling-antes-de-escribir (CUANDO se persisten/borran durante
// una corrida real) es de T06/T07.
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca7-pendiente.md
// §9 (otras persistencias, libreta vieja, entrada mal formada) y
// escenarios-ca9-ventas-individuales.md paso 8 (escrito -3 y 2.5).
// -----------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cargarLibretaCompleta,
  guardarSnapshot,
  persistirPendienteUniversal,
  confirmarSkuUniversal,
  SNAPSHOT_VERSION,
} from "../src/sync.js";

import { SKU_5V, VARIANTES_5V } from "./_helpers-sku-universal.js";

function conDirTemporal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "libreta-universales-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function rutaLibreta(dir) {
  return join(dir, "last-sync.json");
}

function sembrarLibreta(dir, contenido) {
  writeFileSync(rutaLibreta(dir), JSON.stringify({ __v: SNAPSHOT_VERSION, skus: {}, ...contenido }), "utf-8");
}

function leerCrudo(dir) {
  return JSON.parse(readFileSync(rutaLibreta(dir), "utf-8"));
}

// Entrada pendiente valida de referencia: S0 de escenarios-ca7-pendiente.md
// (`nuevoValor 8`, `contabiliumObjetivo 13`, 5 variantes en `desde: 5`).
function entradaPendienteValida() {
  return {
    nuevoValor: 8,
    contabiliumObjetivo: 13,
    variantes: VARIANTES_5V.map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
  };
}

// -----------------------------------------------------------------------------
// parsearContabilidad / cargarLibretaCompleta — lectura como opcionales
// -----------------------------------------------------------------------------

test("una libreta v2 sin pendientes ni escritos sigue siendo valida (9b)", () => {
  conDirTemporal((dir) => {
    sembrarLibreta(dir, { contabilium: { [SKU_5V]: 10 } });
    const libreta = cargarLibretaCompleta(rutaLibreta(dir));
    assert.deepEqual(libreta.pendientes, {});
    assert.deepEqual(libreta.escritos, {});
  });
});

test("una libreta v2 con pendientes y escritos bien formados se lee tal cual", () => {
  conDirTemporal((dir) => {
    const entrada = entradaPendienteValida();
    sembrarLibreta(dir, { pendientes: { [SKU_5V]: entrada }, escritos: { "OTRO-SKU": 6 } });
    const libreta = cargarLibretaCompleta(rutaLibreta(dir));
    assert.deepEqual(libreta.pendientes, { [SKU_5V]: entrada });
    assert.deepEqual(libreta.escritos, { "OTRO-SKU": 6 });
  });
});

test("9c: una entrada pendiente sin la lista de variantes se descarta con [ERROR] y no invalida el resto", (t) => {
  conDirTemporal((dir) => {
    sembrarLibreta(dir, {
      pendientes: { [SKU_5V]: { nuevoValor: 8 } },
      contabilium: { [SKU_5V]: 10, "FUNDA-TEST-UNICA": 2 },
    });
    const errores = [];
    t.mock.method(console, "error", (msg) => errores.push(msg));
    const libreta = cargarLibretaCompleta(rutaLibreta(dir), { nombre: "dot" });
    assert.deepEqual(libreta.pendientes, {}, "la entrada mal formada se descarta");
    assert.equal(libreta.contabilium?.["FUNDA-TEST-UNICA"], 2, "el resto de la libreta no se invalida");
    assert.ok(
      errores.some((m) => m === `[ERROR] dot/${SKU_5V}: pendiente mal formado, se descarta`),
      "R-8: el [ERROR] lleva el prefijo <par>/<sku>"
    );
  });
});

// Paso 8 de escenarios-ca9-ventas-individuales.md: escrito -3 (8a) y 2.5 (8b).
for (const [nombre, valorInvalido] of [["negativo (-3, 8a)", -3], ["no entero (2.5, 8b)", 2.5]]) {
  test(`8: un escrito ${nombre} se descarta con [ERROR] y no invalida el resto`, (t) => {
    conDirTemporal((dir) => {
      sembrarLibreta(dir, {
        escritos: { [SKU_5V]: valorInvalido, "OTRO-SKU": 6 },
        contabilium: { [SKU_5V]: 10 },
      });
      const errores = [];
      t.mock.method(console, "error", (msg) => errores.push(msg));
      const libreta = cargarLibretaCompleta(rutaLibreta(dir), { nombre: "dot" });
      assert.equal(libreta.escritos?.[SKU_5V], undefined, "el valor mal formado se descarta");
      assert.equal(libreta.escritos?.["OTRO-SKU"], 6, "el resto de la libreta no se invalida");
      assert.ok(
        errores.some((m) => m === `[ERROR] dot/${SKU_5V}: escrito mal formado, se descarta`),
        "R-8: el [ERROR] lleva el prefijo <par>/<sku>"
      );
    });
  });
}

test("un escrito valido (0, borde) se acepta", () => {
  conDirTemporal((dir) => {
    sembrarLibreta(dir, { escritos: { [SKU_5V]: 0 } });
    const libreta = cargarLibretaCompleta(rutaLibreta(dir));
    assert.equal(libreta.escritos[SKU_5V], 0);
  });
});

// -----------------------------------------------------------------------------
// guardarSnapshot — ninguna otra persistencia pisa ni borra (9a)
// -----------------------------------------------------------------------------

test("9a: un checkpoint (guardarSnapshot de 3 argumentos) no borra el pendiente ni el escrito existentes", () => {
  conDirTemporal((dir) => {
    const entrada = entradaPendienteValida();
    sembrarLibreta(dir, {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      pendientes: { [SKU_5V]: entrada },
      escritos: { "FUNDA-TEST-UNICA": 2 },
    });

    // checkpoint tras otro SKU del par, sin mencionar pendientes/escritos.
    guardarSnapshot({ [SKU_5V]: 10, "FUNDA-TEST-UNICA": 2 }, rutaLibreta(dir), new Map([[SKU_5V, 10], ["FUNDA-TEST-UNICA", 3]]));

    const crudo = leerCrudo(dir);
    assert.deepEqual(crudo.pendientes, { [SKU_5V]: entrada }, "el pendiente se conserva sin cambios");
    assert.deepEqual(crudo.escritos, { "FUNDA-TEST-UNICA": 2 }, "el escrito se conserva sin cambios");
  });
});

test("una contabilidad explicita sin pendientes/escritos (undefined) tambien los conserva", () => {
  conDirTemporal((dir) => {
    const entrada = entradaPendienteValida();
    sembrarLibreta(dir, { pendientes: { [SKU_5V]: entrada }, escritos: { [SKU_5V]: 5 } });

    guardarSnapshot({ [SKU_5V]: 13 }, rutaLibreta(dir), new Map([[SKU_5V, 13]]), {
      corte: null,
      consumos: {},
      resembradoEn: {},
      resembradoPor: {},
      destinos: {},
      // pendientes/escritos ausentes de esta contabilidad: "no me pidieron tocarlos".
    });

    const crudo = leerCrudo(dir);
    assert.deepEqual(crudo.pendientes, { [SKU_5V]: entrada });
    assert.deepEqual(crudo.escritos, { [SKU_5V]: 5 });
  });
});

// -----------------------------------------------------------------------------
// persistirPendienteUniversal — persistencia inmediata (R-10)
// -----------------------------------------------------------------------------

test("persistirPendienteUniversal escribe la entrada ANTES de cualquier mutacion y conserva el resto de la libreta", () => {
  conDirTemporal((dir) => {
    sembrarLibreta(dir, { skus: { [SKU_5V]: 5 }, contabilium: { [SKU_5V]: 10 }, destinos: { [SKU_5V]: "gid://x/9010001" } });
    const entrada = entradaPendienteValida();
    persistirPendienteUniversal(SKU_5V, entrada, rutaLibreta(dir));

    const crudo = leerCrudo(dir);
    assert.deepEqual(crudo.pendientes, { [SKU_5V]: entrada });
    assert.equal(crudo.contabilium?.[SKU_5V], 10, "el baseline NO avanza todavia");
    assert.equal(crudo.destinos?.[SKU_5V], "gid://x/9010001", "el resto de la libreta se conserva");
  });
});

test("persistirPendienteUniversal lanza si la entrada esta mal formada, y no escribe nada", () => {
  conDirTemporal((dir) => {
    sembrarLibreta(dir, { contabilium: { [SKU_5V]: 10 } });
    assert.throws(() => persistirPendienteUniversal(SKU_5V, { nuevoValor: 8 }, rutaLibreta(dir)));
    const crudo = leerCrudo(dir);
    assert.equal(crudo.pendientes, undefined, "no quedo ninguna entrada pendiente");
  });
});

test("persistirPendienteUniversal lanza si la escritura en disco falla: el llamador se entera", () => {
  conDirTemporal((dir) => {
    // Ruta en un directorio que no existe y que no se puede crear (archivo en
    // vez de directorio) para forzar el fallo de IO.
    const rutaInvalida = join(dir, "no-es-un-directorio");
    writeFileSync(rutaInvalida, "no soy un directorio");
    const rutaRota = join(rutaInvalida, "last-sync.json");
    assert.throws(() => persistirPendienteUniversal(SKU_5V, entradaPendienteValida(), rutaRota));
  });
});

// -----------------------------------------------------------------------------
// confirmarSkuUniversal — UNA sola persistencia que borra, fija escrito y
// avanza baseline/destino (R-10, R-13)
// -----------------------------------------------------------------------------

test("confirmarSkuUniversal borra el pendiente, fija escrito y avanza baseline/destino en una sola escritura", () => {
  conDirTemporal((dir) => {
    const entrada = entradaPendienteValida();
    sembrarLibreta(dir, {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      destinos: { [SKU_5V]: "gid://x/9010001" },
      pendientes: { [SKU_5V]: entrada },
    });
    const libreta = cargarLibretaCompleta(rutaLibreta(dir));

    confirmarSkuUniversal({
      sku: SKU_5V,
      snap: { [SKU_5V]: 13 },
      contabilium: { [SKU_5V]: 13 },
      contabilidad: libreta,
      escrito: 8,
      destino: "gid://x/9010001",
      ruta: rutaLibreta(dir),
    });

    const crudo = leerCrudo(dir);
    assert.equal(crudo.pendientes?.[SKU_5V], undefined, "la entrada se borra");
    assert.equal(crudo.escritos?.[SKU_5V], 8);
    assert.equal(crudo.skus?.[SKU_5V], 13);
    assert.equal(crudo.contabilium?.[SKU_5V], 13);
    assert.equal(crudo.destinos?.[SKU_5V], "gid://x/9010001");
  });
});

test("confirmarSkuUniversal lanza con un escrito invalido y no persiste nada", () => {
  conDirTemporal((dir) => {
    sembrarLibreta(dir, { pendientes: { [SKU_5V]: entradaPendienteValida() } });
    const libreta = cargarLibretaCompleta(rutaLibreta(dir));
    assert.throws(() =>
      confirmarSkuUniversal({
        sku: SKU_5V,
        snap: { [SKU_5V]: 13 },
        contabilium: { [SKU_5V]: 13 },
        contabilidad: libreta,
        escrito: -1,
        ruta: rutaLibreta(dir),
      })
    );
    const crudo = leerCrudo(dir);
    assert.deepEqual(crudo.pendientes, { [SKU_5V]: entradaPendienteValida() }, "el pendiente sigue intacto");
  });
});
