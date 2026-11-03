# Feature en curso

## Pedido original

> "Escribir en todas las variantes (nuevo)" (03/11/2026): para los 7 SKUs del grupo A1 del
> informe `docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md` (un mismo artículo físico
> publicado como variante separada por modelo de teléfono, con el mismo SKU exacto en varias
> variantes de Shopify), el sync tiene que escribir el mismo stock resultante en TODAS las
> variantes de ese grupo, no solo en la "variante establecida". El resto del catálogo (SKUs
> duplicados no confirmados como universales, p. ej. SKU mal cargado o el caso ambiguo
> 16e/17e del grupo A4) sigue con el comportamiento actual: escribir solo en la variante
> establecida y avisar, o no escribir si es ambiguo sin variante establecida todavía.

## Lista curada (fuente: `docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md`, sección 3.A1)

La constante del código lleva cada SKU junto a su cantidad de variantes esperada (R-1, R-7).

1. `APPLYFIT-CLEAR-IP16PRO-17-17PRO` — 3 variantes (líneas 147-155)
2. `APPLYFIT-CLEAR-S24-S25` — 2 variantes (líneas 157-164)
3. `APPLYFIT-CLEAR-IP15-16` — 2 variantes (líneas 166-173)
4. `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E` — 5 variantes (líneas 175-185)
5. `APPLYFIT-CLEAR-IP16PM-17PM` — 2 variantes (líneas 187-194)
6. `APPLYFIT-CLEAR-IP13PM-14PLUS` — 2 variantes (líneas 196-203)
7. `APPLYFIT-CLEAR-S24PLUS-S25PLUS` — 2 variantes (líneas 205-212)

Total: 18 variantes (el pedido textual decía 19; el informe, que es la fuente de verdad pedida
explícitamente, suma 18 para estos 7 SKUs exactos; se usa el informe).

