# Interfaz asumida para `verificar-cache-sku`

Rol: `autor-aceptacion`. Son decisiones de interfaz, no de implementación. El implementador puede
cambiar nombres internos. Lo que verifican los tests es esto: los nombres exportados, la firma y el
retorno de `resolverSku`, la forma de los archivos en disco, las claves del `[RESUMEN]` y el prefijo
y el contenido de la línea `[AVISO]`. Cambiar cualquiera de esas cosas exige volver a pasar por
`revisor-alcance`.

Contrato: `.agents/.arn/feature.md`, R-1 a R-10.

Ronda 2 (02/11/2026, arreglo tras `revisor-alcance`): inicialización de destinos por SKU (4.3),
`destinos` en el checkpoint (4.3), la libreta manda sobre `cambioDeDestino` (4.1), tope de
candidatos (2, 3, 4.1), `variantId` en el retorno y en el `[AVISO]` (3, 5), el `[AVISO]` como
excepción al CA-4 del clasificador (5) y `inventoryItemId: null` como `no_encontrado` también en
`procesarSku` (3).

---

## 0. Compatibilidad con la suite existente

- `ejecutarPar` sigue llamando `deps.resolverSku(sku, par.locationId)`, con dos argumentos. Los
  ~15 archivos de test que simulan `resolverSku` devuelven `{ inventoryItemId, available }` o
  `null` y no traen ninguno de los campos nuevos. Si falta un campo nuevo, se lee así:
  `duplicados = 0`, `cacheInvalidada = false`, `cambioDeDestino = false`, `topeAlcanzado = false`,
  `variantId = null`, `itemsVistos = [inventoryItemId]`.
- `deps.leerCacheSku` es **opcional**. Si falta, no se inicializa ningún destino (sección 4.3) y
  **nunca** se lee el `.cache/sku-map.json` real como respaldo. Esto importa porque varios tests
  usan SKUs reales (`IEY-C09-GRIS`, `IEY-103-NEGRO`) que pueden estar en la caché real de la
  máquina del desarrollador. Si se leyera esa caché, sus ids reales no coincidirían con los ids
  falsos del test y el SKU se sembraría.
- `deps.cargarLibretaCompleta` puede devolver una libreta **sin** la clave `destinos`: los mocks
  congelados de `test/regresion-h3-absoluto.test.js:129-132` y `test/par-isla-pendiente.test.js:147`
  no la traen. `destinos` `null`, ausente o que no sea un objeto se trata igual que `{}`.
- `cargarLibretaCompleta` de un archivo corrupto devuelve **exactamente**
  `{ skus: {}, contabilium: null }` (`test/libreta.test.js:194`). El campo nuevo `destinos` solo
  aparece en las otras dos formas.
- `buscarVariantePorSku`, `elegirVarianteExacta`, `escaparValorBusqueda`, `QUERY_POR_SKU` y
  `leerStockActual` conservan su contrato (`test/sku-match.test.js`). `QUERY_POR_SKU` suma
  `pageInfo { hasNextPage }` dentro de `productVariants`, sin tocar `product { id title }`
  (`test/sku-match.test.js:178`).
- Las respuestas simuladas de `GetVariantBySku` de la suite previa no traen `pageInfo`
  (`test/sku-individual-usa-libreta-por-par.test.js:164,326,530`, `test/sku-match.test.js:239`).
  Una respuesta sin `pageInfo` cuenta como `hasNextPage = false`.

## 1. `resolverSku` inyectable — `src/shopify.js`

```js
export async function resolverSku(sku, locationId, opciones = {})
//   opciones.consultar  async (query, variables) => data
//                       Por defecto, shopifyGraphQL. Devuelve `data`, igual que shopifyGraphQL,
//                       no `{ data }`.
//   opciones.rutaCache  string. Por defecto, CACHE_PATH (.cache/sku-map.json).
```

