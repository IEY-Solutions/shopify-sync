// no-sincronizables.js
// -----------------------------------------------------------------------------
// Codigos de Contabilium que NO son mercaderia y por lo tanto nunca van a existir
// como producto en Shopify.
//
// Son conceptos de facturacion: comisiones, envios, bonificaciones, derechos
// aduaneros. Contabilium los devuelve en getStockByDeposito como una fila mas,
// asi que el sync los buscaba en Shopify, no los encontraba, y los contaba como
// "no encontrado" en CADA corrida. Seis de los 87 "no encontrados" del deposito
// DOT eran esto: el numero honesto de productos faltantes es 81.
//
// Requisito de AC-16: "los SKUs de la lista de no sincronizables nunca se
// escriben". La lista estaba especificada y no existia en el codigo.
//
// COINCIDENCIA EXACTA, A PROPOSITO. Filtrar por prefijo (todo lo que empiece con
// COMISIONES, por ejemplo) es tentador y peligroso: un producto real cuyo codigo
// arrancara igual dejaria de sincronizarse en silencio, que es exactamente el
// modo de falla que este repo persigue. Agregar un codigo nuevo es barato;
// perder un producto sin enterarse, no.
// -----------------------------------------------------------------------------

export const NO_SINCRONIZABLES = new Set([
  "BONIFICACIONES-01",
  "COMISIONES",
  "COMISIONES-MELI",
  "DERECHOS-ADUANEROS",
  "ENVIO-01",
  "TASA-DESEMBOLSO",
]);

// El SKU llega ya normalizado a mayusculas desde contabilium.js:122.
export function esNoSincronizable(sku) {
  return NO_SINCRONIZABLES.has(String(sku ?? "").trim().toUpperCase());
}
