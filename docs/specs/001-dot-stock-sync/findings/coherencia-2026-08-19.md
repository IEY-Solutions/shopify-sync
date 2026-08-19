# Coherencia — afirmaciones vencidas antes del SPEC_CHALLENGE 02

- **Fecha:** 2026-08-19 · **Alcance:** read-only sobre la documentación, con verificación por comando
- **Para qué:** que el SPEC_CHALLENGE 02 gaste su presupuesto en el diseño y no en texto muerto

Este documento **no modifica la spec**: quien implementa no corrige su propio contrato. Registra
las afirmaciones que hoy son demostrablemente falsas, con la fuente de la refutación, para que el
challenger las trate como resueltas.

---

## C-01 — "La cuenta perdió el acceso de escritura al repo" — **falso desde el 2026-08-19**

`p0-disparo-externo.md` §"Diagnóstico definitivo" concluye que la identidad `federico0330` quedó
con sólo `pull` sobre `IEY-Solutions/shopify-sync` y que por eso `workflow_dispatch` devuelve 403.
La spec ya lo corrigió (V10, `spec.md:35`), pero la evidencia y `p0-proximos-pasos.md` no.

```
$ gh api repos/IEY-Solutions/shopify-sync --jq '.permissions'
{"admin":true,"maintain":true,"pull":true,"push":true,"triage":true}

$ curl -X POST -H "Authorization: Bearer $(gh auth token)" \
    -d '{"ref":"main","inputs":{"dry_run":"true","full":"false"}}' \
    https://api.github.com/repositories/1257815793/actions/workflows/sync.yml/dispatches
HTTP 204
```

Además hay 10 corridas `workflow_dispatch` exitosas del 2026-08-19 con actor `federico0330`.

**Lo que sí sigue roto, y por otra causa** (verificado el mismo día en la consola de cron-job.org):
la ejecución de prueba del cronjob `7733389` devuelve **403** contra esa misma URL y ese mismo
cuerpo. El header `Authorization` lleva un PAT **fine-grained** (`github_pat_`). Un PAT
fine-grained fija su lista de repositorios **en el momento de crearse** y no la puede seguir cuando
el repositorio cambia de dueño: fue emitido para `agustinmorales-iey/shopify-sync` y no cubre
`IEY-Solutions/shopify-sync`. Los permisos del usuario no lo arreglan porque el límite lo pone el
token, no la cuenta.

→ **Consecuencia:** D-08 y AC-19 dejan de estar bloqueados por permisos. El bloqueo real es un
token que hay que reemplazar.

## C-02 — "`verify.sh` todavía no corre `npm test`" — **falso**

`p0-proximos-pasos.md` §"Deuda conocida" ítem 3.

```
$ grep -n "has_npm test" ai/scripts/verify.sh
24:  has_npm test      && { run npm test          || FAIL=1; }
$ node -e "console.log(require('./package.json').scripts.test)"
node --test test/*.test.js
$ bash ai/scripts/verify.sh | tail -1
VERIFY_PASS
```

## C-03 — `compareQuantity` y "el proyecto está fijado en 2026-01" — **vencido**

`spec.md:37` (V12), `spec.md:123-126` ("Restricciones técnicas verificadas") y `acceptance.md:112-114`
(nota de fecha dura sobre AC-15) describen el estado **anterior** a `5049ed5` y `587c8bd`.

```
$ grep -n "SHOPIFY_API_VERSION" .github/workflows/sync.yml
75:          SHOPIFY_API_VERSION: "2026-04"
$ grep -c "compareQuantity" src/shopify.js
0          # sólo aparece en comentarios que explican la migración
```

`construirInputSet` emite `changeFromQuantity` y `MUTATION_SET` declara `@idempotent` en el campo.
Cuatro tests congelan ese contrato (`test/sku-match.test.js`). La "fecha dura 2027-01-01" del
riesgo abierto 5 **ya no aplica**.

## C-04 — Contradicción interna sobre los permisos

`spec.md:90-91` afirma *"la cuenta no tiene push sobre `shopify-sync` y sí sobre `iey-ai`"* como
fundamento de dónde vive el código, 55 líneas después de que V10 (`spec.md:35`) diga que se otorgó
`admin`. La misma contradicción está en `iey-ai/docs/specs/dot-stock-sync/spec.md` §1.

El argumento de arquitectura (Postgres, rate limiter compartido, Vercel) **se sostiene solo**. El
que cae es el argumento de "única opción ejecutable".

## C-05 — Hay DOS specs del mismo sistema, ambas "pendientes de challenge"

- `shopify-sync/docs/specs/001-dot-stock-sync/spec.md` — 13 invariantes, 24 criterios trazados al
  challenge 01. Estado declarado: `SPEC_DRAFT v2`, pendiente de SPEC_CHALLENGE 02.
- `iey-ai/docs/specs/dot-stock-sync/spec.md` — misma evidencia, otra estructura, y **la única que
  define los gates G-01..G-08**. Estado declarado: `Draft`.

Cuál de las dos es el contrato es la primera decisión del SPEC_CHALLENGE 02. Dos specs del mismo
sistema divergen solas.

## C-06 — `scripts/slot-due.ts` no existe

`iey-ai/docs/specs/dot-stock-sync/spec.md` §3.2 lo lista como prior art reutilizable. No está en el
checkout local ni en `origin/main` de `iey-ai`. La propia spec avisa que se escribió sobre un
checkout desactualizado y que sus referencias a código de `iey-ai` hay que reverificarlas; ésta es
una que ya se verificó y falló.

---

## Lo que este documento NO toca

Las 9 decisiones (D-01..D-09), los hechos verificados contra las APIs (V1..V14, S-1/S-2/S-3) y los
26 hallazgos del challenge 01 siguen vigentes. Nada acá los contradice.
