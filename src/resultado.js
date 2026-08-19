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

  return { ok: true, motivo: null };
}
