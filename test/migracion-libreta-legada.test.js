// R-11 / CA-12 — el primer run del par DOT despues de este deploy usa como
// linea base la libreta LEGADA (.cache/last-sync.json), no una libreta
// vacia, via migracion explicita.
//
// INTERFAZ ASUMIDA (no existe hoy; ver
// aceptacion/deltas-dot-mas-isla-galerias/DISENO-INTERFAZ.md, "Ronda 3",
// seccion R-11/CA-12):
//
//   migrarLibretaLegada(rutaLegada, rutaNueva) en src/sync.js:
//     - rutaNueva ya existe -> no toca nada, devuelve false.
//     - rutaNueva no existe y rutaLegada tampoco -> no hace nada, false.
//     - rutaNueva no existe y rutaLegada si -> copia el contenido crudo,
//       devuelve true.
//
//   correrTodosLosPares(pares, deps) en src/sync.js: el loop de orquestacion
//   real (extraido de src/index.js, mismo patron que ya se uso para sacar
//   ejecutarPar de index.js). Para el par "dot" llama migrarLibretaLegada
//   ANTES de invocar ejecutarPar(dot, ...).
//
// HALLAZGO que motiva este test (revisor-codigo): rutaSnapshotPara("dot", ...)
// apunta a .cache/last-sync.dot.json, un archivo DISTINTO del legado
// SNAPSHOT_PATH (.cache/last-sync.json). Hoy no existe ningun codigo que
// migre o lea el legado como fallback: el primer deploy hace que el DOT
// arranque con libreta vacia y resiembre todo. Este archivo falla hoy
// porque migrarLibretaLegada no existe como export de src/sync.js.
//
// HALLAZGO que motiva el caso "de punta a punta" de mas abajo (revisor-alcance,
// sobre la Ronda 3 original de este archivo): los casos anteriores prueban
// migrarLibretaLegada aislada, y por separado ejecutarPar llamada A MANO
// despues de migrar a mano. Ninguno prueba que el ENTRYPOINT real
// (correrTodosLosPares, hoy local y no exportada dentro de src/index.js) de
// verdad llame a migrarLibretaLegada antes de ejecutarPar(dot, ...). Un
// implementador podia hacer pasar los casos de arriba sin tocar index.js en
// absoluto, reproduciendo el bug real de R-11 en produccion.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { construirPares } from "../src/pares.js";
import {
  ejecutarPar,
  correrTodosLosPares,
  migrarLibretaLegada,
  cargarLibretaCompleta,
  guardarSnapshot,
  rutaSnapshotPara,
} from "../src/sync.js";

function conDirTemporal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "migracion-libreta-legada-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------------
// Caso base: hay legado, no hay libreta nueva -> migra.
// -----------------------------------------------------------------------------

test("migrarLibretaLegada copia el legado cuando la libreta nueva todavia no existe", () => {
  conDirTemporal((dir) => {
    const rutaLegada = join(dir, "last-sync.json");
    const rutaNueva = rutaSnapshotPara("dot", dir);

    guardarSnapshot(
      { "IEY-103-NEGRO": 10, "IEY-200-BLANCO": 4 },
      rutaLegada,
      new Map([["IEY-103-NEGRO", 10], ["IEY-200-BLANCO", 4]])
    );
    assert.equal(existsSync(rutaNueva), false, "precondicion: todavia no hay libreta nueva");

    const migro = migrarLibretaLegada(rutaLegada, rutaNueva);

    assert.equal(migro, true);
    const libreta = cargarLibretaCompleta(rutaNueva);
    assert.equal(libreta.skus["IEY-103-NEGRO"], 10);
    assert.equal(libreta.skus["IEY-200-BLANCO"], 4);
    assert.equal(libreta.contabilium["IEY-103-NEGRO"], 10);
    assert.equal(libreta.contabilium["IEY-200-BLANCO"], 4);
  });
});

// -----------------------------------------------------------------------------
// Nunca pisa progreso que la libreta nueva ya tenga (idempotencia / seguridad).
// -----------------------------------------------------------------------------

