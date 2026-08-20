# Spec 001 — Sync de stock DOT Baires

**Estado:** `SPEC_DRAFT v2` · **SPEC_CHALLENGE 02 → `revision_required`** (13 bloqueantes) · P0 y P1 cerrados.

> La v3 tiene que responder los 13 bloqueantes de
> [`findings/spec-challenge-02.md`](findings/spec-challenge-02.md) antes de que se implemente nada.
> **GATE 4 no arranca hasta entonces.**

## Orden de lectura

1. **`iey-ai › evidence/p0-decisiones.md`** — las 9 decisiones ya tomadas.
   *Empezá acá: lo que está acá no se vuelve a preguntar.*
2. **[`spec.md`](spec.md)** — el contrato: problema, 14 hallazgos verificados, 13 invariantes,
   semántica de escritura, arquitectura, alcance y riesgos abiertos.
3. **[`acceptance.md`](acceptance.md)** — 24 criterios Given/When/Then, cada uno trazado al hallazgo
   del challenger que lo originó.
4. **[`findings/spec-challenge-01.md`](findings/spec-challenge-01.md)** — el challenge de la v1:
   26 hallazgos, 11 bloqueantes. Es lo que la v2 tuvo que responder.
5. **[`findings/spec-challenge-02.md`](findings/spec-challenge-02.md)** — el challenge de la v2:
   13 bloqueantes. Es lo que la v3 tiene que responder.
6. **[`findings/coherencia-2026-08-19.md`](findings/coherencia-2026-08-19.md)** — afirmaciones vencidas.

## Evidencia

> `iey-ai › evidence/` = `~/iey/iey-ai/docs/specs/dot-stock-sync/evidence/`. Vive en el repo
> **privado** porque contiene volumen de ventas, stock por SKU, CUIT y correos internos, y éste es un
> repositorio público. El porqué completo está en [`findings/README.md`](findings/README.md).

### Verificación P0 — cierra los supuestos S-1, S-2 y S-3

| Archivo | Qué resuelve |
|---|---|
| `iey-ai › evidence/p0-s2-comprobantes.md` | **S-2**: las ventas de Shopify descuentan de CENTRAL. La regla de deltas es correcta — con una rama manual que la rompe. |
| `iey-ai › evidence/p0-s1-integraciones.md` | **S-1**: integración del DOT creada (`IDIntegracion=29489`). Config real de la integración Shopify. |
| `iey-ai › evidence/p0-s3-stock-cero.md` | **S-3**: el endpoint lista los ceros. Más F-21: los `-INCLUIDO` son combos. |
| `iey-ai › evidence/p0-shopify-app.md` | Scopes reales de la app y la deprecación de la API 2026-04 (ya cerrada). |
| `iey-ai › evidence/p0-movimientos-dot.md` | Cómo cambia el stock del DOT en la vida real, y por qué el clasificador tiene un punto ciego estructural. |
| `iey-ai › evidence/p0-disparo-externo.md` | Por qué el disparo externo nunca funcionó. |

### Decisión y ejecución

| Archivo | Qué contiene |
|---|---|
| `iey-ai › evidence/p0-recomendacion-semantica.md` | La recomendación de semántica de escritura, con su fundamento. |
| `iey-ai › evidence/p0-validacion-p1.md` | Los arreglos H3/H4/H5 validados contra producción, con antes y después. |
| `iey-ai › evidence/p0-proximos-pasos.md` | Estado al cierre y qué falta para que corra solo. |

## Lo que ya está implementado (P1)

Commits `f000eb5` → `587c8bd` en `main`:

- **H3** `guardarCache()` sin `mkdirSync` → 2.475 errores en verde. Corregido.
- **H4** SKU tokenizado → escritura en la variante equivocada. Corregido; destapó **41 SKUs
  duplicados** en Shopify.
- **H5** libreta envenenada → 87 SKUs invisibles. Corregido, con invalidación por versión.
- **H12** API 2026-04: `compareQuantity` → `changeFromQuantity` **y** directiva `@idempotent`.
- Guardarraíl de salida distinta de cero, `schedule:` eliminado, modo `--full` expuesto, `npm test`.

## Lo que falta

Ver `iey-ai › evidence/p0-proximos-pasos.md` y
[`../../PROMPT-SESION-LIMPIA.md`](../../PROMPT-SESION-LIMPIA.md).
