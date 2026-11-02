// R-15 / CA-15 — la compuerta manual NO aplicada no sale en verde (revision de
// codigo del 02/11/2026, hallazgo I-1; AGENTS.md invariante 5: "Prohibido fallar
// en silencio").
//
// Escenario real: se dispara ESCRITURA_ABSOLUTA=IEY-C09-GRIX (error de tipeo), o
// el SKU existe pero queda no_encontrado / no_activado / ambiguo / error en todos
// los pares. No se escribe ningun absoluto, el workflow imprime "ESCRITURA
// ABSOLUTA activa", main loguea "[COMPUERTA] ... 1 SKU(s)" y la corrida sale 0:
// el operador cree que quedo aplicado.
//
// Interfaz (DISENO-INTERFAZ.md seccion 6.1):
//   - ejecutarPar: el [RESUMEN] de cada par lleva compuerta_pedidos (SKUs de la
//     compuerta presentes en el stock del deposito del par) y compuerta_aplicados
//     (de esos, los que quedaron actualizado, sin_cambios o dry con el absoluto);
//     el valor devuelto lleva ademas, SIN imprimirlo, compuertaSkus:
//     { pedidos: [sku...], aplicados: [sku...], noActivados: [sku...] }
//     (noActivados: de los pedidos, los que quedaron no_activado; ronda 5b).
//   - evaluarCorridaMultiPar(porPar, umbral, { escrituraAbsoluta }): si
//     escrituraAbsoluta es un Set, un SKU de la lista es "no aplicado" (ok:false
//     y compuertaNoAplicados: [sku...]) si (a) no figura en `aplicados` de
//     NINGUN par, o (b) ronda 5b: en algun par no pendiente donde esta en
//     `pedidos`, no esta ni en `aplicados` ni en `noActivados` (error, ambiguo,
//     no_encontrado...). Solo `no_activado` se tolera en un par si se aplico en
//     otro. "todos": sin regla por SKU.
//   - main: pasa { escrituraAbsoluta } como tercer argumento e imprime UNA linea
//     "[COMPUERTA][ERROR] ..." que nombra los SKUs no aplicados, sin que un valor
//     del entorno pueda formar un comando de workflow (N-10): ni una linea que
//     empiece con "::" ni un "##[" en cualquier posicion (formato viejo del
//     runner; ronda 5b). Tolera un veredicto sin compuertaNoAplicados (= []).
//
// Se ejercita el camino real: main -> correrTodosLosPares (de src/sync.js, con
// depsFake sobre un directorio temporal) -> evaluarCorridaMultiPar real. Cada
// escenario corre en el modo por defecto y en --full (R-13/CA-13: los dos modos
// que llevan compuerta).
//
// Corre con: node --test test/compuerta-no-aplicada.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { evaluarCorridaMultiPar } from "../src/resultado.js";
import { SkuAmbiguoError } from "../src/shopify.js";
import { comandosEfectivos } from "./_helpers-comandos-workflow.js";
import {
  conDirTemporal,
  depsFake,
  llamadasVacias,
  reloj,
  sembrarLibreta,
  leerLibretaCruda,
  escriturasDe,
  capturarConsola,
  lineaResumen,
  valorEnResumen,
  guardiaDeEscriturasEnRepo,
  PAR_DOT,
  PAR_ISLA,
  DEPOSITO_DOT,
  DEPOSITO_ISLA,
  LOCATION_DOT,
  LOCATION_ISLA,
} from "./_helpers-clasificador.js";

// Import dinamico: si src/main.js no existe, fallan solo los casos que lo usan.
let mainMod = {};
try {
  mainMod = await import("../src/main.js");
} catch {
  mainMod = {};
}

const CORTE_VIEJO = "2026-08-01T00:00:00.000Z";
const T = "2026-08-12T16:00:00.000Z";
const MODOS = [[], ["--full"]];
const nombreModo = (argv) => (argv.length ? argv.join(" ") : "modo por defecto");