```yaml arn-contrato
feature: sku-universal-multivarianta
nivel: 2
riesgo: alto
pedido: |
  "Escribir en todas las variantes (nuevo)" (03/11/2026): para los 7 SKUs del grupo A1 del
  informe docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md (un mismo articulo fisico
  publicado como variante separada por modelo de telefono, con el mismo SKU exacto en varias
  variantes de Shopify), el sync tiene que escribir el mismo stock resultante en TODAS las
  variantes de ese grupo, no solo en la "variante establecida". El resto del catalogo (SKUs
  duplicados no confirmados como universales, p. ej. SKU mal cargado o el caso ambiguo
  16e/17e del grupo A4) sigue con el comportamiento actual: escribir solo en la variante
  establecida y avisar, o no escribir si es ambiguo sin variante establecida todavia.
requisitos:
  - id: R-1
    texto: "La lista de SKUs universales vive en el codigo (una constante exportada, auditable con un test), con exactamente estos 7 SKUs tal como figuran en docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md seccion 3.A1, cada uno junto a su cantidad de variantes esperada (pares {sku, variantes}, no una lista de SKUs sola): APPLYFIT-CLEAR-IP16PRO-17-17PRO 3, APPLYFIT-CLEAR-S24-S25 2, APPLYFIT-CLEAR-IP15-16 2, APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E 5, APPLYFIT-CLEAR-IP16PM-17PM 2, APPLYFIT-CLEAR-IP13PM-14PLUS 2 y APPLYFIT-CLEAR-S24PLUS-S25PLUS 2 (18 variantes en total). La cantidad esperada es un dato conocido de antemano (viene del informe) y es la referencia del control de R-7. No es una heuristica (no se infiere de que el SKU nombre varios modelos): es esta lista explicita, y solo estos 7 SKUs activan el comportamiento nuevo. La pertenencia a la lista es por coincidencia EXACTA del string completo del SKU contra estos 7 valores, nunca por similitud: un SKU que es prefijo o extension de uno curado (p. ej. un SKU que empieza con APPLYFIT-CLEAR-IP15-16 y sigue con mas caracteres, o uno que es un recorte de APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E) NO es universal y nunca entra a ningun camino de esta feature (ni busqueda de N variantes, ni journal pendiente, ni escrito, ni bypass del atajo de R-14, ni carve-out de cambioDeDestino de R-4, ni compuerta multi-variante de R-16)."
    origen: "pedido de la persona (03/11/2026); docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md:145-212 (seccion 3.A1)"
  - id: R-2
    texto: "Cuando el SKU pedido esta en la lista curada, la busqueda exacta (la misma QUERY_POR_SKU, sku:\"...\" entre comillas, mismo tope de candidatos) devuelve TODAS las variantes con ese SKU exacto como candidatas de escritura, no solo la variante establecida de la cache. Cada candidata trae su variantId, inventoryItemId y available propios, igual que hoy trae la establecida. Para los SKUs de la lista curada, resolverSku NUNCA lanza SkuAmbiguoError por falta de variante establecida en cache: el camino de verificar-cache-sku que exige una entrada en cache para no tirar ese error no aplica a estos 7 SKUs, sea cual sea el estado de la cache (sin entrada, entrada vencida o entrada presente); siempre devuelve las N variantes exactas como candidatas de escritura (sujeto solo al control de conteo de R-7 y al de activacion de R-18). La cache tampoco decide cual de las N es 'la' candidata: las N lo son."
    origen: "pedido de la persona; hallazgo IM-1 de la revision de alcance; src/shopify.js:362-459 (resolverSku, logica actual de variante establecida + duplicados); src/shopify.js:272-277 (elegirVarianteExacta, SkuAmbiguoError)"
  - id: R-3
    texto: "El baseline sigue siendo UNICO POR SKU, nunca por variante (un solo stock real en Contabilium para el articulo fisico). El delta/valor a escribir (calcularEscritura) se calcula UNA sola vez por SKU y corrida, no una vez por variante, preservando la semantica de deltas del ADR 0001 y de calcularEscritura (src/sync.js:283-289): nunca se escribe el absoluto de Contabilium salvo siembra (baseline null). Si el SKU universal tiene credito acreditable, se suma UNA sola vez dentro de ese mismo calculo unico de nuevoValor (la misma formula que ya usan los SKUs no universales, src/sync.js:1159), nunca una vez por variante."
    origen: "pedido de la persona (\"sigue existiendo un solo baseline por SKU\"); docs/adr/0001-semantica-de-escritura-de-stock.md; src/sync.js:273-289"
  - id: R-4
    texto: "Para calcular ese unico delta hace falta un unico 'shopifyActual' de referencia. Este requisito aplica SOLO cuando el SKU universal NO tiene una entrada pendiente en la libreta del par (R-10); con entrada pendiente no se calcula ningun delta, ni se toma ningun maximo, ni se usa escrito (R-11), porque lo leido en Shopify puede ser el resultado a medio aplicar de un intento anterior y no una senal real (hallazgo B-1). Sin pendiente hay exactamente tres caminos, excluyentes entre si (nunca se combinan dos en el mismo SKU y corrida): (a) SIEMBRA: baseline null, se siembra con el absoluto de Contabilium como hoy. (b) BOOTSTRAP, sin escrito guardado (R-13) para ese SKU: primera corrida del SKU o primera corrida tras desplegar esta feature, sin historial; si las N variantes tienen el mismo available se usa ese valor, y si DIVERGEN (tipicamente por el comportamiento viejo que solo escribia en una, o por una edicion manual) se toma el valor MAS ALTO entre los available de las N variantes leidos EN ESA CORRIDA. (c) CAMINO NORMAL, con escrito guardado (R-13): shopifyActual = max(0, escrito - suma sobre las N variantes de max(0, escrito - available_i)); cada baja de una variante desde el ultimo escrito (available_i < escrito) es una venta online real, sin importar en que variante/modelo se vendio, y se suman todas sus bajas. Una variante que aparece POR ENCIMA de escrito (available_i > escrito, p. ej. una reposicion o edicion manual en Shopify, o un escrito viejo restaurado) aporta 0 a la suma: su suba se IGNORA, nunca resta de la cuenta de ventas ni infla shopifyActual por encima de escrito. El piso 0 se aplica DOS veces: a cada termino individual (max(0, escrito - available_i), que es lo que ignora las subas) y al resultado final de la resta, porque la suma de las bajas individuales puede superar a escrito (varias variantes pueden reportar cada una una baja grande de forma independiente aunque fisicamente sea el mismo pool) y el piso por termino no alcanza para impedir un total negativo. shopifyActual nunca es negativo. El maximo NO se usa en el camino (c). En los tres caminos nuevoValor se calcula una sola vez (calcularEscritura) y es el mismo para las N variantes. El chequeo generico de 'cambioDeDestino' que en ejecutarPar (src/sync.js:1134-1151, no en calcularEscritura, que no lo tiene) dispara siembra para SKUs no universales (verificar-cache-sku R-4) NO aplica a los 7 SKUs de la lista curada: para estos SKUs la unica condicion de siembra es la del camino (a) de este requisito (baseline null). Actualizar destinos[sku] al inventoryItemId mas chico (R-5), incluida la primera corrida tras desplegar esta feature para un SKU que ya tenia un destinos[sku] heredado del comportamiento viejo con otro valor, nunca dispara siembra por si solo. El delta se sigue calculando contra el baseline de Contabilium (nunca se pisa Contabilium); lo unico que cambia entre (b) y (c) es de donde sale el 'shopifyActual' de referencia. Ejemplo normativo de ventas individuales: escrito 5, las 5 variantes en 5, una venta online deja una variante en 4 (4/5/5/5/5), luego Contabilium baja 1 en mostrador: shopifyActual = max(0, 5 - 1) = 4, delta -1, nuevoValor 3 en las 5 variantes (nunca 4, que es lo que daria el maximo y re-inflaria la venta online). Ejemplo normativo del piso 0 sobre el total: escrito 1, Shopify lee 0/0 en 2 variantes y Contabilium sin cambios: suma de bajas = max(0,1-0) + max(0,1-0) = 2, shopifyActual = max(0, 1 - 2) = 0 (nunca -1), nuevoValor 0. Ejemplo normativo de suba ignorada: escrito 5, Shopify lee 8/5/5/5/5 (alguien repuso a mano la primera variante) y Contabilium sin cambios: shopifyActual = max(0, 5 - (max(0,5-8) + 0+0+0+0)) = max(0, 5 - 0) = 5, nuevoValor 5; se escribe 5 en la primera variante (bajandola de 8 a 5, revirtiendo la suba) y las otras cuatro, que ya estan en 5, no reciben mutacion; nunca se escribe 8 en ninguna ni se usa 8 como referencia."
    origen: "decisiones de la persona (03/11/2026): 'Tomar el valor mas alto como referencia y emparejar solo' (Duda 1, ahora solo para el bootstrap), 'Sumar las ventas individuales, no tomar el maximo' (Duda 5) e 'Ignorar la suba, contar solo las bajas reales' (Duda 7); AGENTS.md invariante 1 (deltas, nunca absoluto de Contabilium, no re-inflar lo vendido online); hallazgo B-1 de la revision de alcance (delta aplicado dos veces tras fallo parcial)"
  - id: R-5
    texto: "Calculado nuevoValor (entero, Math.round, igual que hoy) y persistida la entrada pendiente (R-10), se escribe nuevoValor en cada una de las N variantes/inventory items del SKU en la location del par cuyo available difiere de nuevoValor; las que ya tienen nuevoValor cuentan como satisfechas y no reciben mutacion. Cada mutacion lleva como changeFromQuantity el available de esa variante leido en esa corrida (guarda del ADR 0001): si la variante se movio entre la lectura y la escritura, la mutacion falla en vez de pisar. El SKU solo se marca resuelto, y el baseline y el destino avanzan UNA vez, cuando las N variantes quedan confirmadas en nuevoValor. Al avanzar, destinos[sku] (y la cache, si se reescribe) se fija al inventoryItemId MAS CHICO (orden ascendente, comparando el numero del gid) entre las N variantes, no al orden en que Shopify devolvio la busqueda exacta: el orden de respuesta de la API no esta garantizado estable entre corridas, y destinos[sku] cambiando de variante sin motivo real dispararia el chequeo de 'cambioDeDestino' de verificar-cache-sku (docs/contratos/verificar-cache-sku.md R-4) y sembraria el absoluto en vez de aplicar un delta, lo cual violaria la invariante 1. Ordenando por inventoryItemId, el mismo conjunto de N variantes da siempre el mismo destino sin importar el orden de respuesta de la API. Si alguna mutacion falla (error de Shopify, guarda changeFromQuantity, o el proceso muere a mitad), el SKU no se marca resuelto, el baseline y el destino no avanzan, se emite un [ERROR] por cada variante fallida y la entrada pendiente de R-10 queda en la libreta para la corrida siguiente. Las variantes que si se escribieron NO se revierten. Un SKU universal no resuelto (por fallo de escritura, por fallo de persistencia de R-10 o por divergencia de R-11) suma al MISMO contador de errores que ya usa el sync para cualquier otro fallo de escritura; no es un camino de salida nuevo ni distinto, y el codigo de salida del proceso sigue la convencion ya existente para cuando hay errores (invariante 5), sin definir un umbral nuevo."
    origen: "pedido de la persona (\"escribir ese mismo valor resultante en TODAS las variantes\"); AGENTS.md invariantes 5, 6 (enteros) y 7 (ningun SKU no resuelto se marca resuelto); docs/adr/0001-semantica-de-escritura-de-stock.md:41-42 (changeFromQuantity, journal pendiente/confirmado); src/sync.js:1173 (setearStock, dentro de ejecutarPar, ya recibe available como guarda); hallazgo B-1"
  - id: R-6
    texto: "Para cualquier SKU repetido que NO esta en la lista curada (incluido el grupo A4 ambiguo 16e/17e y cualquier SKU mal cargado del grupo A2), el comportamiento no cambia: sigue existiendo la logica actual de 'variante establecida + [AVISO]' (si hay entrada en cache) o SkuAmbiguoError sin escritura (si no hay variante establecida), exactamente como la dejo la feature verificar-cache-sku."
    origen: "pedido de la persona (\"el comportamiento actual no cambia\"); docs/contratos/verificar-cache-sku.md R-2, R-3, R-5; src/shopify.js:393-458"
  - id: R-7
    texto: "El tope de candidatos (CANDIDATOS_POR_SKU=10) sigue aplicando igual para SKUs universales, y el control se hace contra la cantidad de variantes ESPERADA de la lista curada (R-1), no contra variantes conocidas sacadas de cache, destinos o pendientes en tiempo de ejecucion. Es error (no se escribe ninguna variante del SKU, no se marca resuelto, se emite [ERROR]) en dos casos: (a) la busqueda exacta termina antes de llegar al tope con una cantidad de variantes exactas distinta de la esperada, tanto menos (falta alguna) como mas (candidatos de mas por un error de catalogo); (b) la busqueda llega al tope de candidatos sin haber completado la cantidad esperada. Ninguno de los 7 SKUs curados tiene mas de 5 variantes hoy (seccion 3.A1 del informe), asi que no se espera tocar el caso (b), que se trata igual que el tope generico ya existente."
    origen: "src/shopify.js:207 (CANDIDATOS_POR_SKU), :405-412 (tope ya existente); docs/contratos/verificar-cache-sku.md R-1"
  - id: R-8
    texto: "El log y el [RESUMEN] del par distinguen este caso nuevo del de 'duplicados ambiguos con variante establecida' (R-6). Linea de log, una por SKU universal procesado que no quedo sin cambios, con este formato literal (dos espacios de sangria y prefijo <par>/<sku>, igual que [SET]/[AVISO]/[DRY] de ejecutarPar, src/sync.js:1126 y :1174; <par> es el nombre del par, <sku> el SKU exacto, <N> la cantidad de variantes exactas, <V> el nuevoValor entero, <E> las variantes mutadas con exito en esta corrida, <Y> las que ya tenian <V>, <F> las fallidas o no escritas; E+Y+F=N): (1) todas confirmadas: '  [UNIVERSAL] <par>/<sku>: <N> variantes -> <V> (escritas=<E>, ya_estaban=<Y>)'; (2) alguna fallida o no escrita, queda pendiente: '  [UNIVERSAL] <par>/<sku>: <N> variantes -> <V> PENDIENTE (escritas=<E>, ya_estaban=<Y>, fallidas=<F>)'; (3) DRY_RUN: '  [UNIVERSAL] <par>/<sku>: <N> variantes -> <V> (no se escribe, DRY_RUN=true)'. Todas las lineas [ERROR] nuevas de esta feature (R-7, R-10, R-11, R-13) llevan el mismo prefijo <par>/<sku>. Si la corrida retoma una entrada pendiente (R-11), la linea lleva el sufijo literal ' [reintento]' al final. Nunca se emite el [AVISO] de duplicados para un SKU universal, y un SKU universal sin cambios no emite [UNIVERSAL] (salvo [OK] en modo verboso, como hoy). [RESUMEN]: dos claves nuevas, siempre presentes (tambien en 0) y sin nombrar SKUs, junto a las existentes (duplicados, cache_invalidada, etc.): universales=<k> (SKUs universales que en esta corrida quedaron con sus N variantes confirmadas en nuevoValor, por primer intento o por reintento; cuenta tambien el que no necesito ninguna mutacion porque las N ya estaban en nuevoValor, aunque no emita [UNIVERSAL]; en DRY_RUN queda en 0 porque no hay confirmacion real) y universales_pendientes=<p> (SKUs universales con entrada pendiente en la libreta al terminar la corrida). Un SKU universal nunca incrementa el contador duplicados existente. Esta linea es una excepcion explicita que nombra el SKU, igual que [SET], [DRY] y el [AVISO] de duplicados (adenda del ADR 0001)."
    origen: "pedido de la persona (\"sin confundirlo con duplicado ambiguo\"); AGENTS.md invariante 5; docs/contratos/verificar-cache-sku.md R-8 (forma del [RESUMEN]); docs/adr/0001-semantica-de-escritura-de-stock.md:47-52 (adenda del [AVISO]); src/sync.js:1126,1168,1174 (formato de [AVISO]/[DRY]/[SET] en ejecutarPar); hallazgo B-4 de la revision de alcance"
  - id: R-9
    texto: "Se preservan los contratos existentes: la suite completa pasa sin debilitar, saltear ni borrar tests, incluidos los de verificar-cache-sku (test/cache-sku-*.test.js), sku-match.test.js y libreta.test.js (los de verificar-cache-sku que hoy usan como fixture un SKU curado migran de fixture segun R-15, sin cambiar sus aserciones). La coincidencia de SKU exacta (comillas, verificacion de node.sku), los deltas (nunca absoluto salvo siembra) y las cantidades enteras se siguen cumpliendo para los SKUs universales igual que para el resto."
    origen: "AGENTS.md, Gates de revision; pedido de la persona (punto final de invariantes a respetar)"
  - id: R-10
    texto: "Journal pendiente ANTES de escribir. Antes de la primera mutacion en Shopify de un SKU universal (y solo si hay al menos una variante cuyo available difiere de nuevoValor), el sync persiste en la libreta del par, en disco y no solo en memoria, una entrada pendiente para ese SKU con: el nuevoValor calculado, el valor de Contabilium con el que se calculo (contabiliumObjetivo), y por cada una de las N variantes su variantId, su inventoryItemId y el available leido en esa corrida justo antes de escribir (desde). Si esa persistencia falla, no se hace ninguna mutacion de ese SKU, el SKU queda no resuelto y el log de ese SKU es exactamente '  [ERROR] <par>/<sku>: no se pudo persistir la entrada pendiente, no se escribe'; en ese caso NUNCA se emite una linea [UNIVERSAL] para ese SKU (esa linea implica que si se intento escribir). La entrada se borra UNICAMENTE cuando las N variantes de la entrada quedan confirmadas en nuevoValor (en el primer intento o en un reintento, R-11), y en la misma persistencia de la libreta que marca el SKU resuelto y avanza baseline y destino; ninguna otra persistencia de la libreta (checkpoint, guardado final, corrida --full) la borra ni la pisa mientras no se cumpla esa condicion. UNICA EXCEPCION: la compuerta de R-16 SI puede descartar y reemplazar una entrada pendiente existente (marcada o no) por una propia, como parte de la reparacion manual. Como se persiste ANTES de la primera mutacion, el mecanismo cubre por igual una mutacion que falla con error y un proceso que muere a mitad de las N escrituras (crash, timeout, kill): en ambos casos la corrida siguiente lee la entrada desde la libreta. En DRY_RUN no se persiste ninguna entrada pendiente (la libreta no se persiste en dry-run). Una libreta v2 sin el campo nuevo sigue siendo valida (campo opcional, igual que destinos) y una entrada pendiente mal formada se descarta con [ERROR], sin invalidar el resto de la libreta. Nombre exacto del campo y forma del JSON: los decide el implementador."
    origen: "hallazgo B-1 de la revision de alcance; docs/adr/0001-semantica-de-escritura-de-stock.md:41-42 ('journal pendiente/confirmado'); AGENTS.md invariantes 1 y 7; src/sync.js:81-101 (campos opcionales de la libreta v2)"
  - id: R-11
    texto: "Corrida con entrada pendiente. Si al procesar un SKU universal la libreta del par tiene una entrada pendiente para ese SKU, el sync NO calcula delta ni toma maximo (R-4 no aplica): reintenta el MISMO nuevoValor persistido. El SKU se procesa aunque Contabilium no haya cambiado (el atajo del incremental no lo saltea) y tambien en --full. Hace la busqueda exacta de R-2 y, por cada variante de la entrada, con el available leido en esta corrida: (a) available igual a nuevoValor: satisfecha, sin mutacion, y no cuenta como divergencia; (b) available igual a desde: se escribe nuevoValor con changeFromQuantity igual a desde; (c) cualquier otro valor: la variante se movio despues del intento anterior (venta online o edicion manual) y no se puede saber si aquella escritura se aplico, asi que NO se escribe en esa variante, se emite '  [ERROR] <par>/<sku>: variante <variantId> cambio durante un pendiente universal (desde=<desde>, actual=<available>, pendiente=<V>) -> no se escribe', la entrada sigue pendiente y el SKU sigue no resuelto (invariante 4: una divergencia se reporta, no se pisa; se destraba con la compuerta absoluta manual del ADR 0001, en su forma multi-variante de R-16). Este reintento automatico solo aplica a una entrada pendiente que NO esta marcada como 'requiere compuerta' (R-17); una entrada marcada no se reintenta sola. Si la busqueda exacta ya no devuelve alguna variante de la entrada, o devuelve variantes que no estaban en ella, tampoco se escribe ninguna variante del SKU, se emite [ERROR] y la entrada sigue pendiente. Cuando todas las variantes de la entrada quedan en (a), se aplica el borrado de R-10. Ejemplo normativo (B-1): baseline 10, Contabilium 13, las 5 variantes en 5, nuevoValor 8; la mutacion de la tercera falla. Corrida siguiente, Contabilium sigue en 13, Shopify lee 8/8/5/8/8: se escribe 8 SOLO en la tercera (changeFromQuantity 5), nunca 11 en ninguna; las otras cuatro no reciben mutacion; recien ahi el SKU queda resuelto y el baseline pasa a 13 una sola vez."
    origen: "hallazgo B-1 de la revision de alcance; AGENTS.md invariantes 1, 4 y 7; docs/adr/0001-semantica-de-escritura-de-stock.md:23-24 y 41-42; src/sync.js:1087 (atajo del incremental en ejecutarPar)"
  - id: R-12
    texto: "Contabilium cambia mientras hay un pendiente: primero se termina lo pendiente y el cambio nuevo espera a la corrida siguiente. Mientras un SKU universal tenga entrada pendiente, el valor de Contabilium de la corrida actual no se usa para calcular nada de ese SKU: se prioriza terminar lo pendiente. Al borrarse la entrada (R-10), el baseline de Contabilium y el valor anotado en la libreta para el atajo del incremental quedan en el contabiliumObjetivo de la entrada, NO en el valor de Contabilium de la corrida que completo el pendiente, y escrito (R-13) queda en el nuevoValor de la entrada. Asi, un cambio de Contabilium ocurrido mientras tanto no se pierde ni se aplica dos veces: la corrida siguiente lo ve como un delta normal (contabiliumActual - contabiliumObjetivo), y como el SKU es universal se procesa igual en esa corrida (R-14)."
    origen: "decision de la persona (03/11/2026): 'Terminar lo pendiente primero, el cambio nuevo espera a la corrida siguiente' (Duda 4); AGENTS.md invariante 1; hallazgo B-1"
  - id: R-13
    texto: "Persistencia de escrito. La libreta del par guarda, por SKU universal, el ultimo nuevoValor confirmado en las N variantes (escrito). Se guarda UNICAMENTE cuando el SKU queda resuelto con las N variantes confirmadas en nuevoValor (por mutacion o porque ya lo tenian), en la misma persistencia de la libreta que marca el SKU resuelto y avanza baseline y destino; esto incluye la siembra (escrito = absoluto sembrado) y el cierre de un pendiente (cuando R-10 borra la entrada pendiente, el nuevoValor de esa entrada pasa a ser el escrito para la corrida siguiente, en la misma persistencia). Si el SKU no queda resuelto (alguna variante fallida o no escrita, o divergencia de R-11), escrito NO cambia. En DRY_RUN no se persiste (la libreta no se persiste en dry-run). Un SKU universal sin entrada pendiente y sin escrito guardado usa el camino de bootstrap de R-4 (maximo); uno sin entrada pendiente y CON escrito guardado usa el camino normal de R-4 (escrito - suma de bajas, piso 0); uno con entrada pendiente no usa ninguno de los dos (R-11). Nunca se usan ambos caminos a la vez. Una libreta v2 sin este campo sigue siendo valida (campo opcional, igual que destinos y que la entrada pendiente de R-10) y todos sus SKUs universales arrancan por bootstrap; un valor de escrito mal formado (no entero o negativo) se descarta con [ERROR] y ese SKU vuelve a bootstrap, sin invalidar el resto de la libreta. Un SKU que no esta en la lista curada nunca guarda escrito. Nombre exacto del campo y forma del JSON: los decide el implementador."
    origen: "decision de la persona (03/11/2026): 'Sumar las ventas individuales, no tomar el maximo' (Duda 5, recomendacion del planificador adoptada); AGENTS.md invariantes 1 y 7; src/sync.js:81-101 (campos opcionales de la libreta v2)"
  - id: R-14
    texto: "Bypass del atajo del incremental SOLO para los 7 SKUs de la lista curada. El atajo del incremental (src/sync.js:1087, dentro de ejecutarPar: saltea un SKU cuando a la vez !alcanzaAbsoluta, !full, el valor de Contabilium no cambio desde la ultima corrida y credito.credito === 0) NO aplica a los SKUs de la lista curada (R-1): en TODAS las corridas, incrementales o --full, se resuelven en Shopify (busqueda exacta de R-2, lectura del available real de las N variantes) aunque Contabilium no haya cambiado ese SKU, para detectar ventas online y re-emparejar las variantes con la cadencia normal del cron (ventana maxima de una corrida, ~30 minutos, en vez de quedar sin tocar por dias). Con Contabilium sin cambios el delta es 0 y, con escrito guardado, nuevoValor es la referencia de R-4 camino (c): si alguna variante difiere de ese valor se escribe en las que difieren (R-5) y escrito se actualiza (R-13); si las N variantes ya estan en ese valor no hay ninguna mutacion ni linea [UNIVERSAL] (R-8). Para cualquier SKU que NO esta en la lista curada el atajo del incremental no cambia: se sigue salteando igual que hoy. Este bypass suma como maximo 7 busquedas exactas a Shopify por corrida y ninguna lectura extra a Contabilium. El bypass CONVIVE con las condiciones existentes del atajo, no las reemplaza: es una condicion adicional (el SKU esta en la lista curada) que hace que el SKU universal entre a resolverse aunque el atajo normal lo saltearia; las condiciones !alcanzaAbsoluta, !full y credito.credito === 0 siguen igual para el resto del catalogo. R-14 aplica dentro de ejecutarPar (la corrida completa de un par, src/sync.js:1087 el atajo y src/sync.js:1173 la escritura), no en syncTodos, que main.js ya no usa (src/main.js:78-83 solo inyecta correrTodosLosPares, construirPares, evaluarCorridaMultiPar y syncUnSku); la corrida de un SKU puntual la cubre R-19."
    origen: "decision de la persona (03/11/2026): 'Si, revisar los 7 SKUs en cada corrida' (aparte de la Duda 5); hallazgo IM-3 de la revision de alcance; src/sync.js:1087 (atajo del incremental en ejecutarPar); src/main.js:78-83; AGENTS.md invariante 1 (riesgo de sobreventa si las otras variantes siguen ofreciendo stock vendido)"
  - id: R-15
    texto: "Migracion del fixture de los tests de verificar-cache-sku. La constante SKU_APPLYFIT de test/_helpers-cache-sku.js (hoy 'APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E', un SKU de la lista curada de R-1) y cada uso literal de ese SKU en test/cache-sku-duplicados.test.js, test/cache-sku-verificada.test.js, test/cache-sku-caminos-de-escritura.test.js y test/cache-sku-resumen.test.js migran a un SKU real que (a) esta documentado como duplicado en docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md y (b) NO esta en la lista curada de R-1 ni es prefijo o extension de ninguno de sus 7 SKUs. El reemplazo por defecto es IEY-COMBO-CARBON-VERDE-IP16E (grupo A4, docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md:224, el mismo que CA-4 ya usa como 'con variante establecida en cache'); el implementador puede elegir otro del grupo A2 o A4 si alguno de esos tests lo necesita, siempre cumpliendo (a) y (b). La migracion preserva exactamente la forma y las aserciones de cada test: el mismo patron (con variante establecida en cache, escritura solo en esa variante y [AVISO]; sin variante establecida, SkuAmbiguoError sin escritura), las mismas variantes inyectadas (mismos variantId, inventoryItemId, available y la misma cantidad de variantes que arma cada test, aunque el catalogo real del SKU nuevo tenga otra cantidad: la consulta es inyectada), los mismos valores esperados y los mismos textos esperados salvo el SKU. El nombre de la constante SKU_APPLYFIT se conserva. Lo unico que cambia es el string del SKU (y, en los comentarios, la descripcion del caso real que motiva el fixture): el reemplazo del string se aplica a TODAS sus apariciones, incluidas las que esten dentro de un titulo de test()/describe() (no solo en el codigo de aserciones), asi que un titulo como 'APPLYFIT, 5 variantes' pasa a nombrar el SKU nuevo manteniendo '5 variantes' (R-15 preserva la misma cantidad de variantes inyectadas que tenia el test original, aunque el SKU de reemplazo tenga otra cantidad real: la consulta esta inyectada). La comparacion byte a byte de CA-10 cubre esto solo: reemplazo literal del string del SKU en todo el archivo, comparado contra la copia congelada con ese mismo reemplazo ya aplicado. Esto NO es debilitar, saltear ni borrar un test (prohibido por AGENTS.md, Gates de revision): es migrar su fixture a un SKU que sigue existiendo y siendo un duplicado real, para que cada test siga probando exactamente lo mismo (el comportamiento de variante unica de verificar-cache-sku) sobre un SKU al que esta feature no le cambia el comportamiento (R-6). Sin esta migracion esos tests exigirian sobre un SKU curado el comportamiento viejo, opuesto a R-2/R-5."
    origen: "hallazgo BL-1 de la revision de alcance; test/_helpers-cache-sku.js:30; AGENTS.md, Gates de revision (nunca se debilita, saltea ni borra un test); docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md:218-224 (grupo A4)"
  - id: R-16
    texto: "Compuerta de escritura absoluta manual (ESCRITURA_ABSOLUTA, ADR 0001) para SKUs universales. Si la compuerta alcanza a un SKU de la lista curada, se escribe el MISMO valor absoluto (Math.round del valor de Contabilium, igual que hoy, sin credito) en las N variantes del SKU en la location del par, nunca en una sola. Sigue haciendo la busqueda exacta de R-2 y los controles de R-7 (conteo esperado) y R-18 (variantes no activadas): si alguno falla, no se escribe ninguna variante y el SKU queda como no aplicado por la compuerta (el mismo reporte [COMPUERTA][ERROR] que ya existe, src/main.js:48). Cada mutacion lleva como changeFromQuantity el available de esa variante leido en esa corrida; las variantes que ya tienen el valor absoluto no reciben mutacion. La compuerta tiene prioridad sobre el journal automatico (es la via de reparacion humana): antes de la primera mutacion descarta cualquier entrada pendiente de R-10 que exista para ese SKU (marcada o no por R-17) y la reemplaza por una entrada pendiente propia con el valor absoluto como nuevoValor, marcada 'requiere compuerta' (R-17), persistida igual que R-10 (si esa persistencia falla, no hay ninguna mutacion y se emite el [ERROR] literal de R-10). Cuando las N variantes quedan confirmadas en el valor absoluto, en la misma persistencia de la libreta: se borra la entrada pendiente, escrito (R-13) queda en el valor absoluto escrito, y el baseline y el destino avanzan igual que en una resolucion normal por R-5 (destino al inventoryItemId mas chico); ADEMAS, en esa misma resolucion, se consumen las lineas de credito anteriores con motivo 'absoluto' (src/sync.js:1213-1222) Y se escriben resembradoPor[sku]='absoluto' y resembradoEn[sku] (la referencia/fecha de corte), exactamente UNA VEZ por SKU (no una vez por variante) -- el mismo mecanismo completo que ya existe hoy para la compuerta sobre un SKU no universal (src/sync.js:1213-1222; test/cache-sku-caminos-de-escritura.test.js:212 confirma resembradoPor para ese caso). Los dos consumos (las lineas de credito YA conocidas en el momento de escribir, Y la marca resembradoEn que permite a aplicarCortes, src/sync.js:875-879, tratar como 'absoluto' cualquier linea de credito que llegue DESPUES con una referencia anterior a ese corte) son obligatorios, no opcionales: sin el consumo inmediato, una corrida automatica posterior volveria a sumar un credito ya conocido sobre el valor recien emparejado; sin resembradoEn, una linea de credito que el registro de comprobantes tarda en reflejar (llega despues, pero es anterior en el tiempo real) se acreditaria igual en una corrida futura, re-inflando stock ya vendido online (la misma familia de bug que motivo R-10, aplicada aqui al credito en vez de al delta, por las dos vias: inmediata y tardia). El SKU cuenta como aplicado por la compuerta. Si alguna mutacion falla, el SKU queda no aplicado por la compuerta, baseline, destino y escrito no avanzan, y la entrada marcada queda en la libreta: la siguiente corrida automatica no la reintenta sola (R-17) y la reparacion es volver a correr la compuerta. En DRY_RUN no se persiste nada ni hay mutaciones. Asi la compuerta sigue siendo la unica via para destrabar un pendiente que R-11(c) o R-17 dejaron esperando intervencion manual."
    origen: "hallazgo BL-2 de la revision de alcance; docs/adr/0001-semantica-de-escritura-de-stock.md (compuerta absoluta manual); src/sync.js:1151-1155 (rama alcanzaAbsoluta); src/main.js:12,48,85; AGENTS.md invariantes 4 y 7"
  - id: R-17
    texto: "Pendiente con credito acreditable o siembra: no se reintenta solo. Simplificacion deliberada: esta feature no construye un journal del consumo de credito ni del estado de una siembra. Si el nuevoValor de un SKU universal se calculo con credito acreditable distinto de cero (R-3) o por el camino de siembra (R-4 camino (a), baseline null), la entrada pendiente de R-10 se persiste igual antes de la primera mutacion, pero marcada como 'requiere compuerta' (nombre exacto del campo: lo decide el implementador), sin guardar el consumo de credito ni el estado de la siembra. Si las N variantes quedan confirmadas en ese mismo intento, la entrada se borra y el SKU se resuelve normalmente (R-5, R-10, R-13), con el consumo de credito que ya hace hoy una resolucion normal. Si no (fallo parcial de R-5 o proceso que muere a mitad), el SKU queda no resuelto y en esa corrida, ademas de los [ERROR] por variante de R-5 y la linea [UNIVERSAL] PENDIENTE de R-8, se emite exactamente '  [ERROR] <par>/<sku>: pendiente universal requiere compuerta manual -> no se escribe'. Esta MISMA linea literal (sin mencionar la causa) es la que corresponde tambien cuando la entrada quedo marcada 'requiere compuerta' porque la propia compuerta de R-16 fallo a mitad (no porque hubiera credito o siembra): la marca es una sola cosa ('requiere compuerta'), sin distinguir en el log si la origino el credito, la siembra o un intento de compuerta fallido; quien necesite el motivo lo busca en la entrada persistida, no en el log. En cada corrida siguiente, mientras la entrada marcada exista, el camino automatico de R-11 NO aplica: no se calcula delta, no se toma maximo, no se usa escrito, no se usa el valor de Contabilium de la corrida (R-12), no hay ninguna mutacion de ese SKU, se vuelve a emitir esa misma linea [ERROR], el SKU sigue no resuelto (mismo contador de errores de R-5) y cuenta en universales_pendientes (R-8). La unica salida de una entrada marcada es la compuerta absoluta manual de R-16. Costo aceptado: la combinacion rara de fallo parcial mas credito o siembra no se automatiza y se resuelve a mano, igual que ya se resuelve un pendiente trabado por R-11(c); a cambio no hay ninguna via de aplicar el credito o la siembra dos veces (analogo al bug original B-1)."
    origen: "hallazgo BL-3 de la revision de alcance; hallazgo B-1 (delta aplicado dos veces tras fallo parcial); src/sync.js:1082-1085 (credito acreditable); AGENTS.md invariantes 1, 4, 5 y 7"
  - id: R-18
    texto: "Variante universal no activada en la location del par: DOS casos distintos, no uno. (a) TODAS las N variantes exactas de un SKU de la lista curada tienen available null en esa location (el articulo no esta activado ahi todavia, el caso real de Galerias Pacifico antes de habilitar productos): el SKU se trata igual que hoy se trata un SKU no universal con available null, no_activado (src/sync.js:1146-1148): NO es error, no se emite ningun [ERROR] nuevo de esta feature, no se calcula nuevoValor, no se persiste entrada pendiente, no hay ninguna mutacion, el SKU no avanza baseline/destino/escrito pero TAMPOCO suma al contador de errores de R-5: simplemente no_activado no cuenta como error, exactamente igual que hoy para un SKU no universal (src/sync.js:1146-1148). ACLARACION IMPORTANTE sobre la 'tolerancia ya existente': esa tolerancia (compuertaNoAplicadaEn, src/resultado.js:104-118, 'tolerado si el SKU se aplico en otro par') vive UNICAMENTE dentro del reporte de la compuerta de escritura absoluta (ESCRITURA_ABSOLUTA); no es un mecanismo general que aplique a cualquier corrida. Fuera de la compuerta, no_activado simplemente no es error y el par sigue la regla general de evaluarCorrida (si ese es el UNICO SKU de la corrida de ese par y termina en no_activado, evaluarCorrida igual puede dar ok:false por 'corrida vacia, ningun SKU sincronizado ni verificado' -- la misma regla que ya aplica hoy a un SKU no universal en la misma situacion, sin que R-18 la cambie). Bajo la compuerta si aplica la tolerancia de compuertaNoAplicadaEn tal cual existe hoy, sin cambios por R-18. (b) ALGUNAS (no todas) de las N variantes tienen available null mientras otras SI estan activadas: esto es un estado de catalogo inconsistente (el mismo articulo activado para unos modelos y no para otros dentro del mismo par) y SI es error: no se calcula nuevoValor por ningun camino de R-4 (ni (a) ni (b) ni (c) de R-4, no confundir con los casos (a)/(b) de este requisito), no se persiste entrada pendiente, no hay ninguna mutacion en ninguna de las N variantes (tampoco en las activadas), se emite '  [ERROR] <par>/<sku>: variante <variantId> no esta activada en la location del par, no se resuelve' (una linea por variante NO activada, no por las activadas) y el SKU se trata como no resuelto: no avanzan baseline, destino ni escrito, y suma al mismo contador de errores de R-5. En ambos casos (a) y (b), null nunca participa de la resta del camino (c) ni del maximo del camino (b) de R-4. Si el SKU tenia una entrada pendiente (R-10/R-11) y cae en el caso (a) o en el caso (b) en una corrida posterior, la entrada sigue pendiente sin cambios en los dos casos (R-11 sigue procesandola con sus propios valores de desde/pendiente, independientemente de R-18; en particular, si todas las variantes vuelven a aparecer null mientras hay un pendiente, el pendiente no se toca ni se descarta: simplemente espera a que se reactiven). El caso (b) aplica igual a la compuerta de R-16 (SKU no aplicado por la compuerta, con el [ERROR] de la variante no activada). El caso (a) tambien es benigno para la compuerta en cuanto a ESTE requisito (nada que calcular ni escribir, sin [ERROR] nuevo de R-18) -- pero esto NO cambia el mecanismo de reporte que la compuerta YA TIENE hoy para saber si un SKU quedo 'aplicado' o 'no aplicado' en cada par (src/resultado.js:109,115, con su tolerancia existente de 'aplicado en otro par'): si la corrida de la compuerta toca un solo par y el SKU cae en el caso (a) en ese par (nada para escribir ahi), ese SKU sigue contando segun esa logica YA EXISTENTE sin cambios (tolerado si se aplico en otro par de la misma corrida, no tolerado si no se aplico en ninguno); R-18 no introduce ni cambia ese mecanismo de tolerancia entre pares, solo evita que el caso (a) genere ruido nuevo (un [ERROR] o un contador de error) que no existia antes para un SKU no universal en la misma situacion."
    origen: "hallazgo IM-2 de la revision de alcance; hallazgo IM-A de la tercera revision de alcance (distinguir 'ninguna activada', benigno, de 'algunas si algunas no', error); src/sync.js:1146-1148 (available null -> no_activado); docs/contratos/clasificador-causa-comprobante.md y src/resultado.js:113 (tolerancia existente de no_activado entre pares); AGENTS.md invariantes 5 y 7"
  - id: R-19
    texto: "Mismo comportamiento sin importar el punto de entrada, con DOS excepciones explicitas (R-14 y R-16, ver mas abajo). Los requisitos R-2 a R-13, R-15, R-17 y R-18 aplican igual en la corrida completa de un par (ejecutarPar) y en la corrida de un SKU puntual (syncUnSku/procesarSku, flag --sku). Ambos puntos de entrada verifican primero si el SKU pedido esta en la lista curada de R-1 (coincidencia exacta del string) y, si lo esta, siguen el camino universal: busqueda de las N variantes (R-2, R-7, R-18), los tres caminos de R-4, journal pendiente (R-10, R-11, R-12, R-17), escrito (R-13) y las lineas de log de R-8 (con el mismo prefijo <par>/<sku>, aunque las lineas de --sku de hoy no lo usen para otros mensajes); nunca el camino de variante unica de verificar-cache-sku. Un SKU que no esta en la lista curada sigue por --sku exactamente igual que hoy (R-6). EXCEPCION: R-14 (bypass del atajo) solo aplica en ejecutarPar, el punto de entrada que tiene atajo del incremental; --sku no tiene ese atajo hoy, asi que no hay nada que bypasear ahi. EXCEPCION: R-16 (compuerta absoluta multi-variante) queda FUERA de este requisito. Hoy la compuerta ESCRITURA_ABSOLUTA no esta conectada al punto de entrada --sku (src/main.js:12-13,117): esta feature no le agrega esa conexion, porque no es parte del pedido original y seria un alcance nuevo. Para SKUs universales, la compuerta solo es alcanzable por el mismo mecanismo con el que ya se invoca hoy (no por --sku); si el dia de manana se conecta la compuerta a --sku, R-16 aplicaria igual ahi, pero eso queda fuera de este contrato. Codigo de salida, mecanismo exacto: hoy el modo sku de main.js (src/main.js:115-123) hace 'await d.syncUnSku(...); return 0' y solo devuelve 1 si syncUnSku lanza una excepcion (catch). Para que --sku sobre un SKU de la lista curada refleje el fallo (invariante 5 de AGENTS.md) sin tocar el comportamiento de main.js para el resto de los SKUs (fuera de alcance, gap preexistente en src/main.js:118), syncUnSku/procesarSku tienen que LANZAR una excepcion cuando el SKU pedido esta en la lista curada de R-1 y no queda resuelto en esa corrida (fallo de escritura de R-5, entrada pendiente trabada de R-11/R-17, o variante no activada caso (b) de R-18); esa excepcion propaga al catch existente de main.js, que ya devuelve 1 e imprime [FATAL]. Cuando el SKU curado SI se resuelve (incluido el caso (a) benigno de R-18, no_activado en todas), syncUnSku no lanza y el proceso sigue devolviendo 0 como hoy. No hace falta ningun flag CLI nuevo: el modo de escritura real para probar esto es la variable de entorno DRY_RUN=false (src/sync.js:38), nunca un flag como --no-dry-run (no existe, src/argv.js:25-31 no lo acepta); el comando real es 'DRY_RUN=false node src/index.js --sku <sku>'. --sku y --full son excluyentes (--sku gana, src/argv.js:84-88): este requisito no aplica junto con --full."
    origen: "hallazgo IM-4 de la revision de alcance; duda del autor de la evidencia de aceptacion sobre la compuerta y --sku (aceptacion/sku-universal-multivarianta/escenarios-ca14-sku-puntual.md); src/main.js:12-13,78-83,117-118 (syncUnSku inyectado, compuerta no conectada a --sku, codigo de salida); src/sync.js (syncUnSku/procesarSku, ejecutarPar); AGENTS.md invariante 5"
criterios:
  - id: CA-1
    requisitos: [R-1]
    tipo: mecanico
    superficie: datos
    texto: "Test unitario que verifica el contenido EXACTO de la lista curada: los 7 SKUs del pedido, ni uno mas ni uno menos, cada uno con su cantidad de variantes esperada (3, 2, 2, 5, 2, 2, 2 en el orden de R-1; 18 en total), comparados contra el literal esperado de pares {sku, variantes}."
    comando: "node --test test/skus-universales-lista.test.js"
  - id: CA-2
    requisitos: [R-2, R-3, R-4, R-5, R-7, R-9, R-13]
    tipo: mecanico
    superficie: datos
    texto: "Test de regresion con el caso real APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E (5 variantes, consulta/cache inyectadas, sin red): con available igual en las 5 variantes y un delta no nulo contra el baseline, ejecutarPar/resolverSku calcula el nuevoValor UNA sola vez y lo escribe en las 5 inventoryItemId; el SKU queda resuelto, el baseline avanza una sola vez (no 5) y no incrementa el contador duplicados. Con siembra (baseline null) escribe el absoluto de Contabilium en las 5. Con una de las 5 escrituras fallando, el SKU no queda resuelto, el baseline y el destino no avanzan, se emite un [ERROR] por la variante fallida, la corrida cuenta como error y la libreta queda con la entrada pendiente del SKU (el detalle del reintento lo prueba CA-7). Cada mutacion lleva como changeFromQuantity el available leido de esa variante. Bootstrap (sin escrito guardado): con available DIVERGENTES entre las 5 (p. ej. 7 en una variante y 0 en las otras 4, el caso real del informe), toma el maximo (7) como shopifyActual de referencia, calcula nuevoValor una sola vez a partir de ese maximo y lo escribe en las 5, emparejandolas en la misma pasada. Ventas individuales (con escrito guardado): escrito 5, baseline 10, las 5 variantes en 5; una venta online deja la variante IP14 en 4 (Shopify lee 4/5/5/5/5) y Contabilium pasa de 10 a 9 (venta de mostrador): shopifyActual de referencia = 5 - 1 = 4, nuevoValor 3, se escribe 3 en las 5 variantes (changeFromQuantity 4 en la IP14 y 5 en las otras cuatro), ninguna mutacion lleva 4, el baseline queda en 9 y escrito queda en 3. Mismo escenario con dos ventas online en variantes distintas (Shopify lee 4/4/5/5/5) y Contabilium 10 -> 9: referencia max(0, 5 - 2) = 3, nuevoValor 2 en las 5. Conteo esperado (R-7): si la busqueda exacta de este SKU (5 variantes esperadas segun R-1) devuelve 4 variantes exactas, o 6, sin llegar al tope, no hay ninguna mutacion, se emite [ERROR] con prefijo <par>/<sku>, el SKU no queda resuelto y el baseline no avanza. Cache (R-2, IM-1): el mismo SKU con las 5 variantes exactas, en tres sub-casos (sin entrada en cache, con entrada vencida, con entrada presente apuntando a una sola variante), resolverSku nunca lanza SkuAmbiguoError y devuelve las 5 variantes como candidatas; la escritura alcanza a las 5 en los tres sub-casos."
    comando: "node --test test/sku-universal-5-variantes.test.js"
  - id: CA-3
    requisitos: [R-2, R-3, R-4, R-5, R-13]
    tipo: mecanico
    superficie: datos
    texto: "Test con un caso de 2 variantes (APPLYFIT-CLEAR-S24-S25 o APPLYFIT-CLEAR-S24PLUS-S25PLUS): con available igual en ambas, escribe el mismo nuevoValor entero en las 2; bootstrap (sin escrito guardado) con available distinto entre ambas (p. ej. 5 y 0), toma el maximo (5) como shopifyActual de referencia, calcula el nuevoValor una sola vez a partir de ese maximo y lo escribe en las 2 variantes emparejandolas, y el baseline avanza una sola vez. Ventas individuales (con escrito guardado): escrito 6, baseline 10, Shopify lee 5/6 (una venta online en la primera variante) y Contabilium pasa de 10 a 9: referencia 6 - 1 = 5, nuevoValor 4 en las 2 (nunca 5), escrito queda en 4. Piso 0 sobre el total (doble piso de R-4): escrito 1, Shopify lee 0/0 (una venta online en cada variante) y Contabilium sin cambios: suma de bajas = max(0,1-0) + max(0,1-0) = 2, referencia max(0, 1 - 2) = 0 (nunca -1), nuevoValor 0, ninguna mutacion (ambas ya estan en 0), nunca se escribe un valor negativo. Suba ignorada (Duda 7): escrito 5, baseline 10, Shopify lee 8/5 (alguien repuso a mano la primera variante) y Contabilium sin cambios (atajo con bypass de R-14, SKU se resuelve igual): referencia = max(0, 5 - (max(0,5-8) + max(0,5-5))) = max(0, 5 - 0) = 5, nuevoValor 5; se escribe 5 SOLO en la primera variante (changeFromQuantity 8), la segunda ya esta en 5 y no recibe mutacion; nunca se escribe 8 en ninguna ni se usa 8 como shopifyActual."
    comando: "node --test test/sku-universal-2-variantes.test.js"
  - id: CA-4
    requisitos: [R-6, R-9]
    tipo: mecanico
    superficie: datos
    texto: "Test de no-regresion: un SKU duplicado que NO esta en la lista curada (caso real del grupo A4, por ejemplo IEY-COMBO-CARBON-VERDE-IP16E con 2 variantes, o un SKU del grupo A2 mal cargado) mantiene el comportamiento viejo byte a byte: con variante establecida en cache escribe solo ahi y emite el [AVISO] de duplicados existente (no el log nuevo de universales); sin variante establecida y 2+ exactas, SkuAmbiguoError sin escritura. El contador universales del [RESUMEN] queda en 0 para este SKU."
    comando: "node --test test/sku-no-universal-sin-regresion.test.js"
  - id: CA-5
    requisitos: [R-8]
    tipo: mecanico
    superficie: cli
    texto: "Test del log y del [RESUMEN]: una corrida con un SKU universal resuelto en N variantes y, por separado, un SKU con duplicados ambiguos (R-6) en la misma corrida: el [RESUMEN] muestra universales=1, universales_pendientes=0 y duplicados=1 (no mezclados), las tres claves siempre presentes (tambien en 0 en una corrida sin ninguno de los casos), sin nombrar SKUs, junto a las claves previas del [RESUMEN]. La salida capturada contiene, caracter a caracter, las lineas literales de R-8, con el prefijo <par>/<sku>: '  [UNIVERSAL] <par>/<sku>: <N> variantes -> <V> (escritas=<E>, ya_estaban=<Y>)' para el universal confirmado, la variante PENDIENTE con fallidas=<F> cuando una mutacion falla (y entonces universales_pendientes=1), la variante DRY_RUN con DRY_RUN=true, y el sufijo ' [reintento]' al retomar un pendiente; y nunca contiene el texto del [AVISO] de duplicados para el SKU universal. Conteo de universales: un SKU universal con las N variantes ya en nuevoValor (sin mutacion ni linea [UNIVERSAL]) cuenta en universales, y en DRY_RUN universales queda en 0."
    comando: "node --test test/resumen-universales.test.js"
  - id: CA-6
    requisitos: [R-9, R-15]
    tipo: mecanico
    superficie: infra
    texto: "La suite completa del repo pasa sin debilitar, saltear ni borrar tests, incluidos los 4 test/cache-sku-*.test.js con el fixture migrado por R-15 (la preservacion de sus aserciones la prueba CA-10)."
    comando: "npm test"
  - id: CA-7
    requisitos: [R-4, R-5, R-10, R-11]
    tipo: mecanico
    superficie: datos
    texto: "Test de regresion del hallazgo B-1 con el caso real APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E (5 variantes, consulta, mutacion y libreta inyectadas, sin red), con un registro ordenado de eventos (persistencias de libreta y mutaciones). (1) Orden: baseline 10, Contabilium 13, las 5 variantes en 5; la entrada pendiente (nuevoValor 8, contabiliumObjetivo 13, desde=5 por variante) aparece persistida en la libreta ANTES de la primera mutacion. (2) Fallo parcial: la mutacion de la tercera falla; la libreta conserva la entrada pendiente, el SKU no queda resuelto y el baseline sigue en 10. (3) Reintento: corrida siguiente con Contabilium en 13 y Shopify en 8/8/5/8/8: hay exactamente UNA mutacion, sobre la tercera variante, con valor 8 y changeFromQuantity 5; ninguna mutacion lleva 11; al terminar, la entrada pendiente se borra, el SKU queda resuelto y el baseline queda en 13. (4) Crash: el proceso lanza una excepcion no controlada tras la segunda de 5 mutaciones exitosas; la libreta en disco conserva la entrada pendiente y la corrida siguiente con 8/8/5/5/5 escribe 8 solo en las variantes 3, 4 y 5 (changeFromQuantity 5). (5) Variante movida: en el reintento, Shopify lee 8/8/4/8/8 (venta online sobre la tercera, desde=5): no hay ninguna mutacion, se emite el [ERROR] literal de R-11 (con prefijo <par>/<sku>) con desde=5, actual=4, pendiente=8, la entrada sigue pendiente y el SKU sigue no resuelto. (6) Atajo del incremental: con la entrada pendiente y Contabilium sin cambios, el SKU se procesa igual (no lo saltea el atajo). (7) Persistencia fallida: si la escritura de la libreta con la entrada pendiente falla, no hay ninguna mutacion de ese SKU, la salida contiene el [ERROR] literal de R-10 ('  [ERROR] <par>/<sku>: no se pudo persistir la entrada pendiente, no se escribe') y no contiene ninguna linea [UNIVERSAL] para ese SKU. (8) DRY_RUN: no se persiste entrada pendiente ni hay mutaciones."
    comando: "node --test test/sku-universal-pendiente.test.js"
  - id: CA-8
    requisitos: [R-12]
    tipo: mecanico
    superficie: datos
    texto: "Test de Contabilium cambiando durante un pendiente (APPLYFIT-CLEAR-S24-S25, 2 variantes, todo inyectado): baseline 10, Contabilium 13, ambas variantes en 5, nuevoValor 8, falla la segunda mutacion. Corrida siguiente con Contabilium en 15 y Shopify en 8/5: se escribe 8 (no 10 ni 13) en la segunda variante con changeFromQuantity 5, el pendiente se borra y el baseline y el valor del atajo quedan en 13 (no 15). Corrida siguiente con Contabilium en 15 y Shopify en 8/8: delta +2, se escribe 10 en ambas variantes y el baseline queda en 15."
    comando: "node --test test/sku-universal-pendiente-contabilium.test.js"
  - id: CA-9
    requisitos: [R-4, R-13, R-14]
    tipo: mecanico
    superficie: datos
    texto: "Test de escrito y del bypass del atajo (APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E, 5 variantes, y un SKU de control fuera de la lista curada; consulta, mutacion y libreta inyectadas, sin red; corridas incrementales encadenadas sobre la misma libreta). (1) Bootstrap -> escrito: libreta v2 sin escrito, baseline 10, Contabilium 10, Shopify 7/0/0/0/0: toma el maximo, escribe 7 en las 5 y la libreta persistida guarda escrito 7 en la misma persistencia que marca el SKU resuelto. (2) Bypass del atajo, venta online sin cambio en Contabilium: corrida siguiente con Contabilium en 10 (sin cambios) y Shopify 7/6/7/7/7: el SKU universal SE resuelve (hay busqueda exacta en Shopify para el aunque el atajo saltearia un SKU comun), referencia 7 - 1 = 6, se escribe 6 solo en las 4 variantes en 7 (changeFromQuantity 7), la variante en 6 no recibe mutacion, el baseline sigue en 10 y escrito queda en 6. (3) Sin cambios: corrida siguiente con Contabilium en 10 y Shopify 6/6/6/6/6: busqueda exacta si, ninguna mutacion, ninguna linea [UNIVERSAL], escrito sigue en 6. (4) Ventas individuales tras el bypass: corrida siguiente con Shopify 6/6/5/6/6 y Contabilium 10 -> 9: referencia 6 - 1 = 5, nuevoValor 4 en las 5 variantes, baseline 9, escrito 4 (nunca se toma el maximo 6). (5) Control fuera de la lista: un SKU no curado con Contabilium sin cambios sigue salteado por el atajo (ninguna busqueda en Shopify para el) en todas esas corridas. (6) Cierre de pendiente -> escrito: una entrada pendiente con nuevoValor 8 que se confirma en las N variantes deja escrito 8 y borra la entrada en la misma persistencia. (7) Fallo parcial no toca escrito: con escrito 6 y una mutacion fallida, escrito sigue en 6. (8) escrito mal formado (p. ej. -3 o 2.5) se descarta con [ERROR] y el SKU usa el maximo (bootstrap), sin invalidar el resto de la libreta. (9) DRY_RUN: no se persiste escrito."
    comando: "node --test test/sku-universal-ventas-individuales.test.js"
  - id: CA-10
    requisitos: [R-15]
    tipo: mecanico
    superficie: datos
    texto: "Test mecanico de la migracion del fixture, SIN depender de git en tiempo de ejecucion (un clon superficial de CI puede no tener el commit 3abeda7 disponible). El autor de la evidencia de aceptacion guarda, dentro de aceptacion/sku-universal-multivarianta/fixtures-originales/, una copia literal de la version de cada uno de los 5 archivos (test/_helpers-cache-sku.js, test/cache-sku-duplicados.test.js, test/cache-sku-verificada.test.js, test/cache-sku-caminos-de-escritura.test.js y test/cache-sku-resumen.test.js) tal como estaban en el commit 3abeda7 (obtenida una sola vez, en el momento de escribir la evidencia, no en cada corrida del test). El test lee esas copias guardadas (no usa git en absoluto), reemplaza toda aparicion del string APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E por el SKU de reemplazo (el valor actual de SKU_APPLYFIT exportado por test/_helpers-cache-sku.js) y exige que el resultado sea byte a byte igual al archivo actual del repo, ignorando unicamente las lineas que son comentario (empiezan con // tras la sangria). Ademas verifica que el SKU de reemplazo (a) no esta en la lista curada exportada por src/shopify.js, (b) no es prefijo ni extension de ninguno de sus 7 SKUs, (c) aparece en docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md, y (d) que ninguno de los 4 archivos de test contiene ya el string APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E fuera de comentarios. La cantidad de llamadas a assert, de bloques test() y de describe() de cada archivo es la misma que en la copia guardada."
    comando: "node --test test/migracion-fixture-cache-sku.test.js"
  - id: CA-11
    requisitos: [R-16, R-18, R-3, R-13, R-17]
    tipo: mecanico
    superficie: datos
    texto: "Test de la compuerta absoluta multi-variante (APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E, 5 variantes; consulta, mutacion, libreta y lineas de credito inyectadas, sin red). (1) Compuerta sin pendiente y SIN credito: Contabilium 12, baseline 10, Shopify 7/0/0/0/0, escrito 7: se escribe 12 en las 5 variantes (changeFromQuantity el available leido de cada una), ninguna variante queda en otro valor, el baseline queda en 12, escrito queda en 12, destinos[sku] queda en el inventoryItemId mas chico y el SKU cuenta como aplicado por la compuerta. (1b) Compuerta sin pendiente y CON 2 lineas de credito activas (K1, K2): se escribe el mismo absoluto 12 en las 5 (el credito no se suma: R-16 dice 'sin credito'), pero K1 y K2 quedan marcadas consumidas con motivo 'absoluto' en esa misma resolucion (nunca marcadas dos veces, nunca sin marcar). (2) Compuerta con pendiente de R-11(c) trabado (entrada con nuevoValor 8, desde 5, Shopify 8/8/4/8/8): se escribe el absoluto en las 5, la entrada pendiente vieja ya no esta en la libreta persistida y escrito queda en el absoluto. (3) Compuerta con fallo parcial: falla la mutacion de la cuarta variante; el SKU queda como no aplicado por la compuerta (aparece en el [COMPUERTA][ERROR]), baseline, destino, escrito y las lineas de credito (si las hay) no cambian/no se marcan consumidas, la libreta conserva una entrada pendiente marcada 'requiere compuerta' con el absoluto como nuevoValor, y una corrida automatica siguiente no hace ninguna mutacion de ese SKU (emite la linea [ERROR] literal de R-17, identica a la de un pendiente con credito, ver Nota mas abajo). (4) Conteo distinto del esperado (4 variantes exactas): ninguna mutacion y el SKU queda no aplicado. (5) Una variante activada y otra con available null (caso (b) de R-18, catalogo inconsistente): ninguna mutacion, se emite el [ERROR] literal de R-18 (una linea, solo por la variante null) y el SKU queda no aplicado por la compuerta. (5b) Las 5 variantes con available null (caso (a) de R-18, SKU no activado en este par): no es error, no hay [ERROR] de R-18, no hay mutaciones, la compuerta no tiene nada que aplicar y lo reporta como tal (no como fallo). (6) DRY_RUN: ninguna mutacion ni persistencia, tampoco se marca ningun credito consumido. Nota sobre (3): la linea de R-17 no distingue en el texto si la causa fue credito, siembra o una compuerta fallida a mitad (es la misma marca 'requiere compuerta'); este escenario y el de CA-12 usan la MISMA linea literal."
    comando: "node --test test/sku-universal-compuerta-absoluta.test.js"
  - id: CA-12
    requisitos: [R-17]
    tipo: mecanico
    superficie: datos
    texto: "Test del pendiente con credito o siembra (APPLYFIT-CLEAR-S24-S25, 2 variantes; consulta, mutacion, libreta y lineas de credito inyectadas, sin red). (1) Credito con fallo parcial: escrito 5, baseline 10, Contabilium 10, credito acreditable +2, Shopify 5/5; la mutacion de la segunda falla. La libreta persistida conserva la entrada pendiente marcada 'requiere compuerta', la salida contiene literal '  [ERROR] <par>/<sku>: pendiente universal requiere compuerta manual -> no se escribe' con el nombre del par y el SKU, el SKU no queda resuelto. Corrida siguiente con Shopify 7/5 y el mismo credito: ninguna mutacion de ese SKU (ni 7 ni 9 en ninguna variante), se repite la misma linea [ERROR], universales_pendientes=1, baseline y escrito sin cambios. (2) Siembra con fallo parcial: baseline null, Contabilium 6, Shopify 0/0, falla la segunda mutacion: misma marca, misma linea [ERROR], y la corrida siguiente no hace ninguna mutacion de ese SKU. (3) Credito sin fallo: con credito +2 y ambas mutaciones exitosas, el SKU se resuelve normalmente, no queda entrada pendiente y no se emite la linea [ERROR] de R-17. (4) Sin credito ni siembra, el pendiente sigue siendo reintentable por R-11 (control: una mutacion fallida sin credito se reintenta sola en la corrida siguiente). (5) La compuerta de R-16 cierra una entrada marcada que vino de credito: la escribe en ambas variantes, marca el credito consumido con motivo 'absoluto' (nunca lo deja sin marcar: ver CA-11 caso 3) y borra la entrada."
    comando: "node --test test/sku-universal-pendiente-credito-siembra.test.js"
  - id: CA-13
    requisitos: [R-18]
    tipo: mecanico
    superficie: datos
    texto: "Test de variante universal no activada (APPLYFIT-CLEAR-IP16PM-17PM, 2 variantes, todo inyectado, par de Galerias Pacifico o cualquier par inyectado), con los DOS casos de R-18 bien separados. CASO (b), catalogo inconsistente -- la primera variante activada (available 5) y la segunda con available null. En los tres caminos de R-4 (baseline null; sin escrito; con escrito 5 y Shopify 5/null): ninguna mutacion en ninguna de las 2 variantes, no se persiste entrada pendiente, la salida contiene literal '  [ERROR] <par>/<sku>: variante <variantId> no esta activada en la location del par, no se resuelve' SOLO con el variantId de la segunda (nunca una linea por la primera, que si esta activada), el SKU no queda resuelto, baseline, destino y escrito no cambian, la corrida SI suma al contador de errores y ningun nuevoValor calculado es NaN ni negativo (el test lo verifica sobre las mutaciones y el plan DRY_RUN: vacios). Con una entrada pendiente previa para el SKU y una variante que aparece con available null (caso (b) en una corrida posterior), la entrada sigue igual en la libreta, sin que R-18 la toque. CASO (a), SKU no activado en este par -- las DOS variantes con available null: no hay ningun [ERROR] de R-18, no es error, no suma al contador de errores, no hay mutaciones, el SKU se trata como no_activado (benigno) igual que hoy un SKU no universal, y si ese mismo SKU se aplico en el otro par (DOT o Galerias, el que no sea este) en la misma corrida, el reporte global lo tolera (src/resultado.js:113), sin alertar por este par."
    comando: "node --test test/sku-universal-no-activada.test.js"
  - id: CA-14
    requisitos: [R-1, R-2, R-11, R-17, R-18, R-19]
    tipo: mecanico
    superficie: cli
    texto: "Test de la corrida de un SKU puntual (syncUnSku/procesarSku, invocado como 'DRY_RUN=false node src/index.js --sku <sku>'; dependencias inyectadas, sin red, sin el flag --no-dry-run que no existe en src/argv.js) con APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E: sin entrada en cache, no lanza SkuAmbiguoError, escribe el mismo nuevoValor en las 5 variantes, emite la linea [UNIVERSAL] de R-8 y no el [AVISO] de duplicados, y main() devuelve 0 (src/main.js:118, resolucion exitosa). Con una mutacion fallida deja la entrada pendiente en la libreta, main() devuelve 1 (la excepcion de R-19 llega al catch de src/main.js:121 con [FATAL]), y una segunda corrida --sku la reintenta con el mismo nuevoValor (R-11) y, si esa segunda corrida SI resuelve el SKU, vuelve a devolver 0. Con una entrada marcada 'requiere compuerta' (R-17) una corrida --sku tambien devuelve 1 (no la resuelve, no tiene acceso a la compuerta: R-19, excepcion de R-16 fuera de alcance). Con una variante no activada caso (b) de R-18, devuelve 1; con las N variantes no activadas caso (a) de R-18 (benigno), devuelve 0. Con escrito guardado usa el camino (c) de R-4. Control: --sku con IEY-COMBO-CARBON-VERDE-IP16E (fuera de la lista) mantiene el comportamiento de variante unica, [AVISO] y el codigo de salida de siempre (0 aunque falle, fuera de alcance), y --sku con un SKU que es prefijo o extension de uno curado nunca sigue el camino universal."
    comando: "node --test test/sku-universal-sku-puntual.test.js"
congelado: {sha256: "fd967fe42559203c028e4ecfa8274613eb7b5af488a508b29ee936a8266b2130", por: "autor-aceptacion", fecha: "2026-11-03T14:27:56+00:00"}
```

