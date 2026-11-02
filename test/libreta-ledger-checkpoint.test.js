// R-8 / CA-8 — persistencia del registro y de los consumos (diseño B).
//
//   - Baseline y consumo se escriben JUNTOS, en la misma escritura de la libreta,
//     en el checkpoint y en el guardado final: una corrida interrumpida deja los
//     dos para los SKUs procesados y ninguno de los dos para los no alcanzados.
//   - Al reanudar, nada ya consumido se reacredita (ni tras perder la cache).
//   - Un SKU en error no consume: conserva su credito y lo consume al resolverse.
//   - Ni el checkpoint ni syncUnSku borran consumos ya persistidos (syncUnSku:
//     test/sku-individual-usa-libreta-por-par.test.js).
//   - En DRY_RUN la libreta no cambia.
//   - La cache poda ids no relevantes de mas de 7 dias (y lineas de mas de 30).
//   - La libreta ya no contiene ultimaCorridaExitosa (D-7).
//   - Ronda 3: un consumo no se poda mientras su comprobante siga en la cache
//     (misma regla de dias ART para las dos podas), y un SKU no_activado o
//     ambiguo tampoco consume su credito.
//   - Ronda 4: la condicion "el comprobante sigue en la cache" probada sola; el
//     `dia` de la entrada es el del comprobante, recalculado al pasar a ok; la
//     cache se poda tambien al cargarse (falla de guardado + /search caido).
//
// Todas las verificaciones de persistencia leen el ARCHIVO REAL en un directorio
// temporal, no los spies en memoria.
//
// Corre con: node --test test/libreta-ledger-checkpoint.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as sync from "../src/sync.js";
import { SkuAmbiguoError } from "../src/shopify.js";
import {
  conDirTemporal,
  depsFake,
  llamadasVacias,
  reloj,
  sembrarLibreta,
  sembrarRegistro,
  leerLibretaCruda,
  leerRegistroCrudo,
  entradaShopify,
  entradaSinLineas,
  rutaRegistro,
  resumenSearch,
  comprobanteDetalle,
  escriturasDe,
  PAR_DOT,
  DEPOSITO_DOT,
  LOCATION_DOT,
  MIN,
  HORA,
  DIA,
} from "./_helpers-clasificador.js";

const CORTE_VIEJO = "2026-08-01T00:00:00.000Z";
const T = "2026-08-12T16:00:00.000Z";
const tMs = new Date(T).getTime();
const iso = (ms) => new Date(ms).toISOString();
const SKUS = ["SKU-1", "SKU-2", "SKU-3", "SKU-4", "SKU-5"];

// 5 SKUs, cada uno con delta -1 y una venta Shopify de 1 u. que lo explica
// (credito 1): ninguno deberia escribir en Shopify, y cada uno consume su linea.
function escenarioCincoConCredito(dir) {
  sembrarLibreta(dir, "dot", {
    skus: Object.fromEntries(SKUS.map((s) => [s, 10])),
    contabilium: Object.fromEntries(SKUS.map((s) => [s, 10])),
    corte: CORTE_VIEJO,
    consumos: { "111:SKU-VIEJO": { cantidad: 1, motivo: "delta", referencia: "2026-08-10T12:00:00.000Z", en: "2026-08-10T12:30:00.000Z" } },
  });
  sembrarRegistro(dir, {
    ultimoRefrescoOk: iso(tMs - 2 * HORA),
    comprobantes: SKUS.map((s, i) => entradaShopify({ id: 200 + i, sku: s, referencia: iso(tMs - HORA) })),
  });
  return {
    stock: new Map([[DEPOSITO_DOT, new Map(SKUS.map((s) => [s, 9]))]]),
    shopify: new Map([[LOCATION_DOT, new Map(SKUS.map((s) => [s, 9]))]]), // Shopify ya desconto cada venta
    search: SKUS.map((_, i) => resumenSearch(200 + i)),
  };
}

const clave = (i) => `${200 + i}:SKU-${i + 1}`;

test("CA-8: interrumpida tras un checkpoint, la libreta en disco tiene baseline Y consumo para los procesados, y ninguno de los dos para los no alcanzados", async () => {
  await conDirTemporal(async (dir) => {
    const esc = escenarioCincoConCredito(dir);
    const llamadas = llamadasVacias();
    let guardados = 0;
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      ...esc,
      llamadas,
      guardarSnapshotEnvoltorio: (real) => (...args) => {
        guardados++;
        if (guardados === 2) throw new Error("ENOSPC simulado en el segundo checkpoint");
        return real(...args);
      },
    });

    await assert.rejects(() => sync.ejecutarPar(PAR_DOT, deps, { checkpointCada: 2 }), /ENOSPC simulado/);

    const libreta = leerLibretaCruda(dir, "dot");
    // Procesados antes del primer checkpoint: SKU-1 y SKU-2.
    for (const i of [0, 1]) {
      assert.equal(libreta.contabilium[SKUS[i]], 9, `${SKUS[i]}: baseline avanzado`);
      assert.ok(libreta.consumos?.[clave(i)], `${SKUS[i]}: su consumo esta en la MISMA escritura que su baseline`);
      assert.equal(libreta.consumos[clave(i)].motivo, "delta");
    }
    // No alcanzados (o procesados despues del ultimo checkpoint exitoso).
    for (const i of [2, 3, 4]) {
      assert.equal(libreta.contabilium[SKUS[i]], 10, `${SKUS[i]}: baseline viejo`);
      assert.equal(libreta.consumos?.[clave(i)], undefined, `${SKUS[i]}: sin consumo (si no, su credito se perderia)`);
    }
    assert.ok(libreta.consumos["111:SKU-VIEJO"], "el checkpoint no borra consumos de corridas anteriores");
    assert.deepEqual(escriturasDe(llamadas, "SKU-1"), []);
  });
});

