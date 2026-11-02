// R-13 / CA-13 — argv estricto en src/index.js (hallazgo 8 del segundo juez).
//
// Hoy index.js hace args.includes("--cron"|"--full"|"--locations") sobre TODO el
// argv, y el workflow le pasaba `--escritura-absoluta "$ESCRITURA_ABSOLUTA"
// --motivo "$MOTIVO"`: un input que valiera exactamente "--cron" arrancaba el
// cron (proceso vivo hasta el timeout de 50 min); "--full", una reconciliacion.
//
// Interfaz (DISENO-INTERFAZ.md seccion 7):
//   src/argv.js: resolverModo(argv, env) -> { modo, sku, qty, escrituraAbsoluta }
//                ErrorDeUso (codigoSalida 2)
//   src/index.js: ante ErrorDeUso, sale con 2 ANTES de tocar Contabilium/Shopify.
//
// Dos niveles:
//   1. resolverModo (puro): la decision de modo depende SOLO de argv.
//   2. src/index.js como SUBPROCESO, solo para los casos que tienen que salir con
//      2: cwd en un directorio temporal (dotenv no encuentra ningun .env real),
//      entorno armado desde cero y CONTABILIUM_API_URL / SHOPIFY_STORE_DOMAIN
//      apuntando a un servidor HTTP local que cuenta requests. Esos casos salen
//      antes de leer libretas: no tocan el .cache/ del repo.
//   3. Ronda 3: main(argv, env, deps) de src/main.js con correrTodosLosPares
//      simulado: la compuerta llega al sync en el modo por defecto Y en --full.
//
// Corre con: node --test test/index-argv.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Import dinamico: si src/argv.js todavia no existe, fallan los tests puros (con
// un TypeError claro) y los de subproceso igual corren contra src/index.js.
let argvMod = {};
try {
  argvMod = await import("../src/argv.js");
} catch {
  argvMod = {};
}

// Ronda 3: src/main.js (DISENO-INTERFAZ.md seccion 7.1). Import dinamico por el
// mismo motivo: si no existe, fallan solo sus casos.
let mainMod = {};
try {
  mainMod = await import("../src/main.js");
} catch {
  mainMod = {};
}

const INDEX = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js");

// -----------------------------------------------------------------------------
// 1. resolverModo, puro
// -----------------------------------------------------------------------------

test("CA-13: resolverModo elige el modo por las opciones declaradas de argv", () => {
  assert.equal(argvMod.resolverModo([], {}).modo, "incremental");
  assert.equal(argvMod.resolverModo(["--full"], {}).modo, "full");
  assert.equal(argvMod.resolverModo(["--cron"], {}).modo, "cron");
  assert.equal(argvMod.resolverModo(["--locations"], {}).modo, "locations");
  const sku = argvMod.resolverModo(["--sku", "IEY-C09-GRIS", "--qty", "3"], {});
  assert.equal(sku.modo, "sku");
  assert.equal(sku.sku, "IEY-C09-GRIS");
});

test("CA-13: con ESCRITURA_ABSOLUTA=--full (o --cron, --locations, --sku) en el entorno y sin flag, el modo es incremental", () => {
  for (const valor of ["--full", "--cron", "--locations", "--sku", "--full --cron"]) {
    const r = argvMod.resolverModo([], { ESCRITURA_ABSOLUTA: valor, MOTIVO: valor });
    assert.equal(r.modo, "incremental", `ESCRITURA_ABSOLUTA=${valor}`);
  }
  // El valor se usa como lo que es: el alcance de la compuerta, no un flag.
  assert.equal(argvMod.resolverModo([], { ESCRITURA_ABSOLUTA: "--full", MOTIVO: "x" }).escrituraAbsoluta instanceof Set, true);
});

test("CA-13: un MOTIVO que vale --cron no arranca el cron (ni con --full en argv cambia a cron)", () => {
  assert.equal(argvMod.resolverModo([], { ESCRITURA_ABSOLUTA: "todos", MOTIVO: "--cron" }).modo, "incremental");
  assert.equal(argvMod.resolverModo(["--full"], { ESCRITURA_ABSOLUTA: "todos", MOTIVO: "--cron" }).modo, "full");
});