## Archivos probables

- `src/shopify.js`: lista curada (nueva constante exportada, p. ej. `SKUS_UNIVERSALES`), y la
  rama de `resolverSku`/la búsqueda exacta que, para un SKU de la lista, devuelve todas las
  coincidencias exactas en vez de aplicar la lógica de "variante establecida".
- `src/sync.js`: `procesarSku`/`ejecutarPar`/`syncUnSku` (donde hoy se llama a `resolverSku` y se
  decide escribir en una sola variante), `calcularEscritura`/`armarPlanDeEscritura` (cómo se
  calcula el único valor a escribir), la libreta/caché (baseline y destino por SKU, no por
  variante) y el `[RESUMEN]` con las claves `universales` y `universales_pendientes`.
- `src/sync.js`, libreta del par: **campo opcional nuevo** con las entradas pendientes por SKU
  universal (R-10: `nuevoValor`, `contabiliumObjetivo` y, por variante, `variantId`,
  `inventoryItemId` y `desde`). Lo tocan `parsearContabilidad`/`cargarLibretaCompleta`
  (src/sync.js:91-112, leerlo como opcional igual que `destinos`), la persistencia por SKU
  antes de la primera mutación (la libreta hoy se persiste por checkpoint y al final, no antes
  de cada escritura), el guardado final/checkpoint (no pisar ni borrar pendientes) y el atajo del
  incremental (`src/sync.js:1087`, dentro de `ejecutarPar`, no saltear un SKU con pendiente). La
  entrada lleva además la marca "requiere compuerta" de R-17. No hace falta subir
  `SNAPSHOT_VERSION`.