test("migrarLibretaLegada no pisa la libreta nueva si ya tiene su propio progreso", () => {
  conDirTemporal((dir) => {
    const rutaLegada = join(dir, "last-sync.json");
    const rutaNueva = rutaSnapshotPara("dot", dir);

    guardarSnapshot({ "VIEJO": 1 }, rutaLegada, new Map([["VIEJO", 1]]));
    guardarSnapshot({ "NUEVO": 99 }, rutaNueva, new Map([["NUEVO", 99]]));

    const migro = migrarLibretaLegada(rutaLegada, rutaNueva);

    assert.equal(migro, false, "la libreta nueva ya existia: no se toca");
    const libreta = cargarLibretaCompleta(rutaNueva);
    assert.equal(libreta.skus["NUEVO"], 99, "el progreso propio del par DOT no se pierde");
    assert.equal(libreta.skus["VIEJO"], undefined, "el legado no se mezcla encima de un progreso ya existente");
  });
});

// -----------------------------------------------------------------------------
// Cuarto veredicto del juez (2026-10-29), CA-12:
//
//   "migrarLibretaLegada copia tal cual el campo `contabilium` legado [...]
//   incluidos los SKU no_encontrado, no_activado, error o ambiguo y los que
//   un checkpoint todavia no habia alcanzado. Despues de migrar, esos SKU
//   heredan como base un valor que nunca se escribio en Shopify [...] quedan
//   'sin_cambios' y se marcan resueltos sin escribirse."
//
// La señal de "nunca se escribio de verdad" ya existe en la libreta legada
// misma: un SKU resuelto y escrito tiene entrada en AMBOS campos (`skus` Y
// `contabilium`); un SKU no_encontrado/no_activado/error/ambiguo, o uno que
// un checkpoint todavia no habia alcanzado, solo puede tener entrada en
// `contabilium` (ver ejecutarPar / R-7, que ya es la regla para la libreta
// NUEVA: "un SKU no_activado no deja baseline de contabilium",
// test/orquestacion-pares.test.js). migrarLibretaLegada tiene que aplicar la
// MISMA regla al copiar el legado: un SKU con `contabilium` pero sin `skus`
// correspondiente se descarta, no se migra.
// -----------------------------------------------------------------------------

test("migrarLibretaLegada descarta el baseline de contabilium de un SKU que nunca se confirmo escrito (sin entrada en skus)", () => {
  conDirTemporal((dir) => {
    const rutaLegada = join(dir, "last-sync.json");
    const rutaNueva = rutaSnapshotPara("dot", dir);

    // "CONFIRMADO" tiene entrada en `skus` Y en `contabilium`: SI se migra.
    // "NUNCA-ESCRITO" tiene SOLO `contabilium` (el caso real: no_encontrado,
    // no_activado, error, ambiguo, o un SKU que un checkpoint todavia no
    // habia alcanzado) -- nunca se confirmo una escritura real en Shopify
    // para el: NO puede heredar ese baseline.
    guardarSnapshot(
      { "CONFIRMADO": 6 },
      rutaLegada,
      new Map([["CONFIRMADO", 10], ["NUNCA-ESCRITO", 10]])
    );

    const migro = migrarLibretaLegada(rutaLegada, rutaNueva);

    assert.equal(migro, true);
    const libreta = cargarLibretaCompleta(rutaNueva);

    assert.equal(libreta.skus["CONFIRMADO"], 6, "CONFIRMADO tenia entrada en skus: se migra normal");
    assert.equal(libreta.contabilium["CONFIRMADO"], 10, "CONFIRMADO tenia entrada en contabilium: se migra normal");

    assert.equal(
      libreta.contabilium["NUNCA-ESCRITO"],
      undefined,
      "sin entrada en skus, el legado nunca confirmo una escritura real para este SKU: " +
        "no puede heredar un baseline de contabilium que nunca se escribio en Shopify " +
        "(si se migrara, el SKU quedaria 'sin_cambios' y se marcaria resuelto sin escribirse jamas)"
    );
    assert.equal(libreta.skus["NUNCA-ESCRITO"], undefined, "tampoco tiene que aparecer en skus: no se inventa progreso");
  });
});

