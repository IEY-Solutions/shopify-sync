# Lecciones

- En shopify-sync: antes de cerrar, verificar que TODOS los modos de src/index.js (--full, --cron, --sku, default) usan la misma funcion de orquestacion y el mismo archivo de estado. El juez rechazo 5 veces por codigo legado/huerfano divergente.
- Antes de congelar un test que restringe la forma de un archivo (ej. src/index.js), buscar con grep los tests preexistentes que lean ese archivo como texto: dos tests congelados se contradijeron y ninguna revisión lo vio.
- El runner de GitHub también interpreta el formato viejo ##[ en cualquier posición de una línea que no sea comando ::; escapar %/CR/LF no alcanza para valores impresos fuera de un ::warning::.
- arn juzgar trunca diffs grandes (ARN-W072): en features grandes, doble chequeo con un juez opus como agente antes de arn cerrar.