// -----------------------------------------------------------------------------
// Escenario fijo de dos pares, sin deltas (clasificador no_requerido):
//
//   DOT  (127356):  IEY-C09-GRIS  Contabilium 5, Shopify 4   -> con compuerta: actualizado 4 -> 5
//                   IEY-B         Contabilium 3, Shopify 3   -> con compuerta: sin_cambios
//                   IEY-Z         Contabilium 4, no existe en Shopify -> no_encontrado
//   ISLA (999001):  IEY-C09-GRIS  Contabilium 2, no activado (o Shopify 1 con islaActiva)
//                   IEY-I         Contabilium 4, Shopify 4   (mantiene la isla "efectiva")
//                   IEY-Z         Contabilium 1, no activado -> no_activado
// -----------------------------------------------------------------------------
function prepararEscenario(dir, { islaActiva = false, dryRun = false } = {}) {
  sembrarLibreta(dir, "dot", {
    skus: { "IEY-C09-GRIS": 5, "IEY-B": 3, "IEY-Z": 4 },
    contabilium: { "IEY-C09-GRIS": 5, "IEY-B": 3, "IEY-Z": 4 },
    corte: CORTE_VIEJO,
  });
  sembrarLibreta(dir, "galerias-pacifico", {
    skus: { "IEY-C09-GRIS": 2, "IEY-I": 4, "IEY-Z": 1 },
    contabilium: { "IEY-C09-GRIS": 2, "IEY-I": 4, "IEY-Z": 1 },
    corte: CORTE_VIEJO,
  });
  const llamadas = llamadasVacias();
  const deps = depsFake({
    dir,
    reloj: reloj(T),
    stock: new Map([
      [DEPOSITO_DOT, new Map([["IEY-C09-GRIS", 5], ["IEY-B", 3], ["IEY-Z", 4]])],
      [DEPOSITO_ISLA, new Map([["IEY-C09-GRIS", 2], ["IEY-I", 4], ["IEY-Z", 1]])],
    ]),
    shopify: new Map([
      [LOCATION_DOT, new Map([["IEY-C09-GRIS", 4], ["IEY-B", 3]])],
      [LOCATION_ISLA, new Map([["IEY-C09-GRIS", islaActiva ? 1 : null], ["IEY-I", 4], ["IEY-Z", null]])],
    ]),
    dryRun,
    llamadas,
  });
  return { deps, llamadas };
}

// main con el cableado real salvo el origen de los pares y las deps de sync.
// evaluarCorridaMultiPar NO se inyecta: corre el real.
async function correrMain(argv, env, depsSync) {
  const capturado = { porPar: null, opciones: null };
  const deps = {
    construirPares: () => [PAR_DOT, PAR_ISLA],
    correrTodosLosPares: async (pares, _depsIgnoradas, opciones) => {
      capturado.opciones = opciones;
      capturado.porPar = await sync.correrTodosLosPares(pares, depsSync, opciones);
      return capturado.porPar;
    },
  };
  const { valor: codigo, lineas } = await capturarConsola(() => mainMod.main(argv, env, deps));
  // Lineas FISICAS: un console.error("a\nb") son dos lineas en el log de Actions.
  const fisicas = lineas.flatMap((l) => l.texto.split(/\r\n|\r|\n/));
  return { codigo, lineas, fisicas, ...capturado };
}

const lineasCompuertaError = (fisicas) => fisicas.filter((t) => t.includes("[COMPUERTA][ERROR]"));
const ordenado = (xs) => [...(xs ?? [])].sort();

function resumenImpreso(lineas, nombrePar) {
  const rs = lineaResumen(lineas, nombrePar);
  assert.equal(rs.length, 1, `un [RESUMEN] para ${nombrePar}`);
  const texto = rs[0].texto;
  assert.doesNotMatch(texto, /IEY-/, `el [RESUMEN] no nombra SKUs (repo y logs publicos): "${texto}"`);
  return {
    pedidos: valorEnResumen(texto, "compuerta_pedidos"),
    aplicados: valorEnResumen(texto, "compuerta_aplicados"),
    texto,
  };
}

// Ronda 5b: `noActivados` (de los pedidos, los que quedaron no_activado) es parte
// de la interfaz de compuertaSkus; todos los escenarios lo fijan.
function verificarConteos(r, par, nombrePar, { pedidos, aplicados, noActivados }) {
  const imp = resumenImpreso(r.lineas, nombrePar);
  assert.equal(imp.pedidos, String(pedidos.length), `[RESUMEN] ${nombrePar}: compuerta_pedidos ("${imp.texto}")`);
  assert.equal(imp.aplicados, String(aplicados.length), `[RESUMEN] ${nombrePar}: compuerta_aplicados ("${imp.texto}")`);
  const res = r.porPar?.[par];
  assert.ok(res, `resultado del par ${par}`);
  assert.equal(res.compuerta_pedidos, pedidos.length, `${par}: compuerta_pedidos en el valor devuelto`);
  assert.equal(res.compuerta_aplicados, aplicados.length, `${par}: compuerta_aplicados en el valor devuelto`);
  assert.deepEqual(ordenado(res.compuertaSkus?.pedidos), ordenado(pedidos), `${par}: compuertaSkus.pedidos`);
  assert.deepEqual(ordenado(res.compuertaSkus?.aplicados), ordenado(aplicados), `${par}: compuertaSkus.aplicados`);
  assert.ok(Array.isArray(noActivados), "verificarConteos: el caso tiene que fijar noActivados");
  assert.deepEqual(ordenado(res.compuertaSkus?.noActivados), ordenado(noActivados), `${par}: compuertaSkus.noActivados (ronda 5b)`);
}

