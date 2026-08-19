// AC-19 y el contrato del workflow que dispara el sync.
//
// No se puede esperar 60 dias para comprobar que un workflow no se
// auto-desactiva, ni medir la entrega de un `schedule` en un test. Lo que SI se
// puede es congelar el contrato del YAML, que es lo que el challenger pidio en
// F-24: "AC-14 no es testeable -> test de contrato sobre el YAML".
//
// Lo que protege, con su caso real:
//   H1  el workflow tenia `schedule:` y GitHub lo auto-desactivo a los 60 dias
//       sin actividad. Estuvo 10 dias sin sincronizar y nadie se entero.
//   H2  ese mismo `schedule` entrego el 5% de las corridas pedidas: 2.806 de
//       ~19.300 entre el 2026-06-03 y el 2026-08-09.
//   H12 la API 2026-04 elimino `compareQuantity`. Bajar la version rompe la
//       escritura.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const yaml = readFileSync(join(raiz, ".github/workflows/sync.yml"), "utf-8");

// Las lineas de codigo YAML, sin comentarios: `schedule` aparece varias veces en
// los comentarios que explican POR QUE no esta, y eso no debe dar un falso positivo.
const lineas = yaml
  .split("\n")
  .map((l) => l.replace(/#.*$/, ""))
  .filter((l) => l.trim() !== "");

test("AC-19: el workflow NO declara schedule — el disparo es externo", () => {
  const conSchedule = lineas.filter((l) => /^\s*schedule\s*:/.test(l));
  assert.deepEqual(
    conSchedule,
    [],
    "un `schedule:` reintroduce H1 (auto-desactivacion a los 60 dias) y H2 (5% de entrega)"
  );
});

test("el disparo externo sigue existiendo: workflow_dispatch declarado", () => {
  assert.match(yaml, /^\s*workflow_dispatch\s*:/m);
});

test("simular es el default: escribir en Shopify es una decision explicita", () => {
  // El cronjob manda {"ref":"main","inputs":{"dry_run":"false"}}. Si algun dia
  // manda el cuerpo sin inputs, el default tiene que dejarlo en simulacion.
  assert.match(yaml, /DRY_RUN:\s*\$\{\{\s*inputs\.dry_run\s*\|\|\s*'true'\s*\}\}/);
  const bloqueDryRun = yaml.slice(yaml.indexOf("dry_run:"), yaml.indexOf("full:"));
  assert.match(bloqueDryRun, /default:\s*"true"/);
});

test("la reconciliacion completa NO es el default", () => {
  // Un --full automatico empujaria los 2.562 absolutos y borraria toda venta
  // online no reflejada. Es F-09, y por eso el --full diario esta desactivado.
  const bloqueFull = yaml.slice(yaml.indexOf("full:"));
  assert.match(bloqueFull.slice(0, 400), /default:\s*"false"/);
});

test("no se puede correr dos veces a la vez, y la que corre no se cancela", () => {
  assert.match(yaml, /concurrency:/);
  assert.match(yaml, /cancel-in-progress:\s*false/);
});

test("la version de la API de Shopify no baja de 2026-04", () => {
  // Desde 2026-04 el input usa `changeFromQuantity` y `@idempotent` es
  // obligatoria. Bajar la version rompe toda escritura (H12).
  const m = yaml.match(/SHOPIFY_API_VERSION:\s*"(\d{4})-(\d{2})"/);
  assert.ok(m, "SHOPIFY_API_VERSION tiene que estar fijada y a la vista");
  const [, anio, mes] = m;
  assert.ok(
    Number(anio) > 2026 || (Number(anio) === 2026 && Number(mes) >= 4),
    `SHOPIFY_API_VERSION=${m[1]}-${m[2]} es anterior a 2026-04`
  );
});

test("el estado se restaura y se guarda SIEMPRE, aunque el job falle", () => {
  // Sin el `if: always()` un job que muere por timeout pierde el checkpoint y la
  // corrida siguiente vuelve a empezar de cero.
  assert.match(yaml, /actions\/cache\/restore@/);
  assert.match(yaml, /actions\/cache\/save@/);
  const bloqueSave = yaml.slice(yaml.indexOf("Guardar estado"));
  assert.match(bloqueSave, /if:\s*always\(\)/);
});

test("ningun secreto esta escrito en el YAML: todos salen de secrets", () => {
  // El repo es publico.
  assert.ok(!/shpat_|github_pat_|gh[pousr]_/.test(yaml), "hay algo con pinta de token en el YAML");
  for (const v of [
    "SHOPIFY_CLIENT_ID",
    "SHOPIFY_CLIENT_SECRET",
    "CONTABILIUM_CLIENT_ID",
    "CONTABILIUM_CLIENT_SECRET",
  ]) {
    const re = new RegExp(`${v}:\\s*\\$\\{\\{\\s*secrets\\.${v}\\s*\\}\\}`);
    assert.match(yaml, re, `${v} tiene que venir de secrets`);
  }
});