- **Ruta explícita:** la caché se lee del disco **en cada llamada**, sin memo de proceso, y se
  escribe en esa ruta, creando el directorio si falta. Los tests modifican el archivo entre
  corridas y esperan ver el cambio.
- **Ruta por defecto (producción):** el memo de proceso de hoy sigue valiendo. Escribir con
  `guardarCache` sigue igual.
- `locationId` sigue siendo obligatorio.

## 2. Caché y búsqueda

- Forma del archivo, sin cambios: `{ [sku]: inventoryItemId }`.
- Exportación nueva: `export function leerCacheSku(ruta = CACHE_PATH)`. Devuelve un objeto
  **nuevo** leído del disco, sin memo. Si el archivo no existe o está corrupto, devuelve `{}`.
  `DEPS_REALES.leerCacheSku` es esta función, o un envoltorio sin argumentos que la llama con la
  ruta real.
- Cada llamada a `resolverSku` hace **exactamente una** consulta, `QUERY_POR_SKU`, con estas
  variables: `{ query: 'sku:"<escapado>"', locationId, first: 10 }`. La hace **también** con
  acierto en caché y reemplaza a `GetLevel`. El `available` sale del `inventoryLevel` de esa misma
  respuesta. `first` queda en 10: no se sube, por costo (decisión E2 del orquestador).
- **Coincidencia exacta:** cuenta un nodo con `node.sku === sku` y `node.inventoryItem.id`
  presente. Que un nodo aparezca en los resultados no alcanza: la búsqueda es tokenizada y trae
  también los SKU prefijo-largo.
- **Tope:** `topeAlcanzado = data.productVariants.pageInfo?.hasNextPage === true`. Significa que
  quedaron coincidencias de la búsqueda tokenizada afuera de las 10 visibles.
- Si la consulta lanza, `resolverSku` lanza. No toca la caché, no usa el id cacheado y no llama a
  `GetLevel`.

## 3. Retorno de `resolverSku`

Todo retorno con ítem trae además `variantId` (el `node.id` de la variante devuelta, por ejemplo
`gid://shopify/ProductVariant/1701`), `topeAlcanzado` e `itemsVistos` (los `inventoryItem.id` de
**todos** los nodos de la respuesta, exactos o no). `itemsVistos` es la forma recomendada de que
`ejecutarPar` sepa si un destino "se ve" (4.1); los tests no lo exigen por nombre.

| caso | retorno | caché después |
|---|---|---|
| caché válida (el ítem cacheado está entre los exactos), con o sin tope | `{ inventoryItemId: cacheado, variantId, available, desdeCache: true, duplicados: exactos-1, cacheInvalidada: false, cambioDeDestino: false, inventoryItemIdAnterior: cacheado, topeAlcanzado }` | sin cambios, no se reescribe |
| **caché con entrada, el cacheado no está entre los exactos y `topeAlcanzado`** | lanza un `Error` que **no** es `SkuAmbiguoError`, con `topeAlcanzado = true` y un mensaje que nombra el tope | **sin cambios**: no se invalida |
| caché inválida sin tope, 1 exacto W | `{ inventoryItemId: W, variantId, available, desdeCache: false, duplicados: 0, cacheInvalidada: true, cambioDeDestino: true, inventoryItemIdAnterior: viejo, topeAlcanzado: false }` | `sku -> W` |
| caché inválida sin tope, más de 1 exacto | lanza `SkuAmbiguoError` con `cacheInvalidada = true` e `inventoryItemIdAnterior = viejo` | entrada borrada |
| caché inválida sin tope, 0 exactos | `{ inventoryItemId: null, available: null, desdeCache: false, duplicados: 0, cacheInvalidada: true, cambioDeDestino: false, inventoryItemIdAnterior: viejo, topeAlcanzado: false }` | entrada borrada |
| sin entrada, 1 exacto (con o sin tope) | `{ inventoryItemId, variantId, available, desdeCache: false, duplicados: 0, cacheInvalidada: false, cambioDeDestino: false, inventoryItemIdAnterior: null, topeAlcanzado }` | `sku -> id` |
| sin entrada, más de 1 | lanza `SkuAmbiguoError` sin `cacheInvalidada`, o con `false` | sin cambios |
| sin entrada, 0 | `null`, como hoy | sin cambios |