test("CA-8: al reanudar despues de la interrupcion, no se reacredita nada ya consumido y los pendientes consumen su credito", async () => {
  await conDirTemporal(async (dir) => {
    const esc = escenarioCincoConCredito(dir);
    let guardados = 0;
    const llamadas1 = llamadasVacias();
    const deps1 = depsFake({
      dir,
      reloj: reloj(T),
      ...esc,
      llamadas: llamadas1,
      guardarSnapshotEnvoltorio: (real) => (...args) => {
        guardados++;
        if (guardados === 2) throw new Error("ENOSPC simulado");
        return real(...args);
      },
    });
    await assert.rejects(() => sync.ejecutarPar(PAR_DOT, deps1, { checkpointCada: 2 }));

    // Reanudacion, 10 min despues, mismo stock.
    const llamadas2 = llamadasVacias();
    const deps2 = depsFake({ dir, reloj: reloj(iso(tMs + 10 * MIN)), ...esc, llamadas: llamadas2 });
    const res = await sync.ejecutarPar(PAR_DOT, deps2, { checkpointCada: 2 });

    // SKU-1/2: baseline 9 = stock 9 y credito consumido -> nada. Si su consumo no se
    // hubiera persistido junto al baseline, el credito se reaplicaria: 9 + 0 + 1 = 10.
    // SKU-3/4/5: baseline 10, stock 9, credito 1 -> 9 + (-1) + 1 = 9: nada. Si se
    // hubieran consumido sin avanzar el baseline: 9 - 1 = 8.
    assert.deepEqual(llamadas2.setearStock, [], "ninguna escritura: ni reacreditacion ni doble descuento");
    assert.equal(res.causa_venta_shopify, 3, "solo los 3 que faltaban");
    const libreta = leerLibretaCruda(dir, "dot");
    for (let i = 0; i < 5; i++) {
      assert.equal(libreta.contabilium[SKUS[i]], 9);
      assert.equal(libreta.consumos[clave(i)]?.cantidad, 1, `${clave(i)} consumida una sola vez`);
    }
  });
});

test("CA-8: si se pierde la cache de comprobantes pero la libreta sobrevive, un credito ya consumido no se reacredita", async () => {
  await conDirTemporal(async (dir) => {
    const esc = escenarioCincoConCredito(dir);
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const detalles = new Map(
      SKUS.map((s, i) => [200 + i, { Id: 200 + i, FechaAlta: "2026-08-12T11:59:50", FechaEmision: "2026-08-12T12:00:00", TipoFc: "FCB", Inventario: 127356, Items: [{ Codigo: s, Cantidad: 1 }], IDIntegracion: 25020, Origen: "Shopify" }])
    );
    await sync.ejecutarPar(PAR_DOT, depsFake({ dir, reloj: r, ...esc, detalles, llamadas }));
    assert.deepEqual(llamadas.setearStock, []);

    // Se corrompe la cache. El refresco siguiente vuelve a traer los mismos ids
    // (mismo dia) y sus lineas reaparecen.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(rutaRegistro(dir), "{roto", "utf-8");
    esc.stock.get(DEPOSITO_DOT).set("SKU-1", 8); // otra baja, para forzar el refresco
    r.fijar(iso(tMs + 30 * MIN));
    await sync.ejecutarPar(PAR_DOT, depsFake({ dir, reloj: r, ...esc, detalles, llamadas }));

    assert.deepEqual(escriturasDe(llamadas, "SKU-1"), [8], "9 + (-1) + 0 = 8: el 200 ya estaba consumido en la libreta");
    for (const s of SKUS.slice(1)) assert.deepEqual(escriturasDe(llamadas, s), [], `${s}: no se reacredita (seria 10)`);
    assert.deepEqual(
      [...llamadas.idsDetalle].sort(),
      [200, 201, 202, 203, 204],
      "la cache se perdio: los ids se vuelven a pedir (costo), pero no se reacreditan (correccion)"
    );
  });
});

