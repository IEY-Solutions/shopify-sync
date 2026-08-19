# Contexto para una sesión nueva

> **Este archivo estaba desactualizado y se reemplazó el 2026-08-19** (hallazgo F-26 del
> SPEC_CHALLENGE 01). Describía un token `shpat_` que el código ya no usa —migró a
> `client_credentials` en `src/shopify.js`—, daba por pendiente un end-to-end que había corrido
> 2.806 veces, y era lo primero que leía cada sesión nueva.

**Empezá por [`docs/README.md`](docs/README.md).**

Si vas a retomar el trabajo, el prompt listo está en
[`docs/PROMPT-SESION-LIMPIA.md`](docs/PROMPT-SESION-LIMPIA.md).

## Lo mínimo, en cuatro líneas

- Este repo sincroniza el stock del depósito **DOT Baires** de Contabilium (`127356`) hacia la
  location **IEY Shopping Dot Baires** de Shopify (`gid://shopify/Location/83342655574`).
- Existe porque la integración nativa de Contabilium ocupa su único cupo con el depósito **CENTRAL**.
- Hoy **funciona y está convergido**, pero corre sólo por disparo manual.
- El rediseño (webhook + deltas + reconciliación) está especificado y **va a vivir en `iey-ai`**,
  no acá. Este repo se archiva con su diagnóstico.

## Reglas de seguridad

- **Nunca leer, mostrar ni loguear `.env`.**
- **Contabilium no tiene sandbox**: toda prueba contra su API es **sólo lectura**.
- **Este repositorio es público.** Antes de commitear cualquier documento, revisá que no lleve
  volúmenes de venta, precios, datos de clientes ni credenciales.
