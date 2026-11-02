// argv.js
// -----------------------------------------------------------------------------
// Decision de modo a partir de argv, estricta y pura (R-13).
//
// Antes index.js hacia args.includes("--cron"|"--full"|...) sobre TODO el argv:
// un input libre del workflow que valiera "--cron" arrancaba el cron. Ahora:
//   - solo se aceptan las opciones declaradas; un token desconocido, un
//     posicional, una opcion sin valor o un valor que parece un flag son un
//     ErrorDeUso (salida 2);
//   - el modo depende SOLO de argv;
//   - la compuerta manual (ESCRITURA_ABSOLUTA) se lee del entorno (R-6), nunca
//     de argv, y su valor no cambia el modo.
// -----------------------------------------------------------------------------

import { parseArgs } from "node:util";

export class ErrorDeUso extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "ErrorDeUso";
    this.codigoSalida = 2;
  }
}

const OPCIONES = {
  sku: { type: "string" },
  qty: { type: "string" },
  cron: { type: "boolean" },
  full: { type: "boolean" },
  locations: { type: "boolean" },
};

// Compuerta manual auditada (R-6/R-7): vacio -> null (apagado), "todos" ->
// "todos", lista separada por coma -> Set de SKUs normalizados a mayusculas.
export function parsearEscrituraAbsoluta(crudo) {
  const texto = String(crudo ?? "").trim();
  if (!texto) return null;
  // N-10 / R-15: un SKU con caracteres de control, "::" o "##[" formaria un
  // comando de workflow al imprimirse. Se rechaza sin repetir el valor crudo.
  if (/[\u0000-\u001f\u007f]|::|##\[/.test(String(crudo))) {
    throw new ErrorDeUso(
      'ESCRITURA_ABSOLUTA contiene caracteres de control o una secuencia de comando de workflow (dos puntos dobles, o doble numeral seguido de corchete); no se acepta'
    );
  }
  if (texto.toLowerCase() === "todos") return "todos";
  const skus = texto
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return skus.length > 0 ? new Set(skus) : null;
}

export function resolverModo(argv, env = {}) {
  let valores;
  try {
    ({ values: valores } = parseArgs({ args: [...(argv ?? [])], strict: true, allowPositionals: false, options: OPCIONES }));
  } catch (err) {
    if (typeof err?.code === "string" && err.code.startsWith("ERR_PARSE_ARGS")) {
      throw new ErrorDeUso(`argumentos invalidos: ${err.message}`);
    }
    throw err;
  }

  // Defensa extra: parseArgs ya rechaza un valor que empieza con "-" en modo
  // estricto, pero un valor de --sku/--qty con forma de flag nunca es valido.
  for (const nombre of ["sku", "qty"]) {
    const v = valores[nombre];
    if (v !== undefined && (v.trim() === "" || v.startsWith("-"))) {
      throw new ErrorDeUso(`--${nombre} necesita un valor (recibio "${v}")`);
    }
  }

  const escrituraAbsoluta = parsearEscrituraAbsoluta(env?.ESCRITURA_ABSOLUTA);

  let qty = null;
  if (valores.qty !== undefined) {
    if (valores.sku === undefined) throw new ErrorDeUso("--qty solo se usa junto con --sku");
    qty = Number(valores.qty);
    // N-9 / invariante 6: entero seguro >= 0 en valor ("3.0" -> 3).
    if (!Number.isSafeInteger(qty) || qty < 0) throw new ErrorDeUso("el valor de --qty debe ser un numero entero");
  }

  let modo;
  if (valores.locations) modo = "locations";
  else if (valores.sku !== undefined) modo = "sku";
  else if (valores.cron) modo = "cron";
  else if (valores.full) modo = "full";
  else modo = "incremental";

  return { modo, sku: valores.sku ?? null, qty, escrituraAbsoluta };
}