test("CA-8: un SKU en error no consume su credito; lo consume cuando se resuelve", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "SKU-E": 10 }, contabilium: { "SKU-E": 10 }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, {
      ultimoRefrescoOk: iso(tMs - 2 * HORA),
      comprobantes: [entradaShopify({ id: 250, sku: "SKU-E", referencia: iso(tMs - HORA) })],
    });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const skusConError = new Set(["SKU-E"]);
    const base = {
      dir,
      reloj: r,
      stock: new Map([[DEPOSITO_DOT, new Map([["SKU-E", 9]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["SKU-E", 9]])]]),
      search: [resumenSearch(250)],
      skusConError,
      llamadas,
    };

    const res1 = await sync.ejecutarPar(PAR_DOT, depsFake(base));
    assert.equal(res1.error, 1);
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["SKU-E"], 10, "en error: el baseline no avanza");
    assert.equal(libreta.consumos?.["250:SKU-E"], undefined, "en error: el credito no se consume (invariante 7)");

    skusConError.clear();
    r.fijar(iso(tMs + 30 * MIN));
    await sync.ejecutarPar(PAR_DOT, depsFake(base));
    assert.deepEqual(escriturasDe(llamadas, "SKU-E"), [], "resuelto: 9 + (-1) + 1 = 9 = Shopify");
    libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium["SKU-E"], 9);
    assert.equal(libreta.consumos["250:SKU-E"]?.motivo, "delta");
  });
});

test("CA-8: el checkpoint intermedio escribe los consumos de los SKUs ya procesados y conserva los viejos (verificado en disco en ese instante)", async () => {
  await conDirTemporal(async (dir) => {
    const esc = escenarioCincoConCredito(dir);
    let enPrimerCheckpoint = null;
    let guardados = 0;
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      ...esc,
      guardarSnapshotEnvoltorio: (real) => (...args) => {
        guardados++;
        const v = real(...args);
        if (guardados === 1) enPrimerCheckpoint = leerLibretaCruda(dir, "dot");
        return v;
      },
    });
    await sync.ejecutarPar(PAR_DOT, deps, { checkpointCada: 2 });
    assert.ok(guardados > 1);
    assert.ok(enPrimerCheckpoint);
    assert.deepEqual(
      Object.keys(enPrimerCheckpoint.consumos ?? {}).sort(),
      ["111:SKU-VIEJO", clave(0), clave(1)].sort(),
      "en el primer checkpoint: el viejo + los de SKU-1 y SKU-2, ninguno adelantado"
    );
    const final = leerLibretaCruda(dir, "dot");
    assert.equal(Object.keys(final.consumos).length, 6);
  });
});

test("CA-8: en DRY_RUN la libreta no cambia (ni baseline, ni consumos, ni corte)", async () => {
  await conDirTemporal(async (dir) => {
    const esc = escenarioCincoConCredito(dir);
    const ruta = join(dir, "last-sync.dot.json");
    const antes = readFileSync(ruta, "utf-8");
    const deps = depsFake({ dir, reloj: reloj(T), ...esc, dryRun: true });
    await sync.ejecutarPar(PAR_DOT, deps, { checkpointCada: 2 });
    assert.equal(readFileSync(ruta, "utf-8"), antes, "byte a byte igual");
  });
});

test("CA-8: en DRY_RUN tampoco se fija el corte de una libreta vieja", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { "SKU-1": 10 }, contabilium: { "SKU-1": 10 } });
    const ruta = join(dir, "last-sync.dot.json");
    const antes = readFileSync(ruta, "utf-8");
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([[DEPOSITO_DOT, new Map([["SKU-1", 9]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["SKU-1", 10]])]]),
      dryRun: true,
    });
    await sync.ejecutarPar(PAR_DOT, deps);
    assert.equal(readFileSync(ruta, "utf-8"), antes);
  });
});