- `src/sync.js`, libreta del par: **otro campo opcional nuevo**, `escrito` por SKU universal
  (R-13: último `nuevoValor` confirmado en las N variantes). Se lee como opcional en
  `parsearContabilidad`/`cargarLibretaCompleta`, se escribe en la misma persistencia que marca el
  SKU resuelto (incluido el borrado del pendiente de R-10) y lo usa el cálculo de la referencia
  de R-4 (camino normal `max(0, escrito − Σ max(0, escrito − available_i))`, doble piso 0;
  máximo solo sin `escrito`).
- `src/sync.js:1087`, atajo del incremental dentro de `ejecutarPar` (condiciones actuales
  `!alcanzaAbsoluta && !full && snapshotPrevio[sku] === cantidad && credito.credito === 0`):
  **bypass puntual para los 7 SKUs de la lista curada** (R-14), que convive con esas condiciones
  sin reemplazarlas. El atajo sigue igual para el resto del catálogo. No se toca `syncTodos`
  (`src/main.js:78-83` ya no lo usa).
- `src/sync.js:1146-1148` (`available === null` → `no_activado`): para universales, una sola
  variante no activada frena el SKU entero (R-18).
- `src/sync.js:1151-1155` (rama `alcanzaAbsoluta`) y `src/main.js:12,48,85` (compuerta
  `ESCRITURA_ABSOLUTA` y su `[COMPUERTA][ERROR]`): compuerta multi-variante (R-16).