// Ronda 5b: resolverSku que falla SOLO para un SKU en una location (para dejar
// un SKU en error o ambiguo en el DOT mientras se aplica en la isla).
function conFallaEn(deps, { sku, locationId, ambiguo = false }) {
  const real = deps.resolverSku;
  return {
    ...deps,
    resolverSku: async (s, loc) => {
      if (s === sku && loc === locationId) {
        if (ambiguo) {
          throw new SkuAmbiguoError(s, [
            { id: "gid://shopify/ProductVariant/M-1", product: { id: "gid://shopify/Product/M", title: "Fixture M (1)" } },
            { id: "gid://shopify/ProductVariant/M-2", product: { id: "gid://shopify/Product/M", title: "Fixture M (2)" } },
          ]);
        }
        throw new Error(`Shopify caido para ${s} (simulado)`);
      }
      return real(s, loc);
    },
  };
}

// -----------------------------------------------------------------------------
// 1. Rojo: el SKU de la compuerta no existe en ningun par (error de tipeo)
// -----------------------------------------------------------------------------
for (const argv of MODOS) {
  test(`CA-15 (${nombreModo(argv)}): ESCRITURA_ABSOLUTA con un SKU inexistente en los dos pares (IEY-C09-GRIX) sale en rojo con [COMPUERTA][ERROR]`, async (t) => {
    guardiaDeEscriturasEnRepo(t);
    await conDirTemporal(async (dir) => {
      const { deps, llamadas } = prepararEscenario(dir);
      const env = { ESCRITURA_ABSOLUTA: "IEY-C09-GRIX", MOTIVO: "recuento fisico" };
      const r = await correrMain(argv, env, deps);

      assert.equal(typeof r.codigo, "number");
      assert.notEqual(r.codigo, 0, "una compuerta que no se aplico en ningun lado no puede salir 0 (invariante 5)");
      const errores = lineasCompuertaError(r.fisicas);
      assert.equal(errores.length, 1, `una sola linea [COMPUERTA][ERROR]: ${JSON.stringify(errores)}`);
      assert.match(errores[0], /^\s*\[COMPUERTA\]\[ERROR\]/);
      assert.ok(errores[0].includes("IEY-C09-GRIX"), `la linea nombra el SKU no aplicado: "${errores[0]}"`);

      verificarConteos(r, "dot", "dot", { pedidos: [], aplicados: [], noActivados: [] });
      verificarConteos(r, "galerias-pacifico", "galerias-pacifico", { pedidos: [], aplicados: [], noActivados: [] });
      assert.deepEqual(llamadas.setearStock, [], "no se escribio nada");

      const v = evaluarCorridaMultiPar(r.porPar, undefined, { escrituraAbsoluta: new Set(["IEY-C09-GRIX"]) });
      assert.equal(v.ok, false);
      assert.deepEqual(ordenado(v.compuertaNoAplicados), ["IEY-C09-GRIX"]);
    });
  });
}

// -----------------------------------------------------------------------------
// 2. Rojo: el SKU existe pero no queda aplicado en ningun par
// -----------------------------------------------------------------------------
for (const argv of MODOS) {
  test(`CA-15 (${nombreModo(argv)}): un SKU que queda no_encontrado en el DOT y no_activado en la isla sale en rojo`, async (t) => {
    guardiaDeEscriturasEnRepo(t);
    await conDirTemporal(async (dir) => {
      const { deps } = prepararEscenario(dir);
      const r = await correrMain(argv, { ESCRITURA_ABSOLUTA: "IEY-Z", MOTIVO: "recuento fisico" }, deps);

      assert.notEqual(r.codigo, 0);
      const errores = lineasCompuertaError(r.fisicas);
      assert.equal(errores.length, 1, JSON.stringify(errores));
      assert.ok(errores[0].includes("IEY-Z"), errores[0]);

      // Visible por par: le correspondia a los dos y no se aplico en ninguno.
      verificarConteos(r, "dot", "dot", { pedidos: ["IEY-Z"], aplicados: [], noActivados: [] });
      verificarConteos(r, "galerias-pacifico", "galerias-pacifico", { pedidos: ["IEY-Z"], aplicados: [], noActivados: ["IEY-Z"] });
    });
  });
}

