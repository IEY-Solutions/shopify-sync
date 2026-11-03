// CA-7 — Reintento de una entrada pendiente de un SKU universal (R-11, hallazgo
// B-1). Cubre el ejemplo normativo de B-1 (8/8/5/8/8 -> una sola mutacion) y
// los casos (a)/(b)/(c) de R-11.
//
// Evidencia: aceptacion/sku-universal-multivarianta/escenarios-ca7-pendiente.md
// (S0, §3, §5, §5b, §5c, §5d, §6). Las claves `universales`/`universales_pendientes`
// y el sufijo ` [reintento]` de `[UNIVERSAL]` son de T09: este archivo no las exige.
//
// Corre con: node --test test/sku-universal-pendiente.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import { conDirTemporal, sembrarLibreta, leerLibretaCruda, PAR_DOT, capturarConsola } from "./_helpers-clasificador.js";
import { SKU_5V, VARIANTES_5V, VARIANTE_5V_EXTRA, nodoExacto } from "./_helpers-sku-universal.js";

const T = "2026-11-03T12:00:00.000Z";

function tiendaUniversal(nodos, { hasNextPage = false } = {}) {
  const t = {
    nodos,
    escrituras: [],
    async consultar(_query, variables) {
      return { productVariants: { edges: t.nodos.map((n) => ({ node: n })), pageInfo: { hasNextPage } } };
    },
    async setearStock(inventoryItemId, quantity, changeFromQuantity, locationId) {
      t.escrituras.push({ inventoryItemId, quantity, changeFromQuantity, locationId });
    },
  };
  t.consultar = t.consultar.bind(t);
  t.setearStock = t.setearStock.bind(t);
  return t;
}

function depsCon({ dir, tienda, stock, t = T }) {
  return {
    ...sync.DEPS_REALES,
    ahora: () => new Date(t),
    esDryRun: () => false,
    getStockDeposito: async () => stock,
    rutaSnapshotPara: (stateKey) => sync.rutaSnapshotPara(stateKey, dir),
    cargarRegistroComprobantes: () => ({ v: 1, ultimoRefrescoOk: t, diasCerrados: [], comprobantes: {} }),
    guardarRegistroComprobantes: () => {},
    leerCacheSku: () => ({}),
    buscarComprobantes: async () => [],
    fetchComprobantesDetalle: async () => [],
    crearSesion: () => undefined,
    resolverSkuUniversal: async (sku, locationId) => {
      const data = await tienda.consultar(null, { query: `sku:"${sku}"`, locationId, first: 10 });
      const nodos = data.productVariants.edges.map((e) => e.node);
      const topeAlcanzado = data.productVariants.pageInfo.hasNextPage;
      const { ConteoVariantesUniversalError, variantesUniversales } = await import("../src/shopify.js");
      const esperadas = variantesUniversales(sku);
      const exactos = nodos.filter((n) => n.sku === sku && n.inventoryItem?.id);
      if (exactos.length !== esperadas) throw new ConteoVariantesUniversalError(sku, esperadas, exactos.length, topeAlcanzado);
      return exactos.map((n) => ({
        variantId: n.id,
        inventoryItemId: n.inventoryItem.id,
        available: n.inventoryItem.inventoryLevel?.quantities?.find((q) => q.name === "available")?.quantity ?? null,
      }));
    },
    setearStock: tienda.setearStock,
  };
}

const [V1, V2, V3, V4, V5] = VARIANTES_5V;

// S2 del escenario: pendiente con desde=5 en las 5 variantes, baseline 10.
function sembrarS2(dir) {
  sembrarLibreta(dir, "dot", {
    skus: { [SKU_5V]: 10 },
    contabilium: { [SKU_5V]: 10 },
    extra: {
      destinos: { [SKU_5V]: V1.inventoryItemId },
      pendientes: {
        [SKU_5V]: {
          nuevoValor: 8,
          contabiliumObjetivo: 13,
          variantes: VARIANTES_5V.map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
        },
      },
    },
  });
}

