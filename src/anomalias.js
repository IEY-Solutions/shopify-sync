// anomalias.js
// -----------------------------------------------------------------------------
// Compara el snapshot de Contabilium de esta corrida contra el de la anterior y
// nombra las dos cosas que hoy el sync hace sin decir nada.
//
// El 2026-08-20 a las 00:00 el sync puso 15 fundas de iPhone 18 en cero en
// Shopify. Fue CORRECTO -Contabilium confirmo 0 unidades en el DOT, asi que
// evito vender lo que no esta- pero nadie se habria enterado. El sistema hace
// cosas grandes en silencio, y ese silencio es el modo de falla de este repo.
//
// SE REPORTA, NO SE BLOQUEA. Los 15 ceros de esa noche eran legitimos: un corte
// automatico habria sido el error, no el acierto. Invariante 4 de AGENTS.md: una
// divergencia se reporta, no se pisa. Vale igual para las anomalias.
// -----------------------------------------------------------------------------

// Cuantos SKUs listar por anomalia antes de resumir. El log de este repo es
// PUBLICO: no se vuelca el catalogo entero, se da la muestra y el total.
export const MAX_EJEMPLOS = 15;

// `previo` y `actual` son Map<sku, cantidad> (o cualquier iterable de pares).
// `previo` null/vacio = primera corrida: no hay con que comparar, no se inventa.
export function detectarAnomalias(previo, actual) {
  const anterior = previo instanceof Map ? previo : new Map(Object.entries(previo ?? {}));
  const ahora = actual instanceof Map ? actual : new Map(Object.entries(actual ?? {}));

  if (anterior.size === 0) {
    return { hayBase: false, desaparecidos: [], puestosEnCero: [], nuevos: [] };
  }

  const desaparecidos = [];
  const puestosEnCero = [];
  const nuevos = [];

  for (const [sku, cantidadPrevia] of anterior) {
    if (!ahora.has(sku)) {
      // Nunca se vuelve a visitar: el bucle recorre lo que Contabilium DEVUELVE.
      // Shopify se queda ofreciendo el ultimo valor conocido, para siempre.
      desaparecidos.push({ sku, ultimaCantidad: cantidadPrevia });
      continue;
    }
    const cantidadActual = ahora.get(sku);
    // Un SKU NUEVO que llega en 0 es normal (producto cargado antes de recibirlo).
    // Lo que importa es la transicion: tenia stock, ahora no.
    if (cantidadPrevia > 0 && cantidadActual === 0) {
      puestosEnCero.push({ sku, cantidadPrevia });
    }
  }

  for (const sku of ahora.keys()) {
    if (!anterior.has(sku)) nuevos.push(sku);
  }

  return { hayBase: true, desaparecidos, puestosEnCero, nuevos };
}

// Arma las lineas de log. Devuelve [] cuando no hay nada que decir: un reporte
// que habla siempre deja de leerse.
export function formatearAnomalias(a) {
  if (!a?.hayBase) return [];
  const lineas = [];

  if (a.desaparecidos.length > 0) {
    lineas.push(
      `[ANOMALIA] ${a.desaparecidos.length} SKU(s) DESAPARECIERON del deposito en Contabilium. ` +
        `El sync no los vuelve a visitar: Shopify sigue ofreciendo su ultimo valor.`
    );
    for (const d of a.desaparecidos.slice(0, MAX_EJEMPLOS)) {
      lineas.push(`             - ${d.sku} (tenia ${d.ultimaCantidad})`);
    }
    if (a.desaparecidos.length > MAX_EJEMPLOS) {
      lineas.push(`             ... y ${a.desaparecidos.length - MAX_EJEMPLOS} mas`);
    }
  }

  if (a.puestosEnCero.length > 0) {
    lineas.push(
      `[ANOMALIA] ${a.puestosEnCero.length} SKU(s) pasaron de tener stock a CERO en Contabilium. ` +
        `Puede ser correcto (mercaderia que no llego) o un fallo parcial de Contabilium.`
    );
    for (const p of a.puestosEnCero.slice(0, MAX_EJEMPLOS)) {
      lineas.push(`             - ${p.sku} (tenia ${p.cantidadPrevia})`);
    }
    if (a.puestosEnCero.length > MAX_EJEMPLOS) {
      lineas.push(`             ... y ${a.puestosEnCero.length - MAX_EJEMPLOS} mas`);
    }
  }

  return lineas;
}