- `src/sync.js:1173`, escritura (`setearStock`) dentro de `ejecutarPar`: pasa a N escrituras
  para universales (R-5).
- `src/sync.js`, `syncUnSku`/`procesarSku` (flag `--sku`): mismo camino universal (R-19).
- Fixture migrado (R-15, CA-10): `test/_helpers-cache-sku.js` (`SKU_APPLYFIT`, línea 30),
  `test/cache-sku-duplicados.test.js`, `test/cache-sku-verificada.test.js`,
  `test/cache-sku-caminos-de-escritura.test.js` y `test/cache-sku-resumen.test.js`: solo cambia
  el string del SKU (y comentarios), nunca las aserciones.
- `aceptacion/sku-universal-multivarianta/fixtures-originales/`: copia literal, congelada una
  sola vez por el autor de la evidencia, de los 5 archivos de arriba tal como estaban en el
  commit `3abeda7`. La usa CA-10 para no depender de `git show` en tiempo de test.
- Tests nuevos: `test/skus-universales-lista.test.js`, `test/sku-universal-5-variantes.test.js`,
  `test/sku-universal-2-variantes.test.js`, `test/sku-no-universal-sin-regresion.test.js`,
  `test/resumen-universales.test.js`, `test/sku-universal-pendiente.test.js` (CA-7),
  `test/sku-universal-pendiente-contabilium.test.js` (CA-8),
  `test/sku-universal-ventas-individuales.test.js` (CA-9),
  `test/migracion-fixture-cache-sku.test.js` (CA-10),
  `test/sku-universal-compuerta-absoluta.test.js` (CA-11),
  `test/sku-universal-pendiente-credito-siembra.test.js` (CA-12),
  `test/sku-universal-no-activada.test.js` (CA-13) y
  `test/sku-universal-sku-puntual.test.js` (CA-14).
