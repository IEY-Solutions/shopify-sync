# Reglas del proyecto — iey-shopify-sync

Middleware que sincroniza el stock del depósito **LOCAL DOT BAIRES** de Contabilium (id `127356`)
hacia la location **IEY Shopping Dot Baires** de Shopify (`gid://shopify/Location/83342655574`).

Antes de revisar: `ai/scripts/verify.sh`. Preservá los contratos existentes.

## Dominio

Retail. El local del DOT vende por mostrador (se registra en Contabilium) **y** por la web con
retiro en tienda (lo descuenta Shopify). Son **dos sumideros independientes sobre el mismo stock
físico**, y esa asimetría es la fuente de casi todos los bugs de este repo.

## Fuente de verdad

Contabilium es la fuente de verdad del stock **físico**, pero **no es el único que lo descuenta**.
Shopify no es una réplica: es un segundo consumidor con estado propio.

## Invariantes

1. **Nunca escribir el valor absoluto de Contabilium sobre Shopify** mientras el flujo inverso
   (ventas del DOT → Contabilium) no exista. Se aplican **deltas** contra una línea base durable.
   Escribir el absoluto re-infla stock ya vendido online y produce sobreventa.
2. **Sólo se escribe la location DOT.** El depósito CENTRAL y su location no se tocan jamás.
3. **Coincidencia de SKU exacta.** El campo `sku` de Shopify es tokenizado con coincidencia parcial,
   y el **26%** de los SKUs de este catálogo son prefijo estricto de otro
   (`FUNDA-MAGSAFE-MATE-IPHONE16` vs `...16PRO`). Siempre `sku:"..."` entre comillas **y** verificar
   que el `sku` devuelto sea el pedido antes de escribir.
4. **Una divergencia se reporta, no se pisa.** Una venta online legítima y un bug producen la misma
   diferencia entre Contabilium y Shopify.
5. **Prohibido fallar en silencio.** Una corrida que no sincronizó nada no puede salir con código 0.
   El modo de falla real de este sistema no es el error ruidoso: es el tilde verde vacío
   (ver `docs/diagnostico-2026-08-19.md`, H3: 2.396 errores en verde).
6. **Cantidades enteras.** Contabilium devuelve decimales; Shopify sólo acepta enteros.
7. **Ningún SKU no resuelto se marca como resuelto.** Se reintenta en la próxima pasada.

## Límites externos (verificados)

- **Contabilium**: 25 req/10 s **por cuenta/IP**, compartido con `iey-ai` (que presupuesta 18/25).
  Un `429` bloquea *todos* los endpoints por ~1 min. `pageSize` fijo en 50, no modificable.
  Sin sandbox: toda prueba es contra producción → **sólo lectura**.
- **Shopify**: balde de puntos; `bulkOperationRunQuery` no consume rate limit en su ejecución.
  `inventorySetQuantities` requiere `@idempotent` **desde la API 2026-04**.
- **GitHub Actions**: el `schedule` sub-horario entrega entre 1,4% y 15%. Los workflows **con**
  `schedule:` se auto-desactivan a los 60 días sin actividad; los que se disparan desde afuera, no.
- **Vercel Hobby**: mata las funciones a ~48 s aunque declaren `maxDuration = 60`.

## Alcance

No refactors oportunistas. No se toca el sync de catálogo ni de ventas de `iey-ai`. No se sincronizan
precios. El flujo inverso (`POST /notificador/ecommerce`) está diseñado pero **fuera de alcance**
hasta tener los scopes de Shopify.

## Gates de revisión

- `ai/scripts/verify.sh` tiene que verificar algo de verdad: hoy este `package.json` no define
  `test`, `lint` ni `typecheck`, así que el gate pasaría vacío. **Agregarlos antes de confiar en él.**
- Todo fix de un hallazgo del diagnóstico lleva su test de regresión, con el caso real que lo produjo.
- Nunca se debilita, saltea ni borra un test para que pase.

## Secretos

Nunca leer, mostrar ni loguear `.env`. El repo es **público**: los secretos viven en GitHub Actions
Secrets. Verificado que el historial de git está limpio.

## Separación de deberes

Quien implementa no aprueba. Los revisores son read-only. Ver `docs/specs/001-dot-stock-sync/`.