// -----------------------------------------------------------------------------
// Sin legado y sin libreta nueva: no-op, no explota.
// -----------------------------------------------------------------------------

test("migrarLibretaLegada es un no-op (sin error) si no hay legado ni libreta nueva", () => {
  conDirTemporal((dir) => {
    const rutaLegada = join(dir, "last-sync.json");
    const rutaNueva = rutaSnapshotPara("dot", dir);

    const migro = migrarLibretaLegada(rutaLegada, rutaNueva);

    assert.equal(migro, false);
    assert.equal(existsSync(rutaNueva), false);
  });
});

// -----------------------------------------------------------------------------
// Cadena completa: migrar y despues correr ejecutarPar usa el baseline
// migrado (nunca "sembrado" para un SKU que ya estaba en el legado).
// -----------------------------------------------------------------------------

test("tras migrar, ejecutarPar del DOT usa el baseline del legado para calcular el delta (R-1)", async () => {
  await conDirTemporal(async (dir) => {
    const rutaLegada = join(dir, "last-sync.json");

    // Legado: la ultima vez que corrio el DOT (pre-deploy), Contabilium decia 10.
    guardarSnapshot({ "IEY-103-NEGRO": 10 }, rutaLegada, new Map([["IEY-103-NEGRO", 10]]));

    const [dot] = construirPares({
      CONTABILIUM_DOT_DEPOSITO_ID: "127356",
      SHOPIFY_DOT_LOCATION_ID: "gid://shopify/Location/83342655574",
    });

    // Migracion explicita contra la ruta por-par real del DOT:
    const rutaPorPar = rutaSnapshotPara(dot.stateKey, dir);
    const migro = migrarLibretaLegada(rutaLegada, rutaPorPar);
    assert.equal(migro, true);

    const llamadas = { resolverSku: [], setearStock: [] };
    const deps = {
      getStockDeposito: async () => new Map([["IEY-103-NEGRO", 12]]), // Contabilium ahora dice 12 (subio 2)
      resolverSku: async (sku, locationId) => {
        llamadas.resolverSku.push({ sku, locationId });
        return { inventoryItemId: "inv-1", available: 8 }; // Shopify ya vendio online: bajo a 8
      },
      setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
        llamadas.setearStock.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      },
      cargarLibretaCompleta: (ruta) => cargarLibretaCompleta(ruta),
      guardarSnapshot: (snap, ruta, contabilium) => guardarSnapshot(snap, ruta, contabilium),
      rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey, dir),
      esDryRun: () => false,
    };

    await ejecutarPar(dot, deps);

    // delta = 12 - 10 = 2; nuevoValor = shopifyActual(8) + delta(2) = 10.
    // Si el baseline migrado NO se hubiera usado (sembrado:true), el codigo
    // habria escrito el absoluto de Contabilium (12), no el delta (10).
    assert.equal(llamadas.setearStock.length, 1);
    assert.equal(llamadas.setearStock[0].quantity, 10, "tiene que usar el delta contra el baseline migrado, no el absoluto");
  });
});

// -----------------------------------------------------------------------------
// Punta a punta (cierre del hueco de revisor-alcance en CA-12): el entrypoint
// real, correrTodosLosPares, tiene que migrar por si solo -- el test NUNCA
// llama migrarLibretaLegada a mano aca. Si correrTodosLosPares no existe
// como export de src/sync.js (porque el loop sigue viviendo solo en
// src/index.js), este test falla al importar el simbolo -- ese es,
// precisamente, el escenario que antes podia colar el bug de R-11 sin que
// ningun test lo notara.
// -----------------------------------------------------------------------------