// -----------------------------------------------------------------------------
// 3. Rojo mixto: uno aplicado y otro no. La linea nombra SOLO el no aplicado, y
//    el rojo llega despues de escribir y guardar (como R-12).
// -----------------------------------------------------------------------------
for (const argv of MODOS) {
  test(`CA-15 (${nombreModo(argv)}): con un SKU aplicado y otro inexistente, rojo que nombra solo el inexistente, y la escritura del aplicado igual ocurre`, async (t) => {
    guardiaDeEscriturasEnRepo(t);
    await conDirTemporal(async (dir) => {
      const { deps, llamadas } = prepararEscenario(dir);
      const r = await correrMain(argv, { ESCRITURA_ABSOLUTA: "IEY-C09-GRIX,IEY-C09-GRIS", MOTIVO: "recuento fisico" }, deps);

      assert.notEqual(r.codigo, 0);
      const errores = lineasCompuertaError(r.fisicas);
      assert.equal(errores.length, 1, JSON.stringify(errores));
      assert.ok(errores[0].includes("IEY-C09-GRIX"), errores[0]);
      assert.ok(!errores[0].includes("IEY-C09-GRIS"), `no nombra el SKU que SI se aplico: "${errores[0]}"`);

      assert.deepEqual(escriturasDe(llamadas, "IEY-C09-GRIS", LOCATION_DOT), [5], "el absoluto del DOT se escribio igual");
      assert.equal(leerLibretaCruda(dir, "dot").resembradoEn?.["IEY-C09-GRIS"], T, "y la libreta (con resembradoEn, R-7) se guardo antes del veredicto");
      verificarConteos(r, "dot", "dot", { pedidos: ["IEY-C09-GRIS"], aplicados: ["IEY-C09-GRIS"], noActivados: [] });
      verificarConteos(r, "galerias-pacifico", "galerias-pacifico", { pedidos: ["IEY-C09-GRIS"], aplicados: [], noActivados: ["IEY-C09-GRIS"] });

      const v = evaluarCorridaMultiPar(r.porPar, undefined, { escrituraAbsoluta: new Set(["IEY-C09-GRIX", "IEY-C09-GRIS"]) });
      assert.equal(v.ok, false);
      assert.deepEqual(ordenado(v.compuertaNoAplicados), ["IEY-C09-GRIX"]);
    });
  });
}

// -----------------------------------------------------------------------------
// 4. No rojo: aplicado en un par y no_activado en el otro (hoy la isla tiene la
//    mayoria de los SKUs no_activado). El resumen por par lo deja visible. Desde
//    la ronda 5b, no_activado es el UNICO estado tolerado (ver 4b/4c).
// -----------------------------------------------------------------------------
for (const argv of MODOS) {
  test(`CA-15 (${nombreModo(argv)}): un SKU aplicado en el DOT y no_activado en la isla NO pone la corrida en rojo, y el [RESUMEN] de la isla lo muestra`, async (t) => {
    guardiaDeEscriturasEnRepo(t);
    await conDirTemporal(async (dir) => {
      const { deps, llamadas } = prepararEscenario(dir);
      const r = await correrMain(argv, { ESCRITURA_ABSOLUTA: "IEY-C09-GRIS", MOTIVO: "recuento fisico" }, deps);

      assert.equal(r.codigo, 0, `aplicado en un par alcanza. Lineas: ${JSON.stringify(r.fisicas)}`);
      assert.deepEqual(lineasCompuertaError(r.fisicas), []);
      assert.deepEqual(escriturasDe(llamadas, "IEY-C09-GRIS", LOCATION_DOT), [5]);
      verificarConteos(r, "dot", "dot", { pedidos: ["IEY-C09-GRIS"], aplicados: ["IEY-C09-GRIS"], noActivados: [] });
      verificarConteos(r, "galerias-pacifico", "galerias-pacifico", { pedidos: ["IEY-C09-GRIS"], aplicados: [], noActivados: ["IEY-C09-GRIS"] });

      const v = evaluarCorridaMultiPar(r.porPar, undefined, { escrituraAbsoluta: new Set(["IEY-C09-GRIS"]) });
      assert.equal(v.ok, true, v.motivo);
      assert.deepEqual(ordenado(v.compuertaNoAplicados), []);
    });
  });
}

