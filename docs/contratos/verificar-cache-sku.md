# Feature: verificar-cache-sku

## Pedido original

> "Mientras, hace todo lo posible de tu lado para solucionarlo. Es muy importante."

## Decisiones textuales de la persona (02/11/2026)

- Qué hacer con un SKU repetido que ya se venía escribiendo en una variante: **"Seguir en la
  variante establecida y avisar (Recommended)"**.
- Cómo mostrar los artículos universales en la tienda: **"Por ahora como está"**. Queda fuera de
  alcance.

## Defecto, con evidencia

- `src/shopify.js:18` y `:27-47`: `.cache/sku-map.json` guarda SKU → `inventoryItemId`, sin TTL ni
  invalidación. `--full` vacía `snapshotPrevio`, pero sigue usando la caché.
- `src/shopify.js:337-340`: con acierto en caché, `resolverSku` devuelve el id sin consultar
  Shopify. Solo lee el stock (`leerStockActual`). No verifica que esa variante siga teniendo ese
  SKU ni que no haya otras con el mismo.
- `src/sync.js:1030`, `:1051` y `:1075`: `ejecutarPar` escribe con ese id. `syncUnSku` hace lo
  mismo, vía `procesarSku` (`src/sync.js:321`, `:374`).
- Viola la invariante 3 de `AGENTS.md`: "verificar que el `sku` devuelto sea el pedido antes de
  escribir".
- **Caso real.** `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E` hoy está en 5 variantes (iPhone 13,
  13 Pro, 14, 16e y 17e). Según el historial de ajustes de Shopify, la app escribió **solo** en la
  17e: el 24/10 +10, después −1, −1 y −1, la última el 31/10 a las 18:01 UTC. Nunca detectó la
  ambigüedad porque tenía el id en caché.
- **Riesgo mayor.** Si en Shopify se cambia el SKU de una variante de X a Y, el sync sigue
  escribiendo el stock de X en esa variante. Hay **15 correcciones de SKU** pendientes
  (`docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md`) que no se pueden aplicar hasta
  arreglar esto.
- **Hueco adicional que encontró el planificador (R-9).** La caché es una sola para todos los
  pares (`src/sync.js:1179-1193`) y se reescribe al invalidarse, pero la línea base es por par.
  Con detectar el cambio de destino solo en `resolverSku`, un delta de la variante vieja todavía
  se aplica a la nueva en tres casos:
  - D1: la corrida que invalida termina en `ambiguo`, `no_encontrado` o `error`, y una corrida
    posterior resuelve el SKU sin entrada en caché;
  - D2: el segundo par de la misma corrida ve la caché ya reescrita por el primero (Galerías está
    activo desde `023ff95`);
  - D3: el segundo par saltea el SKU por el atajo y lo resuelve días después.

## Departamentos

Uno solo: **backend / middleware de sincronización de stock** (`src/shopify.js`, `src/sync.js`,
`test/*`). No se tocan `.github/` ni `src/resultado.js`.

## Nivel y riesgo

- **Nivel 2:** es una funcionalidad de un departamento y toca varios archivos.
- **Riesgo alto:** escribe inventario real en producción cada ~30 min (dinero: sobreventa o
  subventa), corrige la invariante 3 y, con R-9, suma un campo al estado persistido de la libreta.
  Ver la duda 2 sobre el nivel.
- **Presupuesto:** 2 intentos por tarea para el especialista; el jefe del departamento puede subir
  de escalón.

## Dudas y supuestos (no inventar)

1. **R-9 lo agregó el planificador.** El orquestador pidió pensar si hacía falta algo más, y el
   argumento son los huecos D1-D3 de arriba, con tests propios. La persona no lo aprobó con
   palabras. Conviene mostrárselo antes de implementar. Si se descarta, se sacan R-9, CA-8 y
   `test/cache-sku-destino-por-par.test.js` sin tocar el resto.
2. **Nivel.** R-9 cambia el esquema de la libreta persistida. Según `descomposicion-tareas`, "cambia
   datos" es nivel 3. Se deja en 2 por indicación del orquestador; el riesgo ya es alto.
3. **Residuo de R-9.** Desde la ronda 2, cada SKU con baseline y sin destino en la libreta se
   inicializa con la caché del inicio de la corrida (por SKU, no por libreta). Puede quedar mal
   inicializado en dos casos:
   - el par no se persistió en la corrida que invalidó: DRY_RUN, o `getStockDeposito` falló en ese
     par;
   - ya hubo un renombre antes del deploy.

   Alternativa más fuerte, no incluida: congelar una sola vez una copia de la caché previa al
   deploy (`.cache/sku-map.heredado.json`) y usarla para inicializar.