test("CA-7 §3: reintento normativo B-1, 8/8/5/8/8 -> UNA sola mutacion (V3), nunca 11", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS2(dir);
    const availables = [8, 8, 5, 8, 8];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.equal(res.error, 0);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V3.inventoryItemId, 8, 5]]
    );
    assert.ok(!tienda.escrituras.some((e) => e.quantity === 11), "nunca el absoluto max 8 + delta 3");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {}, "el pendiente se cierra");
    assert.equal(libreta.contabilium[SKU_5V], 13);
    assert.equal(libreta.skus[SKU_5V], 13);
    assert.equal(libreta.escritos?.[SKU_5V], 8);
  });
});

test("CA-7 §5: variante movida (c) durante el pendiente -> cero mutaciones, error exacto, sigue pendiente", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS2(dir);
    const availables = [8, 8, 4, 8, 8]; // V3 vendida online: desde era 5, ahora 4
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.error, 1);
    assert.equal(res.actualizado, 0);
    assert.deepEqual(tienda.escrituras, []);
    const esperado = `  [ERROR] dot/${SKU_5V}: variante ${V3.variantId} cambio durante un pendiente universal (desde=5, actual=4, pendiente=8) -> no se escribe`;
    assert.ok(lineas.some((l) => l.texto === esperado), "linea de error exacta de R-11 (c)");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.ok(libreta.pendientes?.[SKU_5V], "el pendiente sigue");
    assert.equal(libreta.contabilium[SKU_5V], 10, "baseline no avanza");
    assert.equal(libreta.escritos?.[SKU_5V], undefined);
  });
});

test("CA-7 §5d: una variante en (b) y otra en (c) -> UNA mutacion (la de b), la de c bloquea el cierre", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS2(dir);
    const availables = [8, 5, 4, 8, 8]; // V2 cae en (b), V3 cae en (c)
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.error, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V2.inventoryItemId, 8, 5]]
    );
    const esperado = `  [ERROR] dot/${SKU_5V}: variante ${V3.variantId} cambio durante un pendiente universal (desde=5, actual=4, pendiente=8) -> no se escribe`;
    assert.ok(lineas.some((l) => l.texto === esperado));

    const libreta = leerLibretaCruda(dir, "dot");
    assert.ok(libreta.pendientes?.[SKU_5V], "sigue pendiente, aunque V2 ya se haya escrito en Shopify");
  });
});

test("CA-7 §5b: falta una variante de la entrada -> cero mutaciones, error, pendiente intacto", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS2(dir);
    const availables = [8, 8, 5, 8]; // falta V5
    const nodos = [V1, V2, V3, V4].map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.error, 1);
    assert.deepEqual(tienda.escrituras, []);
    assert.ok(lineas.some((l) => l.texto.startsWith(`  [ERROR] dot/${SKU_5V}:`)));
    assert.ok(leerLibretaCruda(dir, "dot").pendientes?.[SKU_5V], "el pendiente sigue");
  });
});

test("CA-7 §5c: aparece una variante exacta nueva (V6) -> cero mutaciones, error, pendiente intacto", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS2(dir);
    const availables = [8, 8, 5, 8, 8];
    const nodos = [
      ...VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i])),
      nodoExacto(VARIANTE_5V_EXTRA, SKU_5V, 0),
    ];
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.error, 1);
    assert.deepEqual(tienda.escrituras, []);
    assert.ok(lineas.some((l) => l.texto.startsWith(`  [ERROR] dot/${SKU_5V}:`)));
    assert.ok(leerLibretaCruda(dir, "dot").pendientes?.[SKU_5V], "el pendiente sigue");
  });
});