`ejecutarPar` y `procesarSku` (el camino de `syncUnSku` y de `syncTodos`) tratan como
`no_encontrado` tanto `null` como un objeto con `inventoryItemId` nulo, y lo informan con el
mensaje de hoy (`[SKIP] <sku>: no existe en Shopify`, `src/sync.js:336`). **Nunca** como
`no_activado`: la compuerta tolera `no_activado` (R-15 del clasificador) y un SKU que ya no
existe no puede pasar por "aplicado en otro par". `available === null` con un `inventoryItemId`
válido sigue siendo `no_activado`.

## 4. Cómo lo usan `ejecutarPar` y `syncUnSku` — `src/sync.js`

### 4.1 Decisión por SKU (`ejecutarPar`, modo por defecto, `--full` y compuerta)

El atajo incremental queda igual y va antes de resolver. Después de `deps.resolverSku`:

```
destinoLibreta = destinos[sku]   // tras la inicializacion por SKU (4.3); undefined si no se conoce
conoceLibreta  = baseline !== null && destinoLibreta != null

if (conoceLibreta && destinoLibreta !== info.inventoryItemId
    && info.topeAlcanzado === true && !vistos(info).includes(destinoLibreta)) {
  // R-9 + E2: no se sabe si el destino fue renombrado o quedo afuera del tope.
  resultado = "error"   // linea [ERROR] <par>/<sku>: ... tope ...; sin escribir; destino conservado
}

cambioDeDestino = conoceLibreta
  ? destinoLibreta !== info.inventoryItemId          // manda la libreta
  : baseline !== null && info.cambioDeDestino === true // solo si la libreta no conoce el destino
```

- **Manda la libreta.** Si la libreta conoce el destino del SKU, se siembra si y solo si ese
  destino difiere del ítem resuelto, sin importar `info.cambioDeDestino`. Ejemplo (CA-8 D10): la
  libreta dice W, la caché apuntaba a V y hoy el SKU resuelve a W: es delta, no siembra. La
  marca del resolver solo decide cuando la libreta no conoce el destino.
- Si hay `cambioDeDestino` y el SKU tiene baseline, se trata como **sembrado**:
  - `nuevoValor = Math.round(cantidad)`;
  - `motivoAbsoluto = alcanzaAbsoluta ? "absoluto" : "sembrado"`;
  - crédito 0: el crédito calculado antes de resolver se descarta y no consume claves;
  - no suma `causa_desconocida`: no es un delta (CA-3 ronda 2);
  - con el resultado resuelto, las líneas Shopify del depósito anteriores a `tInicioLectura` se
    consumen con ese motivo, y se fijan `resembradoEn[sku] = tIso` y `resembradoPor[sku]`. Es el
    mismo bloque que hoy usa cualquier siembra (`src/sync.js:1106-1115`).
- Un `resolverSku` que lanza por tope (sección 3) cae en el `catch` de hoy: `error`, con la línea
  `[ERROR] <par>/<sku>: ...`. Un SKU en tope no cuenta en `cache_invalidada`. Un solo SKU en tope
  no pone la corrida en rojo por sí mismo: rige el umbral de errores de `evaluarCorrida` (5%).
- `cache_invalidada` suma 1 por SKU del par si `info?.cacheInvalidada`, `err.cacheInvalidada` o
  `cambioDeDestino`. Cada SKU cuenta una sola vez, aunque se den varias de esas condiciones. En
  D10 cuenta 1: la entrada de la caché (V) dejó de valer, aunque no se siembre.
- `duplicados` suma 1 por SKU del par si `info.duplicados > 0`, sea cual sea el resultado de
  después. En ese caso se imprime una línea `[AVISO]`, sección 5. Vale también con la compuerta.

