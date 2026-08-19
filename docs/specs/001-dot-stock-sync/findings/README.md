# Evidencia de la spec 001

## Dónde está

**La evidencia de P0 y P1 NO vive en este repositorio.** Está en

```
~/iey/iey-ai/docs/specs/dot-stock-sync/evidence/
```

## Por qué

`IEY-Solutions/shopify-sync` es un **repositorio público**. Los documentos de evidencia contienen
volumen de ventas por canal, niveles de stock por SKU, CUIT y direcciones de correo internas. Nada de
eso puede estar en un repo abierto, y el historial de git persiste aunque después se borre el archivo.

`iey-ai` es privado, es donde va a vivir el código nuevo, y es donde la cuenta tiene permiso de push.

No se hizo el repo privado a propósito: los repos públicos tienen GitHub Actions sin límite y los
privados consumen cuota. A ~9 minutos por corrida, este sync agotaría el cupo mensual en días.

## Índice de lo que hay allá

| Archivo | Qué resuelve |
|---|---|
| `p0-decisiones.md` | **Las 9 decisiones tomadas.** Es el documento que evita repetir conversaciones. |
| `p0-s2-comprobantes.md` | **S-2**: de qué depósito descuenta una venta de Shopify. La pregunta que decidía el diseño. |
| `p0-s1-integraciones.md` | **S-1**: integraciones de Contabilium; creación de la del DOT (`IDIntegracion=29489`). |
| `p0-s3-stock-cero.md` | **S-3**: el endpoint lista los ceros. Y F-21: los `-INCLUIDO` son combos. |
| `p0-shopify-app.md` | Scopes reales de la app y la deprecación de la API 2026-04 (cerrada). |
| `p0-movimientos-dot.md` | Cómo cambia el stock del DOT en la vida real; el punto ciego estructural. |
| `p0-disparo-externo.md` | Por qué el disparo externo nunca funcionó. |
| `p0-recomendacion-semantica.md` | La recomendación de semántica de escritura, con su fundamento. |
| `p0-validacion-p1.md` | Los arreglos H3/H4/H5/H12 validados contra producción. |
| `p0-proximos-pasos.md` | Estado al cierre y qué falta para que corra solo. |

## Lo que sí queda acá

- [`spec-challenge-01.md`](spec-challenge-01.md) — el challenge de la spec v1: 26 hallazgos,
  11 bloqueantes. Es análisis técnico, sin datos de negocio.