test("CA-8: la cache poda ids no relevantes de mas de 7 dias y lineas Shopify de mas de 30; conserva lo reciente", async () => {
  await conDirTemporal(async (dir) => {
    const T20 = "2026-08-20T15:00:00.000Z";
    const t20 = new Date(T20).getTime();
    sembrarLibreta(dir, "dot", { skus: { "SKU-1": 10 }, contabilium: { "SKU-1": 10 }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, {
      ultimoRefrescoOk: iso(t20 - HORA),
      diasCerrados: ["2026-08-05", "2026-08-19"],
      comprobantes: [
        entradaSinLineas({ id: 1, dia: "2026-08-10" }), // 10 dias, sin lineas -> fuera
        entradaSinLineas({ id: 2, dia: "2026-08-17" }), // 3 dias -> queda
        entradaSinLineas({ id: 3, dia: "2026-08-10", tipoFc: "COT" }), // 10 dias -> fuera
        entradaShopify({ id: 4, sku: "SKU-OTRO", referencia: iso(t20 - 10 * DIA) }), // linea de 10 dias -> queda
        entradaShopify({ id: 5, sku: "SKU-OTRO", referencia: iso(t20 - 40 * DIA) }), // linea de 40 dias -> fuera
      ],
    });
    const deps = depsFake({
      dir,
      reloj: reloj(T20),
      stock: new Map([[DEPOSITO_DOT, new Map([["SKU-1", 9]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["SKU-1", 10]])]]),
      search: [],
    });
    const res = await sync.ejecutarPar(PAR_DOT, deps);
    const reg = leerRegistroCrudo(dir);
    const ids = Object.keys(reg.comprobantes).sort();
    assert.deepEqual(ids, ["2", "4"], `quedaron ${ids.join(",")}`);
    assert.ok(!reg.diasCerrados.includes("2026-08-05"), "diasCerrados tambien se poda a 7 dias");
    assert.equal(res.creditos_vencidos, 1, "la linea de 40 dias sin consumir se cuenta como vencida");
  });
});

test("CA-8: la libreta ya no contiene ultimaCorridaExitosa (D-7), aunque la libreta vieja lo trajera", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { "SKU-1": 10 },
      contabilium: { "SKU-1": 10 },
      corte: CORTE_VIEJO,
      extra: { ultimaCorridaExitosa: "2026-08-11T10:00:00.000Z" },
    });
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([[DEPOSITO_DOT, new Map([["SKU-1", 9]])]]),
      shopify: new Map([[LOCATION_DOT, new Map([["SKU-1", 10]])]]),
    });
    await sync.ejecutarPar(PAR_DOT, deps);
    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal("ultimaCorridaExitosa" in libreta, false);
    assert.equal(libreta.contabilium["SKU-1"], 9);
    assert.equal(typeof sync.parsearUltimaCorridaExitosa, "undefined", "la funcion de la ventana vieja se retira");
  });
});

test("CA-8: guardarSnapshot sin contabilidad (3 argumentos) conserva corte y consumos del disco; con contabilidad, los escribe", async () => {
  await conDirTemporal(async (dir) => {
    const ruta = join(dir, "last-sync.dot.json");
    const consumos = { "1:A": { cantidad: 1, motivo: "delta", referencia: "2026-08-12T12:00:00.000Z", en: "2026-08-12T12:10:00.000Z" } };
    sync.guardarSnapshot({ A: 1 }, ruta, new Map([["A", 1]]), { corte: CORTE_VIEJO, consumos });
    let crudo = JSON.parse(readFileSync(ruta, "utf-8"));
    assert.equal(crudo.corte, CORTE_VIEJO);
    assert.deepEqual(crudo.consumos, consumos);

    sync.guardarSnapshot({ A: 2 }, ruta, new Map([["A", 2]]));
    crudo = JSON.parse(readFileSync(ruta, "utf-8"));
    assert.deepEqual(crudo.skus, { A: 2 });
    assert.equal(crudo.corte, CORTE_VIEJO, "una escritura de 3 argumentos no borra el corte");
    assert.deepEqual(crudo.consumos, consumos, "una escritura de 3 argumentos no borra consumos");

    const l = sync.cargarLibretaCompleta(ruta);
    assert.equal(l.corte, CORTE_VIEJO);
    assert.deepEqual(l.consumos, consumos);
    const vacia = sync.cargarLibretaCompleta(join(dir, "no-existe.json"));
    assert.equal(vacia.corte, null);
    assert.deepEqual(vacia.consumos, {});
  });
});

// -----------------------------------------------------------------------------
// Ronda 3 (02/11/2026, hallazgo 1 de revisor-alcance): podas alineadas.
//
// R-8: "Un consumo nunca se poda mientras su comprobante siga en la cache de
// comprobantes: la antiguedad de las dos podas se mide con la misma regla (el
// dia de Argentina del comprobante)". DISENO-INTERFAZ.md secciones 3 y 4.
//
// El bug: la cache poda por DIA ART (> 30 dias) y los consumos por HORA exacta
// de la referencia (> 30 x 24 h). Una linea de hace 30 dias y 1 hora sigue en la
// cache (30 dias calendario), pero su consumo ya se podo: la linea vuelve a ser
// credito y se acredita otra vez.
//
//   T = 12/08 13:00 ART. Linea 801, SKU-P, 2 u., 13/07 12:00 ART (30 d + 1 h).
//   Venta de mostrador de 1 u.: Contabilium 10 -> 9; Shopify 10.
//   Correcto:              10 + (9 - 10) + 0 = 9.
//   Consumo podado (bug):  10 + (9 - 10) + 2 = 11  (sobreventa de 2).
// -----------------------------------------------------------------------------

const CORTE_JULIO = "2026-07-01T00:00:00.000Z"; // anterior a la linea: no puede caer en pre-corte
const REF_30D_1H = iso(tMs - 30 * DIA - HORA); // 2026-07-13T15:00:00.000Z = 13/07 12:00 ART
const CONSUMO_801 = { cantidad: 2, motivo: "delta", referencia: REF_30D_1H, en: iso(tMs - 30 * DIA) };

