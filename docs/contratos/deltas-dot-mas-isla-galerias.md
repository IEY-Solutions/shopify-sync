# Feature: deltas-dot-mas-isla-galerias

## Pedido original

> Arreglar la semántica de escritura de stock del DOT para que use deltas contra una línea base
> durable en vez del valor absoluto (implementar de verdad el ADR 0001 y el invariante 1 de
> `AGENTS.md`, hoy incumplidos por `src/sync.js:172` y `src/shopify.js:345-354`), y agregar la isla
> comercial nueva de Galerías Pacífico como un segundo par (depósito Contabilium → location
> Shopify) sincronizado con esa misma semántica de deltas corregida — nunca con el absoluto. Un
> solo módulo multi-par en este repo (loop de pares en `src/index.js`), transporte directo a
> Contabilium por ahora (no vía `BrokerContabilium`, que queda para una fase 2 fuera de esta
> feature). El gid de la location de Galerías Pacífico en Shopify y el id de su depósito en
> Contabilium todavía no están confirmados — hay una consulta de solo lectura en curso contra la
> tienda real. Decisión de alcance y dirección arquitectónica confirmadas por la persona del
> proyecto sobre la base de `docs/analisis/2026-10-29-isla-galerias-pacifico.md` (29/10/2026).

## Departamentos

Un solo departamento interviene: **backend / middleware de sincronización de stock**
(`src/*.js` de este repo: `index.js`, `sync.js`, `contabilium.js`, `shopify.js`, config de env,
`test/*`). No hay reparto entre departamentos porque todo el cambio vive en este mismo módulo; por
ser nivel 3 (ver abajo) corresponde además un **revisor de calidad** de solo lectura, separado de
quien implementa, antes del cierre (invariante "Separación de deberes" de `AGENTS.md`).

Presupuesto de intentos sugerido para el jefe de este departamento al partir tareas: 2 intentos por
tarea (el default de `contrato-especialista`), salvo que el jefe decida que alguna tarea concreta
amerita más por tocar escritura contra Shopify en vivo.

## Nivel y riesgo

- **Nivel: 3.** Según `descomposicion-tareas`, nivel 3 es "varios departamentos, **o cambia
  datos**, contratos o seguridad". Esto cambia datos de producción en dos sentidos: (a) el formato
  y la semántica del estado persistido (`last-sync.json` → separado por location, de línea base
  absoluta a delta) y (b) el inventario real de Shopify de una location que la web usa para decidir
  si vende o no. No alcanza con "varios archivos de un departamento" (nivel 2) porque el error ya
  tiene impacto medido en datos de negocio (ver `docs/diagnostico-2026-08-19.md`, H3) y el fix debe
  tratarse con el mismo cuidado que una migración de esquema de datos.
- **Riesgo: alto.** Por `descomposicion-tareas`, riesgo alto es "nivel 3, o cualquier superficie
  alta: auth, datos personales, **dinero**, migraciones o esquema, contratos públicos, seguridad,
  infra". Acá hay al menos tres: (1) escritura contra el inventario real de Shopify que, si la
  semántica queda mal, produce sobreventa real (equivalente a impacto de dinero: pedidos que no se
  pueden cumplir); (2) migración del esquema del estado persistido (`last-sync.json` de un único
  archivo global a uno por location, con cambio de `SNAPSHOT_VERSION`); (3) integración con dos
  APIs externas con límites de tasa (infra: 25 req/10s compartido con `iey-ai`, balde de puntos de
  Shopify). El riesgo no se baja porque el dato de la isla (gid/depósito) esté pendiente: al
  contrario, ese hueco es una razón más para no bajarlo.

## Dudas (no resueltas por el planificador, no inventar)

1. **Gid de la location de Shopify de Galerías Pacífico** y **id del depósito de Contabilium de la
   isla**: pendientes de una consulta de solo lectura en curso. Por eso R-9/CA-9 exige que el par de
   la isla pueda declararse en la configuración de pares sin esos valores reales (usando valores de
   prueba) y quede inactivo/omitido de forma explícita y ruidosa hasta que lleguen — nunca que el
   código los necesite hardcodeados para compilar o testear.
2. **¿La isla de Galerías Pacífico despacha pedidos online (retiro en tienda) igual que el DOT?**
   La persona ya confirmó que sí (ver contexto del pedido), así que este contrato asume dos
   sumideros independientes también para la isla y exige la misma semántica de deltas. Si esa
   confirmación cambiara, R-9/R-3 habría que revisarlos.
3. **Fase del transporte (directo vs. `BrokerContabilium`)**: queda fuera de alcance por decisión ya
   tomada (transporte directo, como hoy). No es una duda para este contrato, se deja anotada para
   que no se re-abra por error durante la implementación.