// -----------------------------------------------------------------------------
// 4b / 4c (ronda 5b, decision del orquestador por la invariante 5): la
// tolerancia "aplicado en algun par" era para la isla con SKUs no_activado.
// Solo `no_activado` se tolera. Un SKU que se aplica en la isla y queda en
// `error` o `ambiguo` en el DOT (donde estaba pedido: esta en su stock) deja la
// corrida en rojo, y la linea [COMPUERTA][ERROR] lo nombra.
//
// En 4b el DOT ademas queda en rojo por el umbral de error (1 de 3 SKUs), asi
// que lo que discrimina es la linea y compuertaNoAplicados. En 4c `ambiguo` no
// cuenta para el umbral: ahi discrimina tambien el codigo de salida.
// -----------------------------------------------------------------------------
for (const [etiqueta, ambiguo] of [["error", false], ["ambiguo", true]]) {
  for (const argv of MODOS) {
    test(`CA-15 (ronda 5b, ${nombreModo(argv)}): un SKU aplicado en la isla y en ${etiqueta} en el DOT sale en rojo y la linea [COMPUERTA][ERROR] lo nombra`, async (t) => {
      guardiaDeEscriturasEnRepo(t);
      await conDirTemporal(async (dir) => {
        const base = prepararEscenario(dir, { islaActiva: true });
        const deps = conFallaEn(base.deps, { sku: "IEY-C09-GRIS", locationId: LOCATION_DOT, ambiguo });
        const r = await correrMain(argv, { ESCRITURA_ABSOLUTA: "IEY-C09-GRIS", MOTIVO: "recuento fisico" }, deps);

        assert.equal(typeof r.codigo, "number");
        assert.notEqual(r.codigo, 0, `la compuerta quedo en ${etiqueta} en el DOT: no puede salir 0 (invariante 5)`);
        const errores = lineasCompuertaError(r.fisicas);
        assert.equal(errores.length, 1, `una sola linea [COMPUERTA][ERROR]: ${JSON.stringify(errores)}`);
        assert.ok(errores[0].includes("IEY-C09-GRIS"), `la linea nombra el SKU que no quedo aplicado en el DOT: "${errores[0]}"`);

        // La isla si escribio el absoluto (2), el DOT no escribio nada.
        assert.deepEqual(escriturasDe(base.llamadas, "IEY-C09-GRIS", LOCATION_ISLA), [2], "la isla aplico el absoluto");
        assert.deepEqual(escriturasDe(base.llamadas, "IEY-C09-GRIS", LOCATION_DOT), [], `el DOT quedo en ${etiqueta}`);
        verificarConteos(r, "dot", "dot", { pedidos: ["IEY-C09-GRIS"], aplicados: [], noActivados: [] });
        verificarConteos(r, "galerias-pacifico", "galerias-pacifico", { pedidos: ["IEY-C09-GRIS"], aplicados: ["IEY-C09-GRIS"], noActivados: [] });
        assert.equal(r.porPar.dot[etiqueta], 1, `el DOT conto el SKU como ${etiqueta}`);

        const v = evaluarCorridaMultiPar(r.porPar, undefined, { escrituraAbsoluta: new Set(["IEY-C09-GRIS"]) });
        assert.equal(v.ok, false);
        assert.deepEqual(ordenado(v.compuertaNoAplicados), ["IEY-C09-GRIS"]);
      });
    });
  }
}

// -----------------------------------------------------------------------------
// 5. Verde: todos aplicados (actualizado y sin_cambios cuentan)
// -----------------------------------------------------------------------------
for (const argv of MODOS) {
  test(`CA-15 (${nombreModo(argv)}): todos los SKUs de la compuerta aplicados (actualizado o sin_cambios) sale en verde, sin [COMPUERTA][ERROR]`, async (t) => {
    guardiaDeEscriturasEnRepo(t);
    await conDirTemporal(async (dir) => {
      const { deps, llamadas } = prepararEscenario(dir, { islaActiva: true });
      const r = await correrMain(argv, { ESCRITURA_ABSOLUTA: "IEY-C09-GRIS,IEY-B", MOTIVO: "recuento fisico" }, deps);

      assert.equal(r.codigo, 0, JSON.stringify(r.fisicas));
      assert.deepEqual(lineasCompuertaError(r.fisicas), []);
      assert.deepEqual(escriturasDe(llamadas, "IEY-C09-GRIS", LOCATION_DOT), [5]);
      assert.deepEqual(escriturasDe(llamadas, "IEY-C09-GRIS", LOCATION_ISLA), [2]);
      // IEY-B: Shopify ya tenia 3 = absoluto -> sin_cambios, y cuenta como aplicado.
      verificarConteos(r, "dot", "dot", { pedidos: ["IEY-B", "IEY-C09-GRIS"], aplicados: ["IEY-B", "IEY-C09-GRIS"], noActivados: [] });
      verificarConteos(r, "galerias-pacifico", "galerias-pacifico", { pedidos: ["IEY-C09-GRIS"], aplicados: ["IEY-C09-GRIS"], noActivados: [] });
    });
  });
}

// -----------------------------------------------------------------------------
// 6. DRY_RUN: el error de tipeo se detecta igual; `dry` cuenta como aplicado
//    (en una simulacion ningun SKU se escribe: si `dry` no contara, ensayar la
//    compuerta en dry_run saldria siempre en rojo).
// -----------------------------------------------------------------------------
for (const argv of MODOS) {
  test(`CA-15 (${nombreModo(argv)}): en DRY_RUN un SKU inexistente sale en rojo y uno con diferencia (dry) cuenta como aplicado`, async (t) => {
    guardiaDeEscriturasEnRepo(t);
    await conDirTemporal(async (dir) => {
      const tipeo = prepararEscenario(dir, { dryRun: true });
      const rojo = await correrMain(argv, { ESCRITURA_ABSOLUTA: "IEY-C09-GRIX", MOTIVO: "ensayo" }, tipeo.deps);
      assert.notEqual(rojo.codigo, 0);
      assert.equal(lineasCompuertaError(rojo.fisicas).length, 1);
    });
    await conDirTemporal(async (dir) => {
      const { deps, llamadas } = prepararEscenario(dir, { dryRun: true });
      const r = await correrMain(argv, { ESCRITURA_ABSOLUTA: "IEY-C09-GRIS", MOTIVO: "ensayo" }, deps);
      assert.deepEqual(llamadas.setearStock, [], "DRY_RUN no escribe");
      assert.equal(r.porPar.dot.dry >= 1, true, "IEY-C09-GRIS quedo dry en el DOT");
      assert.equal(r.codigo, 0, JSON.stringify(r.fisicas));
      assert.deepEqual(lineasCompuertaError(r.fisicas), []);
      verificarConteos(r, "dot", "dot", { pedidos: ["IEY-C09-GRIS"], aplicados: ["IEY-C09-GRIS"], noActivados: [] });
    });
  });
}