- Posiblemente `docs/contratos/sku-universal-multivarianta.md` (igual al patrón de
  `docs/contratos/verificar-cache-sku.md`) y una adenda en `docs/adr/0001-semantica-de-escritura-de-stock.md`
  para documentar la excepción de "un baseline, múltiples escrituras", el journal pendiente
  (que materializa la consecuencia de las líneas 41-42) y la línea `[UNIVERSAL]` como excepción
  que nombra el SKU, igual que la adenda del `[AVISO]` (líneas 47-52).

## Dudas (para la persona, antes de implementar)

1. **R-4, resuelta.** El pedido decía "calcular el delta UNA sola vez" pero no qué hacer si las
   variantes universales hoy tienen stock *distinto* entre sí en Shopify (herencia del
   comportamiento viejo: solo se escribía en una). Pregunta y respuesta de la persona
   (03/11/2026): **"Tomar el valor más alto como referencia y emparejar solo"** — en vez de
   reportar y no escribir, el sync toma el máximo entre las N variantes como `shopifyActual`,
   calcula el `nuevoValor` una sola vez a partir de ese máximo y lo escribe en las N variantes,
   autocorrigiendo la divergencia en la misma pasada sin intervención manual. Volcado en R-4,
   CA-2 y CA-3. Acotada después por la Duda 5: el máximo queda solo para el bootstrap, cuando
   todavía no hay `escrito` guardado.