4. **`ai/scripts/verify.sh`**: a la fecha de este contrato `package.json` ya define `scripts.test`
   (`node --test test/*.test.js`), así que el gate de `AGENTS.md` ya corre tests de verdad; no hace
   falta un requisito aparte para esto, pero si algún `CA-#` agrega un archivo de test nuevo,
   confirmar que `test/*.test.js` lo recoge por el glob (no requiere tocar `package.json`).
5. **Alcance parcial del ADR 0001 (decidido por la persona, 29/10/2026):** esta feature NO implementa
   el clasificador de causa por comprobante ni la compuerta manual auditada que el ADR exige para
   deltas puros. Queda **pendiente como feature futura, fuera de este contrato**. Riesgo residual
   aceptado explícitamente: una venta facturada a mano contra el DOT puede duplicar el descuento
   (caso real del censo de agosto, 3/6, citado en el ADR). No reabrir esto como hallazgo de alcance
   durante la implementación de este contrato.

```yaml arn-contrato
feature: deltas-dot-mas-isla-galerias
nivel: 3
riesgo: alto
pedido: |
  Arreglar la semantica de escritura de stock del DOT para que use deltas contra una linea base
  durable en vez del valor absoluto (implementar de verdad el ADR 0001 y el invariante 1 de
  AGENTS.md, hoy incumplidos por src/sync.js:172 y src/shopify.js:345-354), y agregar la isla
  comercial nueva de Galerias Pacifico como un segundo par (deposito Contabilium -> location
  Shopify) sincronizado con esa misma semantica de deltas corregida, nunca con el absoluto. Un
  solo modulo multi-par en este repo (loop de pares en src/index.js), transporte directo a
  Contabilium por ahora (no via BrokerContabilium, que queda para una fase 2 fuera de esta
  feature). El gid de la location de Galerias Pacifico en Shopify y el id de su deposito en
  Contabilium todavia no estan confirmados; hay una consulta de solo lectura en curso contra la
  tienda real. Decision de alcance y direccion arquitectonica confirmadas por la persona del
  proyecto sobre la base de docs/analisis/2026-10-29-isla-galerias-pacifico.md (29/10/2026).
requisitos:
  - id: R-1
    texto: "El sync del par DOT escribe en Shopify un delta contra una linea base durable (no el valor absoluto de Contabilium): si Shopify ya desconto unidades por una venta web con retiro en tienda, una corrida posterior no debe re-inflar ese stock. Cumple PARCIALMENTE el ADR 0001 (docs/adr/0001-semantica-de-escritura-de-stock.md): implementa el delta contra linea base (el invariante 1 de AGENTS.md), pero NO implementa las dos defensas que el ADR exige para deltas puros (clasificador de causa por comprobante, compuerta manual auditada). Decision de la persona (29/10/2026): avanzar con deltas puros ahora y dejar esas dos defensas para una feature futura, aceptando el riesgo residual documentado en el ADR (una venta facturada a mano contra el DOT puede duplicar el descuento bajo deltas puros)."
    origen: "AGENTS.md invariante 1; ADR 0001 (alcance parcial, decidido por la persona); pedido de la persona (29/10/2026)"
  - id: R-2
    texto: "El sync admite una lista de pares (deposito Contabilium, location Shopify) parametrizable por configuracion/env, sin ids de deposito ni de location hardcodeados en src/*.js. Agregar o quitar un par no requiere tocar la logica de sync, solo la lista de pares."
    origen: "docs/analisis/2026-10-29-isla-galerias-pacifico.md seccion 6.2; pedido de la persona"
  - id: R-3
    texto: "El estado persistido (hoy .cache/last-sync.json) esta separado por location: la linea base de un par nunca se lee ni se pisa con la de otro par, aun cuando ambos corran en la misma invocacion del proceso."
    origen: "docs/analisis/2026-10-29-isla-galerias-pacifico.md seccion 3 shopify-sync; pedido de la persona"
  - id: R-4
    texto: "El sync nunca escribe sobre el deposito CENTRAL ni su location en Shopify: solo escribe sobre los pares declarados explicitamente en la configuracion (hoy DOT; cuando este el dato, la isla)."
    origen: "AGENTS.md invariante 2"
  - id: R-5
    texto: "Para todos los pares, la resolucion de SKU usa sku:\"...\" entre comillas y verifica que el sku devuelto por Shopify sea exactamente el pedido antes de escribir, por el 26% de SKUs que son prefijo estricto de otro."
    origen: "AGENTS.md invariante 3"
  - id: R-6
    texto: "Para todos los pares, la cantidad escrita en Shopify es siempre entera, aun cuando Contabilium devuelva decimales."
    origen: "AGENTS.md invariante 6"
  - id: R-7
    texto: "Para todos los pares, un SKU no resuelto (no encontrado en Shopify, o no activado en esa location) nunca se marca como resuelto en el estado persistido: se reintenta en la proxima pasada."
    origen: "AGENTS.md invariante 7"
  - id: R-8
    texto: "Una corrida que no sincronizo nada en ningun par (0 escrituras, 0 confirmaciones) no sale con codigo 0: se reporta como falla o advertencia explicita, nunca en silencio."
    origen: "AGENTS.md invariante 5; docs/diagnostico-2026-08-19.md hallazgo H3"
  - id: R-9
    texto: "El par de Galerias Pacifico (deposito Contabilium de la isla x location Shopify de la isla) queda declarado en la configuracion de pares usando la misma semantica de deltas de R-1, pero mientras el gid de la location y el id del deposito reales no esten confirmados, el par se puede declarar con valores de prueba, corre en modo seguro (sin escribir contra una location real) y lo reporta de forma explicita, sin fallar en silencio ni requerir valores reales para que el codigo compile o testee."
    origen: "pedido de la persona (29/10/2026): dato pendiente, consulta de solo lectura en curso"
  - id: R-10
    texto: "Para todos los pares, si DRY_RUN es verdadero el sync nunca ejecuta ninguna escritura real contra Shopify (ninguna llamada a setearStock ni mutacion), y reporta explicitamente que habria escrito, igual que ya hace el camino legado procesarSku/syncTodos."
    origen: "hallazgo de revisor-codigo (29/10/2026): ejecutarPar en src/sync.js no consulta esDryRun()/DRY_RUN y siempre escribe en el modo que corre por defecto en produccion via cron-job.org"
  - id: R-11
    texto: "El primer run del par DOT despues de este deploy usa como linea base inicial el contenido ya existente de .cache/last-sync.json (formato legado, SNAPSHOT_VERSION actual) en vez de una libreta vacia, mediante una migracion explicita u otro mecanismo equivalente, de forma que ningun SKU con linea base conocida pase a tratarse como primera vez solo por el cambio de nombre de archivo; el par de la isla no necesita esta migracion porque nunca tuvo estado previo."
    origen: "hallazgo de revisor-codigo (29/10/2026): rutaSnapshotPara(\"dot\", dirCache) apunta a .cache/last-sync.dot.json, distinto del legado, y reintroduce el bug de sobreventa de R-1 via sembrado: true para todo SKU"
  - id: R-12
    texto: "El loop multi-par salta sin reconsultar Shopify los SKUs cuyo valor de Contabilium no cambio desde la corrida anterior, salvo que se pida explicitamente una reconciliacion completa equivalente al modo --full de hoy pero por par, y persiste el progreso periodicamente durante la corrida para que una corrida interrumpida por timeout no pierda el trabajo ya hecho en ese par."
    origen: "hallazgo de revisor-codigo (29/10/2026): ejecutarPar no implementa el atajo incremental ni el checkpointing cada 200 SKUs que si tiene syncTodos, mismo patron que H3 en docs/diagnostico-2026-08-19.md"
criterios:
  - id: CA-1
    requisitos: [R-1]
    tipo: mecanico
    superficie: datos
    texto: "Test de regresion: con una linea base previa y un stock de Contabilium sin cambios pero con Shopify ya descontado por una venta web simulada, el sync no re-infla esa cantidad (no escribe el absoluto de Contabilium encima del descuento online)."
    comando: "node --test test/sync-deltas.test.js"
  - id: CA-2
    requisitos: [R-2]
    tipo: mecanico
    superficie: infra
    texto: "Test con dos pares de fixture (deposito/location distintos) corridos en una sola invocacion: cada par escribe solo en su location correspondiente y ninguno usa un id hardcodeado del otro par."
    comando: "node --test test/multi-par.test.js"
  - id: CA-3
    requisitos: [R-3]
    tipo: mecanico
    superficie: datos
    texto: "Test que corre dos pares con baselines distintos en el mismo estado persistido y verifica que cada location lee y escribe su propio archivo/clave de estado, sin pisar la del otro."
    comando: "node --test test/libreta-multi-location.test.js"
  - id: CA-4
    requisitos: [R-4]
    tipo: mecanico
    superficie: datos
    texto: "Test que, dado un stock de Contabilium que incluye el deposito CENTRAL, confirma que nunca se construye un input de escritura hacia la location CENTRAL de Shopify."
    comando: "node --test test/no-tocar-central.test.js"
  - id: CA-5
    requisitos: [R-5]
    tipo: mecanico
    superficie: datos
    texto: "Los tests de coincidencia de SKU (sku:\"...\" entre comillas y verificacion del sku devuelto) pasan para los pares multiples, no solo para el DOT."
    comando: "node --test test/sku-match.test.js"
  - id: CA-6
    requisitos: [R-6]
    tipo: mecanico
    superficie: datos
    texto: "Test que alimenta una cantidad decimal de Contabilium para cada par y verifica que la cantidad enviada a Shopify es siempre entera."
    comando: "node --test test/cantidades-enteras.test.js"
  - id: CA-7
    requisitos: [R-7]
    tipo: mecanico
    superficie: datos
    texto: "Los tests de la libreta (SNAPSHOT_VERSION, SKUs no_encontrado/no_activado nunca marcados como resueltos) siguen pasando extendidos a mas de un par."
    comando: "node --test test/libreta.test.js test/orquestacion-pares.test.js"
  - id: CA-8
    requisitos: [R-8]
    tipo: mecanico
    superficie: infra
    texto: "Los tests de resultado/workflow confirman que una corrida sin ninguna escritura en ningun par no sale con codigo 0."
    comando: "node --test test/resultado.test.js test/workflow.test.js"
  - id: CA-9
    requisitos: [R-1]
    tipo: mecanico
    superficie: datos
    texto: "Test de regresion con el caso real del hallazgo H3 de docs/diagnostico-2026-08-19.md (corrida que parecia en verde pero no sincronizo nada / escribia el absoluto): el test reproduce ese caso contra el codigo corregido y falla si el codigo vuelve al comportamiento anterior."
    comando: "node --test test/regresion-h3-absoluto.test.js"
  - id: CA-10
    requisitos: [R-9]
    tipo: mecanico
    superficie: infra
    texto: "Test que declara el par de Galerias Pacifico con valores de prueba (sin ids reales) y confirma que el sync lo reporta explicitamente como pendiente/omitido, sin escribir en ninguna location real y sin salir en silencio ni con un codigo de exito falso."
    comando: "node --test test/par-isla-pendiente.test.js"
  - id: CA-11
    requisitos: [R-10]
    tipo: mecanico
    superficie: datos
    texto: "Test que corre ejecutarPar sobre multiples pares con DRY_RUN=true y confirma que no se invoca ninguna escritura real (setearStock/mutacion) contra Shopify en ningun par, y que la corrida reporta explicitamente que habria escrito."
    comando: "node --test test/dry-run-multi-par.test.js"
  - id: CA-12
    requisitos: [R-11]
    tipo: mecanico
    superficie: datos
    texto: "Test que arranca con un .cache/last-sync.json legado existente y sin .cache/last-sync.dot.json, corre el par DOT por primera vez tras el deploy, y verifica que la linea base usada es la del archivo legado (no sembrado: true para SKUs que ya tenian baseline), mientras que el par de la isla sin estado previo sigue arrancando sin esa migracion."
    comando: "node --test test/migracion-libreta-legada.test.js"
  - id: CA-13
    requisitos: [R-12]
    tipo: mecanico
    superficie: infra
    texto: "Test que verifica que el loop multi-par omite la reconsulta a Shopify de SKUs sin cambio de cantidad en Contabilium respecto de la corrida anterior (salvo reconciliacion completa explicita por par), y que el snapshot se persiste mas de una vez durante una corrida larga (no solo al final), de forma que una interrupcion a mitad de camino no pierda el progreso ya guardado."
    comando: "node --test test/incremental-checkpoint-multi-par.test.js"
congelado: {sha256: "e57fda8db05836f70613c4eb78db4d52d0682676e7def89c94060bd6383895f7", por: "autor-aceptacion", fecha: "2026-10-29T18:33:57+00:00"}
```

