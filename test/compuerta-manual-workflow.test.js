// R-6 / CA-6 — contrato del YAML de la compuerta manual auditada (diseño B).
//
//   - escritura_absoluta y motivo existen en workflow_dispatch.inputs, default "";
//   - se pasan por env:, nunca interpolados con ${{ }} dentro de un run: ni por
//     argv (hallazgo 8 del segundo juez: un input que valga "--cron" o "--full"
//     cambiaba el modo de src/index.js);
//   - el step de validacion falla ANTES del sync si hay alcance sin motivo, y deja
//     alcance y motivo en el log.
//
// El step de validacion no solo se lee: se EJECUTA con bash, con varias
// combinaciones de entorno (igual que lo correria Actions, que le pasa los
// inputs por env:).
//
// Corre con: node --test test/compuerta-manual-workflow.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const yaml = readFileSync(join(raiz, ".github/workflows/sync.yml"), "utf-8");

// Bloque literal de cada `run:` (las lineas siguientes con mas indentacion).
function bloquesRun(texto) {
  const lineas = texto.split("\n");
  const bloques = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!/^\s*(-\s+)?run:/.test(lineas[i])) continue;
    const indentRun = lineas[i].match(/^(\s*)/)[1].length;
    const enLinea = lineas[i].replace(/^\s*(-\s+)?run:\s*\|?\s*/, "");
    const contenido = enLinea ? [enLinea] : [];
    for (let j = i + 1; j < lineas.length; j++) {
      const l = lineas[j];
      if (l.trim() === "") {
        contenido.push("");
        continue;
      }
      if (l.match(/^(\s*)/)[1].length <= indentRun) break;
      contenido.push(l);
    }
    bloques.push(contenido.join("\n"));
  }
  return bloques;
}

// Texto de un step por su `name:` (hasta el proximo `- name:` o `- uses:` del mismo nivel).
function step(nombre) {
  const i = yaml.indexOf(`name: ${nombre}`);
  assert.ok(i > -1, `no existe el step "${nombre}"`);
  const resto = yaml.slice(i + 1);
  const fin = resto.search(/\n\s*-\s+(name|uses):/);
  return yaml.slice(i, fin === -1 ? undefined : i + 1 + fin);
}

function scriptDeValidacion() {
  const bloques = bloquesRun(step("Validar compuerta manual"));
  assert.equal(bloques.length, 1, "el step de validacion tiene un run:");
  // Quitar la indentacion comun del bloque literal.
  const lineas = bloques[0].split("\n");
  const indent = Math.min(...lineas.filter((l) => l.trim()).map((l) => l.match(/^(\s*)/)[1].length));
  return lineas.map((l) => l.slice(indent)).join("\n");
}

function correrValidacion(env) {
  return spawnSync("bash", ["-e", "-c", scriptDeValidacion()], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf-8",
    timeout: 10_000,
  });
}

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

test("CA-6: escritura_absoluta y motivo existen en workflow_dispatch.inputs, tipo string, default vacio", () => {
  const inputs = yaml.slice(yaml.indexOf("workflow_dispatch:"), yaml.indexOf("concurrency:"));
  for (const nombre of ["escritura_absoluta", "motivo"]) {
    const i = inputs.search(new RegExp(`\\n\\s+${nombre}\\s*:`));
    assert.ok(i > -1, `falta el input ${nombre}`);
    // Desde la linea del input hasta el proximo input hermano (misma sangria de 6).
    const desde = inputs.slice(i + 1);
    const fin = desde.search(/\n {6}[a-z_]+:/);
    const bloque = fin === -1 ? desde : desde.slice(0, fin);
    assert.match(bloque, /type:\s*string/, nombre);
    assert.match(bloque, /default:\s*""/, `${nombre}: vacio = apagado`);
  }
  // control de regresion: los inputs existentes siguen.
  assert.match(inputs, /dry_run:/);
  assert.match(inputs, /full:/);
  assert.match(inputs, /modo:/);
});

// -----------------------------------------------------------------------------
// Nada de ${{ }} en run:, nada de argv
// -----------------------------------------------------------------------------

