// El sync hacia cosas grandes en silencio.
//
// El 2026-08-20 a las 00:00 puso 15 fundas de iPhone 18 en cero en Shopify. Fue
// correcto -Contabilium confirmo 0 unidades en el DOT- pero nadie se habria
// enterado. Y un SKU que DESAPARECE del listado de Contabilium no se vuelve a
// visitar nunca: Shopify se queda ofreciendo su ultimo valor para siempre.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectarAnomalias, formatearAnomalias, MAX_EJEMPLOS } from "../src/anomalias.js";

const mapa = (o) => new Map(Object.entries(o));

// -----------------------------------------------------------------------------
// Desaparicion (F-08 / G2-10)
// -----------------------------------------------------------------------------

test("un SKU que desaparece del deposito se detecta", () => {
  const a = detectarAnomalias(mapa({ "IEY-103-NEGRO": 4, "IEY-105-NEGRO": 2 }), mapa({ "IEY-105-NEGRO": 2 }));
  assert.equal(a.desaparecidos.length, 1);
  assert.equal(a.desaparecidos[0].sku, "IEY-103-NEGRO");
  assert.equal(a.desaparecidos[0].ultimaCantidad, 4);
});

test("un SKU que desaparece TENIENDO stock es el caso peligroso y se nombra", () => {
  const a = detectarAnomalias(mapa({ "IEY-103-NEGRO": 9 }), mapa({}));
  assert.equal(a.desaparecidos[0].ultimaCantidad, 9);
  assert.match(formatearAnomalias(a).join("\n"), /DESAPARECIERON/);
});

// -----------------------------------------------------------------------------
// Puesta en cero (el caso real del iPhone 18)
// -----------------------------------------------------------------------------

test("un SKU que tenia stock y pasa a 0 se detecta", () => {
  const a = detectarAnomalias(mapa({ "IEY-CASE-CARBON-NEGRO-IP18PM": 15 }), mapa({ "IEY-CASE-CARBON-NEGRO-IP18PM": 0 }));
  assert.equal(a.puestosEnCero.length, 1);
  assert.equal(a.puestosEnCero[0].cantidadPrevia, 15);
});

test("un SKU NUEVO que llega en cero NO es anomalia", () => {
  // Es lo normal: producto cargado en Contabilium antes de recibir la mercaderia.
  // Si esto alarmara, el reporte seria ruido desde el primer dia.
  const a = detectarAnomalias(mapa({ "VIEJO": 3 }), mapa({ "VIEJO": 3, "NUEVO-IP18": 0 }));
  assert.equal(a.puestosEnCero.length, 0);
  assert.deepEqual(a.nuevos, ["NUEVO-IP18"]);
  assert.deepEqual(formatearAnomalias(a), []);
});

test("un SKU que ya estaba en cero y sigue en cero no repite la alarma", () => {
  const a = detectarAnomalias(mapa({ "X": 0 }), mapa({ "X": 0 }));
  assert.equal(a.puestosEnCero.length, 0);
});

test("bajar de 15 a 1 no es puesta en cero: es una venta", () => {
  const a = detectarAnomalias(mapa({ "X": 15 }), mapa({ "X": 1 }));
  assert.equal(a.puestosEnCero.length, 0);
  assert.deepEqual(formatearAnomalias(a), []);
});

test("el caso real: 15 SKUs del iPhone 18 a cero de una", () => {
  const previo = {}, actual = {};
  for (let i = 0; i < 15; i++) { previo[`IEY-CASE-IP18-${i}`] = 3 + i; actual[`IEY-CASE-IP18-${i}`] = 0; }
  const a = detectarAnomalias(mapa(previo), mapa(actual));
  assert.equal(a.puestosEnCero.length, 15);
  const txt = formatearAnomalias(a).join("\n");
  assert.match(txt, /15 SKU\(s\) pasaron de tener stock a CERO/);
});

// -----------------------------------------------------------------------------
// Primera corrida y bordes
// -----------------------------------------------------------------------------

test("sin snapshot previo no se inventa nada", () => {
  // Primera corrida tras el upgrade: la libreta vieja no tiene el campo.
  for (const previo of [null, undefined, new Map(), {}]) {
    const a = detectarAnomalias(previo, mapa({ "X": 1 }));
    assert.equal(a.hayBase, false);
    assert.equal(a.desaparecidos.length, 0);
    assert.deepEqual(formatearAnomalias(a), []);
  }
});

test("sin anomalias no se imprime nada: un reporte que habla siempre no se lee", () => {
  const a = detectarAnomalias(mapa({ "X": 1, "Y": 2 }), mapa({ "X": 1, "Y": 2 }));
  assert.equal(a.hayBase, true);
  assert.deepEqual(formatearAnomalias(a), []);
});

test("acepta objetos ademas de Map (la libreta se persiste como JSON)", () => {
  const a = detectarAnomalias({ "X": 5 }, { "X": 0 });
  assert.equal(a.puestosEnCero.length, 1);
});

test("el listado se corta: el log es PUBLICO, no se vuelca el catalogo", () => {
  const previo = {}, actual = {};
  for (let i = 0; i < 100; i++) { previo[`SKU-${i}`] = 5; actual[`SKU-${i}`] = 0; }
  const txt = formatearAnomalias(detectarAnomalias(mapa(previo), mapa(actual)));
  const listados = txt.filter((l) => l.trim().startsWith("- ")).length;
  assert.equal(listados, MAX_EJEMPLOS);
  assert.match(txt.join("\n"), new RegExp(`y ${100 - MAX_EJEMPLOS} mas`));
  assert.match(txt.join("\n"), /100 SKU\(s\)/); // el total sigue siendo visible
});

test("desaparicion y puesta en cero se reportan juntas y por separado", () => {
  const a = detectarAnomalias(mapa({ "SE-VA": 7, "A-CERO": 4, "IGUAL": 1 }), mapa({ "A-CERO": 0, "IGUAL": 1 }));
  assert.equal(a.desaparecidos.length, 1);
  assert.equal(a.puestosEnCero.length, 1);
  const txt = formatearAnomalias(a).join("\n");
  assert.match(txt, /DESAPARECIERON/);
  assert.match(txt, /pasaron de tener stock a CERO/);
});