// -----------------------------------------------------------------------------
// 7. "todos": no hay lista que contrastar; los conteos igual se imprimen
// -----------------------------------------------------------------------------
for (const argv of MODOS) {
  test(`CA-15 (${nombreModo(argv)}): con ESCRITURA_ABSOLUTA=todos no hay regla por SKU (sin [COMPUERTA][ERROR]) y el resumen cuenta los SKUs del deposito`, async (t) => {
    guardiaDeEscriturasEnRepo(t);
    await conDirTemporal(async (dir) => {
      const { deps } = prepararEscenario(dir);
      const r = await correrMain(argv, { ESCRITURA_ABSOLUTA: "todos", MOTIVO: "recuento general" }, deps);
      assert.equal(r.codigo, 0, JSON.stringify(r.fisicas));
      assert.deepEqual(lineasCompuertaError(r.fisicas), []);
      const dot = resumenImpreso(r.lineas, "dot");
      assert.equal(dot.pedidos, "3", dot.texto);
      assert.equal(dot.aplicados, "2", `GRIS actualizado y B sin_cambios; Z no_encontrado: ${dot.texto}`);
      const isla = resumenImpreso(r.lineas, "galerias-pacifico");
      assert.equal(isla.pedidos, "3", isla.texto);
      assert.equal(isla.aplicados, "1", `solo IEY-I: ${isla.texto}`);
    });
  });
}

// -----------------------------------------------------------------------------
// 8. La linea que nombra SKUs del entorno no reabre la inyeccion de N-10
// -----------------------------------------------------------------------------
// Ronda 5b: ademas de "::" al inicio de una linea, el runner toma como comando
// del formato viejo cualquier "##[" en cualquier posicion de una linea que no es
// un comando "::" (actions/runner, ActionCommand.TryParse; ver
// test/_helpers-comandos-workflow.js). La linea [COMPUERTA][ERROR] la imprime
// node y nunca es un comando "::": un SKU con "##[" adentro la convertiria en un
// comando. Se aceptan las dos alternativas seguras de R-15:
//   - sanear: la corrida sigue, sale distinto de 0 con al menos una linea
//     [COMPUERTA][ERROR], y ninguna linea es un comando;
//   - rechazar: parsearEscrituraAbsoluta (o resolverModo) trata un SKU con
//     caracteres de control, "::" o "##[" como error de uso: main devuelve 2
//     antes de correr el sync, y la linea [USO] tampoco es un comando.
// En los dos casos se mira TODA la salida con el simulador (V2 y formato viejo),
// no solo la linea [COMPUERTA][ERROR].
test("CA-15 (ronda 5, 5b: ##[): un valor de ESCRITURA_ABSOLUTA con salto de linea, :: o ##[ no produce ningun comando de workflow en la salida de main", async (t) => {
  guardiaDeEscriturasEnRepo(t);
  const valores = [
    "IEY-NOEXISTE\n::error::INYECCION",
    "IEY-NOEXISTE\r::add-mask::INYECCION",
    "::stop-commands::INYECCION",
    "##[error]INYECCION",
    "IEY-NOEXISTE ##[error]INYECCION",
  ];
  for (const valor of valores) {
    await conDirTemporal(async (dir) => {
      const { deps, llamadas } = prepararEscenario(dir);
      const r = await correrMain([], { ESCRITURA_ABSOLUTA: valor, MOTIVO: "x" }, deps);
      const desc = `${JSON.stringify(valor)} -> codigo ${r.codigo}. Lineas: ${JSON.stringify(r.fisicas)}`;
      assert.equal(typeof r.codigo, "number", desc);
      if (r.codigo === 2) {
        // Alternativa "rechazar": error de uso antes de tocar nada.
        assert.equal(r.porPar, null, `error de uso: no se corre el sync. ${desc}`);
        assert.deepEqual(llamadas.getStockDeposito, [], `error de uso: no se lee Contabilium. ${desc}`);
        assert.deepEqual(llamadas.setearStock, [], `error de uso: no se escribe Shopify. ${desc}`);
      } else {
        // Alternativa "sanear": la corrida sigue y la compuerta no aplicada se reporta.
        assert.notEqual(r.codigo, 0, `no se aplico en ningun par. ${desc}`);
        assert.ok(lineasCompuertaError(r.fisicas).length >= 1, `la compuerta no aplicada se reporta igual. ${desc}`);
      }
      const { comandos, tokensDePausa } = comandosEfectivos(r.fisicas.join("\n"));
      assert.deepEqual(comandos, [], `linea que el runner tomaria como comando (:: o ##[). ${desc}`);
      assert.deepEqual(tokensDePausa, [], `::stop-commands:: emitido por main. ${desc}`);
    });
  }
});

