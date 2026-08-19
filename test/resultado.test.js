// Regresion del guardarrail de salida: prohibido fallar en silencio.
//
// El modo de falla real de este sistema no es el error ruidoso, es el tilde
// verde vacio. Casos reales:
//   - 2026-06-03, run 26862054076: 2.396 errores de 2.480 SKUs, 0 sincronizados,
//     exit 0 y workflow en VERDE (diagnostico H3).
//   - 2026-08-19: se repitio.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluarCorrida, UMBRAL_ERROR_DEFECTO } from "../src/resultado.js";

// Resumen con la forma que devuelve syncTodos.
const resumen = (extra) => ({
  actualizado: 0,
  dry: 0,
  sin_cambios: 0,
  no_encontrado: 0,
  no_activado: 0,
  error: 0,
  ambiguo: 0,
  saltado: 0,
  total: 0,
  ...extra,
});

test("el umbral por defecto es el 5% de los SKUs", () => {
  assert.equal(UMBRAL_ERROR_DEFECTO, 0.05);
});

// -----------------------------------------------------------------------------
// Corridas que TIENEN que fallar
// -----------------------------------------------------------------------------

test("el caso real de H3: 2.396 errores de 2.480 no puede salir en verde", () => {
  const v = evaluarCorrida(resumen({ total: 2480, error: 2396 }));
  assert.equal(v.ok, false);
  assert.match(v.motivo, /2396 de 2480/);
  assert.match(v.motivo, /96\.6%/);
});

test("una corrida que no verifico ningun SKU falla, aunque no haya errores", () => {
  // "No cambio nada" es correcto; "no mire nada" es un fallo (AC-14).
  const v = evaluarCorrida(resumen({ total: 2562, no_encontrado: 2562 }));
  assert.equal(v.ok, false);
  assert.match(v.motivo, /no sincronizo ni verifico ningun SKU de 2562/);
});

test("total = 0 falla: Contabilium no devolvio un solo SKU del DOT", () => {
  // Antes esto salia en VERDE. index.js hacia `if (!r || !r.total) return`, asi
  // que un deposito vacio -id cambiado, credencial de otra cuenta, respuesta
  // truncada- terminaba con exit 0 sin haber mirado nada.
  const v = evaluarCorrida(resumen({ total: 0 }));
  assert.equal(v.ok, false);
  assert.match(v.motivo, /no devolvio ningun SKU/);
});

test("sin resumen falla: no saber no es estar bien", () => {
  assert.equal(evaluarCorrida(undefined).ok, false);
  assert.equal(evaluarCorrida(null).ok, false);
  assert.equal(evaluarCorrida({}).ok, false);
});

test("justo por encima del umbral falla", () => {
  // 6 de 100 = 6% > 5%
  assert.equal(evaluarCorrida(resumen({ total: 100, error: 6, sin_cambios: 94 })).ok, false);
});

// -----------------------------------------------------------------------------
// Corridas que TIENEN que pasar
// -----------------------------------------------------------------------------

test("la reconciliacion real del 2026-08-19 pasa (run 32278046048)", () => {
  // Total 2562 / Actualizados 0 / Sin cambios 2434 / No encontrados 87 /
  // Ambiguos 41 / Errores 0.
  const v = evaluarCorrida(
    resumen({ total: 2562, sin_cambios: 2434, no_encontrado: 87, ambiguo: 41 })
  );
  assert.equal(v.ok, true);
  assert.equal(v.motivo, null);
});

test("un incremental donde no cambio nada pasa: saltado cuenta como efectivo", () => {
  // Las ultimas 13 corridas del 08-09 reportaron Saltados 2562 / Actualizados 0.
  // Eso es correcto: la libreta ya daba todo por sincronizado.
  assert.equal(evaluarCorrida(resumen({ total: 2562, saltado: 2562 })).ok, true);
});

test("una corrida en dry-run pasa: simular es mirar", () => {
  assert.equal(evaluarCorrida(resumen({ total: 2562, dry: 2562 })).ok, true);
});

test("justo EN el umbral pasa: el corte es estricto", () => {
  // 5 de 100 = 5%, que no es > 5%.
  assert.equal(evaluarCorrida(resumen({ total: 100, error: 5, sin_cambios: 95 })).ok, true);
});

test("los 41 ambiguos y los 87 no encontrados no cuentan como efectivos", () => {
  // Se reportan y no se arreglan, pero no pueden sostener sola una corrida:
  // si TODO el deposito quedara asi, seria un fallo, no un exito.
  const v = evaluarCorrida(resumen({ total: 128, no_encontrado: 87, ambiguo: 41 }));
  assert.equal(v.ok, false);
});

test("el umbral es configurable y se respeta", () => {
  const r = resumen({ total: 100, error: 20, sin_cambios: 80 });
  assert.equal(evaluarCorrida(r, 0.5).ok, true);
  assert.equal(evaluarCorrida(r, 0.1).ok, false);
});