test("CA-7 §6: el atajo del incremental no saltea un SKU con pendiente, cierra con contabiliumObjetivo (no el de esta corrida)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS2(dir); // skus[sku] = 10
    const availables = [8, 8, 5, 8, 8];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 10]]); // Contabilium igual al atajo
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.saltado, 0, "no se saltea por el atajo");
    assert.equal(res.actualizado, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V3.inventoryItemId, 8, 5]]
    );

    const libreta = leerLibretaCruda(dir, "dot");
    assert.equal(libreta.contabilium[SKU_5V], 13, "el contabiliumObjetivo persistido, no el 10 de esta corrida");
    assert.equal(libreta.skus[SKU_5V], 13);
    assert.equal(libreta.escritos?.[SKU_5V], 8);
    assert.deepEqual(libreta.pendientes ?? {}, {});
  });
});

test("CA-7 (bloqueante 1): todas las variantes ya estan en nuevoValor (a) -> cierra el pendiente igual, no queda trabado", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS2(dir);
    // Las 5 variantes ya quedaron en nuevoValor=8 (el proceso murio despues de
    // mutar todo pero antes de confirmar, o confirmarSkuUniversal fallo una
    // vez, etc.): ninguna esta en (b)/(c), todas en (a).
    const availables = [8, 8, 8, 8, 8];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.error, 0);
    assert.equal(res.actualizado, 0, "nada que mutar: las 5 ya estaban en nuevoValor");
    assert.equal(res.sin_cambios, 1);
    assert.equal(res.universales, 1, "igual cuenta como universal resuelto (universalConfirmado)");
    assert.deepEqual(tienda.escrituras, [], "no se repite ninguna mutacion");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {}, "el pendiente se cierra, no queda trabado para siempre");
    assert.equal(libreta.contabilium[SKU_5V], 13, "baseline avanza al contabiliumObjetivo persistido");
    assert.equal(libreta.skus[SKU_5V], 13);
    assert.equal(libreta.escritos?.[SKU_5V], 8);
    assert.equal(libreta.destinos?.[SKU_5V], V1.inventoryItemId, "el inventoryItemId mas chico");
  });
});

test("--full tambien reintenta (R-14 extendido a R-11)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarS2(dir);
    const availables = [8, 8, 5, 8, 8];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps, { full: true });

    assert.equal(res.actualizado, 1);
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [[V3.inventoryItemId, 8, 5]]
    );
    assert.deepEqual(leerLibretaCruda(dir, "dot").pendientes ?? {}, {});
  });
});

test("una entrada con requiereCompuerta no se reintenta (T10: error exacto L17, nunca saltado)", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: {
        destinos: { [SKU_5V]: V1.inventoryItemId },
        pendientes: {
          [SKU_5V]: {
            nuevoValor: 8,
            contabiliumObjetivo: 13,
            requiereCompuerta: true,
            variantes: VARIANTES_5V.map((v) => ({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, desde: 5 })),
          },
        },
      },
    });
    const availables = [8, 8, 5, 8, 8];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.saltado, 0);
    assert.equal(res.error, 1);
    assert.deepEqual(tienda.escrituras, []);
    const esperado = `  [ERROR] dot/${SKU_5V}: pendiente universal requiere compuerta manual -> no se escribe`;
    assert.ok(lineas.some((l) => l.texto === esperado), "L17 (R-17)");
    assert.ok(leerLibretaCruda(dir, "dot").pendientes?.[SKU_5V], "intacta");
  });
});

// -----------------------------------------------------------------------------
// Revision independiente (bloqueante 2) — sub-casos de CA-7 que faltaban:
// (1) orden persistencia-antes-de-mutar con un registro de integracion real,
// (4) regresion directa de B-1 (crash a mitad de las N escrituras), y
// (7) falla integrada de la persistencia del journal (sin ninguna mutacion).
// -----------------------------------------------------------------------------