// -----------------------------------------------------------------------------
// 9. evaluarCorridaMultiPar, puro (la interfaz exacta)
// -----------------------------------------------------------------------------
function res({ pedidos = [], aplicados = [], noActivados = [], ...extra } = {}) {
  return {
    total: 10,
    actualizado: 0,
    dry: 0,
    sin_cambios: 10,
    no_encontrado: 0,
    no_activado: 0,
    error: 0,
    ambiguo: 0,
    no_sincronizable: 0,
    saltado: 0,
    clasificador: "no_requerido",
    compuerta_pedidos: pedidos.length,
    compuerta_aplicados: aplicados.length,
    compuertaSkus: { pedidos, aplicados, noActivados },
    ...extra,
  };
}

test("CA-15: evaluarCorridaMultiPar con { escrituraAbsoluta }: SKU no aplicado en ningun par -> ok:false y compuertaNoAplicados; los pares, cada uno, siguen ok", () => {
  const porPar = { dot: res(), "galerias-pacifico": res() };
  const v = evaluarCorridaMultiPar(porPar, undefined, { escrituraAbsoluta: new Set(["IEY-C09-GRIX"]) });
  assert.equal(v.ok, false);
  assert.match(v.motivo, /compuerta|ESCRITURA_ABSOLUTA/i);
  assert.deepEqual(ordenado(v.compuertaNoAplicados), ["IEY-C09-GRIX"]);
  assert.equal(v.detalle.dot.ok, true, "el rojo es de la corrida, no de un par");
  assert.equal(v.detalle["galerias-pacifico"].ok, true);
});

// Ronda 5b: la isla del caso tiene IEY-A como `noActivados` (antes no habia
// estado por SKU: con la regla nueva un pedido que no es aplicado ni no_activado
// es rojo, ver los casos 9e a 9i).
test("CA-15: evaluarCorridaMultiPar: aplicado en un par y no_activado en el otro alcanza; un par pendiente no aplica nada", () => {
  const escrituraAbsoluta = new Set(["IEY-A", "IEY-B"]);
  const unPar = evaluarCorridaMultiPar(
    {
      dot: res({ pedidos: ["IEY-A", "IEY-B"], aplicados: ["IEY-A", "IEY-B"] }),
      "galerias-pacifico": res({ pedidos: ["IEY-A"], aplicados: [], noActivados: ["IEY-A"] }),
    },
    undefined,
    { escrituraAbsoluta }
  );
  assert.equal(unPar.ok, true, unPar.motivo);
  assert.deepEqual(ordenado(unPar.compuertaNoAplicados), []);

  const conPendiente = evaluarCorridaMultiPar(
    { dot: res({ pedidos: ["IEY-A"], aplicados: ["IEY-A"] }), "galerias-pacifico": { pendiente: true, motivo: "sin confirmar" } },
    undefined,
    { escrituraAbsoluta }
  );
  assert.equal(conPendiente.ok, false);
  assert.deepEqual(ordenado(conPendiente.compuertaNoAplicados), ["IEY-B"]);
});

test("CA-15: evaluarCorridaMultiPar sin tercer argumento, con escrituraAbsoluta null o 'todos', no aplica la regla por SKU (compatibilidad)", () => {
  const porPar = { dot: res(), "galerias-pacifico": res() };
  assert.equal(evaluarCorridaMultiPar(porPar).ok, true);
  assert.equal(evaluarCorridaMultiPar(porPar, undefined, {}).ok, true);
  assert.equal(evaluarCorridaMultiPar(porPar, undefined, { escrituraAbsoluta: null }).ok, true);
  const todos = evaluarCorridaMultiPar(porPar, undefined, { escrituraAbsoluta: "todos" });
  assert.equal(todos.ok, true);
  assert.deepEqual(ordenado(todos.compuertaNoAplicados), []);
});

test("CA-15: la regla de la compuerta se suma a las de siempre: un par con clasificador 'fallo' sigue en rojo y la lista igual se informa", () => {
  const v = evaluarCorridaMultiPar(
    { dot: res({ clasificador: "fallo" }), "galerias-pacifico": res() },
    undefined,
    { escrituraAbsoluta: new Set(["IEY-X"]) }
  );
  assert.equal(v.ok, false);
  assert.equal(v.detalle.dot.ok, false);
  assert.deepEqual(ordenado(v.compuertaNoAplicados), ["IEY-X"]);
});

