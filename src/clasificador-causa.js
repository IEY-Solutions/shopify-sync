// clasificador-causa.js
// -----------------------------------------------------------------------------
// Funciones puras del clasificador de causa por comprobante (diseño B, R-2/R-5).
// Sin IO, sin leer el reloj y sin mutar sus argumentos: ejecutarPar
// (src/sync.js) es quien junta esto con el registro de comprobantes y con
// buscarComprobantes/fetchComprobantesDetalle (src/contabilium.js).
//
// Interfaz: aceptacion/clasificador-causa-comprobante/DISENO-INTERFAZ.md, seccion 2.
// -----------------------------------------------------------------------------

export const ID_INTEGRACION_SHOPIFY = 25020;
export const TIPOS_FACTURA = new Set(["FCA", "FCB", "FCE", "FCM"]);
export const TIPOS_NOTA_CREDITO = new Set(["NCA", "NCB", "NCE", "NCM"]);
export const MARGEN_ACREDITACION_MS = 5 * 60_000;

// Argentina: UTC-3 fijo, sin horario de verano desde 2009.
const OFFSET_ART_MS = 3 * 60 * 60 * 1000;

const PATRON_FECHA =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?(Z|[+-]\d{2}:?\d{2})?$/;

// parsearFechaArgentina — Contabilium manda FechaAlta/FechaEmision SIN zona:
// es hora de Argentina. Nunca new Date(texto) sobre un texto sin zona (en el
// runner, UTC, da 3 horas corridas). Con Z u offset explicito, se respeta.
export function parsearFechaArgentina(texto) {
  if (typeof texto !== "string") return null;
  const m = PATRON_FECHA.exec(texto.trim());
  if (!m) return null;
  const [, a, me, d, h, mi, s = "0", frac = "", zona] = m;
  const anio = Number(a);
  const mes = Number(me);
  const dia = Number(d);
  const hora = Number(h);
  const minuto = Number(mi);
  const segundo = Number(s);
  const ms = frac ? Number(frac.slice(0, 3).padEnd(3, "0")) : 0;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59 || segundo > 59) return null;

  const base = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo, ms);
  const comprobar = new Date(base);
  if (comprobar.getUTCFullYear() !== anio || comprobar.getUTCMonth() !== mes - 1 || comprobar.getUTCDate() !== dia) {
    return null; // 31/02 y similares
  }

  let offsetMs;
  if (zona === undefined) {
    offsetMs = -OFFSET_ART_MS;
  } else if (zona === "Z") {
    offsetMs = 0;
  } else {
    const signo = zona[0] === "-" ? -1 : 1;
    const digitos = zona.slice(1).replace(":", "");
    const oh = Number(digitos.slice(0, 2));
    const om = Number(digitos.slice(2, 4));
    if (oh > 23 || om > 59) return null;
    offsetMs = signo * (oh * 60 + om) * 60_000;
  }
  // hora local = UTC + offset  =>  UTC = hora local - offset
  return new Date(base - offsetMs);
}

// diaArgentina — dia calendario de Argentina de un instante, "YYYY-MM-DD".
export function diaArgentina(fecha) {
  const ms = fecha instanceof Date ? fecha.getTime() : new Date(fecha).getTime();
  return new Date(ms - OFFSET_ART_MS).toISOString().slice(0, 10);
}

function esShopifyDelDeposito(detalle, depositoId) {
  return (
    detalle?.Origen === "Shopify" &&
    Number(detalle?.IDIntegracion) === ID_INTEGRACION_SHOPIFY &&
    String(detalle?.Inventario) === String(depositoId)
  );
}

// Marca de referencia del comprobante: la mayor entre FechaAlta y FechaEmision
// (como hora de Argentina). Si una falta, la otra. null si no hay ninguna.
export function referenciaDeComprobante(detalle) {
  const alta = parsearFechaArgentina(detalle?.FechaAlta);
  const emision = parsearFechaArgentina(detalle?.FechaEmision);
  if (alta && emision) return alta.getTime() >= emision.getTime() ? alta : emision;
  return alta ?? emision ?? null;
}

// lineasAcreditables — lineas de venta Shopify/25020 del deposito, de una factura.
// Mismo SKU normalizado en el mismo comprobante: una sola linea sumada.
export function lineasAcreditables(detalle, depositoId) {
  if (!esShopifyDelDeposito(detalle, depositoId)) return [];
  if (!TIPOS_FACTURA.has(detalle?.TipoFc)) return [];
  const ref = referenciaDeComprobante(detalle);
  if (!ref) return [];
  const comprobanteId = Number(detalle.Id);
  const referencia = ref.toISOString();
  const porSku = new Map();
  for (const item of Array.isArray(detalle.Items) ? detalle.Items : []) {
    const sku = String(item?.Codigo ?? "").trim().toUpperCase();
    if (!sku) continue;
    const cantidad = Math.floor(Number(item?.Cantidad));
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    porSku.set(sku, (porSku.get(sku) ?? 0) + cantidad);
  }
  return [...porSku].map(([sku, cantidad]) => ({ comprobanteId, sku, cantidad, referencia }));
}

// esNotaCreditoShopify — se cuentan, nunca se acreditan (D-8).
export function esNotaCreditoShopify(detalle, depositoId) {
  return TIPOS_NOTA_CREDITO.has(detalle?.TipoFc) && esShopifyDelDeposito(detalle, depositoId);
}

export function claveConsumo(comprobanteId, sku) {
  return `${comprobanteId}:${sku}`;
}

// creditoAcreditable — lineas de UN SKU en el deposito del par: suma las no
// consumidas cuya referencia es estrictamente anterior a tInicioLectura - margen.
export function creditoAcreditable({ lineas, consumos, tInicioLectura, margenMs = MARGEN_ACREDITACION_MS }) {
  const limite = new Date(tInicioLectura).getTime() - margenMs;
  let credito = 0;
  const claves = [];
  for (const l of lineas ?? []) {
    const clave = claveConsumo(l.comprobanteId, l.sku);
    if (consumos && Object.prototype.hasOwnProperty.call(consumos, clave)) continue;
    const ref = new Date(l.referencia).getTime();
    if (!Number.isFinite(ref) || !(ref < limite)) continue;
    credito += l.cantidad;
    claves.push(clave);
  }
  return { credito, claves };
}
