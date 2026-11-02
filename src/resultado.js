// resultado.js
// -----------------------------------------------------------------------------
// Guardarrail de salida: decide si una corrida puede terminar en verde.
//
// El modo de falla real de este sistema no es el error ruidoso: es el tilde
// verde vacio. El 2026-06-03 una corrida reporto 2.396 errores de 2.480 SKUs,
// 0 sincronizados y exit 0 (diagnostico H3), y el 2026-08-19 volvio a pasar.
//
// Esta logica vivia inline en index.js, que la ejecutaba al importarse: no habia
// forma de testearla. Aca es una funcion pura y tiene su red en
// test/resultado.test.js.
// -----------------------------------------------------------------------------

// Fraccion de SKUs con error por encima de la cual la corrida NO puede salir 0.
export const UMBRAL_ERROR_DEFECTO = 0.05;

// Devuelve { ok, motivo }. `motivo` es null solo cuando ok es true.
export function evaluarCorrida(resumen, umbral = UMBRAL_ERROR_DEFECTO) {
  // Sin resumen no sabemos nada de la corrida. No saber no es estar bien.
  if (!resumen || typeof resumen.total !== "number") {
    return { ok: false, motivo: "la corrida no devolvio un resumen: no hay forma de saber si hizo algo" };
  }

  // "No mire nada" no es "no cambio nada" (AC-14). Antes esto salia en VERDE:
  // index.js hacia `if (!r || !r.total) return`, asi que un deposito que
  // devolviera cero SKUs -por un cambio de id, un filtro o una respuesta
  // vacia- terminaba con exit 0 sin haber tocado un solo SKU.
  if (resumen.total === 0) {
    return {
      ok: false,
      motivo:
        "Contabilium no devolvio ningun SKU del deposito DOT. Una corrida que no " +
        "leyo nada no es una corrida exitosa: revisar el deposito y las credenciales.",
    };
  }

  const errores = resumen.error ?? 0;
  const tasaError = errores / resumen.total;
  if (tasaError > umbral) {
    return {
      ok: false,
      motivo:
        `${errores} de ${resumen.total} SKUs con error ` +
        `(${(tasaError * 100).toFixed(1)}% > umbral ${(umbral * 100).toFixed(1)}%).`,
    };
  }

  // Efectivo = lo que se escribio, lo que se verifico igual, lo que se simulo y
  // lo que el incremental salteo porque la libreta ya lo daba por sincronizado.
  const efectivos =
    (resumen.actualizado ?? 0) + (resumen.sin_cambios ?? 0) + (resumen.dry ?? 0) + (resumen.saltado ?? 0);
  if (efectivos === 0) {
    return {
      ok: false,
      motivo:
        `la corrida no sincronizo ni verifico ningun SKU de ${resumen.total}. ` +
        `Una corrida vacia no es una corrida exitosa.`,
    };
  }

  // R-12 / D-5: un clasificador en `fallo` (refresco del registro de
  // comprobantes caido o un detalle que fallo en esta corrida) deja la corrida
  // en rojo, despues de haber aplicado las escrituras y guardado la libreta.
  // `parcial` (solo por el tope), `ok` y `no_requerido` no cambian el veredicto.
  if (resumen.clasificador === "fallo") {
    return {
      ok: false,
      motivo:
        "el clasificador de causa por comprobante fallo en esta corrida (ver [CLASIFICADOR][ERROR]): " +
        "los deltas se aplicaron sin credito.",
    };
  }

  return { ok: true, motivo: null };
}

// -----------------------------------------------------------------------------
// evaluarCorridaMultiPar — agrega el veredicto de evaluarCorrida() por cada par
// -----------------------------------------------------------------------------
// Un par `pendiente` (R-9) se reporta pero NO se exige que haya sincronizado
// nada: no es un fallo que el par de la isla este pendiente. Pero si TODOS los
// pares terminan pendientes (o en error), la corrida entera no puede salir en
// verde: nunca "no hice nada en ningun lado" == exito (mismo principio de H3).
//   porPar: { [stateKey]: resumenDeSyncTodos | { pendiente: true, motivo } }
// Devuelve { ok, motivo, detalle: { [stateKey]: { ok, motivo, pendiente } } }
// Con opciones.escrituraAbsoluta = Set (R-15, DISENO 6.1), un SKU de la
// compuerta va a compuertaNoAplicados si (a) no se aplico en ningun par, o (b)
// en algun par no pendiente que lo tenia pedido no quedo ni aplicado ni
// no_activado. Eso pone la corrida en rojo sin cambiar detalle[par].ok.
export function evaluarCorridaMultiPar(porPar, umbral = UMBRAL_ERROR_DEFECTO, opciones = {}) {
  const compuertaNoAplicados = compuertaNoAplicadaEn(porPar, opciones?.escrituraAbsoluta);
  const v = evaluarParesSinCompuerta(porPar, umbral);
  if (v.ok && compuertaNoAplicados.length > 0) {
    return {
      ok: false,
      motivo: `${compuertaNoAplicados.length} SKU(s) de la compuerta ESCRITURA_ABSOLUTA no quedaron aplicados (ver la linea de la compuerta)`,
      detalle: v.detalle,
      compuertaNoAplicados,
    };
  }
  return { ...v, compuertaNoAplicados };
}

function compuertaNoAplicadaEn(porPar, escrituraAbsoluta) {
  if (!(escrituraAbsoluta instanceof Set)) return [];
  const pares = Object.values(porPar ?? {}).filter((r) => r && !r.pendiente);
  const noAplicados = [];
  for (const sku of escrituraAbsoluta) {
    const aplicadoEnAlguno = pares.some((r) => r.compuertaSkus?.aplicados?.includes(sku));
    const fallidoEnAlguno = pares.some((r) => {
      const c = r.compuertaSkus;
      if (!c?.pedidos?.includes(sku)) return false;
      return !c.aplicados?.includes(sku) && !c.noActivados?.includes(sku);
    });
    if (!aplicadoEnAlguno || fallidoEnAlguno) noAplicados.push(sku);
  }
  return noAplicados;
}

function evaluarParesSinCompuerta(porPar, umbral) {
  const detalle = {};
  let algunoActivo = false;
  let todosOk = true;

  for (const [stateKey, resumen] of Object.entries(porPar ?? {})) {
    if (resumen && resumen.pendiente) {
      detalle[stateKey] = { pendiente: true, motivo: resumen.motivo ?? `par "${stateKey}" pendiente` };
      continue;
    }
    algunoActivo = true;
    const v = evaluarCorrida(resumen, umbral);
    detalle[stateKey] = { ok: v.ok, motivo: v.motivo, pendiente: false };
    if (!v.ok) todosOk = false;
  }

  if (!algunoActivo) {
    return {
      ok: false,
      motivo: "todos los pares quedaron pendientes: ninguno sincronizo nada en esta corrida",
      detalle,
    };
  }

  if (!todosOk) {
    return { ok: false, motivo: "al menos un par activo no pudo sincronizar correctamente", detalle };
  }

  return { ok: true, motivo: null, detalle };
}
