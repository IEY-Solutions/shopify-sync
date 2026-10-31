// pares.js
// -----------------------------------------------------------------------------
// Lista de pares (deposito Contabilium -> location Shopify) parametrizable por
// configuracion/env (R-2). Agregar o quitar un par es agregar/quitar una
// entrada de este arreglo: nunca tocar sync.js/shopify.js/contabilium.js.
//
// R-9: el gid de la location de Shopify de Galerias Pacifico y el id de su
// deposito en Contabilium todavia no estan confirmados (consulta de solo
// lectura en curso). Un par con cualquiera de los dos vacio, null, o igual al
// sentinel VALOR_PENDIENTE, queda marcado `pendiente: true` y el sync lo omite
// sin fallar en silencio (ver ejecutarPar en sync.js).
// -----------------------------------------------------------------------------

// placeholder/pendiente: la isla todavia no tiene gid ni depositoId reales.
export const VALOR_PENDIENTE = "PENDIENTE";

export function esValorPendiente(v) {
  return v === undefined || v === null || v === "" || v === VALOR_PENDIENTE;
}

export function construirPares(env = process.env) {
  return [
    {
      nombre: "dot",
      stateKey: "dot",
      depositoId: env.CONTABILIUM_DOT_DEPOSITO_ID || null,
      locationId: env.SHOPIFY_DOT_LOCATION_ID || null,
      pendiente:
        esValorPendiente(env.CONTABILIUM_DOT_DEPOSITO_ID) ||
        esValorPendiente(env.SHOPIFY_DOT_LOCATION_ID),
    },
    {
      nombre: "galerias-pacifico",
      stateKey: "galerias-pacifico",
      depositoId: env.CONTABILIUM_ISLA_DEPOSITO_ID || null,
      locationId: env.SHOPIFY_ISLA_LOCATION_ID || null,
      pendiente:
        esValorPendiente(env.CONTABILIUM_ISLA_DEPOSITO_ID) ||
        esValorPendiente(env.SHOPIFY_ISLA_LOCATION_ID),
    },
  ];
}
