# Documentación — iey-shopify-sync

Middleware que sincroniza el stock del depósito **LOCAL DOT BAIRES** de Contabilium (`127356`)
hacia la location **IEY Shopping Dot Baires** de Shopify (`gid://shopify/Location/83342655574`).

> **Estado (2026-08-19):** el sync **corre solo**. El disparador externo (cron-job.org `7733389`)
> dispara `sync.yml` **cada 30 min** en modo incremental escribiendo de verdad, con aviso por mail
> ante fallo y ante auto-deshabilitación. Verificado de punta a punta: el cronjob registra
> `204 No Content` y la corrida `32290610062` (19:00:39 UTC, disparada sin intervención humana) dio
> `DRY_RUN=false`, 2.562 SKUs, **0 errores** en 63,7 s.
>
> ⚠️ **El PAT vence el 2027-08-20.** Es fine-grained, alcance `IEY-Solutions/shopify-sync` con
> `Actions: Read and write`, y **su renovación necesita la aprobación de un owner de la
> organización** — no alcanza con ser admin del repo. Un PAT que caduca en silencio reproduce
> exactamente el modo de falla que originó este proyecto.
>
> La spec v2 del rediseño está escrita y pendiente de SPEC_CHALLENGE 02.

> **Nota:** `iey-ai › evidence/` significa
> `~/iey/iey-ai/docs/specs/dot-stock-sync/evidence/`. La evidencia con datos de negocio vive en el
> repositorio **privado** `iey-ai`, porque éste es público. Ver
> [`specs/001-dot-stock-sync/findings/README.md`](specs/001-dot-stock-sync/findings/README.md).

## Por dónde empezar

| Si querés… | Leé |
|---|---|
| Entender qué se rompió y por qué | [`diagnostico-2026-08-19.md`](diagnostico-2026-08-19.md) (H1–H12, N1–N7) |
| Saber qué está decidido y no volver a preguntarlo | `iey-ai › evidence/p0-decisiones.md` |
| Ver el estado y qué falta para que corra solo | `iey-ai › evidence/p0-proximos-pasos.md` |
| Retomar el trabajo en una sesión nueva | [`PROMPT-SESION-LIMPIA.md`](PROMPT-SESION-LIMPIA.md) |
| Saber qué de la doc quedó vencido | [`specs/001-dot-stock-sync/findings/coherencia-2026-08-19.md`](specs/001-dot-stock-sync/findings/coherencia-2026-08-19.md) |
| El contrato del rediseño | [`specs/001-dot-stock-sync/`](specs/001-dot-stock-sync/README.md) |

## Mapa

```
docs/
├── README.md                        ← estás acá
├── PROMPT-SESION-LIMPIA.md          ← prompt listo para arrancar una sesión nueva
├── diagnostico-2026-08-19.md        ← por qué se rompió (H1-H12, N1-N7)
├── adr/                             ← decisiones de arquitectura que sobreviven al paquete
├── specs/
│   ├── README.md                    ← índice de specs
│   └── 001-dot-stock-sync/
│       ├── README.md                ← índice de la spec, orden de lectura
│       ├── spec.md                  ← contrato v2 (post-P0)
│       ├── acceptance.md            ← 24 criterios, trazados al challenger
│       └── findings/
│           ├── README.md            ← dónde está la evidencia y por qué no acá
│           ├── spec-challenge-01.md ← el challenge de la v1 (26 hallazgos)
│           └── coherencia-2026-08-19.md ← afirmaciones vencidas, con su refutación
├── project/                         ← contexto del dominio (scaffold)
└── ai/knowledge/                    ← guías transversales (scaffold)
```

## Reglas que no se negocian

Están en [`../AGENTS.md`](../AGENTS.md). Las tres que más cuestan cuando se olvidan:

1. **Coincidencia de SKU exacta.** 671 de 2.562 SKUs (26,2 %) son prefijo estricto de otro y el
   campo `sku` de Shopify es tokenizado. Siempre `sku:"..."` **y** verificar el `sku` devuelto.
2. **Prohibido fallar en silencio.** El modo de falla real de este sistema no es el error ruidoso:
   es el tilde verde vacío. El 2026-06-03 y otra vez el 2026-08-19 una corrida reportó 2.4k errores,
   0 sincronizados y exit 0.
3. **Sólo se escribe la location DOT.** CENTRAL y su location no se tocan jamás.