function escenarioLineaDe30DiasYUnaHora(dir) {
  sembrarLibreta(dir, "dot", {
    skus: { "SKU-P": 10 },
    contabilium: { "SKU-P": 10 },
    corte: CORTE_JULIO,
    consumos: { "801:SKU-P": { ...CONSUMO_801 } },
  });
  sembrarRegistro(dir, {
    ultimoRefrescoOk: iso(tMs - 2 * HORA),
    comprobantes: [entradaShopify({ id: 801, sku: "SKU-P", cantidad: 2, referencia: REF_30D_1H })],
  });
  return {
    stock: new Map([[DEPOSITO_DOT, new Map([["SKU-P", 9]])]]),
    shopify: new Map([[LOCATION_DOT, new Map([["SKU-P", 10]])]]),
    search: [],
  };
}

test("CA-8 (ronda 3): un consumo cuyo comprobante sigue en la cache NO se poda: linea de 30 dias y 1 hora con su consumo, el SKU con delta, no se reacredita", async () => {
  await conDirTemporal(async (dir) => {
    assert.equal(REF_30D_1H, "2026-07-13T15:00:00.000Z", "precondicion del escenario");
    const esc = escenarioLineaDe30DiasYUnaHora(dir);
    const llamadas = llamadasVacias();
    const res = await sync.ejecutarPar(PAR_DOT, depsFake({ dir, reloj: reloj(T), ...esc, llamadas }));

    // La cache mide en dias ART: 13/07 -> 12/08 son 30 dias, no "mas de 30".
    const reg = leerRegistroCrudo(dir);
    assert.ok(reg.comprobantes["801"], "la cache conserva el 801 (30 dias calendario ART; podarlo por horas tambien rompe la regla comun)");

    assert.deepEqual(
      escriturasDe(llamadas, "SKU-P"),
      [9],
      "10 + (9 - 10) + 0 = 9. Si el consumo se podo por horas (30 d + 1 h > 720 h), la linea se reacredita: 11"
    );
    assert.equal(res.causa_venta_shopify, 0, "nada acreditado");
    assert.equal(res.creditos_pendientes, 0, "la linea sigue consumida");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.consumos?.["801:SKU-P"], CONSUMO_801, "el consumo sigue en disco, intacto (ni podado ni reescrito)");
    assert.equal(libreta.contabilium["SKU-P"], 9);
  });
});

test("CA-8 (ronda 3, frontera): cuando el comprobante sale de la cache (31 dias ART), el consumo se puede podar sin efecto: la linea ya no existe para acreditarse", async () => {
  await conDirTemporal(async (dir) => {
    const esc = escenarioLineaDe30DiasYUnaHora(dir);
    const llamadas = llamadasVacias();
    // Un dia despues: 13/08 13:00 ART. 13/07 -> 13/08 son 31 dias ART.
    const res = await sync.ejecutarPar(PAR_DOT, depsFake({ dir, reloj: reloj(iso(tMs + DIA)), ...esc, llamadas }));

    const reg = leerRegistroCrudo(dir);
    assert.equal(reg.comprobantes["801"], undefined, "con 31 dias ART la cache borra la entrada con lineas");
    assert.deepEqual(escriturasDe(llamadas, "SKU-P"), [9], "sin la linea no hay nada que reacreditar: 10 + (9 - 10) = 9");
    assert.equal(res.creditos_vencidos, 0, "la linea estaba consumida: no es un credito vencido");
    assert.equal(res.causa_venta_shopify, 0);
    // El consumo puede seguir o no en la libreta: los dos son correctos.
  });
});

// -----------------------------------------------------------------------------
// Ronda 4 (02/11/2026, importante 2 de revisor-alcance): la condicion "el
// comprobante sigue en la cache" probada SOLA, el `dia` del comprobante
// recalculado al pasar a ok, y la poda de la cache al cargarse.
//
// Los dos casos de ronda 3 tienen siempre las dos condiciones de la poda de
// consumos juntas (dia de la entrada = dia de la referencia). Una implementacion
// que poda el consumo SOLO por el dia de su `referencia`, sin mirar la cache, los
// pasa. Con un `dia` de la entrada posterior al de la referencia (el dia en que
// se vio por primera vez, si no se recalcula), la cache conserva la linea un dia
// mas que el consumo: ese dia la linea se acredita otra vez (sobreventa).
// DISENO-INTERFAZ.md seccion 3 ("dia" y "Poda") y seccion 4 ("Poda de consumos").
// -----------------------------------------------------------------------------

