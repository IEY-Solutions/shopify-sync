# Evidencia de aceptación — `verificar-cache-sku`

Rol: `autor-aceptacion`. Los oráculos se escribieron **antes** de la implementación y sin tocar
`src/` ni `.github/`. Todos los `CA-#` del contrato (`.agents/.arn/feature.md`) son
`tipo: mecanico`: la evidencia es el test que corre el `comando:` de cada uno.

- Interfaz asumida: `DISENO-INTERFAZ.md`.
- Rojo esperado, tabla de implementación incorrecta contra el caso que la detecta y choques
  revisados con grep: `rojo-2026-11-02.md`.

## Mapa CA → archivo de test

| CA | R | archivo | tests | qué cubre |
|---|---|---|---|---|
| CA-1 | R-1, R-3, R-5 | `test/cache-sku-verificada.test.js` | 12 | `resolverSku` inyectable: verificación con acierto en caché, retorno por caso (con `variantId` y `topeAlcanzado`), estado de la caché, falla de búsqueda sin respaldo; tope de candidatos (E2) con cero, una o dos exactas visibles |
| CA-2 | R-2 | `test/cache-sku-duplicados.test.js` | 5 | caso real APPLYFIT (5 variantes, la 17e establecida): escribe en la establecida, `duplicados=1`, `[AVISO]` con el `variantId`, sin rojo; también en DRY_RUN; un SKU prefijo-largo no cuenta como duplicado; prefijo de la isla; `[AVISO]` como excepción al CA-4 del clasificador |
| CA-3 | R-1, R-3, R-4 | `test/cache-sku-renombre.test.js` | 6 | (a) renombre X → Y; (b) corrección real 9: X en otra variante W, sembrado sin crédito; (d) ambiguo tras invalidar; par invertido real (correcciones 1 y 2); tope en `ejecutarPar`; siembra sin `causa_desconocida` |
| CA-4 | R-5 | `test/cache-sku-sin-cache.test.js` | 1 | (e) sin caché, igual que hoy, y un baseline sin destino conocido aplica el delta |
| CA-5 | R-2, R-3, R-6 | `test/cache-sku-caminos-de-escritura.test.js` | 7 | (f) `syncUnSku`, con `no_encontrado` y no `no_activado`; (g) `--full` y compuerta, también con duplicados |
| CA-6 | R-7 | `test/cache-sku-costo.test.js` | 2 | (h) una búsqueda por SKU resuelto, ninguna `GetLevel`, atajo sin consultas |
| CA-7 | R-8, R-9 | `test/cache-sku-resumen.test.js` | 3 | (i) `[RESUMEN]` con `duplicados` y `cache_invalidada`, también en 0, sin SKUs; error de escritura tras invalidar |
| CA-8 | R-4, R-9 | `test/cache-sku-destino-por-par.test.js` | 14 | destino por par en la libreta: D1 (ambiguo, después único y después delta), D2 (dos pares en la misma corrida), D3 (atajo en la isla), D4 (persistencia), D5 (libreta legada: delta, nunca siembra por falta de dato), D5b (`destinos: null`), D6 (`syncUnSku` con caché perdida), D7 (`leerCacheSku`), D8a (inicialización por SKU con `destinos` parcial), D8b (`syncUnSku` anota el destino con delta), D9 (`destinos` en el checkpoint), D10 (manda la libreta), D11 (tope con el destino de la libreta), D12 (ídem en `syncUnSku`) |
| CA-9 | R-10 | `npm test` | suite | la suite completa |

El helper compartido, sin `.test.js`, es `test/_helpers-cache-sku.js`. Tiene:

- la tienda falsa, que responde la consulta GraphQL e imita la búsqueda tokenizada de Shopify;
- `resolverInyectado`, el `resolverSku` real con `{ consultar, rutaCache }`;
- `depsConCacheReal`, que reutiliza `depsFake` de `_helpers-clasificador.js`;
- `aislarShopify`, que borra las credenciales, pone un `fetch` que lanza y activa
  `guardiaDeEscriturasEnRepo`;
- los SKU reales del análisis `docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md`.

El helper también tiene `prefijosLargos`, para los casos de tope, y pasa `fallaBusqueda` y
`guardarSnapshotEnvoltorio` a `depsFake`.

## Rondas

- **Ronda 1:** el orquestador confirmó con Bash 374 tests, 341 en verde y los 33 nuevos en rojo,
  con `arn oraculo diagnosticar` en `rojo-esperado` para los 9 CA. `revisor-alcance` respondió
  "sin bloqueantes, pero no listo".
- **Ronda 2, arreglo tras `revisor-alcance`:**
  - inicialización de destinos por SKU;
  - `destinos` en el checkpoint;
  - `[AVISO]` como excepción al CA-4 del clasificador;
  - tope de candidatos (E2);
  - `destinos` null o ausente;
  - `variantId` en el `[AVISO]` (E1);
  - prioridad de la libreta;
  - casos baratos.

  Son 12 tests nuevos y 6 ampliados. El detalle está en `rojo-2026-11-02.md`, sección "Ronda 2".
  El orquestador confirmó con Bash 386 tests, 341 en verde y los 45 nuevos en rojo, con los 9 CA
  en `rojo-esperado`.
- **Ronda 3 (última), arreglo tras la re-revisión:**
  - B-1: D8 se parte en D8a (`destinos` presente y parcial) y D8b (`syncUnSku` anota el destino
    con delta);
  - I-1: tope con cero y con dos exactas visibles en CA-1;
  - N-1 a N-4: regex de `pageInfo`, D5b con `destinos: null`, D9 sin contar guardados y D12 (tope
    en `syncUnSku`).

  Son 5 tests más (50 en total) y 2 cambiados. El detalle está en `rojo-2026-11-02.md`, sección
  "Ronda 3 (última)".

## Pendiente (sin Bash)

- Confirmar el rojo inferido de la ronda 3: 50 tests nuevos, 50 en rojo; la suite en 391, con 341
  en verde. Los comandos están al final de la sección 4 de `rojo-2026-11-02.md`.
- Correr `arn feature validar`.
- Correr `arn oraculo diagnosticar`. Es riesgo alto, así que va `--referencia`. No escribí una
  implementación de referencia porque esta tarea no toca `src/`.
- Pasar por `revisor-alcance` antes de congelar.
- R-9 (destino por par) lo agregó el planificador. Si el orquestador o la persona lo descartan,
  `test/cache-sku-destino-por-par.test.js` y CA-8 se sacan sin tocar el resto: los demás tests no
  dependen de él. Ver Dudas en el contrato.