### 4.2 `syncUnSku`

- Usa el mismo `resolverSku`, con `deps.resolverSku`, y la misma regla (incluido el tope).
- `destinoPrevio = libreta.destinos?.[sku] ?? info.inventoryItemIdAnterior`. `syncUnSku` no
  necesita `leerCacheSku`.
- Con `cambioDeDestino` y baseline, sigue el camino de **siembra** que ya existe: escribe el
  absoluto y guarda en la misma escritura `resembradoEn[sku] = tInicioLectura`,
  `resembradoPor[sku] = "sembrado"` y `destinos[sku]`.
- Si avanza el baseline, anota `destinos[sku]` y no borra los destinos de otros SKU, ni el corte,
  los consumos o `resembradoEn`.
- La línea `[AVISO]` en `syncUnSku` es opcional: no tiene `[RESUMEN]`.

### 4.3 Destino por par (R-9)

- La libreta del par (`last-sync.<stateKey>.json`) suma el campo `destinos: { [sku]: inventoryItemId }`.
- `cargarLibretaCompleta` lo devuelve así:
  - `destinos`: el objeto, si el archivo crudo lo trae;
  - `null` o `{}`, si el archivo no lo trae (libreta legada) o no existe;
  - en uno corrupto, la forma de siempre, sin el campo.
  
  Quien lo usa trata `null`, ausente o un valor que no es objeto como `{}` (sección 0).
- `guardarSnapshot(snap, ruta, contabilium, contabilidad)`:
  - con `contabilidad.destinos` presente, lo escribe en el mismo `writeFileSync`;
  - si falta (llamada de 3 argumentos, o una `contabilidad` sin `destinos`), conserva los
    destinos del disco.
  - Ya no hace falta una marca de "libreta migrada": la inicialización es por SKU.
- **Inicialización por SKU, no por libreta (ronda 2):**
  - `ctx.cacheInicial` se toma **una vez por corrida** con `deps.leerCacheSku()`, antes de la
    primera llamada a `resolverSku` de esa corrida y después del corte por `par.pendiente`. Un par
    pendiente no llama a ninguna dependencia.
  - En **cada** corrida, todo SKU con baseline y **sin entrada** en `destinos` toma
    `ctx.cacheInicial[sku]`, si la caché tiene entrada. No importa que otros SKU ya tengan la
    suya: un `--sku` corrido antes del primer cron anota `destinos[A]` y no puede dejar sin
    inicializar a X (CA-8 D8a con el campo `destinos` ya presente y parcial, D8b con el
    `--sku` real, D5b con `destinos: null`).
  - Sin `deps.leerCacheSku`, no se inicializa nada.
  - Lo inicializado se persiste con los guardados de la corrida, aunque el SKU termine en
    `ambiguo`, `no_encontrado`, `no_activado` o `error`.
- **Avance:**
  - con resultado `actualizado`, `sin_cambios` o `dry` (este último solo en memoria), se fija
    `destinos[sku] = info.inventoryItemId`;
  - con `ambiguo`, `no_encontrado`, `no_activado` o `error` (también el de tope), queda el
    destino anterior. Así la corrida siguiente vuelve a detectar el cambio (D1).
- `contabilidadParaGuardar()` suma `destinos` al **checkpoint** y al guardado final, en la misma
  escritura que el baseline (CA-8 D9). En DRY_RUN no se persiste nada, igual que hoy.

## 5. Visibilidad

- El `[RESUMEN] <par>:` suma `duplicados=<n>` y `cache_invalidada=<n>`. Las dos claves aparecen
  **siempre**, también en 0, y la línea sigue sin nombrar SKUs (`test/compuerta-no-aplicada.test.js:142`).