test("CA-7 (1): la entrada pendiente se persiste en disco ANTES de la primera mutacion (orden real, S0 del escenario)", async () => {
  await conDirTemporal(async (dir) => {
    // S0 exacto del escenario: sin pendiente previa (camino de primera
    // escritura, R-10), baseline 10, Contabilium 13, las 5 en 5 -> nuevoValor 8.
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId } },
    });
    const availables = [5, 5, 5, 5, 5];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const base = depsCon({ dir, tienda, stock });

    // Registro de eventos ordenado (README): cada persistencia de libreta y
    // cada mutacion hace push, en el orden real en que las llama produccion.
    // La persistencia es la funcion REAL (base.persistirPendienteUniversal =
    // sync.DEPS_REALES.persistirPendienteUniversal), asi que el push ocurre
    // justo antes de escribir el archivo de verdad.
    const eventos = [];
    const deps = {
      ...base,
      persistirPendienteUniversal: (sku, entrada, ruta) => {
        const evento = {
          tipo: "persistencia",
          sku,
          entrada: structuredClone(entrada),
          libretaAntes: leerLibretaCruda(dir, "dot"),
        };
        eventos.push(evento);
        const resultado = base.persistirPendienteUniversal(sku, entrada, ruta);
        // Contenido EFECTIVO que quedo escrito en disco por ESTE guardado
        // puntual (no el de un guardado posterior): confirma que la entrada
        // pendiente se grabo bien y que ese guardado no tocó contabilium/skus.
        evento.libretaDespues = leerLibretaCruda(dir, "dot");
        return resultado;
      },
      setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
        eventos.push({ tipo: "mutacion", inventoryItemId, quantity, changeFromQuantity });
        return tienda.setearStock(inventoryItemId, quantity, changeFromQuantity, locationId);
      },
    };

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.actualizado, 1);
    assert.equal(eventos.length, 6, "1 persistencia + 5 mutaciones");
    assert.equal(eventos[0].tipo, "persistencia", "la persistencia es SIEMPRE el primer evento");
    assert.ok(eventos.slice(1).every((e) => e.tipo === "mutacion"), "todo lo que sigue son mutaciones");

    // Contenido exacto de la entrada persistida, ANTES de la primera mutacion.
    assert.equal(eventos[0].entrada.nuevoValor, 8);
    assert.equal(eventos[0].entrada.contabiliumObjetivo, 13);
    assert.deepEqual(
      eventos[0].entrada.variantes.map((v) => [v.inventoryItemId, v.desde]),
      VARIANTES_5V.map((v) => [v.inventoryItemId, 5])
    );
    // En ese instante, el disco (no la memoria) todavia tenia el baseline en
    // 10: el journal se escribe antes de que nada avance.
    assert.equal(eventos[0].libretaAntes.contabilium[SKU_5V], 10);
    assert.equal(eventos[0].libretaAntes.skus[SKU_5V], 10);

    // Contenido EFECTIVO que quedo escrito en disco por este guardado puntual
    // (no uno posterior): la entrada pendiente con sus valores correctos, y
    // contabilium/skus TODAVIA en 10 (ese guardado no los toca).
    assert.equal(eventos[0].libretaDespues.pendientes?.[SKU_5V]?.nuevoValor, 8);
    assert.equal(eventos[0].libretaDespues.pendientes?.[SKU_5V]?.contabiliumObjetivo, 13);
    assert.deepEqual(
      eventos[0].libretaDespues.pendientes[SKU_5V].variantes.map((v) => [v.inventoryItemId, v.desde]),
      VARIANTES_5V.map((v) => [v.inventoryItemId, 5])
    );
    assert.equal(eventos[0].libretaDespues.contabilium[SKU_5V], 10, "ese guardado puntual no toca el baseline");
    assert.equal(eventos[0].libretaDespues.skus[SKU_5V], 10);

    assert.deepEqual(
      eventos.slice(1).map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      VARIANTES_5V.map((v) => [v.inventoryItemId, 8, 5])
    );

    const libretaFinal = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libretaFinal.pendientes ?? {}, {}, "el ultimo guardado no tiene pendiente");
    assert.equal(libretaFinal.contabilium[SKU_5V], 13);
    assert.equal(libretaFinal.skus[SKU_5V], 13);
    assert.equal(libretaFinal.escritos?.[SKU_5V], 8);
  });
});

