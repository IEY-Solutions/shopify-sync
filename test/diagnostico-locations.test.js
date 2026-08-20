// Riesgo 1: sobre que location de Shopify escribe la integracion nativa 25020.
//
// Es la ultima premisa abierta de la familia de S-2 y la unica que puede
// invalidar el diseño de deltas entero: si 25020 escribiera sobre la location
// del DOT, habria un TERCER escritor absoluto sobre el mismo inventario.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { elegirSkusDiscriminantes, resumirCoincidencias } from "../src/diagnostico-locations.js";

const mapa = (o) => new Map(Object.entries(o));
const DOT = "gid://shopify/Location/83342655574";
const OTRA = "gid://shopify/Location/11111111111";

// -----------------------------------------------------------------------------
// La muestra tiene que DISCRIMINAR
// -----------------------------------------------------------------------------

test("elige SKUs donde los dos depositos difieren", () => {
  const r = elegirSkusDiscriminantes(mapa({ A: 10, B: 5 }), mapa({ A: 3, B: 5 }));
  assert.deepEqual(r.map((x) => x.sku), ["A"]);
});

test("descarta los que valen igual: no distinguen nada", () => {
  // Si CENTRAL y DOT dicen 5, una location con 5 no dice de cual espeja.
  assert.deepEqual(elegirSkusDiscriminantes(mapa({ A: 5 }), mapa({ A: 5 })), []);
});

test("descarta los ceros: un 0 es ambiguo", () => {
  assert.deepEqual(elegirSkusDiscriminantes(mapa({ A: 0 }), mapa({ A: 4 })), []);
  assert.deepEqual(elegirSkusDiscriminantes(mapa({ A: 4 }), mapa({ A: 0 })), []);
});

test("descarta los que no existen en el otro deposito", () => {
  assert.deepEqual(elegirSkusDiscriminantes(mapa({ A: 4 }), mapa({ B: 2 })), []);
});

test("respeta el limite de la muestra", () => {
  const c = {}, d = {};
  for (let i = 0; i < 50; i++) { c[`S${i}`] = 10; d[`S${i}`] = 3; }
  assert.equal(elegirSkusDiscriminantes(mapa(c), mapa(d), 5).length, 5);
});

// -----------------------------------------------------------------------------
// La lectura del resultado
// -----------------------------------------------------------------------------

const fila = (sku, central, dot, niveles) => ({ sku, central, dot, niveles });

test("una location que espeja CENTRAL se distingue de la que espeja el DOT", () => {
  const filas = [
    fila("A", 10, 3, [
      { locationId: DOT, location: "DOT", available: 3 },
      { locationId: OTRA, location: "Central", available: 10 },
    ]),
    fila("B", 8, 2, [
      { locationId: DOT, location: "DOT", available: 2 },
      { locationId: OTRA, location: "Central", available: 8 },
    ]),
  ];
  const r = resumirCoincidencias(filas);
  const dot = r.find((x) => x.locationId === DOT);
  const central = r.find((x) => x.locationId === OTRA);

  assert.equal(dot.comoDot, 2);
  assert.equal(dot.comoCentral, 0); // <-- lo tranquilizador: el DOT no espeja CENTRAL
  assert.equal(central.comoCentral, 2);
  assert.equal(central.comoDot, 0);
});

test("el caso PELIGROSO se detecta: la location DOT espejando CENTRAL", () => {
  // Si esto diera asi, la integracion 25020 estaria escribiendo sobre el DOT y
  // el diseño de deltas quedaria invalidado antes de escribirse una linea.
  const filas = [
    fila("A", 10, 3, [{ locationId: DOT, location: "DOT", available: 10 }]),
    fila("B", 8, 2, [{ locationId: DOT, location: "DOT", available: 8 }]),
  ];
  const r = resumirCoincidencias(filas);
  assert.equal(r[0].comoCentral, 2);
  assert.equal(r[0].comoDot, 0);
});

test("una location que no coincide con ninguno se reporta igual", () => {
  const r = resumirCoincidencias([
    fila("A", 10, 3, [{ locationId: OTRA, location: "Deposito X", available: 99 }]),
  ]);
  assert.equal(r[0].total, 1);
  assert.equal(r[0].comoCentral, 0);
  assert.equal(r[0].comoDot, 0);
});

test("sin filas no inventa conclusiones", () => {
  assert.deepEqual(resumirCoincidencias([]), []);
});

// -----------------------------------------------------------------------------
// La garantia que hace seguro correr esto contra produccion
// -----------------------------------------------------------------------------

test("la query NO pide campos que exijan read_locations", () => {
  // La app tiene write_inventory, read_inventory y read_products. Pedir
  // Location.name o la query raiz `locations` devuelve ACCESS_DENIED y tumba la
  // corrida entera — verificado contra produccion en el run 32318874707.
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const src = readFileSync(join(raiz, "src/shopify.js"), "utf-8");
  const bloque = src.slice(src.indexOf("QUERY_NIVELES_TODAS"));
  assert.ok(!/location\s*\{[^}]*name/s.test(bloque), "Location.name exige read_locations");
  assert.ok(!/^\s*locations\s*\(/m.test(bloque), "la query raiz `locations` exige read_locations");
});

test("el diagnostico NO puede escribir: nada de mutations en su codigo", () => {
  // Se corre contra PRODUCCION y Contabilium no tiene sandbox. La garantia de
  // que es inocuo tiene que ser verificable, no una promesa del comentario: se
  // miran las lineas de codigo, sin los comentarios (que si nombran setearStock
  // justamente para explicar que no se usa).
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const crudo = readFileSync(join(raiz, "src/diagnostico-locations.js"), "utf-8");
  assert.match(crudo, /SOLO LECTURA/);

  const codigo = crudo
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  assert.ok(!/setearStock/.test(codigo), "no debe importar ni llamar a setearStock");
  assert.ok(
    !/MUTATION_SET|inventorySetQuantities|inventoryAdjust|mutation\s/i.test(codigo),
    "no debe referenciar ninguna mutation"
  );
});