2. **Discrepancia de conteo.** El pedido textual dice "19 variantes en total"; sumando el informe
   (sección 3.A1) da 18. Se usó el informe, tal como indicó el pedido explícitamente
   ("si el informe tiene una lista distinta o más precisa... usá esa").
3. **Caso base (primera corrida tras el cambio), informativa.** Varios de los 7 SKUs curados ya
   muestran `available` distinto entre variantes (p. ej. `APPLYFIT-CLEAR-IP16PRO-17-17PRO` con
   9/9/0). Ese SKU figura como "ambiguo en el sync" en el informe, así que puede no tener caché,
   ni destino, ni baseline. Con R-2 (nunca `SkuAmbiguoError` para un SKU curado) igual entra al
   cálculo de R-4, pero el camino depende de su libreta: **si el baseline es null, va por siembra
   (camino (a)) y escribe el absoluto de Contabilium en las 3 variantes**, no por bootstrap; solo
   si ya tiene baseline y no tiene `escrito` va por bootstrap (camino (b)), toma el máximo (9)
   como referencia, calcula `nuevoValor` una vez y lo escribe en las 3. En los dos casos la
   variante en 0 pasa a mostrar stock en la tienda sin intervención manual. Antes de escribir
   deja la entrada pendiente en la libreta (R-10). Si alguna escritura falla o el proceso se cae:
   por bootstrap sin crédito, la corrida siguiente termina de escribir el mismo `nuevoValor` en
   las que faltan sin volver a tomar el máximo ni sumar el delta otra vez (R-11); por siembra (o
   con crédito), la entrada queda marcada y se cierra con la compuerta manual (R-17, R-16).
   Ninguno de estos casos requiere emparejar el stock a mano antes de activar la feature.
4. **R-12, resuelta.** Respuesta de la persona (03/11/2026): **"Terminar lo pendiente primero,
   el cambio nuevo espera a la corrida siguiente"**. Adoptó tal cual la propuesta que sigue.
   R-12 pasa a ser un requisito decidido. CA-8 no cambia. Registro de la pregunta original:
   *Contabilium cambia mientras hay un pendiente.* R-12 dejaba escrita la propuesta del planificador: mientras un SKU
   universal tiene una entrada pendiente, se termina de escribir el `nuevoValor` ya persistido
   aunque Contabilium se haya movido. Al cerrar el pendiente, el baseline queda en el valor de
   Contabilium que lo originó, y el movimiento nuevo se aplica como delta normal en la corrida
   siguiente. **Recomendación:** aprobarla tal cual. Es la única variante que no pierde ni duplica
   el movimiento intermedio. Su costo es que el stock nuevo llega una corrida más tarde. La
   alternativa, recalcular sobre la marcha, vuelve a mezclar un valor a medio aplicar con un delta
   nuevo, que es justamente lo que causó B-1. Si la persona decide otra cosa, se reescriben R-12
   y CA-8, y nada más.
5. **R-4 y el atajo del incremental, resuelta.** Respuestas de la persona (03/11/2026):
   **"Sumar las ventas individuales, no tomar el máximo"** (adoptó la recomendación de guardar
   `escrito`) y, para el aparte, **"Sí, revisar los 7 SKUs en cada corrida"**. Volcado en R-4
   (tres caminos excluyentes: siembra, bootstrap con máximo sin `escrito`, camino normal con
   `escrito − Σ(escrito − available_i)` y piso 0), R-13 nuevo (persistencia de `escrito`), R-14
   nuevo (bypass del atajo solo para los 7 SKUs curados), CA-2 y CA-3 ampliados con el caso de
   ventas individuales, y CA-9 nuevo. Registro de la pregunta original:
   *El máximo de R-4 pierde ventas online en régimen estable.* Shopify descuenta una venta
   online solo de la variante vendida. Ejemplo: con las 5 variantes en 5, una venta online de la
   variante "IP14" la deja en 4/5/5/5/5. Contabilium no cambia: según el ADR 0001, las ventas web
   van a OFICINA. Entonces el atajo del incremental saltea el SKU, y las otras 4 variantes siguen
   ofreciendo 5 unidades de un artículo del que quedan 4 (riesgo de sobreventa). Cuando
   Contabilium se mueve, por ejemplo con −1 en mostrador, R-4 toma el máximo (5) y escribe 4 en
   las 5. Lo correcto era 3: **la venta online se re-infla**, que es lo que prohíbe la
   invariante 1. El máximo sirve para la herencia del comportamiento viejo (variantes en 0 que el
   sync nunca tocó). No sirve cuando la divergencia viene de ventas. **Recomendación:** guardar en
   la libreta el último `nuevoValor` confirmado en las N variantes (`escrito`). Cuando exista, la
   referencia pasa a ser `escrito − Σ(escrito − available_i)`, con piso 0: suma las ventas de cada
   variante. El máximo queda solo para cuando no hay `escrito` (primera corrida). Un aparte: para
   que una venta online en una variante baje las demás sin esperar a Contabilium, el atajo del
   incremental tendría que dejar pasar los SKUs universales. Eso suma lecturas a Shopify en cada
   corrida (7 SKUs) y también lo decide la persona. Si se adopta la recomendación, cambian R-4,
   CA-2 y CA-3 y aparece un criterio nuevo. Si no, el riesgo queda aceptado por escrito.
6. **Riesgo residual del journal (informativa).** La entrada pendiente sobrevive a un crash del
   proceso porque se guarda en `.cache` antes de escribir. Entre corridas, `.cache` viaja por
   `actions/cache/save` con `if: always()` (`.github/workflows/sync.yml:136-142`), que también corre
   en fallos y en el timeout del job. Si el runner muere sin llegar a ese paso, la corrida
   siguiente restaura la libreta anterior sin el pendiente, y la variante a medio escribir vuelve
   al camino de R-4. Ningún diseño dentro del proceso lo evita. Si pasa, la reparación es la
   compuerta absoluta manual del ADR 0001. Conviene que la persona lo sepa. Con R-13 el mismo
   riesgo alcanza a `escrito`: la corrida siguiente puede restaurar un `escrito` más viejo que
   lo que ya está escrito en las variantes (ver Duda 7).