4. **Riesgo de la decisión "variante establecida".** En los grupos A2 del análisis, la variante
   establecida puede ser la **equivocada**, por ejemplo `IEY-COMBO-IEY108N-CARBON-NEGRO-IP17PM`:
   fila 1652 correcta con 125 u., fila 1744 equivocada con 2 u. El sync seguiría escribiendo ahí y
   el único aviso sería la línea `[AVISO]`. **Cerrada en la ronda 2 (E1 del orquestador):** el
   aviso **debe** nombrar el `variantId` de la establecida (R-2, CA-2).
5. **Tope de 10 candidatos (preexistente, H4).** **Cerrada en la ronda 2 (E2 del orquestador):**
   con `pageInfo.hasNextPage` y la establecida (o el destino de la libreta) fuera de lo visible, es
   `error` sin invalidar, sin sembrar y sin escribir; `first` queda en 10 (R-1, R-9, CA-1, CA-3,
   CA-8 D11). Queda abierto un caso que E2 no cubre: **sin entrada en caché ni destino en la
   libreta**, con tope, una única coincidencia exacta visible se usa como hoy (R-5), aunque podría
   haber otra variante con el mismo SKU afuera del tope. Es el comportamiento previo a esta
   feature; no lo cambié sin decisión.
6. **Índice de búsqueda de Shopify.** Después de un renombre puede tardar en actualizarse. Como la
   comparación usa `node.sku`, que se lee de la base, el retraso solo produce `no_encontrado`
   temporales, nunca una escritura en la variante equivocada.
7. **Costo.** La cantidad de llamadas no cambia, pero el acierto en caché pasa de `GetLevel` a
   `GetVariantBySku`, que cuesta más puntos. En `--full` (~2.500 SKUs secuenciales) no se midió el
   consumo real contra el balde. Supuesto: el ritmo secuencial queda por debajo del relleno.
8. **Siembras al aplicar las 15 correcciones.** La primera corrida después de cada renombre
   escribe el absoluto de Contabilium en esos SKUs. Es el mismo riesgo de cualquier siembra (una
   venta web todavía no registrada en Contabilium se re-infla) y se acota con el consumo
   `sembrado` del clasificador.
9. **Duplicados sin entrada en caché.** Si la caché se pierde y la libreta conoce el destino, el
   pedido (punto 4) dice ambiguo sin escritura. Se respeta, aunque la libreta podría servir de
   "variante establecida".
10. **Rojo confirmado con Bash en las tres rondas.**
    - Ronda 1: 374 tests, con los 33 nuevos en rojo.
    - Ronda 2: 386 tests, con los 45 nuevos en rojo.
    - Ronda 3: 391 tests, 341 en verde y los 50 nuevos en rojo (todos `cache-sku-*`), idéntico en
      dos corridas.

    `arn oraculo diagnosticar` dio los 9 CA en `rojo-esperado` (02/11, 18:56 UTC). No hay
    implementación de referencia, porque el oráculo no toca `src/`.
11. **Ronda 2: `syncTodos` no tiene test directo.** No es inyectable (usa `getStockDeposito` y
    `resolverSku` reales). La regla "`inventoryItemId: null` es `no_encontrado`" se prueba sobre
    `procesarSku`, que comparte con `syncUnSku` (CA-5 f1).
12. **Ronda 2: tope con el destino visible.** R-9 pide error solo si el destino de la libreta
    "no aparece en la respuesta". El caso con el destino visible pero renombrado y la búsqueda en
    el tope (se puede sembrar, porque se sabe que cambió) no tiene test; el diseño recomienda
    `itemsVistos` para distinguirlo. Una implementación más conservadora (error siempre que haya
    tope y destino distinto) pasaría los tests.
13. **Ronda 2: `cache_invalidada` en D10.** Con la libreta en W, la caché en V y el SKU en W, se
    cuenta `cache_invalidada = 1` porque la entrada de la caché dejó de valer (R-8), aunque no se
    siembre. Si se prefiere contar solo lo que cambia la escritura, hay que ajustar R-8 y D10.