test("correrTodosLosPares migra la libreta legada del DOT antes de la primera escritura, sin que el test llame migrarLibretaLegada", async () => {
  await conDirTemporal(async (dir) => {
    const rutaLegada = join(dir, "last-sync.json");

    // Legado real: la ultima vez que corrio el DOT (pre-deploy), Contabilium
    // decia 10 para este SKU. Nadie en este test invoca migrarLibretaLegada.
    guardarSnapshot({ "IEY-103-NEGRO": 10 }, rutaLegada, new Map([["IEY-103-NEGRO", 10]]));

    const pares = construirPares({
      CONTABILIUM_DOT_DEPOSITO_ID: "127356",
      SHOPIFY_DOT_LOCATION_ID: "gid://shopify/Location/83342655574",
      // Isla/Galerias queda pendiente: no tiene legado, no debe intentar migrar nada.
    });

    const llamadas = { resolverSku: [], setearStock: [] };
    const deps = {
      getStockDeposito: async () => new Map([["IEY-103-NEGRO", 12]]), // Contabilium ahora dice 12 (subio 2)
      resolverSku: async (sku, locationId) => {
        llamadas.resolverSku.push({ sku, locationId });
        return { inventoryItemId: "inv-1", available: 8 }; // Shopify ya vendio online: bajo a 8
      },
      setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
        llamadas.setearStock.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
      },
      cargarLibretaCompleta: (ruta) => cargarLibretaCompleta(ruta),
      guardarSnapshot: (snap, ruta, contabilium) => guardarSnapshot(snap, ruta, contabilium),
      rutaSnapshotPara: (stateKey) => rutaSnapshotPara(stateKey, dir),
      // deps.SNAPSHOT_PATH: aca es donde el test apunta la ruta legada a un
      // directorio temporal, en vez del .cache/last-sync.json real del repo.
      SNAPSHOT_PATH: rutaLegada,
      migrarLibretaLegada: (rutaLegadaReal, rutaNueva) => migrarLibretaLegada(rutaLegadaReal, rutaNueva),
      esDryRun: () => false,
    };

    // Espia sobre migrarLibretaLegada SOLO para contar cuantas veces se
    // invoco -- la asercion real de "si migro de verdad" es por efecto
    // (el baseline usado mas abajo), no por el mock.
    const migracionesLlamadas = [];
    const migrarOriginal = deps.migrarLibretaLegada;
    deps.migrarLibretaLegada = (rutaLegadaReal, rutaNueva) => {
      migracionesLlamadas.push({ rutaLegadaReal, rutaNueva });
      return migrarOriginal(rutaLegadaReal, rutaNueva);
    };

    const porPar = await correrTodosLosPares(pares, deps);

    // La migracion tiene que haber ocurrido (una sola vez, para "dot") ANTES
    // de que ejecutarPar escribiera nada -- lo confirmamos por el efecto, no
    // por el mock: si no hubiera migrado, el baseline seria null (sembrado) y
    // el valor escrito seria el absoluto de Contabilium (12), no el delta (10).
    assert.equal(migracionesLlamadas.length, 1, "correrTodosLosPares tiene que migrar exactamente una vez, para el par dot");
    assert.equal(llamadas.setearStock.length, 1);
    assert.equal(
      llamadas.setearStock[0].quantity,
      10,
      "sin llamar migrarLibretaLegada a mano, correrTodosLosPares ya tiene que haber migrado: " +
        "delta = 12 - 10 = 2; nuevoValor = shopifyActual(8) + delta(2) = 10. " +
        "Si no migro, el SKU se habria sembrado y el valor escrito habria sido el absoluto (12)."
    );
    assert.ok(porPar.dot, "correrTodosLosPares devuelve el resumen del par dot");
  });
});