test("CA-8 (ronda 4): con el comprobante TODAVIA en la cache, un consumo cuya referencia tiene mas de 30 dias ART no se poda ni se reacredita", async () => {
  await conDirTemporal(async (dir) => {
    // T = 12/08 13:00 ART. Entrada 802 escrita con dia 02/08 (10 dias: la cache la
    // conserva por su `dia` guardado), pero con una linea de referencia de hace 40
    // dias (03/07). Asi queda una entrada de una version que no recalculaba `dia`,
    // o la de un id visto por primera vez dias despues de su venta.
    const REF_40D = iso(tMs - 40 * DIA); // 2026-07-03T16:00:00.000Z
    const CONSUMO_802 = { cantidad: 2, motivo: "delta", referencia: REF_40D, en: iso(tMs - 10 * DIA) };
    sembrarLibreta(dir, "dot", {
      skus: { "SKU-R": 10 },
      contabilium: { "SKU-R": 10 },
      corte: CORTE_JULIO, // 01/07, anterior a la linea: no cae en pre-corte
      consumos: { "802:SKU-R": { ...CONSUMO_802 } },
    });
    sembrarRegistro(dir, {
      ultimoRefrescoOk: iso(tMs - 2 * HORA),
      comprobantes: [entradaShopify({ id: 802, sku: "SKU-R", cantidad: 2, referencia: REF_40D, dia: "2026-08-02" })],
    });
    const llamadas = llamadasVacias();
    // Venta de mostrador de 1 u.: Contabilium 10 -> 9; Shopify 10.
    const res = await sync.ejecutarPar(
      PAR_DOT,
      depsFake({
        dir,
        reloj: reloj(T),
        stock: new Map([[DEPOSITO_DOT, new Map([["SKU-R", 9]])]]),
        shopify: new Map([[LOCATION_DOT, new Map([["SKU-R", 10]])]]),
        search: [],
        llamadas,
      })
    );

    assert.deepEqual(
      escriturasDe(llamadas, "SKU-R"),
      [9],
      "10 + (9 - 10) + 0 = 9. Si el consumo se poda solo por el dia de su referencia (40 > 30) sin mirar que el 802 sigue en la cache, la linea se reacredita: 11"
    );
    assert.equal(res.causa_venta_shopify, 0, "nada acreditado");
    assert.equal(res.creditos_vencidos, 0, "la linea estaba consumida: no es un credito vencido");

    // Las dos salidas correctas: (a) la cache conserva el 802 por su `dia`
    // guardado y entonces el consumo sigue; (b) la cache lo poda (por ejemplo
    // recalculando el dia desde sus lineas) y entonces el consumo puede irse. Lo
    // prohibido es la mezcla: el 802 en la cache y su consumo podado.
    const reg = leerRegistroCrudo(dir);
    const libreta = leerLibretaCruda(dir, "dot");
    if (reg?.comprobantes?.["802"]) {
      assert.deepEqual(
        libreta.consumos?.["802:SKU-R"],
        CONSUMO_802,
        "el 802 sigue en la cache: su consumo no se poda (condicion 1 de la seccion 4), tenga la antiguedad que tenga"
      );
    }
    assert.equal(libreta.contabilium["SKU-R"], 9);
  });
});

