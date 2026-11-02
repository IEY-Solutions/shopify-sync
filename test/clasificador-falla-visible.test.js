// R-12 / CA-12 — el clasificador no falla en silencio (AGENTS.md invariante 5;
// decision D-5 de la persona: "Rojo enseguida (Recommended)").
//
//   - un error del refresco se loguea UNA vez por corrida, con su mensaje:
//     "[CLASIFICADOR][ERROR] <par>: <mensaje>";
//   - ejecutarPar imprime un resumen por par: "[RESUMEN] <par>: clave=valor ...",
//     con clasificador y los contadores nuevos;
//   - evaluarCorrida da ok:false con clasificador "fallo", DESPUES de que las
//     escrituras se aplicaron y la libreta se guardo;
//   - sin deltas: "no_requerido" y ok:true.
//
// Hoy el camino de produccion (correrTodosLosPares -> ejecutarPar) no imprime
// ningun resumen y el `catch {}` del clasificador se traga el error: este
// archivo falla con ese codigo.
//
// Corre con: node --test test/clasificador-falla-visible.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { evaluarCorrida, evaluarCorridaMultiPar } from "../src/resultado.js";
import {
  conDirTemporal,
  depsFake,
  llamadasVacias,
  reloj,
  sembrarLibreta,
  leerLibretaCruda,
  comprobanteReal,
  resumenSearch,
  escriturasDe,
  capturarConsola,
  lineaResumen,
  valorEnResumen,
  CLAVES_NUEVAS_RESUMEN,
  PAR_DOT,
  PAR_ISLA,
  DEPOSITO_DOT,
  DEPOSITO_ISLA,
  LOCATION_DOT,
  LOCATION_ISLA,
} from "./_helpers-clasificador.js";

const CORTE_VIEJO = "2026-08-01T00:00:00.000Z";
const T = "2026-08-12T22:30:00.000Z";

test("CA-12: con /search fallando en una corrida con deltas: log [CLASIFICADOR][ERROR] una vez con el mensaje, resumen con clasificador=fallo, libreta guardada y evaluarCorrida ok:false", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { "IEY-A": 10, "IEY-B": 10, "IEY-C": 10 },
      contabilium: { "IEY-A": 10, "IEY-B": 10, "IEY-C": 10 },
      corte: CORTE_VIEJO,
    });
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-A", 9], ["IEY-B", 8], ["IEY-C", 7]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 10], ["IEY-B", 10], ["IEY-C", 10]])]]),
      fallaBusqueda: true,
      llamadas,
    });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    // Log de error: una sola linea por corrida (tres SKUs con delta), con el mensaje.
    const errores = lineas.filter((l) => l.texto.includes("[CLASIFICADOR][ERROR]"));
    assert.equal(errores.length, 1, `una vez por corrida, no una por SKU. Lineas: ${JSON.stringify(errores)}`);
    assert.match(errores[0].texto, /\[CLASIFICADOR\]\[ERROR\] dot: /);
    assert.match(errores[0].texto, /fallo simulado de busqueda/, "con el mensaje del error");

    // Resumen impreso del par.
    const resumenes = lineaResumen(lineas, "dot");
    assert.equal(resumenes.length, 1, "un resumen impreso por par");
    const texto = resumenes[0].texto;
    for (const clave of CLAVES_NUEVAS_RESUMEN) {
      assert.notEqual(valorEnResumen(texto, clave), undefined, `el resumen impreso tiene que mostrar ${clave}: "${texto}"`);
    }
    assert.equal(valorEnResumen(texto, "clasificador"), "fallo");
    assert.equal(valorEnResumen(texto, "causa_desconocida"), "3");
    assert.equal(valorEnResumen(texto, "notas_credito_shopify"), "0");

    // Las escrituras se aplicaron y la libreta se guardo ANTES del veredicto.
    assert.deepEqual(escriturasDe(llamadas, "IEY-A"), [9]);
    assert.deepEqual(escriturasDe(llamadas, "IEY-C"), [7]);
    assert.deepEqual(leerLibretaCruda(dir, "dot").contabilium, { "IEY-A": 9, "IEY-B": 8, "IEY-C": 7 });

    // Veredicto: rojo.
    assert.equal(res.clasificador, "fallo");
    const v = evaluarCorrida(res);
    assert.equal(v.ok, false, "clasificador fallo: la corrida no puede salir en verde");
    assert.match(v.motivo, /clasificador/i);
  });
});