- El objeto que devuelve `ejecutarPar` suma `duplicados` y `cache_invalidada` como números.
- Línea de aviso, una por SKU con duplicados y por par:
  `[AVISO] <par>/<sku>: <N> variantes de Shopify tienen el sku exacto -> se escribe en la variante establecida <variantId>`.
  - `<N>` es el total de variantes, `duplicados + 1`, y se escribe con la palabra `variantes`.
  - **Debe** nombrar la variante establecida con su `variantId` (decisión E1 del orquestador),
    para que la persona la coteje con el análisis (Duda 4 del contrato).
  - Los tests buscan el prefijo `[AVISO] <par>/<sku>:`, `\b<N> variantes\b` y el `variantId`.
    Puede ir con sangría.
  - En la isla el prefijo es `[AVISO] galerias-pacifico/<sku>:`.
- **El `[AVISO]` frente al CA-4 del clasificador.** El CA-4 de
  `docs/contratos/clasificador-causa-comprobante.md` (línea 167) prohíbe toda línea de log que
  nombre un SKU contado en `causa_desconocida`, salvo `[SET]` y `[DRY]`
  (`test/clasificador-huecos.test.js:57-84`), porque `causa_desconocida` es métrica agregada,
  nunca alerta por SKU (`docs/adr/0001-semantica-de-escritura-de-stock.md:45`). Decisión del
  orquestador (ronda 2): el `[AVISO]` de duplicados es una **alerta de catálogo**, no de causa. Es
  una **excepción explícita** a esa regla, como `[SET]` y `[DRY]`:
  - sale aunque el SKU cuente en `causa_desconocida`;
  - es acotado: solo SKUs con duplicados;
  - no menciona la causa: ninguna línea que contenga `desconocid` nombra al SKU (CA-2 ronda 2).
- `evaluarCorrida` y `evaluarCorridaMultiPar` no cambian.

## 6. Costo

- Hay una consulta por SKU resuelto, igual que hoy cuando falla la caché. Un acierto en caché
  pasa de `GetLevel` a `GetVariantBySku`: la misma cantidad de llamadas, con más puntos por
  llamada. `pageInfo { hasNextPage }` no agrega llamadas.
- Una invalidación reutiliza la respuesta de esa misma búsqueda. No llama de nuevo a
  `buscarVariantePorSku`.
- El atajo incremental no cambia.

## 7. Cómo se testea sin red ni `.cache` real

- `test/_helpers-cache-sku.js` trae estas piezas:
  - `tiendaFalsa(variantes)`: una tienda que responde `consultar` imitando la búsqueda tokenizada
    (devuelve también los SKU prefijo-largo, corta en `first` y devuelve
    `pageInfo.hasNextPage` si quedaron coincidencias afuera) y anota cada consulta (`busqueda`,
    `nivel` u `otra`) y cada `setearStock`;
  - `prefijosLargos(sku, desdeN, cantidad, niveles)`: variantes `<sku>-L01`, `<sku>-L02`, ...
    que llenan el tope en los casos de E2;
  - `resolverInyectado(tienda, dir)`: el `resolverSku` **real** con `{ consultar, rutaCache: <dir>/sku-map.json }`;
  - `depsConCacheReal(...)`: los `depsFake` de `test/_helpers-clasificador.js`, con ese resolver,
    el `setearStock` de la tienda y `leerCacheSku` del directorio temporal. Pasa `fallaBusqueda`
    y `guardarSnapshotEnvoltorio` tal cual a `depsFake`.
- `aislarShopify(t)`:
  - borra las credenciales `SHOPIFY_*` del entorno, pone `DRY_RUN=true` en el entorno como red y
    fija `SHOPIFY_DOT_LOCATION_ID`;
  - reemplaza `fetch` por uno que lanza y lo anota;
  - activa `guardiaDeEscriturasEnRepo(t)`.

  Si la implementación ignora `opciones`, falla con "Faltan variables de Shopify" sin salir a la
  red y sin escribir en el `.cache/` real. Así se ve el rojo contra el `src/` actual.
- Los tests de `syncUnSku` le pasan además el `encierro` de `depsFake`.