7. **Una variante que SUBE por encima de `escrito`, resuelta.** Respuesta de la persona
   (03/11/2026): **"Ignorar la suba, contar solo las bajas reales"**. La fórmula de R-4 pasa de
   `escrito − Σ(escrito − available_i)` a `escrito − Σ max(0, escrito − available_i)`: cada
   variante aporta como máximo 0 a la resta si subió, nunca negativo. En el ejemplo de la Duda 6
   (`escrito` 5, variantes en 8/8/8/8/8) la referencia da 5, no 20: la próxima escritura empareja
   hacia abajo las variantes editadas a mano, tratando la suba como si no hubiera pasado (el canal
   válido para cambiar el stock real es Contabilium o la compuerta absoluta manual). Volcado en
   R-4 y en el nuevo caso "suba ignorada" de CA-3.
8. **Precisiones de ingeniería D-1 a D-9 (`aceptacion/sku-universal-multivarianta/README.md:140-182`),
   resueltas por el orquestador como clarificaciones, sin decisión de producto nueva.** D-1:
   prefijo `<par>/<sku>` en `[UNIVERSAL]` y en los `[ERROR]` nuevos (R-8, R-10, R-11, CA-5,
   CA-7). D-2/D-3: `universales` cuenta también el universal que ya estaba en `nuevoValor`, y en
   DRY_RUN queda en 0 (R-8, CA-5). D-4: `destinos[sku]` apunta al `inventoryItemId` MÁS CHICO
   (orden ascendente por el número del gid) entre las N variantes, no a la primera en el orden de
   la búsqueda exacta — corregido después, ver punto 9 (R-5). D-5: el crédito acreditable se suma
   una sola vez en el cálculo único (R-3). D-6: la lista curada lleva la cantidad esperada de
   variantes por SKU y R-7 compara contra ella (R-1, R-7, CA-1, CA-2). D-7: mismo contador de
   errores y misma convención de salida, sin umbral nuevo (R-5). D-8: `[ERROR]` literal y ninguna
   `[UNIVERSAL]` si falla la persistencia del pendiente (R-10, CA-7). D-9: doble piso 0 en el
   camino normal (R-4, CA-2, CA-3).
9. **Orden determinístico de `destinos[sku]` y destino heredado, resuelta.** Ajuste del
   orquestador tras D-4: fijar `destinos[sku]` al orden de respuesta de la API era no
   determinístico (Shopify no garantiza orden estable entre corridas), y un cambio de destino sin
   motivo real dispararía el chequeo de `cambioDeDestino` de `verificar-cache-sku`, que siembra el
   absoluto — exactamente lo que esta feature evita con R-10/R-11/R-12. Se cambió a "el
   `inventoryItemId` más chico, orden ascendente" (R-5): mismo conjunto de N variantes, mismo
   destino siempre, sin importar el orden de la API. El autor de la evidencia encontró el caso que
   faltaba cerrar: un SKU universal que YA tenía un `destinos[sku]` heredado del comportamiento
   viejo (de antes de esta feature), que puede no coincidir con el `inventoryItemId` más chico. En
   la primera corrida tras desplegar, R-5 recalcula `destinos[sku]` al más chico, lo que por sí
   solo es un "cambio de destino" respecto del valor heredado. **Queda explícito en R-4/R-5: el
   chequeo genérico de `cambioDeDestino` de `ejecutarPar` (`verificar-cache-sku`) NO aplica a
   los 7 SKUs de la lista curada.** Para estos SKUs la única condición de siembra es la del camino
   (a) de R-4 (baseline null); actualizar `destinos[sku]` al más chico —incluida la primera vez,
   venga de un valor heredado o no— nunca dispara siembra por sí solo. Esto ya estaba implícito en
   R-4 (que solo lista baseline null como condición de siembra, sin mencionar cambio de destino),
   pero quedaba ambiguo porque R-3 cita la misma `calcularEscritura` que usan los SKUs no
   universales; se dejó sin ambigüedad en R-4/R-5 directamente.
10. **`causa_desconocida` para SKUs universales, abierta y diferida.** Esta feature no define
    cómo cuentan los SKUs universales en `causa_desconocida` (el contador del clasificador,
    `src/sync.js:1160`). Pasa lo mismo que con `[AVISO]` y `[UNIVERSAL]`, que ya son excepciones
    documentadas en la adenda del ADR 0001. Si en producción esto genera ruido, se trata en una
    iteración siguiente. No es un requisito de esta feature.
11. **Ronda final de la revisión de alcance (BL-1 a BL-3, IM-1 a IM-4, NO-1 a NO-4), resuelta por
    el orquestador con criterio de ingeniería coherente con lo ya aprobado.** No trae ninguna
    decisión de producto nueva. BL-1 → R-15, CA-10, CA-6. BL-2 → R-16, CA-11. BL-3 → R-17, CA-12.
    IM-1 → R-2, CA-2, CA-14. IM-2 → R-18, CA-13. IM-3 → citas corregidas en R-5, R-8, R-11, R-14
    y en Archivos probables. IM-4 → R-19, CA-14. NO-1 → Duda 3. NO-2 → R-1. NO-3 → Duda 10. Un
    cierre de ingeniería, confirmado por el orquestador: correcto, queda tal cual lo dejó
    `planificador`. En R-16, la compuerta descarta el pendiente viejo, como pidió BL-2, y además
    persiste un pendiente propio marcado "requiere compuerta" antes de escribir. Sin esa marca, un
    fallo parcial de la compuerta dejaría las variantes con el absoluto a medio aplicar, sin
    journal, y la corrida automática siguiente las leería como bajas o subas por el camino (c), que
    es el mismo riesgo de B-1. Es la aplicación consistente del mismo patrón de R-10 a una vía de
    escritura más: no hace falta diseño nuevo, se mantiene.
12. **CA-10, resuelta: copias congeladas en vez de `git show`.** El riesgo de depender de
    `git show 3abeda7:<ruta>` en tiempo de test (un clon superficial de CI puede no tener ese
    commit, y CA-10 daría `entorno` en vez de `codigo`) se evita del todo: CA-10 ya no usa git en
    ninguna corrida. El autor de la evidencia de aceptación congela, una sola vez, una copia
    literal de las 5 versiones originales dentro de
    `aceptacion/sku-universal-multivarianta/fixtures-originales/`, y el test compara contra esas
    copias en disco. Volcado en el texto de CA-10 y en "Archivos probables".

## Departamentos

Uno solo: backend / middleware de sincronización de stock (`src/shopify.js`, `src/sync.js`,
`test/*`), igual que `verificar-cache-sku`.

## Presupuesto

2 intentos por tarea para el especialista; el jefe del departamento puede subir de escalón si la
tarea se complica (p. ej. por la interacción entre `escrito`, el pendiente de R-10/R-11 y el
bypass de R-14, y ahora la marca "requiere compuerta" de R-17 y la compuerta multi-variante de
R-16). Las Dudas 1, 4, 5 y 7 ya están resueltas. La Duda 10 queda diferida explícitamente y fuera
del alcance. Las Dudas 11 y 12 ya están resueltas (confirmadas por el orquestador; CA-10 ya no
depende de `git show`, usa copias congeladas). La tercera ronda de revisión de alcance encontró
BL-A, BL-B e IM-A, ya resueltos en R-16, R-18, R-19, CA-11, CA-12, CA-13 y CA-14. Antes de
diagnosticar y congelar, `autor-aceptacion` tiene que actualizar la evidencia de CA-11 a CA-14 y
`revisor-alcance` tiene que volver a pasar.

## Cierre

- **Arquitectura:** presentada en `docs/diseno/arquitectura-sku-universal-multivarianta.html`,
  aprobada el 03/11/2026 (`docs/diseno/aprobaciones/sku-universal-multivarianta.json`).
- **Proceso de aceptación:** 5 rondas de revisión de alcance (`revisor-alcance`, genérico)
  encontraron y cerraron B-1 a B-4/I-1 a I-6/N-1 a N-6 (ronda 1), BL-1 a BL-3/IM-1 a IM-4/NO-1 a
  NO-4 (ronda 2), BL-A/BL-B/IM-A (ronda 3) y precisiones menores (rondas 4-5), hasta "listo para
  congelar". `arn oraculo diagnosticar` dio 13/14 `rojo-esperado` y 1 `verde-sospechoso` (CA-6,
  esperable sin código); congelado con `ARN-W094` (riesgo alto sin `--referencia`, aceptado).
- **Implementación:** 14 tareas (T01-T14) despachadas en serie a `implementador` (escalón
  `rapido`/sonnet, sin necesitar escalar), cada una con su gate en verde. Un fix post-T08
  (prefijo `<par>/<sku>` en `[ERROR]` de R-10/R-13) y una corrección post-revisión de R-18/R-19
  por fuera de las 14 tareas originales.
- **Revisión de código:** 5 rondas de `revisor-codigo` (opus). Encontraron y cerraron: un bug real
  (el reintento con las N variantes ya en `nuevoValor` no cerraba el pendiente, dejando el SKU
  trabado para siempre — corregido con test de regresión), cobertura incompleta de CA-7 §1 y §4
  (el test de "crash a mitad de las N escrituras" no simulaba un crash real — corregido con
  `throw null` para escapar el `try/catch` de producción, que lee `err.message` sin `?.`), un piso
  de 0 no documentado sobre `nuevoValor` en `calcularUnico` (sacado, para igualar la fórmula de
  R-3 a la de los SKUs no universales), y tests débiles en los subcasos de caché de CA-2/CA-14
  (reescritos para demostrar explícitamente la diferencia contra el camino viejo).
- **Evidencia vigente:** `evidencia/sku-universal-multivarianta/20261103T164910Z` (`arn verificar`,
  14/14 CA en verde). `npm test`: 572/572.
- **Juicio:** `arn juzgar --host claude` → **APRUEBA** los 14 criterios
  (`sku-universal-multivarianta/juez-20261103T164918Z`).
- **`arn cerrar`:** `cerrable: si`.
- **Riesgos aceptados, documentados y no resueltos en esta feature (no bloquean el cierre):**
  - La libreta se escribe sin `tmp`+`rename` (riesgo preexistente a esta feature, ahora con más
    escrituras por corrida: hasta 2 por SKU universal). Un crash a mitad de esa escritura puntual
    corrompería el archivo; `cargarLibretaCompleta` cae a una libreta vacía y la corrida siguiente
    resembraría el catálogo completo. Nota de robustez general, fuera del alcance de R-1 a R-19.
  - `src/sync.js` tiene varios `catch (err)` que leen `err.message` sin `?.` (líneas ~1300, 1471,
    1599, 1981): si algo no-`Error` se lanza ahí, la corrida entera se cae sin control en vez de
    contarlo como una variante fallida y seguir. El test de regresión de CA-7 §4 depende
    deliberadamente de este comportamiento para simular un crash; si se endurece ese `catch` en el
    futuro, ese test (no el código de producción) va a necesitar otro mecanismo.
  - `causa_desconocida` para SKUs universales queda sin definir (Duda 10 del contrato, diferida).
  - Decisiones pendientes de la persona que quedan fuera de esta feature: los 57 pares iPhone
    16e/17e del grupo A4, y cómo mostrar los universales de ese grupo.
- **Próximo paso real, para la persona:** mirar la primera corrida real tras el despliegue
  (sin `DRY_RUN`), confirmar que las 7 variantes de `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E` (el
  caso que motivó todo esto, hoy 7/0/0/0/0) se emparejan en la primera pasada, y revisar
  `universales`/`universales_pendientes` en el `[RESUMEN]` de esa corrida.