// -----------------------------------------------------------------------------
// Fitness function (ultima ronda de arreglo de CA-12, confirmado por
// revisor-alcance con grep): el caso "de punta a punta" de mas arriba
// importa correrTodosLosPares DESDE src/sync.js y lo ejercita ahi. Eso deja
// un hueco que ningun test de comportamiento puede cerrar: un implementador
// puede agregar correrTodosLosPares a sync.js (dejando el caso de arriba en
// verde) SIN borrar la funcion local duplicada y no exportada que hoy vive
// en src/index.js (lineas 22-28), que es la que literalmente corre en
// produccion (src/index.js, linea 142: correrTodosLosPares().then(...)).
// Si esa duplicada sigue viva, la migracion de la libreta legada (R-11)
// nunca se ejecuta en produccion, aunque todos los tests de comportamiento
// de este archivo esten en verde.
//
// Por eso este test lee el TEXTO FUENTE de src/index.js con readFileSync, en
// vez de importar/ejecutar el modulo: ejecutar index.js dispara su modo real
// (parseo de argv, .env, cron, llamadas de red) segun argv/env reales del
// proceso que corre los tests, lo cual no es seguro ni determinista en un
// test. Es un chequeo estructural ("fitness function"), no de ejecucion:
// confirma que el entrypoint se CABLEO al sync.js nuevo, no que su
// comportamiento en runtime sea correcto (eso ya lo cubren los casos de
// arriba).
// -----------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const rutaIndex = join(__dirname, "..", "src", "index.js");