test("CA-7 (4): crash a mitad de las N escrituras (regresion B-1) — la libreta en disco conserva el pendiente y la corrida siguiente retoma", async () => {
  await conDirTemporal(async (dir) => {
    // S0 exacto del escenario: sin pendiente previa, baseline 10, Contabilium
    // 13, las 5 variantes en 5 -> nuevoValor 8 (camino de primera escritura,
    // R-10). Se corre `ejecutarPar` de verdad: nada se prepara a mano.
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId } },
    });
    const availables0 = [5, 5, 5, 5, 5];
    const nodos0 = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables0[i]));
    const tienda0 = tiendaUniversal(nodos0);
    const stock0 = new Map([[SKU_5V, 13]]);
    const base0 = depsCon({ dir, tienda: tienda0, stock: stock0 });

    // NOTA DE DISEÑO (revision 4): `procesarSkuUniversal` (camino de primera
    // escritura, src/sync.js ~1295-1303) envuelve CADA llamada a
    // `setearStock` en su PROPIO try/catch, pero ese catch arma el mensaje de
    // `[ERROR]` leyendo `err.message` SIN `?.`. Si la 3.a llamada lanza algo
    // sin esa propiedad (acá, `throw null`), el propio manejo de errores de
    // produccion revienta con un TypeError al leer `.message` de `null`, y
    // ESE TypeError si escapa sin control: no lo atrapa nada mas arriba (ni
    // `ejecutarParEnCorrida` ni `ejecutarPar`). Eso corta la corrida de
    // verdad antes de intentar la 4.a y la 5.a variante y antes de cualquier
    // guardado final, asi que el disco real queda en el estado del crash sin
    // necesidad de ningun snapshot en memoria: se lee directo con
    // `leerLibretaCruda` despues de capturar la excepcion en el test.
    let llamadas = 0;
    const deps0 = {
      ...base0,
      setearStock: async (inventoryItemId, quantity, changeFromQuantity, locationId) => {
        llamadas++;
        if (llamadas === 3) {
          // eslint-disable-next-line no-throw-literal
          throw null;
        }
        return tienda0.setearStock(inventoryItemId, quantity, changeFromQuantity, locationId);
      },
    };

    let excepcionEscapo = null;
    try {
      await sync.ejecutarPar(PAR_DOT, deps0);
    } catch (err) {
      excepcionEscapo = err ?? "escapo (valor nulo)";
    }
    assert.ok(excepcionEscapo, "la excepcion del catch de produccion (err.message de null) escapo sin control");

    // Al escapar sin control, nadie llego al guardado final: el disco real
    // (releido del archivo, no un snapshot en memoria) quedo exactamente en
    // el estado del crash. Solo V1 y V2 ya estaban escritos en Shopify (la
    // 4a y la 5a nunca se intentaron: la tienda falsa es sincrona y
    // secuencial).
    assert.deepEqual(
      tienda0.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]),
      [
        [V1.inventoryItemId, 8, 5],
        [V2.inventoryItemId, 8, 5],
      ],
      "en el instante del crash solo V1 y V2 ya se habian escrito en Shopify"
    );

    const discoReal = leerLibretaCruda(dir, "dot");
    assert.ok(discoReal.pendientes?.[SKU_5V], "el pendiente ya estaba en disco en el instante del crash");
    assert.equal(discoReal.pendientes[SKU_5V].nuevoValor, 8);
    assert.equal(discoReal.pendientes[SKU_5V].contabiliumObjetivo, 13);
    assert.deepEqual(
      discoReal.pendientes[SKU_5V].variantes.map((v) => [v.inventoryItemId, v.desde]),
      VARIANTES_5V.map((v) => [v.inventoryItemId, 5])
    );
    assert.equal(discoReal.contabilium[SKU_5V], 10, "baseline no avanzo en el instante del crash");
    assert.equal(discoReal.skus[SKU_5V], 10);

    // Corrida siguiente: parte del MISMO dir, es decir del disco real tal
    // como quedo tras el crash (nadie lo reconstruye a mano). Shopify
    // refleja SOLO las mutaciones que de verdad se aplicaron antes del
    // corte (V1/V2 en 8, V3/V4/V5 siguen en desde=5).
    const availables = [8, 8, 5, 5, 5];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 13]]);
    const deps = depsCon({ dir, tienda, stock });

    const res = await sync.ejecutarPar(PAR_DOT, deps);

    assert.equal(res.error, 0);
    assert.equal(res.actualizado, 1, "retoma correctamente: termina de escribir lo que faltaba");
    assert.deepEqual(
      tienda.escrituras.map((e) => [e.inventoryItemId, e.quantity, e.changeFromQuantity]).sort(),
      [
        [V3.inventoryItemId, 8, 5],
        [V4.inventoryItemId, 8, 5],
        [V5.inventoryItemId, 8, 5],
      ].sort()
    );
    assert.ok(!tienda.escrituras.some((e) => e.inventoryItemId === V1.inventoryItemId), "V1 no se reescribe");
    assert.ok(!tienda.escrituras.some((e) => e.inventoryItemId === V2.inventoryItemId), "V2 no se reescribe");
    assert.ok(!tienda.escrituras.some((e) => e.quantity === 11), "nunca el absoluto max 8 + delta 3, en ninguna variante");

    const libretaFinal = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libretaFinal.pendientes ?? {}, {}, "el pendiente se cierra");
    assert.equal(libretaFinal.escritos?.[SKU_5V], 8);
    assert.equal(libretaFinal.contabilium[SKU_5V], 13);
  });
});

