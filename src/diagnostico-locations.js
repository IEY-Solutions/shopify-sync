// diagnostico-locations.js
// -----------------------------------------------------------------------------
// Cierra el riesgo 1: sobre que location de Shopify escribe la integracion
// nativa de Contabilium (IDIntegracion 25020, deposito CENTRAL 96667).
//
// Es la ultima premisa abierta de la familia de S-2 y la unica que puede
// invalidar el diseño de deltas entero: si 25020 escribiera sobre la location
// del DOT, habria un tercer escritor absoluto sobre el mismo inventario.
//
// COMO SE DECIDE. Se eligen SKUs donde CENTRAL y DOT tienen valores DISTINTOS
// -si son iguales la comparacion no distingue nada- y se lee su nivel en todas
// las locations. Si una location espeja los valores de CENTRAL, ahi escribe
// 25020. Si la del DOT los espejara, el riesgo esta confirmado.
//
// SOLO LECTURA. Este modulo no importa `setearStock` y no emite una sola
// mutation.
// -----------------------------------------------------------------------------

import { getStockDeposito } from "./contabilium.js";
import { leerNivelesEnTodasLasLocations } from "./shopify.js";

const DEPOSITO_CENTRAL = "96667"; // DEPOSITO OFICINA
const MUESTRA = 12;

// Elige SKUs donde los dos depositos difieren y ambos son > 0: son los unicos
// que distinguen "esta location espeja CENTRAL" de "espeja el DOT".
export function elegirSkusDiscriminantes(stockCentral, stockDot, limite = MUESTRA) {
  const elegidos = [];
  for (const [sku, central] of stockCentral) {
    if (elegidos.length >= limite) break;
    const dot = stockDot.get(sku);
    if (dot === undefined) continue;
    if (central === dot) continue; // no discrimina
    if (central <= 0 || dot <= 0) continue; // un cero es ambiguo
    elegidos.push({ sku, central, dot });
  }
  return elegidos;
}

export async function diagnosticarLocations() {
  const locationDot = process.env.SHOPIFY_DOT_LOCATION_ID;
  console.log("\n=== Diagnostico de locations (SOLO LECTURA, no escribe nada) ===\n");

  console.log(`Location que escribe este sync (DOT): ${locationDot}`);
  console.log("Las demas se descubren por los niveles de inventario: la app no tiene");
  console.log("`read_locations`, asi que se identifican por id y no por nombre.\n");

  console.log(`\nLeyendo Contabilium: DOT y CENTRAL (${DEPOSITO_CENTRAL})...`);
  const stockDot = await getStockDeposito();
  const stockCentral = await getStockDeposito(DEPOSITO_CENTRAL);
  console.log(`  DOT: ${stockDot.size} SKUs · CENTRAL: ${stockCentral.size} SKUs`);

  const muestra = elegirSkusDiscriminantes(stockCentral, stockDot);
  if (muestra.length === 0) {
    console.warn("\n[SIN CONCLUSION] No hay SKUs con valores distintos en ambos depositos.");
    return { concluyente: false, filas: [] };
  }

  console.log(`\nMuestra de ${muestra.length} SKUs con valores DISTINTOS entre depositos.`);
  console.log("Si una location espeja la columna CENTRAL, ahi escribe la integracion 25020.\n");

  const filas = [];
  for (const m of muestra) {
    const niveles = await leerNivelesEnTodasLasLocations(m.sku);
    if (!niveles) {
      console.log(`  ${m.sku}: no resuelve en Shopify (o es ambiguo) — se saltea`);
      continue;
    }
    filas.push({ ...m, niveles });
    const detalle = niveles
      .map((n) => `${n.location}=${n.available}${n.locationId === locationDot ? "*" : ""}`)
      .join("  ");
    console.log(`  ${m.sku}\n     Contabilium: CENTRAL=${m.central}  DOT=${m.dot}\n     Shopify:     ${detalle}`);
  }

  return { concluyente: filas.length > 0, filas, locationDot };
}

// Cuenta, por location, cuantos SKUs de la muestra coinciden con CENTRAL y
// cuantos con el DOT. Pura, para poder testear la lectura del resultado.
export function resumirCoincidencias(filas) {
  const porLocation = new Map();
  for (const f of filas) {
    for (const n of f.niveles) {
      const k = n.locationId ?? n.location;
      if (!porLocation.has(k)) {
        porLocation.set(k, { location: n.location, locationId: n.locationId, comoCentral: 0, comoDot: 0, total: 0 });
      }
      const acc = porLocation.get(k);
      acc.total++;
      if (n.available === f.central) acc.comoCentral++;
      if (n.available === f.dot) acc.comoDot++;
    }
  }
  return [...porLocation.values()];
}