## Cierre

- **Juicio final:** `deltas-dot-mas-isla-galerias/juez-20261029T183409Z` — **APRUEBA** los 13 criterios (163 tests en verde).
- Camino recorrido hasta la aprobación: 5 rechazos previos del juez, cada uno con hallazgos reales
  (no cosméticos) que las rondas de `revisor-alcance`/`revisor-codigo` anteriores no habían
  detectado — bug de `DRY_RUN` no respetado, ruptura de la línea base legada en la migración,
  pérdida del atajo incremental/checkpointing, `armarPlanDeEscritura` como código muerto no
  ejercitado por el camino real, y persistencia incompleta de la libreta en el modo `--sku`. Todos
  arreglados y re-verificados antes de la aprobación final.
- **Pendiente explícito, fuera de este contrato** (documentado para no perderse):
  1. Activar el par real de Galerías Pacífico: crear la location en Shopify, dar de alta el
     depósito en Contabilium, confirmar ambos ids (hoy declarado en modo seguro/pendiente).
  2. Clasificador de causa por comprobante + compuerta manual auditada (ADR 0001 completo) — alcance
     parcial decidido por la persona, riesgo residual aceptado.
  3. Transporte vía `BrokerContabilium` — fase 2, pospuesta por decisión ya tomada.
  4. `syncTodos`/`procesarSku` quedaron como código legado sin llamador de producción, con el mismo
     patrón de bug de baseline sin corregir (código muerto, no alcanzable, anotado por `revisor-codigo`).