test("CA-7 (7): falla la persistencia del journal (integrado) -> ninguna mutacion de ese SKU, sale el [ERROR] de R-10, sin ningun [UNIVERSAL]", async () => {
  await conDirTemporal(async (dir) => {
    sembrarLibreta(dir, "dot", {
      skus: { [SKU_5V]: 10 },
      contabilium: { [SKU_5V]: 10 },
      extra: { destinos: { [SKU_5V]: V1.inventoryItemId } },
    });
    const availables = [7, 0, 0, 0, 0];
    const nodos = VARIANTES_5V.map((v, i) => nodoExacto(v, SKU_5V, availables[i]));
    const tienda = tiendaUniversal(nodos);
    const stock = new Map([[SKU_5V, 9]]);
    const base = depsCon({ dir, tienda, stock });
    const deps = {
      ...base,
      persistirPendienteUniversal: () => {
        throw new Error("disco lleno (simulado)");
      },
    };

    const { valor: res, lineas } = await capturarConsola(() => sync.ejecutarPar(PAR_DOT, deps));

    assert.equal(res.error, 1);
    assert.equal(res.actualizado, 0);
    assert.deepEqual(tienda.escrituras, [], "ninguna mutacion de ese SKU");
    const esperado = `  [ERROR] dot/${SKU_5V}: no se pudo persistir la entrada pendiente, no se escribe`;
    assert.ok(lineas.some((l) => l.texto === esperado), "R-10");
    assert.ok(!lineas.some((l) => l.texto.includes("[UNIVERSAL]")), "ninguna linea [UNIVERSAL]");

    const libreta = leerLibretaCruda(dir, "dot");
    assert.deepEqual(libreta.pendientes ?? {}, {}, "no quedo ninguna entrada (la persistencia fallo)");
  });
});
