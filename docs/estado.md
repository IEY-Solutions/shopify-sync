# Estado

- Feature: ninguna (cerrada: activar-el-par-real-de — juez aprueba, `arn cerrar` ok)
- Último paso: `deltas-dot-mas-isla-galerias` mergeado a `main` (fast-forward, 165/165 verde).
  Activado el par real de Galerías Pacífico en `.env.example` y en `.github/workflows/sync.yml`
  (gid de Shopify `gid://shopify/Location/96849756246`, depósito Contabilium `139916`).
- Próximo paso: la persona tiene que agregar `SHOPIFY_ISLA_LOCATION_ID` y
  `CONTABILIUM_ISLA_DEPOSITO_ID` como GitHub Actions Secrets (Settings → Secrets and variables →
  Actions) para que el workflow real los inyecte — sin eso, el par sigue tratándose como pendiente
  en producción. Pendientes aparte, bloqueados fuera de este repo: el clasificador de causa por
  comprobante (viable, los campos existen en Contabilium) y el transporte vía BrokerContabilium
  (bloqueado: ese repo todavía no tiene cupo por cliente ni arregló el bug del "running" huérfano).
- Departamento: direccion