// -----------------------------------------------------------------------------
// 9e-9i (ronda 5b): condicion (b). Un SKU de la lista es no aplicado si, en
// algun par NO pendiente donde esta en `pedidos`, no quedo ni en `aplicados` ni
// en `noActivados`, aunque se haya aplicado en otro par.
// -----------------------------------------------------------------------------
test("CA-15 (ronda 5b): evaluarCorridaMultiPar: aplicado en la isla y en error/ambiguo en el DOT (pedido, ni aplicado ni no_activado) -> ok:false con el SKU", () => {
  const v = evaluarCorridaMultiPar(
    {
      dot: res({ pedidos: ["IEY-A"], aplicados: [], noActivados: [] }),
      "galerias-pacifico": res({ pedidos: ["IEY-A"], aplicados: ["IEY-A"] }),
    },
    undefined,
    { escrituraAbsoluta: new Set(["IEY-A"]) }
  );
  assert.equal(v.ok, false);
  assert.match(v.motivo, /compuerta|ESCRITURA_ABSOLUTA/i);
  assert.deepEqual(ordenado(v.compuertaNoAplicados), ["IEY-A"]);
  assert.equal(v.detalle.dot.ok, true, "el rojo es de la corrida, no de un par");
  assert.equal(v.detalle["galerias-pacifico"].ok, true);
});

test("CA-15 (ronda 5b): evaluarCorridaMultiPar: aplicado en el DOT y ni aplicado ni no_activado en la isla -> ok:false (la condicion vale en cualquier par)", () => {
  const v = evaluarCorridaMultiPar(
    {
      dot: res({ pedidos: ["IEY-A"], aplicados: ["IEY-A"] }),
      "galerias-pacifico": res({ pedidos: ["IEY-A"], aplicados: [], noActivados: [] }),
    },
    undefined,
    { escrituraAbsoluta: new Set(["IEY-A"]) }
  );
  assert.equal(v.ok, false);
  assert.deepEqual(ordenado(v.compuertaNoAplicados), ["IEY-A"]);
});

test("CA-15 (ronda 5b): evaluarCorridaMultiPar: no_activado en todos los pares sigue siendo rojo (condicion a)", () => {
  const v = evaluarCorridaMultiPar(
    {
      dot: res({ pedidos: ["IEY-A"], aplicados: [], noActivados: ["IEY-A"] }),
      "galerias-pacifico": res({ pedidos: ["IEY-A"], aplicados: [], noActivados: ["IEY-A"] }),
    },
    undefined,
    { escrituraAbsoluta: new Set(["IEY-A"]) }
  );
  assert.equal(v.ok, false);
  assert.deepEqual(ordenado(v.compuertaNoAplicados), ["IEY-A"]);
});

test("CA-15 (ronda 5b): evaluarCorridaMultiPar: un par donde el SKU no estaba pedido, o un par pendiente, no activan la condicion (b)", () => {
  const escrituraAbsoluta = new Set(["IEY-A"]);
  const ausente = evaluarCorridaMultiPar(
    { dot: res({ pedidos: ["IEY-A"], aplicados: ["IEY-A"] }), "galerias-pacifico": res({ pedidos: [], aplicados: [] }) },
    undefined,
    { escrituraAbsoluta }
  );
  assert.equal(ausente.ok, true, `fuera del stock de la isla no es un fallo de la isla: ${ausente.motivo}`);
  assert.deepEqual(ordenado(ausente.compuertaNoAplicados), []);

  const pendiente = evaluarCorridaMultiPar(
    { dot: res({ pedidos: ["IEY-A"], aplicados: ["IEY-A"] }), "galerias-pacifico": { pendiente: true, motivo: "sin confirmar" } },
    undefined,
    { escrituraAbsoluta }
  );
  assert.equal(pendiente.ok, true, pendiente.motivo);
  assert.deepEqual(ordenado(pendiente.compuertaNoAplicados), []);
});

test("CA-15 (ronda 5b): evaluarCorridaMultiPar: con dos SKUs, solo el que fallo en un par va a compuertaNoAplicados", () => {
  const v = evaluarCorridaMultiPar(
    {
      dot: res({ pedidos: ["IEY-A", "IEY-B"], aplicados: ["IEY-A", "IEY-B"] }),
      "galerias-pacifico": res({ pedidos: ["IEY-A", "IEY-B"], aplicados: ["IEY-B"], noActivados: [] }),
    },
    undefined,
    { escrituraAbsoluta: new Set(["IEY-A", "IEY-B"]) }
  );
  assert.equal(v.ok, false);
  assert.deepEqual(ordenado(v.compuertaNoAplicados), ["IEY-A"]);
});