test("CA-12: el veredicto multi-par tambien queda en rojo, y el error se loguea una sola vez aunque haya dos pares", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    sembrarLibreta(dir, "galerias-pacifico", { skus: { "IEY-I": 10 }, contabilium: { "IEY-I": 10 }, corte: CORTE_VIEJO });
    const llamadas = llamadasVacias();
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([
        [DEPOSITO_DOT, new Map([["IEY-A", 9]])],
        [DEPOSITO_ISLA, new Map([["IEY-I", 9]])],
      ]),
      shopify: new Map([
        [LOCATION_DOT, new Map([["IEY-A", 10]])],
        [LOCATION_ISLA, new Map([["IEY-I", 10]])],
      ]),
      fallaBusqueda: true,
      llamadas,
    });

    const { valor: porPar, lineas } = await capturarConsola(() => sync.correrTodosLosPares([PAR_DOT, PAR_ISLA], deps));
    assert.equal(lineas.filter((l) => l.texto.includes("[CLASIFICADOR][ERROR]")).length, 1, "una vez por corrida");
    assert.equal(lineaResumen(lineas, "dot").length, 1);
    assert.equal(lineaResumen(lineas, "galerias-pacifico").length, 1);
    const v = evaluarCorridaMultiPar(porPar);
    assert.equal(v.ok, false);
    assert.deepEqual(escriturasDe(llamadas, "IEY-I", LOCATION_ISLA), [9], "la isla aplico su delta igual");
  });
});

test("CA-12: sin deltas ni creditos el estado es no_requerido y evaluarCorrida devuelve ok:true", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-A": 10 }, contabilium: { "IEY-A": 10 }, corte: CORTE_VIEJO });
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-A", 10]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-A", 10]])]]),
      fallaBusqueda: true, // no se llega a usar
    });
    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));
    assert.equal(res.clasificador, "no_requerido");
    assert.equal(evaluarCorrida(res).ok, true);
    assert.equal(lineas.filter((l) => l.texto.includes("[CLASIFICADOR][ERROR]")).length, 0);
    const [r] = lineaResumen(lineas, "dot");
    assert.ok(r, "el resumen se imprime siempre, tambien sin refresco");
    assert.equal(valorEnResumen(r.texto, "clasificador"), "no_requerido");
  });
});

test("CA-12 / D-8: con el refresco OK, una nota de credito Shopify del deposito se CUENTA (notas_credito_shopify=1) y no se acredita", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-C09-GRIS": 3 }, contabilium: { "IEY-C09-GRIS": 3 }, corte: CORTE_VIEJO });
    const llamadas = llamadasVacias();
    const ncb = { ...comprobanteReal(), Id: 177999001, TipoFc: "NCB" };
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-C09-GRIS", 4]])]]), // la NC repuso 1 en Contabilium
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-C09-GRIS", 3]])]]),
      search: [resumenSearch(177999001, "NCB")],
      detalles: new Map([[177999001, ncb]]),
      llamadas,
    });
    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));
    assert.equal(res.clasificador, "ok");
    assert.equal(res.notas_credito_shopify, 1);
    assert.equal(res.causa_venta_shopify, 0);
    assert.deepEqual(escriturasDe(llamadas, "IEY-C09-GRIS"), [4], "delta +1 puro: la NC no se acredita (fuera de alcance, D-8)");
    const [r] = lineaResumen(lineas, "dot");
    assert.equal(valorEnResumen(r.texto, "notas_credito_shopify"), "1");
    assert.equal(evaluarCorrida(res).ok, true);
  });
});

test("CA-12: el resumen impreso no lleva SKUs (repo y logs publicos)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "IEY-SECRETO-1": 10 }, contabilium: { "IEY-SECRETO-1": 10 }, corte: CORTE_VIEJO });
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([[DEPOSITO_DOT, new Map([["IEY-SECRETO-1", 9]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["IEY-SECRETO-1", 10]])]]),
      fallaBusqueda: true,
    });
    const { lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));
    const [r] = lineaResumen(lineas, "dot");
    assert.ok(r);
    assert.ok(!r.texto.includes("IEY-SECRETO-1"));
  });
});
