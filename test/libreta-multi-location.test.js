// R-3 / CA-3 — El estado persistido esta separado por location: la linea base
// de un par nunca se lee ni se pisa con la de otro, aun en la misma corrida.
//
// INTERFAZ ASUMIDA (no existe hoy; ver DISENO-INTERFAZ.md seccion 5):
//   rutaSnapshotPara(stateKey, dirCache) -> string (ruta de archivo)
//
// Hoy SNAPSHOT_PATH (src/sync.js:26) es UN SOLO archivo fijo
// (.cache/last-sync.json) para todo el proceso: dos pares corriendo en la
// misma invocacion compartirian el mismo archivo y se pisarian la libreta.
// Este archivo falla hoy porque rutaSnapshotPara no existe.
//
// Las funciones de IO (cargarLibretaCompleta/guardarSnapshot) YA aceptan una
// `ruta` explicita (ver test/libreta.test.js) -- lo que falta es que el loop
// de pares les pase una ruta DISTINTA por stateKey, que es lo que
// rutaSnapshotPara tiene que resolver.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { rutaSnapshotPara, cargarLibretaCompleta, guardarSnapshot } from "../src/sync.js";

function conDirTemporal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "libreta-multi-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("rutaSnapshotPara da una ruta distinta para cada stateKey", () => {
  conDirTemporal((dir) => {
    const rutaDot = rutaSnapshotPara("dot", dir);
    const rutaIsla = rutaSnapshotPara("galerias-pacifico", dir);
    assert.notEqual(rutaDot, rutaIsla);
    assert.match(rutaDot, /dot/);
    assert.match(rutaIsla, /galerias-pacifico/);
  });
});

test("dos pares corridos en la misma invocacion no pisan la libreta del otro", () => {
  conDirTemporal((dir) => {
    const rutaDot = rutaSnapshotPara("dot", dir);
    const rutaIsla = rutaSnapshotPara("galerias-pacifico", dir);

    // Baselines bien distintos a proposito, para el MISMO sku.
    guardarSnapshot({ "IEY-103-NEGRO": 10 }, rutaDot, new Map([["IEY-103-NEGRO", 10]]));
    guardarSnapshot({ "IEY-103-NEGRO": 3 }, rutaIsla, new Map([["IEY-103-NEGRO", 3]]));

    const libretaDot = cargarLibretaCompleta(rutaDot);
    const libretaIsla = cargarLibretaCompleta(rutaIsla);

    assert.equal(libretaDot.skus["IEY-103-NEGRO"], 10);
    assert.equal(libretaIsla.skus["IEY-103-NEGRO"], 3);
    assert.equal(libretaDot.contabilium["IEY-103-NEGRO"], 10);
    assert.equal(libretaIsla.contabilium["IEY-103-NEGRO"], 3);
  });
});

test("escribir la libreta de un par no crea ni toca el archivo del otro", () => {
  conDirTemporal((dir) => {
    const rutaDot = rutaSnapshotPara("dot", dir);
    const rutaIsla = rutaSnapshotPara("galerias-pacifico", dir);

    guardarSnapshot({ "A": 1 }, rutaDot, new Map([["A", 1]]));
    // La libreta de la isla todavia no existe: tiene que leerse vacia, no
    // heredar nada del DOT.
    const libretaIsla = cargarLibretaCompleta(rutaIsla);
    assert.deepEqual(libretaIsla.skus, {});
    assert.equal(libretaIsla.contabilium, null);
  });
});