test("CA-13: escritura_absoluta se parsea del entorno: vacio -> null, 'todos' -> 'todos', lista -> Set normalizado", () => {
  assert.equal(argvMod.resolverModo([], {}).escrituraAbsoluta, null);
  assert.equal(argvMod.resolverModo([], { ESCRITURA_ABSOLUTA: "  " }).escrituraAbsoluta, null);
  assert.equal(argvMod.resolverModo([], { ESCRITURA_ABSOLUTA: "todos" }).escrituraAbsoluta, "todos");
  assert.deepEqual([...argvMod.resolverModo([], { ESCRITURA_ABSOLUTA: " iey-a , IEY-B,," }).escrituraAbsoluta].sort(), ["IEY-A", "IEY-B"]);
});

test("CA-13: token desconocido, posicional, opcion que ya no existe, o un valor que empieza con '-' son ErrorDeUso con salida 2", () => {
  const casos = [
    ["--desconocido"],
    ["posicional"],
    ["--escritura-absoluta", "IEY-A"], // los inputs libres viajan solo por entorno (R-6)
    ["--motivo", "algo"],
    ["--escritura-absoluta", "--cron", "--motivo", "x"], // el vector del hallazgo 8
    ["--sku", "--cron"],
    ["--sku", "--full"],
    ["--sku"],
  ];
  for (const argv of casos) {
    assert.throws(
      () => argvMod.resolverModo(argv, {}),
      (err) => err instanceof argvMod.ErrorDeUso && err.codigoSalida === 2,
      `argv=${JSON.stringify(argv)}`
    );
  }
});

// -----------------------------------------------------------------------------
// 2. src/index.js como subproceso
// -----------------------------------------------------------------------------

async function conServidorContador(fn) {
  const hits = [];
  const servidor = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end('{"error":"servidor de prueba: no deberia recibir requests"}');
  });
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  try {
    return await fn(url, hits);
  } finally {
    await new Promise((r) => servidor.close(r));
  }
}