test("CA-8 (ronda 4): venta online de las 23:30 ART vista recien al dia siguiente, pendiente por el tope: al pasar a ok su `dia` es el de la venta, y el dia 31 no se reacredita", async () => {
  await conDirTemporal(async (dir) => {
    // Venta online de 2 u. de SKU-W el 12/07 a las 23:30 ART (13/07 02:30Z).
    // Contabilium ya la facturo (10 -> 8) y Shopify ya la desconto (10 -> 8).
    const REF_2330 = "2026-07-13T02:30:00.000Z";
    sembrarLibreta(dir, "dot", {
      skus: { "SKU-W": 10, "SKU-X": 5 },
      contabilium: { "SKU-W": 10, "SKU-X": 5 },
      corte: CORTE_JULIO,
    });
    sembrarRegistro(dir, { ultimoRefrescoOk: "2026-07-12T12:00:00.000Z" });
    const llamadas = llamadasVacias();
    const r = reloj("2026-07-13T13:00:00.000Z"); // 13/07 10:00 ART
    const stock = new Map([[DEPOSITO_DOT, new Map([["SKU-W", 8], ["SKU-X", 5]])]]);
    const shopify = new Map([[LOCATION_DOT, new Map([["SKU-W", 8], ["SKU-X", 5]])]]);
    const detalles = new Map([
      [650, comprobanteDetalle({ id: 650, origen: "", idIntegracion: null, referenciaUtc: "2026-07-13T12:00:00.000Z", items: [["SKU-Q", 1]] })],
      [651, comprobanteDetalle({ id: 651, referenciaUtc: REF_2330, items: [["SKU-W", 2]] })],
    ]);
    // /search devuelve el 650 y el 651 si la ventana consultada llega hasta el
    // 13/07; en la corrida del 12/08 (ventana 06/08 a 12/08) ya no los trae.
    const search = (rango) => (String(rango?.fechaHasta ?? "") <= "2026-07-13" ? [resumenSearch(650), resumenSearch(651)] : []);
    const base = { dir, reloj: r, stock, shopify, detalles, search, llamadas };

    // Corrida 1 (13/07 10:00 ART), tope 1: se pide el 650; el 651 queda pendiente
    // (sin detalle no se conoce su referencia). SKU-W: 8 + (8 - 10) + 0 = 6.
    await sync.ejecutarPar(PAR_DOT, depsFake(base), { topeDetalles: 1 });
    assert.deepEqual(llamadas.idsDetalle, [650], "precondicion: con tope 1 se pide solo el primero de /search");
    assert.equal(leerRegistroCrudo(dir).comprobantes["651"]?.estado, "pendiente", "precondicion: el 651 quedo pendiente por el tope");

    // Corrida 2 (13/07 11:00 ART): mostrador de SKU-X (5 -> 4) dispara el refresco;
    // se pide el 651 (pendiente viejo) y pasa a ok. SKU-W: 6 + 0 + 2 = 8.
    r.fijar("2026-07-13T14:00:00.000Z");
    stock.get(DEPOSITO_DOT).set("SKU-X", 4);
    await sync.ejecutarPar(PAR_DOT, depsFake(base));
    const entrada = leerRegistroCrudo(dir).comprobantes["651"];
    assert.equal(entrada?.estado, "ok", "precondicion: el 651 paso a ok");
    assert.equal(
      entrada.dia,
      "2026-07-12",
      "el dia de la entrada es el dia ART DEL COMPROBANTE (12/07, 23:30 ART), recalculado al pasar a ok; no el 13/07 en que se vio por primera vez"
    );
    assert.equal(leerLibretaCruda(dir, "dot").consumos?.["651:SKU-W"]?.cantidad, 2, "precondicion: la linea quedo consumida");
    assert.deepEqual(escriturasDe(llamadas, "SKU-W"), [6, 8], "precondicion: el credito se acredito una vez");

    // Corrida 3 (12/08 13:00 ART): 31 dias ART desde la venta (12/07), 30 desde el
    // 13/07. Mostrador de SKU-W: 8 -> 7. Correcto: 8 + (7 - 8) + 0 = 7.
    r.fijar(T);
    stock.get(DEPOSITO_DOT).set("SKU-W", 7);
    const res3 = await sync.ejecutarPar(PAR_DOT, depsFake(base));
    assert.deepEqual(
      escriturasDe(llamadas, "SKU-W"),
      [6, 8, 7],
      "8 + (7 - 8) + 0 = 7. Con `dia` = 13/07 (primer avistaje) la cache conserva el 651 un dia mas, y si el consumo se poda por su referencia (12/07) la linea se acredita otra vez: 9 (sobreventa de 2)"
    );
    assert.equal(res3.causa_venta_shopify, 0);
    const reg3 = leerRegistroCrudo(dir);
    if (reg3?.comprobantes?.["651"]) {
      assert.ok(leerLibretaCruda(dir, "dot").consumos?.["651:SKU-W"], "si el 651 sigue en la cache, su consumo tambien");
    }
  });
});

test("CA-8 (ronda 4): falla el guardado de la cache despues de podarla, la libreta se guarda con el consumo podado, y en la corrida siguiente con /search caido la cache se poda AL CARGARSE: no se reacredita", async () => {
  await conDirTemporal(async (dir) => {
    // Linea 801 (SKU-P, 2 u.) del 13/07 12:00 ART, consumida. Corrida 1 el 13/08
    // 13:00 ART: 31 dias ART -> la poda en memoria borra el 801 (y puede podar su
    // consumo), pero guardarRegistroComprobantes falla: en disco queda la cache
    // vieja, con el 801.
    const esc = escenarioLineaDe30DiasYUnaHora(dir);
    const llamadas = llamadasVacias();
    const r = reloj(iso(tMs + DIA));
    let fallosRegistro = 0;
    const deps1 = depsFake({
      dir,
      reloj: r,
      ...esc,
      llamadas,
      guardarRegistroEnvoltorio: () => () => {
        fallosRegistro++;
        throw new Error("ENOSPC: no space left on device, write (simulado, .cache/comprobantes.json)");
      },
    });
    try {
      await sync.ejecutarPar(PAR_DOT, deps1);
    } catch {
      // Rechazar es valido (falla ruidosa); seguir y marcar el clasificador, tambien.
    }
    assert.ok(fallosRegistro >= 1, "precondicion: se intento guardar la cache y fallo");
    assert.ok(leerRegistroCrudo(dir).comprobantes["801"], "precondicion: en disco quedo la cache vieja, con el 801");

    // Corrida 2, 1 h despues: /search caido. Mostrador de SKU-P: una baja mas.
    r.fijar(iso(tMs + DIA + HORA));
    const antes = esc.stock.get(DEPOSITO_DOT).get("SKU-P");
    esc.stock.get(DEPOSITO_DOT).set("SKU-P", antes - 1);
    const shopifyAntes = esc.shopify.get(LOCATION_DOT).get("SKU-P");
    const baseline = leerLibretaCruda(dir, "dot").contabilium["SKU-P"];
    const res2 = await sync.ejecutarPar(PAR_DOT, depsFake({ dir, reloj: r, ...esc, llamadas, fallaBusqueda: true }));

    const correcto = shopifyAntes + (antes - 1 - baseline);
    assert.equal(
      esc.shopify.get(LOCATION_DOT).get("SKU-P"),
      correcto,
      `${shopifyAntes} + (${antes - 1} - ${baseline}) + 0 = ${correcto}. Si la cache vieja no se poda al cargarse y el consumo ya se podo en la corrida 1, el 801 se acredita otra vez: ${correcto + 2}`
    );
    assert.equal(res2.causa_venta_shopify, 0, "nada acreditado");
  });
});

