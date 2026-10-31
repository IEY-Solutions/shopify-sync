# activar-el-par-real-de

```yaml arn-contrato
feature: activar-el-par-real-de
nivel: 1
riesgo: alto
pedido: |
  Activar el par real de Galerias Pacifico. La persona confirmo: gid de Shopify
  gid://shopify/Location/96849756246, deposito de Contabilium ID=139916 (31/10/2026).
  Pendiente ya documentado en docs/contratos/deltas-dot-mas-isla-galerias.md.
requisitos:
  - id: R-1
    texto: "SHOPIFY_ISLA_LOCATION_ID y CONTABILIUM_ISLA_DEPOSITO_ID quedan documentados en .env.example con los valores reales confirmados, reemplazando el sentinel PENDIENTE."
    origen: "pedido de la persona (31/10/2026)"
  - id: R-2
    texto: "El workflow .github/workflows/sync.yml pasa SHOPIFY_ISLA_LOCATION_ID y CONTABILIUM_ISLA_DEPOSITO_ID como env vars sourced de secrets.*, igual que ya hace con las variables del DOT, para que el par deje de estar pendiente en produccion una vez que esos secrets existan en GitHub."
    origen: "pedido de la persona (31/10/2026); mismo patron ya usado para SHOPIFY_DOT_LOCATION_ID/CONTABILIUM_DOT_DEPOSITO_ID"
criterios:
  - id: CA-1
    requisitos: [R-1, R-2]
    tipo: mecanico
    superficie: infra
    texto: "npm test sigue en verde (165/165) tras el cambio de config/workflow, sin tocar logica de src/."
    comando: "npm test"
    espera: "exit 0"
```

## Cierre

- **Juicio:** `activar-el-par-real-de/juez-20261031T144530Z` — **APRUEBA**. `.env.example` tiene los valores reales (sin `PENDIENTE`), el workflow pasa ambos secrets nuevos con la misma sintaxis que el DOT, 165/165 tests en verde, ningún secreto escrito en texto plano en el YAML.
- `arn cerrar` → `cerrable: si` (nivel 1, sin oráculo congelado — no corresponde en este nivel).
- **Pendiente para que esto tome efecto en producción (acción de la persona, no del agente):** agregar los dos secrets nuevos en GitHub → Settings → Secrets and variables → Actions:
  - `SHOPIFY_ISLA_LOCATION_ID` = `gid://shopify/Location/96849756246`
  - `CONTABILIUM_ISLA_DEPOSITO_ID` = `139916`

  Sin esos dos secrets cargados en GitHub, el workflow seguirá pasando `undefined`/vacío para esas variables y `construirPares` tratará el par como pendiente igual que antes (comportamiento seguro, no falla, pero tampoco sincroniza la isla).