// Movido el 02/11/2026 por decision de la persona ("Mover el chequeo a main.js",
// R-14 de clasificador-causa-comprobante): desde esa feature el entrypoint es la
// cadena src/index.js -> src/main.js -> src/sync.js (index.js solo importa
// dotenv/config y { main }, ver test/index-argv.test.js, CA-13 ronda 4). La
// propiedad protegida es la MISMA (R-11 de docs/contratos/deltas-dot-mas-isla-
// galerias.md:120-122): lo que corre en produccion es el correrTodosLosPares de
// sync.js, que migra la libreta legada del DOT, y no una copia local. Se verifica
// cada eslabon, sin comentarios (un import comentado no cuenta).
test("src/index.js -> src/main.js -> src/sync.js: el entrypoint real usa el correrTodosLosPares de ./sync.js (no lo declara local)", () => {
  const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  // Nombres importados (sin alias) de `import { ... } from "<modulo>"`.
  const importadosSinAlias = (codigo, modulo) => {
    const esc = modulo.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const nombres = [];
    for (const m of codigo.matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${esc}["']`, "g"))) {
      for (const parte of m[1].split(",")) {
        const p = parte.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(p)) nombres.push(p); // `x as y` no cuenta
      }
    }
    return nombres;
  };

  const fuenteIndex = sinComentarios(readFileSync(rutaIndex, "utf-8"));
  const rutaMain = join(__dirname, "..", "src", "main.js");
  const fuenteMain = sinComentarios(readFileSync(rutaMain, "utf-8"));

  // Eslabon 1: index.js -> main.js
  assert.ok(
    importadosSinAlias(fuenteIndex, "./main.js").includes("main"),
    "src/index.js tiene que importar { main } desde \"./main.js\"; si el entrypoint no " +
      "pasa por main.js, nada garantiza que corra el correrTodosLosPares de sync.js, que " +
      "es el que migra la libreta legada del DOT (R-11)"
  );

  // Eslabon 2: main.js -> sync.js (sin alias: el nombre local ES el de sync.js)
  assert.ok(
    importadosSinAlias(fuenteMain, "./sync.js").includes("correrTodosLosPares"),
    "src/main.js tiene que importar { correrTodosLosPares } desde \"./sync.js\"; " +
      "si no lo importa de ahi, el entrypoint real puede seguir corriendo una copia " +
      "local que nunca migra la libreta legada del DOT (R-11)"
  );

  // Eslabon 3: main.js no tiene su propia copia (ni la pisa)
  const declaraciones = [
    [/\bfunction\s*\*?\s*correrTodosLosPares\s*\(/, "function correrTodosLosPares(...)"],
    [/\b(?:const|let|var)\s+correrTodosLosPares\b/, "const/let/var correrTodosLosPares"],
    [/\b(?:const|let|var)\s*[{[][^=]*\bcorrerTodosLosPares\b[^=]*[}\]]\s*=/, "una desestructuracion que declara correrTodosLosPares"],
    [/\bclass\s+correrTodosLosPares\b/, "class correrTodosLosPares"],
    [/(?<![\w$.])correrTodosLosPares\s*(?:=(?![=>])|\|\|=|&&=|\?\?=)/, "una asignacion a correrTodosLosPares"],
  ];
  for (const [re, que] of declaraciones) {
    assert.doesNotMatch(
      fuenteMain,
      re,
      `src/main.js no puede declarar ${que} local: esa copia seria la que corre en ` +
        "produccion y nunca migraria la libreta legada del DOT (R-11), aunque sync.js " +
        "SI exporte su propia version"
    );
  }

  // Eslabon 4 (ronda 5b, nota 7 de revisor-alcance): los eslabones 2 y 3 se
  // cumplian con una copia local con OTRO nombre usada como respaldo
  // (`deps.correrTodosLosPares ?? correrPares`). No se fija un estilo de
  // cableado; se exigen tres cosas que cualquier cableado correcto cumple:
  //   4a. el correrTodosLosPares importado se usa como VALOR fuera del import
  //       (no solo `deps.correrTodosLosPares` ni la clave `correrTodosLosPares:`):
  //       un import muerto no cablea nada;
  //   4b. si main.js tiene un respaldo `deps.correrTodosLosPares ?? X` / `|| X`, o
  //       una desestructuracion `correrTodosLosPares: y = X`, X es el importado;
  //   4c. main.js no menciona ejecutarPar ni migrarLibretaLegada: toda copia del
  //       orquestador, con cualquier nombre, necesita al menos uno de los dos, y
  //       main.js no tiene por que usarlos (DISENO-INTERFAZ 7.1).
  const sinImports = fuenteMain.replace(/^\s*import\s[\s\S]*?from\s*["'][^"']+["']\s*;?/gm, "");
  assert.match(
    sinImports,
    /(?<![\w$."'`])correrTodosLosPares(?![\w$])(?!\s*:)/,
    "src/main.js tiene que usar como valor el correrTodosLosPares importado de ./sync.js " +
      "(por ejemplo como respaldo de deps.correrTodosLosPares); si solo lo importa, lo que " +
      "corre en produccion es otra cosa (R-11)"
  );
  const respaldos = [
    ...fuenteMain.matchAll(/deps\s*\.\s*correrTodosLosPares\s*(?:\?\?|\|\|)\s*([A-Za-z_$][\w$]*)/g),
    ...fuenteMain.matchAll(/\bcorrerTodosLosPares\s*:\s*[A-Za-z_$][\w$]*\s*=(?![=>])\s*([A-Za-z_$][\w$]*)/g),
  ].map((m) => m[1]);
  for (const x of respaldos) {
    assert.equal(
      x,
      "correrTodosLosPares",
      `src/main.js usa "${x}" como respaldo de deps.correrTodosLosPares: tiene que ser el ` +
        "correrTodosLosPares importado de ./sync.js, que migra la libreta legada del DOT (R-11)"
    );
  }
  for (const pieza of ["ejecutarPar", "migrarLibretaLegada"]) {
    assert.doesNotMatch(
      fuenteMain,
      new RegExp(`\\b${pieza}\\b`),
      `src/main.js menciona ${pieza}: eso huele a una copia local del orquestador; el ` +
        "entrypoint real tiene que delegar en el correrTodosLosPares de ./sync.js (R-11)"
    );
  }
});

test("src/index.js NO declara su propia funcion local correrTodosLosPares", () => {
  const fuente = readFileSync(rutaIndex, "utf-8");

  const declaraFuncionLocal = /\bfunction\s+correrTodosLosPares\s*\(/.test(fuente);
  const declaraConstLocal = /\bconst\s+correrTodosLosPares\s*=/.test(fuente);

  assert.equal(
    declaraFuncionLocal,
    false,
    "src/index.js no puede declarar \"function correrTodosLosPares(...)\" local: " +
      "esa duplicada es la que corre hoy en produccion (linea 142) y nunca migra " +
      "la libreta legada del DOT, aunque sync.js SI exporte su propia version"
  );
  assert.equal(
    declaraConstLocal,
    false,
    "src/index.js no puede declarar \"const correrTodosLosPares = ...\" local, por el mismo motivo"
  );
});