```yaml arn-contrato
feature: verificar-cache-sku
nivel: 2
riesgo: alto
pedido: |
  "Mientras, hace todo lo posible de tu lado para solucionarlo. Es muy importante." (02/11/2026)
  Decision ante un SKU repetido que ya se venia escribiendo en una variante:
  "Seguir en la variante establecida y avisar (Recommended)".
  Sobre como mostrar los articulos universales en la tienda: "Por ahora como esta" (fuera de alcance).
  Defecto: src/shopify.js:337-340 devuelve el inventoryItemId cacheado sin verificar contra Shopify
  (invariante 3 de AGENTS.md); caso real APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E (5 variantes, el sync
  escribio solo en la 17e); 15 correcciones de SKU pendientes en
  docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md.
requisitos:
  - id: R-1
    texto: "Toda resolucion de un SKU para escribir stock se verifica contra Shopify en esa misma llamada, tambien con acierto en cache: resolverSku(sku, locationId, opciones) hace la busqueda exacta existente (QUERY_POR_SKU con sku:\"...\" entre comillas, first 10, que no se sube, la location del par, y pageInfo { hasNextPage } en la consulta) y cuenta como coincidencia solo un nodo cuyo sku es exactamente el pedido; el inventoryItemId que devuelve pertenece siempre a una de esas variantes, y aparecer en los resultados con un SKU prefijo-largo no alcanza. Todo retorno con item informa variantId (el id de la variante devuelta) y topeAlcanzado (pageInfo.hasNextPage; una respuesta sin pageInfo cuenta como false). Tope: si topeAlcanzado es verdadero y el item cacheado no esta entre las coincidencias exactas visibles, sea cual sea la cantidad de coincidencias exactas visibles (cero, una o varias), resolverSku lanza un Error que no es SkuAmbiguoError, con topeAlcanzado true: no cae en R-3 (ni SkuAmbiguoError ni no_encontrado), no invalida ni toca la cache, y no se siembra ni se escribe; ejecutarPar lo cuenta como error con una linea [ERROR] <par>/<sku>:, y un solo SKU en tope no pone la corrida en rojo por si mismo: rige el umbral de errores de siempre de evaluarCorrida. Llegar al tope sin ese conflicto no es error. opciones.consultar(query, variables) reemplaza a la consulta GraphQL real y opciones.rutaCache a .cache/sku-map.json, para testear sin red ni cache real. Si la busqueda falla, resolverSku falla: no usa el id cacheado sin verificar ni cae a GetLevel, y no toca la cache."
    origen: "pedido de la persona (punto 1 del comportamiento pedido); AGENTS.md invariante 3; src/shopify.js:330-350, defecto en :337-340; decision E2 del orquestador sobre el tope de candidatos (ronda 2, 02/11/2026); src/resultado.js:15 (umbral 5%); importante I-1 de la re-revision (ronda 3): el tope rige con cualquier cantidad de exactas visibles"
  - id: R-2
    texto: "Acierto en cache y el item cacheado esta entre las coincidencias exactas: se usa ese item (la variante establecida) con el available de la misma busqueda y la cache no se reescribe. Si hay otras variantes con el mismo SKU exacto, igual se escribe en la establecida: resolverSku devuelve duplicados igual a la cantidad de esas otras variantes (sin contar SKUs prefijo-largo) y el variantId de la establecida, y ejecutarPar suma 1 al contador duplicados del par e imprime una linea [AVISO] <par>/<sku>: con el total de variantes en la forma N variantes que debe nombrar el variantId de la establecida, para cotejarla con el analisis. Tambien en DRY_RUN, con la compuerta y en cualquier par (en la isla, [AVISO] galerias-pacifico/<sku>:). Los duplicados no cambian el veredicto de evaluarCorrida. El [AVISO] es una alerta de catalogo, no de causa, y queda como excepcion explicita y documentada, igual que [SET] y [DRY], a la regla del CA-4 de docs/contratos/clasificador-causa-comprobante.md (ninguna linea de log nombra un SKU contado en causa_desconocida) y de docs/adr/0001-semantica-de-escritura-de-stock.md:45 (causa_desconocida es metrica agregada, nunca alerta por SKU): sale aunque el SKU cuente en causa_desconocida, es acotado (solo SKUs con duplicados) y no menciona la causa, asi que ninguna linea que contenga desconocid nombra al SKU."
    origen: "decision de la persona (02/11/2026): \"Seguir en la variante establecida y avisar (Recommended)\"; caso real APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E (escrituras solo en la 17e, 24/10 a 31/10); decisiones del orquestador en la ronda 2 (02/11/2026): E1 (el aviso debe nombrar la variante establecida) y el [AVISO] como excepcion al CA-4 del clasificador"
  - id: R-3
    texto: "Acierto en cache pero el item cacheado ya no esta entre las coincidencias exactas (SKU renombrado o variante borrada) y la busqueda no llego al tope (con tope rige R-1): nunca se lee ni se escribe ese item; la entrada se borra de la cache y el SKU se resuelve con la misma busqueda: con 1 coincidencia exacta se usa, se cachea y se informa cambioDeDestino; con mas de 1 es SkuAmbiguoError y ambiguo sin escritura; con 0 es no_encontrado. En los tres casos resolverSku informa cacheInvalidada e inventoryItemIdAnterior (en no_encontrado devuelve un objeto con inventoryItemId null en vez de null; en ambiguo, como propiedades del error), y ejecutarPar cuenta el SKU una sola vez en cache_invalidada. ejecutarPar y procesarSku (el camino de syncUnSku y de syncTodos) cuentan un retorno con inventoryItemId null como no_encontrado, con el mensaje de hoy (no existe en Shopify), nunca como no_activado."
    origen: "pedido de la persona (punto 3 del comportamiento pedido); docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md, correcciones 1, 2, 3 y 9"
  - id: R-4
    texto: "Si el item destino de un SKU con baseline cambio, esa linea base era de otra variante: la corrida trata el SKU como sin linea base y siembra el absoluto de Contabilium con los mismos efectos que cualquier siembra: sin credito acreditable ni causa_desconocida, y con el resultado resuelto, resembradoEn[sku] igual a tInicioLectura, resembradoPor[sku] sembrado (absoluto si lo alcanza la compuerta) y las lineas Shopify del deposito anteriores a tInicioLectura consumidas con ese motivo. Quien decide si cambio: si la libreta del par conoce el destino del SKU (destinos[sku], R-9), manda la libreta: se siembra si y solo si ese destino difiere del item resuelto, sin importar la marca cambioDeDestino de resolverSku (con la libreta en W, la cache en V y el SKU resolviendo hoy a W, es delta y no siembra); solo cuando la libreta no conoce el destino decide cambioDeDestino. Baseline, snapshot y destino avanzan solo si la escritura quedo resuelta."
    origen: "pedido de la persona (punto 3, punto critico); docs/contratos/clasificador-causa-comprobante.md R-7; decision del orquestador en la ronda 2 (02/11/2026): prioridad de la libreta sobre cambioDeDestino"
  - id: R-5
    texto: "Sin entrada en cache, el comportamiento es el de hoy: busqueda exacta; 1 resultado se usa y se cachea; mas de 1 es ambiguo, sin escritura y sin cachear; 0 es no_encontrado (null). Un SKU con baseline cuyo destino no se conoce (sin entrada en cache ni destino en la libreta) aplica el delta como hoy: nunca se siembra por falta de dato (invariante 1)."
    origen: "pedido de la persona (punto 4 del comportamiento pedido); AGENTS.md invariante 1"
  - id: R-6
    texto: "La verificacion vale para todo camino que escribe stock: ejecutarPar en el modo por defecto y en --full, la compuerta manual (escrituraAbsoluta escribe el absoluto en la variante que hoy tiene el SKU exacto, nunca en la vieja, conserva el motivo absoluto y, con duplicados y cache valida, escribe en la establecida y emite el [AVISO] de R-2) y syncUnSku (modo --sku), que con cambio de destino siembra y guarda resembradoEn como cualquier siembra de syncUnSku. procesarSku, que comparten syncUnSku y syncTodos, informa un retorno con inventoryItemId null como no_encontrado (no existe en Shopify), nunca como no_activado."
    origen: "pedido de la persona (punto 1: ejecutarPar en modo por defecto y --full, la compuerta y syncUnSku); src/sync.js:321, :1030"
  - id: R-7
    texto: "Costo: como maximo una consulta a Shopify por SKU resuelto, la busqueda por SKU, que en el acierto de cache reemplaza a GetLevel; una invalidacion reutiliza esa misma respuesta y no dispara una segunda busqueda. El atajo incremental no cambia: un SKU sin cambios en Contabilium y sin credito pendiente no se resuelve ni se escribe."
    origen: "pedido de la persona (punto 5 del comportamiento pedido); AGENTS.md, Limites externos (balde de puntos de Shopify)"
  - id: R-8
    texto: "Visibilidad (invariante 5): el [RESUMEN] de cada par suma duplicados y cache_invalidada, siempre presentes (tambien en 0) y sin nombrar SKUs, ademas de las claves que ya tenia, y ejecutarPar los devuelve como numeros. cache_invalidada cuenta una vez cada SKU del par cuyo destino conocido (entrada de la cache o destino de la libreta) dejo de valer en esta corrida. Un SKU invalidado que termina ambiguo, no_encontrado o error cuenta tambien en esos estados, como hoy, incluido un error de escritura despues de invalidar (cuenta en cache_invalidada y en error). Un SKU en tope (R-1) no se invalida y no cuenta en cache_invalidada."
    origen: "pedido de la persona (punto 6 del comportamiento pedido); AGENTS.md invariante 5; test/compuerta-no-aplicada.test.js:142 (el [RESUMEN] no nombra SKUs)"
  - id: R-9
    texto: "Destino por par: cada libreta por par guarda destinos[sku], el inventoryItemId de la variante contra la que avanzo su baseline, en la misma escritura que el baseline, tanto en cada checkpoint como en el guardado final, y ninguna escritura de 3 argumentos (syncUnSku, guardarSnapshot) los borra. Un SKU con baseline cuyo destino en la libreta difiere del resuelto se siembra (R-4) aunque la cache ya apunte a la variante nueva. La inicializacion es por SKU, no por libreta: en cada corrida, todo SKU con baseline y sin entrada en destinos (con el campo null, ausente, o presente con entradas de otros SKUs pero sin esa clave) toma cacheInicial[sku], la cache leida una sola vez al empezar la corrida, antes de la primera resolucion (deps.leerCacheSku; DEPS_REALES la cablea a leerCacheSku de src/shopify.js), si esa cache tiene entrada, y se persiste con los guardados de la corrida aunque el SKU no se resuelva; sin deps.leerCacheSku no se inicializa nada. Asi, un syncUnSku corrido antes del primer cron no deja sin inicializar al resto de los SKUs. Un SKU resuelto anota su destino, tambien en syncUnSku cuando avanza el baseline por el camino del delta; ambiguo, no_encontrado, no_activado o error conservan el anterior. Tope: si el destino de la libreta difiere del resuelto, no aparece en la respuesta de la busqueda y la busqueda llego al tope (R-1), no se siembra ni se escribe: el SKU es error con una linea [ERROR] y el destino y el baseline se conservan, en ejecutarPar y en syncUnSku. syncUnSku usa el destino de la libreta o, si no lo tiene, el inventoryItemIdAnterior de resolverSku."
    origen: "agregado por el planificador a pedido del orquestador (punto 3: pensar si hace falta algo mas para que un delta de la variante vieja nunca se aplique a la nueva); huecos D1, D2 y D3 (src/sync.js:1179-1193, cache unica y libreta por par; par Galerias activo desde 023ff95); pendiente de mostrar a la persona (Dudas 1); ronda 2 de revisor-alcance (02/11/2026): inicializacion por SKU, destinos en el checkpoint (src/sync.js:1126-1127) y decision E2 del orquestador aplicada al destino de la libreta; re-revision ronda 3 (B-1, N-2, N-4): destinos parcial o null, syncUnSku anota el destino con delta y aplica el tope; DISENO-INTERFAZ.md 4.2"
  - id: R-10
    texto: "Se preservan los contratos existentes: la suite completa pasa sin debilitar, saltear ni borrar tests; buscarVariantePorSku, elegirVarianteExacta y leerStockActual conservan su contrato, cargarLibretaCompleta conserva la forma exacta de la libreta corrupta, y los tests que leen o escriben .cache/sku-map.json o simulan resolverSku pasan sin cambios."
    origen: "pedido de la persona (punto 7 del comportamiento pedido); AGENTS.md, Gates de revision"
criterios:
  - id: CA-1
    requisitos: [R-1, R-3, R-5]
    tipo: mecanico
    superficie: datos
    texto: "Test unitario del resolverSku real con consulta y cache inyectadas, sin red ni .cache real: cache valida devuelve el item cacheado, su variantId y topeAlcanzado false con el available de una sola busqueda sku:\"...\" (first >= 10, location del par) y sin GetLevel; caso real APPLYFIT con 5 variantes devuelve la 17e y su variantId con duplicados 4; cache renombrada sin coincidencias devuelve inventoryItemId null con cacheInvalidada y borra la entrada; cache envenenada que apunta a un SKU prefijo-largo se invalida; cache invalida con X unico en W devuelve W con cambioDeDestino y cachea W; con X en dos variantes lanza SkuAmbiguoError con cacheInvalidada y borra la entrada; sin cache se comporta como hoy; si la busqueda falla, rechaza sin GetLevel y deja la cache intacta. Tope: QUERY_POR_SKU pide pageInfo { hasNextPage }; con 11 variantes que coinciden, la cacheada fuera de las 10 visibles y otra con el SKU exacto entre ellas, rechaza con un Error que no es SkuAmbiguoError y tiene topeAlcanzado true, con una sola busqueda de first 10, sin GetLevel, sin cacheInvalidada y con la cache intacta; con tope, sin entrada en cache o con la cacheada visible, devuelve la coincidencia exacta con topeAlcanzado true; con tope y la cacheada fuera de las visibles, tambien con dos coincidencias exactas visibles distintas de ella y con cero (solo prefijos largos), rechaza con un Error que no es SkuAmbiguoError, con topeAlcanzado true, una sola busqueda de first 10, sin cacheInvalidada y con la cache intacta. El control de QUERY_POR_SKU acepta pageInfo con hasNextPage entre otros campos."
    comando: "node --test test/cache-sku-verificada.test.js"
  - id: CA-2
    requisitos: [R-2]
    tipo: mecanico
    superficie: datos
    texto: "Test de regresion con el caso real APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E (5 variantes, cache en la 17e, baseline 10, Contabilium 9, 17e con 4): ejecutarPar escribe una sola vez 3 en la 17e y nada en las otras 4, ambiguo 0, duplicados 1 en el retorno y en el [RESUMEN], una sola linea [AVISO] dot/<sku>: con 5 variantes y el variantId de la 17e, y evaluarCorrida ok true; en DRY_RUN tambien avisa con el variantId y cuenta, sin escribir; un SKU cuyo otro resultado es un prefijo-largo no tiene duplicados ni aviso; en la isla escribe en la establecida en la location de la isla y el aviso lleva el prefijo [AVISO] galerias-pacifico/<sku>:, sin aviso dot/; con la busqueda de comprobantes caida (clasificador fallo) y un delta, el SKU con duplicados cuenta en causa_desconocida, el [AVISO] con el variantId sale igual y ninguna linea que contenga desconocid nombra al SKU."
    comando: "node --test test/cache-sku-duplicados.test.js"
  - id: CA-3
    requisitos: [R-1, R-3, R-4]
    tipo: mecanico
    superficie: datos
    texto: "Test de renombre con ejecutarPar y el resolverSku real: (a) X renombrado a Y en V con cache X -> V: en V solo se escribe la siembra de Y (7), nunca el stock de X (2), X queda no_encontrado, cache_invalidada 1 y la cache queda {Y: V}; (b) correccion real 9, X ahora unico en W con una venta online acreditable: se escribe el absoluto 8 en W (no 0 por delta ni 9 por siembra mas credito), resembradoEn y resembradoPor sembrado en la libreta, la linea consumida como sembrado y causa_venta_shopify 0; (d) X en dos variantes: ambiguo, ninguna escritura, entrada borrada y baseline sin avanzar; par invertido real (correcciones 1 y 2): cada SKU se siembra en su variante nueva y cache_invalidada 2; tope: con 11 variantes que coinciden con X y la establecida fuera de las 10 visibles, ejecutarPar hace una busqueda de first 10, no escribe en ninguna variante (tampoco en la otra visible con el SKU exacto), cuenta error 1 con una linea [ERROR] dot/<sku>:, cache_invalidada 0, deja la cache y el baseline intactos, y con 24 SKUs mas en el atajo (total 25) evaluarCorrida da ok true; con la busqueda de comprobantes caida, una siembra por cambio de destino escribe el absoluto en la variante nueva y causa_desconocida queda en 0."
    comando: "node --test test/cache-sku-renombre.test.js"
  - id: CA-4
    requisitos: [R-5]
    tipo: mecanico
    superficie: datos
    texto: "Test sin cache: un SKU nuevo unico se siembra y se cachea, uno con baseline y sin destino conocido aplica el delta (4, no el absoluto 8), uno en dos variantes queda ambiguo sin escribir, uno inexistente y uno que solo coincide con un prefijo-largo quedan no_encontrado, y el [RESUMEN] muestra duplicados=0 y cache_invalidada=0."
    comando: "node --test test/cache-sku-sin-cache.test.js"
  - id: CA-5
    requisitos: [R-2, R-3, R-6]
    tipo: mecanico
    superficie: datos
    texto: "Test de caminos de escritura: syncUnSku con cache renombrada no escribe en la variante vieja ni avanza la libreta y procesarSku lo informa como no existe en Shopify, nunca como no esta activado; con X unico en W siembra el absoluto en W y guarda resembradoEn, y con duplicados aplica el delta en la establecida; ejecutarPar en --full resuelve un SKU sin cambios con cache renombrada como no_encontrado (no sin_cambios contra el item viejo) y escribe en la establecida con duplicados; la compuerta escribe el absoluto en la variante que hoy tiene el SKU con motivo absoluto, con X en ninguna variante no escribe ni cuenta como aplicada, y con duplicados y cache valida escribe el absoluto en la establecida, cuenta como aplicada, ambiguo 0 y emite el [AVISO] con el variantId de la establecida."
    comando: "node --test test/cache-sku-caminos-de-escritura.test.js"
  - id: CA-6
    requisitos: [R-7]
    tipo: mecanico
    superficie: infra
    texto: "Test de costo: en una corrida incremental con un SKU sin cambios, uno con cache valida, uno con cache renombrada y uno sin cache, las consultas a Shopify son exactamente tres busquedas sku:\"...\", una por SKU resuelto y en ese orden, ninguna GetLevel, el SKU sin cambios no llega a resolverSku y saltado es 1; si la busqueda falla con cache presente, el SKU queda en error sin escribir, sin GetLevel y con la cache intacta."
    comando: "node --test test/cache-sku-costo.test.js"
  - id: CA-7
    requisitos: [R-8, R-9]
    tipo: mecanico
    superficie: cli
    texto: "Test del [RESUMEN]: con un SKU con duplicados y uno con cache renombrada, la linea del par muestra duplicados=1 y cache_invalidada=1 junto a todas las claves previas (contadores, total, claves del clasificador y de la compuerta), sin nombrar SKUs, y ejecutarPar devuelve esos numeros; en una corrida sin duplicados ni invalidaciones las dos claves aparecen en 0; un error de escritura despues de invalidar (el intento fue en la variante nueva) cuenta error 1 y cache_invalidada 1 en el retorno y en el [RESUMEN], sin avanzar el baseline y conservando el destino de la libreta inicializado desde la cache."
    comando: "node --test test/cache-sku-resumen.test.js"
  - id: CA-8
    requisitos: [R-4, R-9]
    tipo: mecanico
    superficie: datos
    texto: "Test del destino por par: D1, una corrida termina ambiguo tras invalidar, la siguiente, con X unico, siembra 8 en vez de aplicar el delta (3), y la tercera aplica el delta (5) en vez de otra siembra (6); D2, con DOT e isla en la misma corrida, la isla siembra 2 en la variante nueva aunque la cache ya fue reescrita por el DOT (con delta seria 0) y las dos cuentan cache_invalidada 1; D3, la isla saltea X por el atajo, su libreta queda inicializada con el destino viejo y dias despues siembra 2; D4, los destinos se guardan con el baseline y ni syncUnSku ni un guardarSnapshot de 3 argumentos los borran; D5, una libreta anterior a esta feature aplica el delta con la cache valida o sin entrada en cache y anota el destino; D5b, con destinos null en el archivo, X se inicializa desde la cache del inicio y el escenario D1 sobre X siembra 8; D6, syncUnSku con el destino de la libreta y la cache perdida siembra en la variante nueva; D7, DEPS_REALES.leerCacheSku existe y leerCacheSku tolera archivo ausente o corrupto; D8a, con la libreta ya trayendo el campo destinos parcial (A si, X no), X toma su destino de la cache del inicio y el escenario D1 sobre X siembra 8; D8b, un syncUnSku con delta sobre A en una libreta legada escribe 3 y anota destinos[A], y despues el escenario D1 sobre X siembra 8; D9, con checkpointCada 1 y todo guardado posterior al primero que lleva el baseline de la siembra fallido (incluido el final), en disco quedan destinos[X] = W junto con su baseline y resembradoEn; D10, con destinos[X] = W, la cache en V y X resolviendo a W, aplica el delta (3) y no siembra (9), con cache_invalidada 1; D11, con el destino de la libreta fuera de las 10 visibles y la busqueda en el tope, no escribe, cuenta error con [ERROR] dot/<sku>:, no da sin_cambios y conserva el destino y el baseline; D12, el mismo tope en syncUnSku: una busqueda, ninguna escritura (ni siembra 9 ni delta 2), una linea [ERROR] con el SKU, y destino, baseline y resembradoEn sin cambios."
    comando: "node --test test/cache-sku-destino-por-par.test.js"
  - id: CA-9
    requisitos: [R-10]
    tipo: mecanico
    superficie: infra
    texto: "La suite completa del repo pasa sin debilitar, saltear ni borrar tests, incluidos test/sku-individual-usa-libreta-por-par.test.js, test/sku-match.test.js, test/libreta.test.js, test/clasificador-falla-visible.test.js y test/compuerta-no-aplicada.test.js."
    comando: "npm test"
congelado: {sha256: "f75f2302d440954ca648192d30bc32a95af508374d76d09cd3cc8fb3153dcdee", por: "autor-aceptacion", fecha: "2026-11-02T18:59:15+00:00"}
```