function correrIndex(args, url, envExtra = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "index-argv-"));
  const env = {
    PATH: process.env.PATH,
    DRY_RUN: "true",
    CONTABILIUM_API_URL: url,
    CONTABILIUM_CLIENT_ID: "id-prueba",
    CONTABILIUM_CLIENT_SECRET: "secreto-prueba",
    CONTABILIUM_DOT_DEPOSITO_ID: "127356",
    SHOPIFY_STORE_DOMAIN: url.replace("http://", ""),
    SHOPIFY_CLIENT_ID: "id-prueba",
    SHOPIFY_CLIENT_SECRET: "secreto-prueba",
    SHOPIFY_DOT_LOCATION_ID: "gid://shopify/Location/83342655574",
    ...envExtra,
  };
  return new Promise((resolve) => {
    const hijo = spawn(process.execPath, [INDEX, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    hijo.stdout.on("data", (d) => (stdout += d));
    hijo.stderr.on("data", (d) => (stderr += d));
    let matado = false;
    const reloj = setTimeout(() => {
      matado = true;
      hijo.kill("SIGKILL");
    }, 15_000);
    hijo.on("close", (code) => {
      clearTimeout(reloj);
      rmSync(cwd, { recursive: true, force: true });
      resolve({ code, stdout, stderr, matado });
    });
  });
}

test("CA-13: `node src/index.js --desconocido` sale con 2 y no hace ningun request a Contabilium ni a Shopify", { timeout: 30_000 }, async () => {
  await conServidorContador(async (url, hits) => {
    const r = await correrIndex(["--desconocido"], url);
    assert.equal(r.matado, false, "tiene que terminar solo");
    assert.equal(r.code, 2, `salida ${r.code}. stderr=${r.stderr}`);
    assert.deepEqual(hits, [], "error de uso: ni un request");
    assert.doesNotMatch(r.stdout, /\[Cron\]/);
  });
});

test("CA-13: un posicional sale con 2 sin requests", { timeout: 30_000 }, async () => {
  await conServidorContador(async (url, hits) => {
    const r = await correrIndex(["algo"], url);
    assert.equal(r.code, 2, `stderr=${r.stderr}`);
    assert.deepEqual(hits, []);
  });
});

test("CA-13: el argv viejo del workflow con un input que vale --cron sale con 2: no arranca el cron", { timeout: 30_000 }, async () => {
  await conServidorContador(async (url, hits) => {
    const r = await correrIndex(["--escritura-absoluta", "--cron", "--motivo", "--full"], url, {
      ESCRITURA_ABSOLUTA: "--cron",
      MOTIVO: "--full",
    });
    assert.equal(r.matado, false, "con el codigo viejo arranca el cron y queda vivo: el test lo mata a los 15 s");
    assert.doesNotMatch(r.stdout + r.stderr, /\[Cron\]/);
    assert.equal(r.code, 2, `stderr=${r.stderr}`);
    assert.deepEqual(hits, []);
  });
});

test("CA-13: `--sku --cron` (valor que parece un flag) sale con 2 y no arranca el cron", { timeout: 30_000 }, async () => {
  await conServidorContador(async (url, hits) => {
    const r = await correrIndex(["--sku", "--cron"], url);
    assert.equal(r.matado, false);
    assert.doesNotMatch(r.stdout + r.stderr, /\[Cron\]/);
    assert.equal(r.code, 2, `stderr=${r.stderr}`);
    assert.deepEqual(hits, []);
  });
});

// -----------------------------------------------------------------------------
// 3. Ronda 3 (hallazgo 2 de revisor-alcance): la compuerta LLEGA al sync.
//
// resolverModo puede estar perfecto y la compuerta igual no hacer nada si el
// cableado no pasa `escrituraAbsoluta` a correrTodosLosPares (o la pasa en uno
// solo de los dos caminos). Forma elegida (a): main(argv, env, deps) en
// src/main.js, sin efectos al importarse, con deps.correrTodosLosPares simulado
// (DISENO-INTERFAZ.md seccion 7.1). Y src/index.js tiene que delegar en main.
// -----------------------------------------------------------------------------

const PARES_FALSOS = Object.freeze([
  Object.freeze({ nombre: "dot", stateKey: "dot", depositoId: "127356", locationId: "gid://shopify/Location/83342655574", pendiente: false }),
]);

function depsMain() {
  const llamadas = { correr: [], syncUnSku: [], construirPares: [], evaluar: [] };
  const deps = {
    construirPares: (...args) => {
      llamadas.construirPares.push(args);
      return PARES_FALSOS;
    },
    correrTodosLosPares: async (pares, depsSync, opciones) => {
      llamadas.correr.push({ pares, depsSync, opciones: opciones ?? {} });
      return { dot: { total: 1, actualizado: 1, dry: 0, sin_cambios: 0, no_encontrado: 0, no_activado: 0, error: 0, ambiguo: 0, no_sincronizable: 0, saltado: 0 } };
    },
    evaluarCorridaMultiPar: (...args) => {
      llamadas.evaluar.push(args);
      return { ok: true, motivo: "ok (simulado)", detalle: {} };
    },
    syncUnSku: async (...args) => {
      llamadas.syncUnSku.push(args);
    },
  };
  return { deps, llamadas };
}

// El alcance tal como lo devuelve resolverModo: null, "todos" o Set de SKUs.
function alcance(ea) {
  if (ea instanceof Set) return [...ea].sort();
  return ea ?? null;
}

// main tiene que leer SOLO el `env` que recibe. Durante estos casos process.env
// trae otro valor: si main lo leyera, el alcance no coincidiria.
async function conProcessEnvTrampa(fn) {
  const previo = process.env.ESCRITURA_ABSOLUTA;
  process.env.ESCRITURA_ABSOLUTA = "SKU-DEL-PROCESO-NO-USAR";
  try {
    return await fn();
  } finally {
    if (previo === undefined) delete process.env.ESCRITURA_ABSOLUTA;
    else process.env.ESCRITURA_ABSOLUTA = previo;
  }
}

test("CA-13 (ronda 3): modo por defecto: con ESCRITURA_ABSOLUTA=SKU-A en el entorno, correrTodosLosPares recibe escrituraAbsoluta con SKU-A", async () => {
  await conProcessEnvTrampa(async () => {
    const { deps, llamadas } = depsMain();
    const env = { ESCRITURA_ABSOLUTA: "SKU-A", MOTIVO: "recuento fisico" };
    const codigo = await mainMod.main([], env, deps);
    assert.equal(llamadas.correr.length, 1, "una corrida");
    const { pares, opciones } = llamadas.correr[0];
    assert.equal(pares, PARES_FALSOS, "los pares salen de deps.construirPares");
    assert.equal(llamadas.construirPares.length, 1, "ronda 4: construirPares una vez");
    assert.deepEqual(llamadas.construirPares[0][0], env, "ronda 4: construirPares recibe el env de main (DISENO 7.1), no process.env");
    assert.deepEqual(alcance(opciones.escrituraAbsoluta), ["SKU-A"], "la compuerta llega al sync en el modo por defecto");
    assert.ok(!opciones.full, "el modo por defecto no es --full");
    assert.equal(codigo, 0);
  });
});

test("CA-13 (ronda 3): --full: con ESCRITURA_ABSOLUTA=SKU-A en el entorno, correrTodosLosPares recibe full Y escrituraAbsoluta con SKU-A", async () => {
  await conProcessEnvTrampa(async () => {
    const { deps, llamadas } = depsMain();
    const codigo = await mainMod.main(["--full"], { ESCRITURA_ABSOLUTA: "SKU-A", MOTIVO: "recuento fisico" }, deps);
    assert.equal(llamadas.correr.length, 1, "una corrida");
    const { opciones } = llamadas.correr[0];
    assert.equal(opciones.full, true);
    assert.deepEqual(alcance(opciones.escrituraAbsoluta), ["SKU-A"], "la compuerta llega al sync tambien en --full");
    assert.equal(codigo, 0);
  });
});

test("CA-13 (ronda 3): 'todos' llega como 'todos', y sin ESCRITURA_ABSOLUTA en el env recibido la compuerta esta apagada (aunque process.env traiga otra)", async () => {
  await conProcessEnvTrampa(async () => {
    for (const argv of [[], ["--full"]]) {
      const conTodos = depsMain();
      await mainMod.main(argv, { ESCRITURA_ABSOLUTA: "todos", MOTIVO: "x" }, conTodos.deps);
      assert.equal(alcance(conTodos.llamadas.correr[0]?.opciones.escrituraAbsoluta), "todos", `argv=${JSON.stringify(argv)}`);

      const apagada = depsMain();
      await mainMod.main(argv, {}, apagada.deps);
      assert.equal(apagada.llamadas.correr.length, 1);
      assert.equal(
        alcance(apagada.llamadas.correr[0].opciones.escrituraAbsoluta),
        null,
        `argv=${JSON.stringify(argv)}: main no lee process.env (traia SKU-DEL-PROCESO-NO-USAR)`
      );
    }
  });
});

test("CA-13 (ronda 3): main con un token desconocido devuelve 2 sin llamar a ninguna dependencia", async () => {
  const { deps, llamadas } = depsMain();
  const codigo = await mainMod.main(["--desconocido"], { ESCRITURA_ABSOLUTA: "SKU-A", MOTIVO: "x" }, deps);
  assert.equal(codigo, 2);
  assert.deepEqual(llamadas.correr, []);
  assert.deepEqual(llamadas.syncUnSku, []);
  assert.deepEqual(llamadas.construirPares, [], "ronda 4: un error de uso no construye los pares");
  assert.deepEqual(llamadas.evaluar, [], "ronda 4: ni evalua una corrida");
});

test("CA-13 (ronda 3): src/index.js delega en main(process.argv.slice(2), process.env) y no llama a correrTodosLosPares por su cuenta", () => {
  const texto = readFileSync(INDEX, "utf-8");
  // Sin comentarios, para que un comentario no cuente como codigo.
  const codigo = texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.match(codigo, /from\s+["']\.\/main\.js["']/, "index.js importa main de ./main.js");
  assert.match(codigo, /\bmain\(\s*process\.argv\.slice\(2\)\s*,\s*process\.env\b/, "index.js llama main(process.argv.slice(2), process.env)");
  assert.doesNotMatch(codigo, /correrTodosLosPares\s*\(/, "un segundo camino en index.js podria no pasar la compuerta");
});

// Ronda 4 (importante 3 de revisor-alcance). El control de arriba se elude:
//   (a) `import { correrTodosLosPares as correr } from "./sync.js"` y `correr(...)`
//       en una rama, con `main(process.argv.slice(2), process.env)` en otra;
//   (b) `main(process.argv.slice(2), process.env, { correrTodosLosPares: ... })`:
//       el tercer argumento reemplaza el cableado real.
// Forma fijada (DISENO-INTERFAZ.md 7.1): index.js importa SOLO "dotenv/config" y
// `{ main }` de "./main.js", sin alias; llama main UNA vez, con exactamente dos
// argumentos; no carga modulos de otra forma (import(), require, eval).
test("CA-13 (ronda 4): src/index.js importa solo dotenv/config y { main } de ./main.js, y llama main(process.argv.slice(2), process.env) una sola vez, con dos argumentos", () => {
  const texto = readFileSync(INDEX, "utf-8");
  const codigo = texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

  // Modulos: todo especificador que sigue a `from` o a `import`.
  const especificadores = [...codigo.matchAll(/\b(?:from|import)\s*["']([^"']+)["']/g)].map((m) => m[1]).sort();
  assert.deepEqual(especificadores, ["./main.js", "dotenv/config"], `index.js importa solo dotenv/config y ./main.js (importa: ${especificadores.join(", ")})`);
  assert.equal((codigo.match(/\bimport\b/g) ?? []).length, 2, "exactamente dos import, ambos estaticos (sin import() dinamico)");
  assert.match(codigo, /^\s*import\s+["']dotenv\/config["']\s*;?\s*$/m, 'import "dotenv/config"');
  assert.match(codigo, /^\s*import\s*\{\s*main\s*\}\s*from\s*["']\.\/main\.js["']\s*;?\s*$/m, 'import { main } from "./main.js", sin alias ni namespace');
  assert.doesNotMatch(codigo, /\bexport\b/, "index.js no reexporta nada");
  assert.doesNotMatch(codigo, /\brequire\s*\(|\bcreateRequire\b|\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/, "sin otras formas de cargar o ejecutar codigo");

  // La llamada: exacta, dos argumentos, una sola vez.
  const llamadaExacta = /(?<![\w$.])main\(\s*process\.argv\.slice\(\s*2\s*\)\s*,\s*process\.env\s*\)/g;
  assert.equal((codigo.match(llamadaExacta) ?? []).length, 1, "main(process.argv.slice(2), process.env) aparece exactamente una vez, sin tercer argumento");
  assert.equal((codigo.match(/(?<![\w$.])main\s*\(/g) ?? []).length, 1, "main se llama una sola vez");
  // Toda mencion del identificador main: la del import y la de la llamada. Nada
  // de `const m = main`, `main.call(...)`, `main.apply(...)` ni pasarlo a otra funcion.
  const menciones = (codigo.match(/(?<![\w$./])main(?![\w$]|\.js)/g) ?? []).length;
  assert.equal(menciones, 2, `el identificador main aparece solo en el import y en la llamada (aparece ${menciones} veces)`);
  assert.equal((codigo.match(/\bprocess\.argv\b/g) ?? []).length, 1, "process.argv solo en la llamada a main");
  assert.equal((codigo.match(/\bprocess\.env\b/g) ?? []).length, 1, "process.env solo en la llamada a main");
  for (const nombre of ["correrTodosLosPares", "syncUnSku", "ejecutarPar", "syncTodos", "resolverModo"]) {
    assert.doesNotMatch(codigo, new RegExp(`\\b${nombre}\\b`), `index.js no menciona ${nombre}: todo pasa por main`);
  }
});

// -----------------------------------------------------------------------------
// 4. Ronda 5 (revision de codigo del 02/11/2026, N-9; invariante 6 de AGENTS.md:
// cantidades enteras). `--qty` se validaba con Number.isFinite aunque el mensaje
// dijera "entero": con `--qty 2.5`, syncUnSku guardaba 2.5 como baseline.
// Regla (DISENO-INTERFAZ.md seccion 7): --qty vale si Number(valor) es un entero
// seguro >= 0 en VALOR ("3" y "3.0" valen 3); cualquier otro es ErrorDeUso
// (salida 2) antes de llamar a ninguna dependencia.
// -----------------------------------------------------------------------------

const QTY_NO_ENTEROS = ["2.5", "1e-1", "3.0001", "0.5"];

test("CA-13 (ronda 5, N-9): --qty que no es entero en valor (2.5, 1e-1, 3.0001, 0.5) es ErrorDeUso con salida 2", () => {
  for (const qty of QTY_NO_ENTEROS) {
    assert.throws(
      () => argvMod.resolverModo(["--sku", "IEY-C09-GRIS", "--qty", qty], {}),
      (err) => err instanceof argvMod.ErrorDeUso && err.codigoSalida === 2,
      `--qty ${qty} no es una cantidad entera (invariante 6)`
    );
  }
  // Control de regresion: lo que ya era error lo sigue siendo.
  for (const qty of ["abc", "Infinity", "NaN"]) {
    assert.throws(
      () => argvMod.resolverModo(["--sku", "IEY-C09-GRIS", "--qty", qty], {}),
      (err) => err instanceof argvMod.ErrorDeUso && err.codigoSalida === 2,
      `--qty ${qty}`
    );
  }
});

test("CA-13 (ronda 5, N-9): main con --qty no entero devuelve 2 sin llamar a ninguna dependencia (ni syncUnSku)", async () => {
  for (const qty of QTY_NO_ENTEROS) {
    const { deps, llamadas } = depsMain();
    const codigo = await mainMod.main(["--sku", "IEY-C09-GRIS", "--qty", qty], {}, deps);
    assert.equal(codigo, 2, `--qty ${qty}`);
    assert.deepEqual(llamadas.syncUnSku, [], `--qty ${qty}: syncUnSku guardaria ${qty} como baseline`);
    assert.deepEqual(llamadas.correr, [], `--qty ${qty}`);
    assert.deepEqual(llamadas.construirPares, [], `--qty ${qty}`);
    assert.deepEqual(llamadas.evaluar, [], `--qty ${qty}`);
  }
});

test("CA-13 (ronda 5, N-9): --qty entero en valor se acepta como numero entero: '3' y '3.0' dan 3, '0' da 0, y syncUnSku recibe ese entero", async () => {
  for (const [qty, esperado] of [["3", 3], ["3.0", 3], ["0", 0]]) {
    const r = argvMod.resolverModo(["--sku", "IEY-C09-GRIS", "--qty", qty], {});
    assert.equal(r.modo, "sku");
    assert.equal(r.qty, esperado, `--qty ${qty}`);
    assert.ok(Number.isInteger(r.qty), `--qty ${qty}: numero, no texto`);

    const { deps, llamadas } = depsMain();
    const codigo = await mainMod.main(["--sku", "IEY-C09-GRIS", "--qty", qty], {}, deps);
    assert.equal(codigo, 0, `--qty ${qty}`);
    assert.equal(llamadas.syncUnSku.length, 1);
    assert.equal(llamadas.syncUnSku[0][0], "IEY-C09-GRIS");
    assert.equal(llamadas.syncUnSku[0][1], esperado, `--qty ${qty}: syncUnSku recibe el entero`);
  }
});