// -----------------------------------------------------------------------------
// Ronda 3 (R-8): "Un SKU en error, ambiguo, no_activado o no alcanzado por una
// interrupcion no consume credito". `error` y "no alcanzado" ya tienen caso
// (arriba). Estos dos detectan `if (resultado !== "error") consumir`.
//
//   SKU con baseline 10, Contabilium 9, Shopify 9, linea Shopify de 1 u. de hace 1 h.
//   Corrida 1: el SKU no se puede escribir (no_activado / ambiguo): ni baseline ni consumo.
//   Corrida 2: resuelto. Correcto: 9 + (9 - 10) + 1 = 9 -> no escribe, consume.
//   Si la corrida 1 consumio el credito: 9 + (9 - 10) + 0 = 8 -> escribe 8.
// -----------------------------------------------------------------------------

async function creditoSeConservaHastaResolver({ sku, id, contador, romper }) {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", { skus: { [sku]: 10 }, contabilium: { [sku]: 10 }, corte: CORTE_VIEJO });
    sembrarRegistro(dir, {
      ultimoRefrescoOk: iso(tMs - 2 * HORA),
      comprobantes: [entradaShopify({ id, sku, referencia: iso(tMs - HORA) })],
    });
    const llamadas = llamadasVacias();
    const r = reloj(T);
    const shopify = new Map([[LOCATION_DOT, new Map([[sku, 9]])]]);
    const base = {
      dir,
      reloj: r,
      stock: new Map([[DEPOSITO_DOT, new Map([[sku, 9]])]]),
      shopify,
      search: [resumenSearch(id)],
      llamadas,
    };
    const estado = romper({ shopify, sku });
    const armar = () => estado.envolver(depsFake(base));

    const res1 = await sync.ejecutarPar(PAR_DOT, armar());
    assert.equal(res1[contador], 1, `precondicion: el SKU quedo ${contador}`);
    assert.deepEqual(escriturasDe(llamadas, sku), [], `${contador}: no se escribe`);
    let libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[sku], 10, `${contador}: el baseline no avanza`);
    assert.equal(libreta.consumos?.[`${id}:${sku}`], undefined, `${contador}: el credito NO se consume (R-8)`);

    estado.arreglar();
    r.fijar(iso(tMs + 30 * MIN));
    await sync.ejecutarPar(PAR_DOT, armar());
    assert.deepEqual(
      escriturasDe(llamadas, sku),
      [],
      `resuelto: 9 + (9 - 10) + 1 = 9 = Shopify. Si el ${contador} consumio el credito, escribe 8`
    );
    libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[sku], 9);
    assert.equal(libreta.consumos?.[`${id}:${sku}`]?.motivo, "delta", "ahora si se consume");
  });
}

test("CA-8 (ronda 3): un SKU no_activado (available null en Shopify) no consume su credito; lo consume cuando se activa", async () => {
  await creditoSeConservaHastaResolver({
    sku: "SKU-N",
    id: 270,
    contador: "no_activado",
    romper: ({ shopify, sku }) => {
      shopify.get(LOCATION_DOT).set(sku, null); // item no activado en la location
      return {
        envolver: (deps) => deps,
        arreglar: () => shopify.get(LOCATION_DOT).set(sku, 9),
      };
    },
  });
});

test("CA-8 (ronda 3): un SKU ambiguo (dos variantes con el mismo SKU exacto) no consume su credito; lo consume cuando se deduplica", async () => {
  await creditoSeConservaHastaResolver({
    sku: "SKU-M",
    id: 280,
    contador: "ambiguo",
    romper: ({ sku }) => {
      let ambiguo = true;
      return {
        envolver: (deps) => {
          const real = deps.resolverSku;
          return {
            ...deps,
            resolverSku: async (s, locationId) => {
              if (ambiguo && s === sku) {
                throw new SkuAmbiguoError(s, [
                  { id: "gid://shopify/ProductVariant/M-1", product: { id: "gid://shopify/Product/M", title: "Fixture M (1)" } },
                  { id: "gid://shopify/ProductVariant/M-2", product: { id: "gid://shopify/Product/M", title: "Fixture M (2)" } },
                ]);
              }
              return real(s, locationId);
            },
          };
        },
        arreglar: () => {
          ambiguo = false;
        },
      };
    },
  });
});

// CA-14 / R-14 (decision D-7 de la persona, 02/11/2026: "Sí, retiralos (Recommended)").
test("CA-14: test/libreta-ultima-corrida-exitosa.test.js ya no existe", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(existsSync(join(raiz, "test", "libreta-ultima-corrida-exitosa.test.js")), false);
});