## Cierre (02/11/2026)

### Evidencia y veredictos
- **Evidencia:** `arn verificar` dejó CA-1 a CA-9 en verde, con exit 0, en
  `verificar-cache-sku/20261102T191238Z`. `npm test` dio 391 de 391, `ai/scripts/verify.sh` salió
  con exit 0 y `arn aceptacion verificar` dio "el oráculo coincide".
- **Juicio (`arn juzgar`):** `verificar-cache-sku/juez-20261102T191442Z`, veredicto **APRUEBA**,
  sobre el código final.
- **Juez independiente (opus, agente):** **APROBADO CON OBSERVACIONES**. Confirmó la invariante 3
  en todos los caminos de escritura. No cuenta para `arn cerrar`.
- **`arn cerrar`:** `cerrable: si`.

### Rondas de arreglo de la implementación
- **Ronda 1:**
  - I-2: `cache_invalidada` ahora cuenta también el destino de la libreta.
  - N-5: `destinos: null` ya no borra en `guardarSnapshot`.
- **Ronda 2:**
  - I-3: el conteo se condiciona a `ctx.cacheInicial?.[sku] != null`, para que cuente una sola
    vez.

### Riesgo aceptado: I-1 (decisión del orquestador)
- **El riesgo:** después del deploy, una corrida DRY_RUN previa a la primera corrida real de cada
  par reescribe `.cache/sku-map.json` pero no la libreta. La primera corrida real tomaría la
  variante nueva como destino conocido y aplicaría el delta en vez de sembrar.
