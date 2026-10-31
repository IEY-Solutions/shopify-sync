# instalar-shopify-cli-para-poder

```yaml arn-contrato
feature: instalar-shopify-cli-para-poder
nivel: 0
riesgo: bajo
pedido: |
  "Fijate además, si podés instalar el CLI de Shopify para que yo vincule a la cuenta de
  ieyoficial.com en el navegador y puedas analizar y obtener el panorama completo." (29/10/2026)
requisitos:
  - id: R-1
    texto: "instalar Shopify CLI para poder consultar el panorama de la cuenta ieyoficial.com"
criterios:
  - id: CA-1
    requisitos: [R-1]
    tipo: mecanico
    superficie: cli
    texto: "instalar Shopify CLI para poder consultar el panorama de la cuenta ieyoficial.com"
    comando: "shopify version"
    espera: "exit 0"
```

## Cierre

- Instalado con `npm install -g @shopify/cli` (sin sudo). Versión `5.0.0`.
- El bin de npm global quedó fuera del PATH (entorno pnpm); se linkeó a `~/.local/bin/shopify`.
- CA-1 verificado por el implementador: `shopify version` → `5.0.0`, exit 0.
- No se ejecutó ningún flujo de autenticación: eso le corresponde a la persona, en su propio
  navegador. Comando para que ella lo corra: `shopify auth login`. La asociación con la tienda
  puntual `ieyoficial.myshopify.com` se hace después, al pedir un comando que la pide
  (por ejemplo `shopify app config link`, o pasando `--store=ieyoficial.myshopify.com` a comandos
  de `theme`/`app`).
- No se tocó ningún archivo del repo (instalación global del sistema).
