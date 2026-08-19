// Los conceptos de facturacion no son mercaderia y nunca existen en Shopify.
//
// Contabilium los devuelve en getStockByDeposito como una fila mas. El sync los
// buscaba, no los encontraba, y los contaba como "no encontrado" en CADA
// corrida: 6 de los 87 del deposito DOT eran esto. AC-16 pedia una lista de no
// sincronizables que no existia en el codigo.
//
// Corre con: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { esNoSincronizable, NO_SINCRONIZABLES } from "../src/no-sincronizables.js";

test("los seis casos reales del deposito DOT quedan fuera del sync", () => {
  // Salidos del log de la reconciliacion completa, run 32286643779.
  for (const sku of [
    "BONIFICACIONES-01",
    "COMISIONES",
    "COMISIONES-MELI",
    "DERECHOS-ADUANEROS",
    "ENVIO-01",
    "TASA-DESEMBOLSO",
  ]) {
    assert.equal(esNoSincronizable(sku), true, `${sku} deberia estar excluido`);
  }
});

test("la lista tiene exactamente seis codigos: crecer es una decision consciente", () => {
  assert.equal(NO_SINCRONIZABLES.size, 6);
});

test("un producto real NO se filtra por parecerse", () => {
  // El riesgo de filtrar por prefijo: estos existen y tienen que sincronizarse.
  for (const sku of [
    "COMISIONES-EXTRA",
    "ENVIO-011",
    "IEY-103-NEGRO",
    "FUNDA-MAGSAFE-MATE-IPHONE16",
    "IEY-COMBO-IEY108N-TRANSP-IP16E",
  ]) {
    assert.equal(esNoSincronizable(sku), false, `${sku} NO deberia excluirse`);
  }
});

test("la coincidencia es exacta, no por prefijo ni por substring", () => {
  assert.equal(esNoSincronizable("COMISIONES"), true);
  assert.equal(esNoSincronizable("COMISIONES-X"), false);
  assert.equal(esNoSincronizable("X-COMISIONES"), false);
  assert.equal(esNoSincronizable("SUPER-ENVIO-01"), false);
});

test("normaliza igual que contabilium.js: mayusculas y espacios", () => {
  assert.equal(esNoSincronizable("comisiones"), true);
  assert.equal(esNoSincronizable("  ENVIO-01  "), true);
});

test("null, undefined y vacio no rompen", () => {
  assert.equal(esNoSincronizable(null), false);
  assert.equal(esNoSincronizable(undefined), false);
  assert.equal(esNoSincronizable(""), false);
});