- **Mitigación operativa:**
  - desplegar justo antes de una corrida real del cron;
  - que nadie dispare una DRY a mano hasta que cada par guarde su primera corrida real.
- **Cuándo se cierra:** la ventana termina con ese primer guardado, que persiste los destinos.
- **Galerías:** hoy tiene todo en 0, así que da lo mismo sembrar o aplicar el delta.

### Notas que quedan aparte
- **Libreta y caché en dos variantes distintas:** si las dos tienen el SKU exacto, se siembra en
  la variante de la caché. Es seguro para la invariante 1.
- **SKU en tope:** queda en `[ERROR]` en cada corrida hasta que se corrija la caché.
- **`[AVISO]` con tope:** puede contar de menos.
- **Caché corrupta:** se descarta sin avisar. Es comportamiento previo.
- **`cache_invalidada`:** en algunos casos no cuenta para un par (por el atajo, por un `--sku`
  entre crons o por una caché corrupta). Solo afecta la métrica.
- **Tests de regresión:** los arreglos de I-2 e I-3 (`src/sync.js:1187`) no tienen test propio,
  porque el oráculo está congelado.
- **Excepción del `[AVISO]` al CA-4 del clasificador:** está documentada acá y en
  `aceptacion/verificar-cache-sku/DISENO-INTERFAZ.md` §5, pero falta la adenda en el ADR 0001.
- **`syncTodos`:** ya no tiene llamadores en producción.
- **`guardarSnapshot` con `destinos: {}` vacío:** no escribe destinos. Hoy ningún llamador lo
  hace.