test("CA-6: ningun bloque run: interpola ${{ inputs.escritura_absoluta }} ni ${{ inputs.motivo }}", () => {
  const bloques = bloquesRun(yaml);
  assert.ok(bloques.length >= 2);
  for (const b of bloques) {
    assert.doesNotMatch(b, /\$\{\{\s*inputs\.escritura_absoluta\s*\}\}/, `interpolacion directa en:\n${b}`);
    assert.doesNotMatch(b, /\$\{\{\s*inputs\.motivo\s*\}\}/, `interpolacion directa en:\n${b}`);
    assert.doesNotMatch(b, /\$\{\{\s*github\.event\.inputs\.(escritura_absoluta|motivo)\s*\}\}/, `interpolacion directa en:\n${b}`);
  }
});

test("CA-6 (ronda 3): ningun bloque run: interpola ${{ env.MOTIVO }} ni ${{ env.ESCRITURA_ABSOLUTA }} (misma inyeccion que ${{ inputs.* }})", () => {
  const bloques = bloquesRun(yaml);
  assert.ok(bloques.length >= 2);
  for (const b of bloques) {
    assert.doesNotMatch(b, /\$\{\{\s*env\.MOTIVO\s*\}\}/i, `interpolacion de env en:\n${b}`);
    assert.doesNotMatch(b, /\$\{\{\s*env\.ESCRITURA_ABSOLUTA\s*\}\}/i, `interpolacion de env en:\n${b}`);
    assert.doesNotMatch(b, /\$\{\{\s*env\[\s*["'](MOTIVO|ESCRITURA_ABSOLUTA)["']\s*\]\s*\}\}/i, `interpolacion de env en:\n${b}`);
  }
});

test("CA-6: el comando node no recibe --motivo ni --escritura-absoluta (los inputs libres no viajan por argv)", () => {
  const run = bloquesRun(step("Correr sync")).join("\n");
  const comandosNode = run.split("\n").filter((l) => /\bnode\s+src\/index\.js/.test(l));
  assert.ok(comandosNode.length >= 1, "el step Correr sync tiene que seguir corriendo node src/index.js");
  for (const c of comandosNode) {
    assert.doesNotMatch(c, /--motivo/, c);
    assert.doesNotMatch(c, /--escritura-absoluta/, c);
    assert.doesNotMatch(c, /\$ESCRITURA_ABSOLUTA|\$MOTIVO|\$\{ESCRITURA_ABSOLUTA\}|\$\{MOTIVO\}/, `ningun input libre como argumento: ${c}`);
  }
});

test("CA-6: escritura_absoluta llega al proceso de sync por env: (ESCRITURA_ABSOLUTA <- inputs.escritura_absoluta)", () => {
  const s = step("Correr sync");
  assert.match(s, /ESCRITURA_ABSOLUTA:\s*\$\{\{\s*inputs\.escritura_absoluta\s*\}\}/);
  const v = step("Validar compuerta manual");
  assert.match(v, /ESCRITURA_ABSOLUTA:\s*\$\{\{\s*inputs\.escritura_absoluta\s*\}\}/);
  assert.match(v, /MOTIVO:\s*\$\{\{\s*inputs\.motivo\s*\}\}/);
});

test("CA-6: la validacion corre ANTES del sync", () => {
  assert.ok(yaml.indexOf("name: Validar compuerta manual") > -1);
  assert.ok(yaml.indexOf("name: Validar compuerta manual") < yaml.indexOf("name: Correr sync"));
});

// -----------------------------------------------------------------------------
// El step de validacion, ejecutado
// -----------------------------------------------------------------------------

test("CA-6: con escritura_absoluta y SIN motivo, el step de validacion falla (exit != 0)", () => {
  const r = correrValidacion({ ESCRITURA_ABSOLUTA: "IEY-C09-GRIS", MOTIVO: "" });
  assert.notEqual(r.status, 0, `tiene que fallar. stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stdout + r.stderr, /motivo/i);
});

test("CA-6 (ronda 3): con escritura_absoluta y un motivo de SOLO espacios (espacios, tab, salto de linea), el step de validacion falla", () => {
  // Hoy `[ -z "$MOTIVO" ]` (sync.yml:85) deja pasar "   ": la compuerta queda
  // auditada con un motivo que no dice nada.
  for (const motivo of [" ", "   ", "\t", " \t \n "]) {
    const r = correrValidacion({ ESCRITURA_ABSOLUTA: "IEY-C09-GRIS", MOTIVO: motivo });
    assert.notEqual(r.status, 0, `MOTIVO=${JSON.stringify(motivo)} tiene que fallar. stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout + r.stderr, /motivo/i);
  }
  // Control: un motivo con espacios alrededor pero con texto pasa.
  const ok = correrValidacion({ ESCRITURA_ABSOLUTA: "IEY-C09-GRIS", MOTIVO: "  recuento  " });
  assert.equal(ok.status, 0, `stdout=${ok.stdout} stderr=${ok.stderr}`);
});

test("CA-6: con escritura_absoluta y motivo, pasa y deja alcance y motivo en el log", () => {
  const r = correrValidacion({ ESCRITURA_ABSOLUTA: "IEY-C09-GRIS,IEY-X", MOTIVO: "recuento fisico del 02/11" });
  assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stdout, /IEY-C09-GRIS,IEY-X/);
  assert.match(r.stdout, /recuento fisico del 02\/11/);
});

test("CA-6: con los dos vacios (default) pasa sin ruido", () => {
  const r = correrValidacion({ ESCRITURA_ABSOLUTA: "", MOTIVO: "" });
  assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
});

test("CA-6: un motivo con $(...) y backticks queda como texto literal: no se ejecuta", () => {
  const malicioso = "x $(echo INYECTADO_A) `echo INYECTADO_B`";
  const r = correrValidacion({ ESCRITURA_ABSOLUTA: "todos", MOTIVO: malicioso });
  assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
  assert.ok(r.stdout.includes("$(echo INYECTADO_A)"), "el texto tiene que aparecer tal cual");
  assert.ok(!r.stdout.replace("$(echo INYECTADO_A)", "").includes("INYECTADO_A"), "no se ejecuto el $(...)");
  assert.ok(!r.stdout.replace("`echo INYECTADO_B`", "").includes("INYECTADO_B"), "no se ejecutaron los backticks");
});

// -----------------------------------------------------------------------------
// Ronda 5 (revision de codigo del 02/11/2026, N-10): inyeccion de COMANDOS DE
// WORKFLOW. El runner de GitHub lee la salida del step linea por linea y toma
// como comando toda linea que empieza con `::nombre ...::`. Un motivo (o un
// alcance) con un salto de linea -se puede mandar por la API de
// workflow_dispatch- hace que `echo "...: $MOTIVO"` emita una linea propia
// `::error::...`, `::add-mask::...` o `::stop-commands::...`.
//
// Control de COMPORTAMIENTO (no estatico): se ejecuta el step con valores
// maliciosos y se simula, de forma conservadora, como el runner leeria la
// salida. Un control estatico ("ninguna linea ::x:: interpola $MOTIVO") no
// alcanza: `echo "Motivo: $MOTIVO"` no tiene `::` y con un salto de linea igual
// inyecta. Vale cualquier arreglo que cumpla (DISENO-INTERFAZ.md seccion 8,
// redefinidos en la ronda 5b por el formato viejo "##["): (a) el valor va solo
// dentro de los datos del unico comando "::" del step, con %, CR y LF escapados;
// (b) rechazar como error de validacion un valor con CR, LF, "::" o "##["; o
// (c) ::stop-commands:: con un token que no se repite entre corridas. Escapar
// %, CR y LF NO alcanza para un valor impreso fuera de un comando "::": ahi un
// "##[" es un comando del formato viejo.
// -----------------------------------------------------------------------------

// Comandos que el runner ejecutaria. Ronda 5b: el simulador vive en
// test/_helpers-comandos-workflow.js (lo comparte el caso 8 de CA-15) y modela
// el orden REAL del runner, con las lineas de actions/runner citadas ahi:
// primero el formato "::" (TrimStart + StartsWith("::")); si la linea no es un
// comando "::", cualquier "##[" en cualquier posicion es un comando del formato
// viejo (ActionCommand.TryParse, IndexOf("##[")). Conservador: corta en CR, LF y
// CRLF; respeta ::stop-commands::<token> ... ::<token>:: comparando el token sin
// distinguir mayusculas.
import { comandosEfectivos } from "./_helpers-comandos-workflow.js";

const MARCA = "INYECCION";
const MOTIVOS_MALICIOSOS = [
  `recuento\n::error::${MARCA}`,
  `recuento\r\n::add-mask::${MARCA}`,
  `recuento\r::warning::${MARCA}`,
  `recuento\n  ::notice::${MARCA}`,
  `recuento\n::set-output name=x::${MARCA}`,
  `recuento\n::stop-commands::${MARCA}`,
  `::error::${MARCA}`,
  `::stop-commands::${MARCA}`,
  `recuento%0A::error::${MARCA}`,
  `recuento%0D%0A::add-mask::${MARCA}`,
  // Ronda 5b: formato viejo "##[", al inicio y en medio del valor. Dentro de los
  // datos del unico comando "::" del step es dato; en cualquier otra linea es un
  // comando.
  `##[error]${MARCA}`,
  `recuento ##[error]${MARCA}`,
];
const ALCANCES_MALICIOSOS = [
  `IEY-C09-GRIS\n::error::${MARCA}`,
  `IEY-C09-GRIS\r::add-mask::${MARCA}`,
  `::stop-commands::${MARCA}`,
  `IEY-C09-GRIS%0A::error::${MARCA}`,
  // Ronda 5b: formato viejo.
  `##[error]${MARCA}`,
  `IEY-C09-GRIS ##[error]${MARCA}`,
];

function sinComandosInyectados(env, r) {
  const salida = r.stdout + "\n" + r.stderr;
  const { comandos, tokensDePausa, pausaAbierta } = comandosEfectivos(salida);
  const desc = `env=${JSON.stringify(env)} exit=${r.status}\nstdout=${JSON.stringify(r.stdout)}\nstderr=${JSON.stringify(r.stderr)}`;
  // Un ::stop-commands:: que sale del valor, o una pausa que nunca se cierra,
  // apaga los comandos del resto del job: tambien es inyeccion.
  for (const token of tokensDePausa) {
    assert.ok(!token.includes(MARCA), `::stop-commands:: inyectado desde el valor (token ${JSON.stringify(token)})\n${desc}`);
  }
  assert.equal(pausaAbierta, false, `::stop-commands:: sin cerrar al terminar el step\n${desc}`);
  // El step emite a proposito UN comando por corrida: ::error:: (falta motivo) o
  // ::warning:: (compuerta activa). Cualquier otro es inyectado.
  assert.ok(comandos.length <= 1, `comando de workflow inyectado: ${JSON.stringify(comandos)}\n${desc}`);
  for (const c of comandos) {
    assert.ok(["warning", "error"].includes(c.nombre), `comando de workflow no previsto: ${JSON.stringify(c)}\n${desc}`);
    // Todos los payloads ponen la MARCA justo despues del `::` del comando que
    // inyectan; el comando legitimo empieza con su propio texto fijo.
    assert.ok(!c.datos.trimStart().startsWith(MARCA), `comando de workflow inyectado: ${JSON.stringify(c)}\n${desc}`);
  }
  // Si el step pasa, alcance y motivo siguen quedando en el log (R-6), escapados o
  // no: "arreglarlo" dejando de imprimirlos no vale.
  if (r.status === 0) {
    assert.ok(salida.includes(MARCA), `el step paso pero el valor no quedo en el log (R-6)\n${desc}`);
  }
}

test("CA-6 (ronda 5, N-10; 5b: ##[): un motivo con saltos de linea (LF, CR, CRLF), que empieza con :: o que contiene ##[ no inyecta comandos de workflow", () => {
  for (const motivo of MOTIVOS_MALICIOSOS) {
    const env = { ESCRITURA_ABSOLUTA: "IEY-C09-GRIS", MOTIVO: motivo };
    sinComandosInyectados(env, correrValidacion(env));
  }
});

test("CA-6 (ronda 5, N-10; 5b: ##[): un escritura_absoluta con saltos de linea, que empieza con :: o que contiene ##[ tampoco inyecta comandos de workflow", () => {
  for (const alcance of ALCANCES_MALICIOSOS) {
    const env = { ESCRITURA_ABSOLUTA: alcance, MOTIVO: "recuento fisico" };
    sinComandosInyectados(env, correrValidacion(env));
  }
});

test("CA-6 (ronda 5, N-10): si el step usa ::stop-commands::, el token no se puede adivinar desde otra corrida", () => {
  const benigna = correrValidacion({ ESCRITURA_ABSOLUTA: "IEY-C09-GRIS", MOTIVO: "recuento fisico" });
  assert.equal(benigna.status, 0, `stdout=${benigna.stdout} stderr=${benigna.stderr}`);
  const { tokensDePausa } = comandosEfectivos(benigna.stdout + "\n" + benigna.stderr);
  // Sin ::stop-commands:: no hay token que reusar: el control de arriba alcanza.
  for (const token of tokensDePausa) {
    const motivo = `recuento\n::${token}::\n::error::${MARCA}`;
    const env = { ESCRITURA_ABSOLUTA: "IEY-C09-GRIS", MOTIVO: motivo };
    sinComandosInyectados(env, correrValidacion(env));
  }
});

test("CA-6 (ronda 5, N-10): control positivo del simulador: el echo sin escapar de hoy SI inyecta", () => {
  // Guarda contra un simulador que nunca encuentra nada (verde vacio).
  const script = 'echo "::warning::Alcance: $ESCRITURA_ABSOLUTA - Motivo: $MOTIVO"';
  const r = spawnSync("bash", ["-e", "-c", script], {
    env: { PATH: process.env.PATH, ESCRITURA_ABSOLUTA: "IEY-C09-GRIS", MOTIVO: `recuento\n::error::${MARCA}` },
    encoding: "utf-8",
    timeout: 10_000,
  });
  assert.equal(comandosEfectivos(r.stdout).comandos.length, 2, `stdout=${JSON.stringify(r.stdout)}`);
  // Y una salida escapada a la manera de GitHub no cuenta como inyeccion.
  assert.equal(comandosEfectivos(`::warning::Alcance: IEY-C09-GRIS - Motivo: recuento%0A::error::${MARCA}\n`).comandos.length, 1);
});

test("CA-6 (ronda 5b): control positivo del simulador: el formato viejo ##[ cuenta en cualquier posicion de una linea que no es un comando ::", () => {
  // Una linea propia con el valor escapado "a la manera de GitHub" (%, CR, LF)
  // igual inyecta: el escapado no toca "##[".
  const script = 'echo "::warning::compuerta activa"; echo "Motivo: $MOTIVO"';
  const r = spawnSync("bash", ["-e", "-c", script], {
    env: { PATH: process.env.PATH, MOTIVO: `recuento ##[error]${MARCA}` },
    encoding: "utf-8",
    timeout: 10_000,
  });
  const { comandos } = comandosEfectivos(r.stdout);
  assert.equal(comandos.length, 2, `stdout=${JSON.stringify(r.stdout)}`);
  assert.deepEqual(
    { formato: comandos[1].formato, nombre: comandos[1].nombre, datos: comandos[1].datos },
    { formato: "viejo", nombre: "error", datos: MARCA }
  );
  // Al inicio de la linea, y con prefijo de node.
  assert.equal(comandosEfectivos(`##[error]${MARCA}`).comandos.length, 1);
  const deNode = comandosEfectivos(`[COMPUERTA][ERROR] 1 SKU(s) no aplicados: "IEY-X ##[error]${MARCA}"`).comandos;
  assert.equal(deNode.length, 1, "una linea de node con ##[ es un comando del formato viejo");
  assert.equal(deNode[0].formato, "viejo");
  // Dentro de los datos de un comando "::" valido, "##[" es dato (V2 gana).
  const v2 = comandosEfectivos(`::warning::Alcance: X - Motivo: recuento ##[error]${MARCA}`).comandos;
  assert.equal(v2.length, 1);
  assert.equal(v2[0].formato, "v2");
  assert.equal(v2[0].nombre, "warning");
  // Una linea sin "::" al inicio ni "##[" no es comando.
  assert.equal(comandosEfectivos("Motivo: recuento ::error::x").comandos.length, 0);
});

test("CA-6 (ronda 5b): control positivo del simulador: el token de stop-commands se compara sin distinguir mayusculas, y el formato viejo tambien pausa", () => {
  const conMayusculas = comandosEfectivos(`::stop-commands::AbC123\n::error::adentro\n::abc123::\n::error::${MARCA}`);
  assert.equal(conMayusculas.pausaAbierta, false, "::abc123:: cierra la pausa de AbC123");
  assert.equal(conMayusculas.comandos.length, 1, "el ::error:: posterior al cierre cuenta");
  const viejo = comandosEfectivos(`##[stop-commands]tok\n::error::adentro`);
  assert.deepEqual(viejo.tokensDePausa, ["tok"]);
  assert.equal(viejo.pausaAbierta, true);
});
