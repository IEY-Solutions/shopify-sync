// R-10 / CA-10 — en modo --full el clasificador corre con el MISMO refresco unico
// y la MISMA regla contable que en incremental (decision D-4 de la persona,
// 02/11/2026); el costo no depende del numero de SKUs del par.
//
// Fixture: 30 SKUs con delta y 3 comprobantes nuevos en la cuenta (uno es una
// venta Shopify del DOT). Un pedido por SKU daria 30; uno por comprobante, 3.
//
// Corre con: node --test test/clasificador-modo-full.test.js
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sync from "../src/sync.js";
import {
  conDirTemporal,
  depsFake,
  llamadasVacias,
  reloj,
  sembrarLibreta,
  comprobanteDetalle,
  resumenSearch,
  escriturasDe,
  PAR_DOT,
  DEPOSITO_DOT,
  LOCATION_DOT,
  HORA,
} from "./_helpers-clasificador.js";

const CORTE_VIEJO = "2026-08-01T00:00:00.000Z";
const T = "2026-08-12T16:00:00.000Z";
const N = 30;

async function correr({ full }) {
  return conDirTemporal(async (dir) => {
    const skus = Array.from({ length: N }, (_, i) => `IEY-F${String(i).padStart(2, "0")}`);
    const baseline = Object.fromEntries(skus.map((s) => [s, 10]));
    sembrarLibreta(dir, "dot", { skus: baseline, contabilium: baseline, corte: CORTE_VIEJO });
    const llamadas = llamadasVacias();
    const hace1h = new Date(new Date(T).getTime() - HORA).toISOString();
    const deps = depsFake({
      dir,
      reloj: reloj(T),
      stock: new Map([[DEPOSITO_DOT, new Map(skus.map((s) => [s, 9]))]]), // todos con delta -1
      shopify: new Map([[LOCATION_DOT, new Map(skus.map((s) => [s, s === "IEY-F07" ? 9 : 10]))]]),
      search: [resumenSearch(71), resumenSearch(72), resumenSearch(73)],
      detalles: new Map([
        [71, comprobanteDetalle({ id: 71, referenciaUtc: hace1h, items: [["IEY-F07", 1]] })], // venta Shopify DOT
        [72, comprobanteDetalle({ id: 72, origen: "", idIntegracion: null, referenciaUtc: hace1h, items: [["IEY-F01", 1]] })],
        [73, comprobanteDetalle({ id: 73, origen: "", idIntegracion: null, referenciaUtc: hace1h, items: [["IEY-F02", 1]] })],
      ]),
      llamadas,
    });
    const res = await sync.ejecutarPar(PAR_DOT, deps, { full });
    return { res, llamadas };
  });
}

test("CA-10: en --full, buscarComprobantes se llama exactamente una vez y fetchComprobantesDetalle como maximo una, con 30 SKUs con delta", async () => {
  const { llamadas, res } = await correr({ full: true });
  assert.equal(llamadas.buscarComprobantes.length, 1, "un refresco por corrida, no uno por SKU");
  assert.ok(llamadas.fetchComprobantesDetalle.length <= 1, `${llamadas.fetchComprobantesDetalle.length} invocaciones de detalle`);
  assert.equal(llamadas.idsDetalle.length, 3, "tantos detalles como comprobantes nuevos (3), no como SKUs con delta (30)");
  assert.equal(res.clasificador, "ok", "en --full el clasificador corre (D-4), no queda apagado");
});

test("CA-10: en --full el SKU con credito aplica la regla contable igual que en incremental", async () => {
  const full = await correr({ full: true });
  const incremental = await correr({ full: false });

  assert.deepEqual(escriturasDe(full.llamadas, "IEY-F07"), [], "9 + (-1) + 1 = 9 = Shopify: no escribe");
  assert.deepEqual(escriturasDe(full.llamadas, "IEY-F01"), [9], "sin credito: 10 + (-1) = 9");
  assert.equal(full.res.causa_venta_shopify, 1);

  // Mismas escrituras, SKU por SKU, que en incremental.
  const porSku = (ll) => Object.fromEntries(ll.setearStock.map((s) => [s.sku, s.quantity]));
  assert.deepEqual(porSku(full.llamadas), porSku(incremental.llamadas));
  assert.equal(full.res.causa_venta_shopify, incremental.res.causa_venta_shopify);
  assert.equal(incremental.llamadas.buscarComprobantes.length, 1);
});
