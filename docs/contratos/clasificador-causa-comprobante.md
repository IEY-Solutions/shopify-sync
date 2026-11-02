# Feature: clasificador-causa-comprobante

## Pedido original

> implementar la primera defensa pendiente del ADR 0001
> (`docs/adr/0001-semantica-de-escritura-de-stock.md`) — el **clasificador de causa por
> comprobante** — más la **compuerta manual auditada**, ambas explícitamente diferidas como
> "feature futura" en el contrato ya cerrado `docs/contratos/deltas-dot-mas-isla-galerias.md`
> (sección R-1 y Dudas punto 5).

## Rediseño aprobado (02/11/2026)

Tras dos rechazos de un juez independiente (opus) sobre el diseño de "ventana temporal", la persona
aprobó la **alternativa B: registro persistente de comprobantes con contabilidad de créditos**.
Análisis completo con citas: `docs/analisis/2026-11-02-rediseno-clasificador.md`. Propuesta
renderizada y aprobada: `docs/diseno/arquitectura.html` (`arn diseno aprobar`, 02/11/2026).

Decisiones de la persona (textual, 02/11/2026):
- Alternativa: "B: registro de comprobantes (Recommended)".
- Resto de las decisiones (D-2 crédito parcial, D-3 deltas de cualquier signo, D-4 clasificador
  encendido en `--full`, D-6 parámetros, D-8 notas de crédito solo contadas): "Sí, todas las
  recomendadas (Recommended)".
- D-5, falla del clasificador: "Rojo enseguida (Recommended)".
- D-7, retirar `ultimaCorridaExitosa` y `test/libreta-ultima-corrida-exitosa.test.js`: "Sí,
  retiralos (Recommended)".

Datos verificados por la persona en su Postman (02/11/2026, `GET /api/comprobantes/?id=177960828`):
`FechaAlta: "2026-08-12T19:14:11.633"`, `FechaEmision: "2026-08-12T19:14:29.66"` (con hora, **sin
zona horaria**), `TipoFc: "FCB"`, `Inventario: 127356`, `Origen: "Shopify"`,
`IDIntegracion: 25020`, `IDVentaIntegracion: "4586"`, `Items[0].Codigo: "IEY-C09-GRIS"`,
`Items[0].Cantidad: 1`.

## Departamentos

Un solo departamento: **backend / middleware de sincronización de stock** (`src/contabilium.js`,
`src/clasificador-causa.js`, `src/sync.js`, `src/resultado.js`, `src/index.js`,
`.github/workflows/sync.yml`, `test/*`). Nivel 3: revisor de calidad de solo lectura separado de
quien implementa, y juez antes del cierre.

## Nivel y riesgo

- **Nivel 3:** cambia el esquema del estado persistido (registro de comprobantes y consumos), la
  lógica que decide cuánto se escribe en el inventario real de Shopify, y el contrato de entrada del
  proceso (argv, inputs del workflow).
- **Riesgo alto:** sobreventa real si la contabilidad acredita de más (dinero), migración de estado
  persistido (esquema), integración con una API externa sin sandbox y con cupo compartido (infra),
  e inputs de un workflow de repo público (seguridad).

## Dudas y supuestos (no inventar)

1. **H-3, fechas de emisión retroactivas.** La persona: "Creo que no se hace en la práctica, pero no
   estoy seguro." Supuesto: no se hace. La consulta de hoy + ayer cubre el caso normal; un
   comprobante cargado con fecha más vieja que lo ya consultado no se vería y quedaría como doble
   descuento (subventa, el lado seguro).
2. **H-1/H-2, formato de `/search`.** No se corrieron. Se usa solo el formato probado en producción
   por `iey-ai` (`YYYY-MM-DD`, días de Argentina); el diseño B no depende de que la API filtre por
   hora.
3. **H-5, momento en que se mueve el stock.** Supuesto: Contabilium descuenta el stock al dar de alta
   o emitir el comprobante. Mitigación: la referencia de acreditación es la mayor entre `FechaAlta` y
   `FechaEmision`, más un margen.
4. **H-6, producción en `dry_run`.** En verificación por los logs públicos de GitHub Actions. No
   cambia el diseño, sí qué significa desplegar.
5. **H-7, un depósito por comprobante.** `Inventario` es campo de cabecera (confirmado en el
   comprobante 177960828). Supuesto: no hay comprobantes con ítems de varios depósitos.
6. **Ronda 5 (02/11/2026).** R-15/CA-15 (nuevos) y las ampliaciones de R-6/CA-6, R-13/CA-13 y
   R-14/CA-14 salen de la revisión de código del 02/11: I-1 (compuerta no aplicada en verde), N-9
   (`--qty` no entero) y N-10 (inyección de comandos de workflow con el motivo). También de la
   decisión de la persona sobre el test de migración (textual: "Mover el chequeo a main.js").
   Hay dos supuestos que fijó `autor-aceptacion` y que el orquestador puede revisar. Primero, `dry`
   cuenta como aplicado para la compuerta: si no, ensayarla en `dry_run` daría siempre rojo. Segundo,
   con `escritura_absoluta=todos` no hay regla por SKU. Detalle en
   `aceptacion/clasificador-causa-comprobante/DISENO-INTERFAZ.md` (secciones 6.1, 7 y 8).
7. **Ronda 5b (02/11/2026), arreglo tras `revisor-alcance`.** Decisión del orquestador, por la
   invariante 5: en la compuerta, `no_activado` es el **único** estado que se tolera en un par si el
   SKU se aplicó en otro. Un SKU en `error`, `ambiguo` o `no_encontrado` en un par donde estaba
   pedido deja la corrida en rojo (R-15, condición b). El formato viejo `##[` del runner, verificado
   por el orquestador en `actions/runner`, entra en R-6 y R-15. `main` tolera un veredicto sin
   `compuertaNoAplicados` (R-15). El caso de migración suma el eslabón 4 (R-14, nota 7). Detalle en
   `aceptacion/clasificador-causa-comprobante/rojo-2026-11-02.md`, sección "Ronda 5b".

```yaml arn-contrato
feature: clasificador-causa-comprobante
nivel: 3
riesgo: alto
pedido: |
  Implementar la primera defensa pendiente del ADR 0001
  (docs/adr/0001-semantica-de-escritura-de-stock.md) - el clasificador de causa por comprobante -
  mas la compuerta manual auditada, ambas explicitamente diferidas como "feature futura" en el
  contrato ya cerrado docs/contratos/deltas-dot-mas-isla-galerias.md (seccion R-1 y Dudas punto 5).
  Decision de la persona sobre la compuerta manual (31/10/2026): se dispara como un input nuevo del
  workflow_dispatch de GitHub Actions (mismo patron que dry_run), para forzar el absoluto en una
  corrida puntual, con el motivo quedando en el log de esa corrida.
  Rediseno aprobado por la persona el 02/11/2026 tras el segundo rechazo del juez independiente
  (docs/analisis/2026-11-02-rediseno-clasificador.md, docs/diseno/arquitectura.html):
  "B: registro de comprobantes (Recommended)"; resto de las decisiones: "Si, todas las
  recomendadas (Recommended)"; falla del clasificador: "Rojo enseguida (Recommended)"; retirar
  ultimaCorridaExitosa y test/libreta-ultima-corrida-exitosa.test.js: "Si, retiralos (Recommended)".
requisitos:
  - id: R-1
    texto: "Cliente de solo lectura de comprobantes en src/contabilium.js: buscarComprobantes consulta GET /api/comprobantes/search con fechaDesde y fechaHasta en formato YYYY-MM-DD calculados en America/Argentina/Buenos_Aires y page; fetchComprobantesDetalle trae GET /api/comprobantes/?id={id} de forma secuencial con un ritmo configurable no menor a 1500 ms entre pedidos. Ambos usan una sesion unica por corrida (un solo token, compartido tambien con getStockDeposito, y un solo presupuesto de espera acumulada de 5 minutos para toda la corrida). fetchComprobanteById no figura en DEPS_REALES."
    origen: "ADR 0001:20-22; hallazgos 1, 3 y 10 del segundo juez; decision D-6 de la persona (02/11/2026); iey-ai/src/app/api/cron/sync-sales/route.ts:32-46,106-111; iey-ai/src/lib/integrations/contabilium/client.ts:838-876"
  - id: R-2
    texto: "Funciones puras sin IO en src/clasificador-causa.js: dado el detalle de un comprobante y un depositoId, devuelven las lineas acreditables (sku normalizado con trim y mayusculas, cantidad entera, y marca de tiempo de referencia) solo si Origen es \"Shopify\", IDIntegracion es 25020, Inventario es igual al depositoId del par y TipoFc es una factura (FCA, FCB, FCE o FCM); con cualquier otra combinacion devuelven cero lineas, y las notas de credito Shopify/25020 del deposito (NCA, NCB, NCE o NCM) se reconocen aparte para contarlas sin acreditarlas. Las lineas sin Codigo se ignoran. FechaAlta y FechaEmision vienen sin zona horaria (verificado el 02/11/2026: \"2026-08-12T19:14:29.66\") y se interpretan como hora de Argentina (UTC-3), nunca con la zona horaria del proceso; la marca de referencia de una linea es la mayor de las dos."
    origen: "ADR 0001:32-33; P0-S2:36-48,75,136-139; hallazgos 2 y 10 del segundo juez; decision D-8 de la persona; dato verificado por la persona (comprobante 177960828, 02/11/2026)"
  - id: R-3
    texto: "Costo acotado: el detalle de cada id de comprobante se pide como maximo una vez mientras siga en la cache persistente; los comprobantes COT se descartan por el TipoFc de /search sin pedir detalle; el refresco del registro ocurre como maximo una vez por corrida y solo si algun SKU no sembrado del par tiene delta distinto de cero o credito pendiente; cada corrida pide como maximo un tope configurable de detalles (por defecto 60) y los ids que exceden el tope quedan pendientes para la corrida siguiente."
    origen: "AGENTS.md seccion Limites externos; hallazgo 1 del segundo juez; decision D-6 de la persona; P0-S2:14-15"
  - id: R-4
    texto: "Si el refresco del registro falla total o parcialmente, ejecutarPar no bloquea: aplica el delta sin credito para los SKUs cuyo credito no se pudo determinar, los cuenta como causa_desconocida en el agregado del par (nunca como alerta por SKU) y conserva los ids fallidos como pendientes para el refresco siguiente; un id que falla no descarta el resto del lote. Un id que acumula 3 errores no transitorios (400, 404 o detalle que no se puede interpretar) pasa a ilegible: no se vuelve a pedir, se cuenta en comprobantes_ilegibles y no deja el clasificador en fallo; un error transitorio nunca lleva a ilegible."
    origen: "ADR 0001:45-46; contrato original R-4; src/contabilium.js:399-402 y src/sync.js:564-566; docs/analisis/2026-11-02-rediseno-clasificador.md seccion 4.2; caso real P0-S2:212-213 (Id=173386407)"
  - id: R-5
    texto: "Regla contable por SKU: el valor a escribir es shopifyActual + (contabiliumActual - baseline) + creditoAcreditable, donde creditoAcreditable es la suma de las cantidades de lineas Shopify del deposito del par para ese SKU no consumidas y cuya marca de referencia es anterior a tInicioLectura menos un margen configurable (por defecto 5 minutos); esas lineas se marcan consumidas una sola vez, incluso si solo explican una parte del delta. Se aplica con delta de cualquier signo, y un SKU con credito acreditable pendiente saltea el atajo incremental aunque su stock de Contabilium no haya cambiado."
    origen: "ADR 0001:30-33,39-43; hallazgos 2, 6 y 7 del segundo juez; decisiones D-2, D-3 y D-6 de la persona (02/11/2026); caso real censo de agosto P0-S2:109-118"
  - id: R-6
    texto: "Los inputs escritura_absoluta y motivo del workflow_dispatch existen con default vacio, se pasan por env: y nunca por argv ni interpolados con ${{ }} dentro de run:, el job falla antes de correr el sync si escritura_absoluta no esta vacio y motivo esta vacio o tiene solo espacios, y, si el step de validacion pasa, ambos quedan impresos en el log de esa corrida. Ningun valor de esos dos inputs (con saltos de linea CR o LF, que empiece con ::, o que contenga ##[ en cualquier posicion) puede producir en la salida del step de validacion un comando de workflow distinto del unico ::warning:: o ::error:: que el step emite a proposito. Cuenta como comando, igual que en el runner de GitHub (actions/runner prueba TryParseV2 y despues TryParse, sin flag que apague el segundo), toda linea que despues de recortar al inicio empieza con :: y toda linea que no es un comando :: y contiene ##[ en cualquier posicion (formato viejo). Arreglos aceptables, solos o combinados: (a) el valor va solo dentro de los datos del unico comando :: del step, con %, CR y LF escapados (%25, %0D, %0A), y en ninguna otra linea; (b) rechazar como error de validacion, antes del sync, un valor con CR, LF, :: o ##[; (c) encerrar la impresion entre ::stop-commands:: y su cierre, con un token que no se repite entre corridas. Escapar %, CR y LF no alcanza para un valor impreso fuera de un comando ::, y no vale imprimirlo sin escapar, con o sin prefijo."
    origen: "decision de la persona (31/10/2026); hallazgo I-3 del primer juez; hallazgo 8 del segundo juez; nota 8 de revisor-alcance (02/11/2026); revision de codigo del 02/11/2026, hallazgo N-10 (.github/workflows/sync.yml:91); importante 3 y nota 5 de revisor-alcance (ronda 5b, 02/11/2026), formato viejo ##[ verificado por el orquestador en actions/runner (src/Runner.Worker/ActionCommandManager.cs TryProcessCommand; src/Runner.Common/ActionCommand.cs TryParse y TryParseV2)"
  - id: R-7
    texto: "Compuerta manual independiente del clasificador: para los SKUs alcanzados por escritura_absoluta se escribe el absoluto de Contabilium, se resiembra el baseline con ese valor y se guarda resembradoEn[sku] igual a tInicioLectura en la libreta del par; toda linea Shopify del deposito para ese SKU con marca de referencia anterior a resembradoEn[sku] queda consumida con motivo absoluto y nunca se acredita, tanto si ya estaba registrada como si se registra en un refresco posterior (llego tarde o quedo pendiente por el tope); lo mismo vale para un SKU sembrado, con motivo sembrado, por cualquier camino: tambien cuando syncUnSku (modo --sku) escribe el absoluto porque el SKU no tiene baseline, guarda resembradoEn[sku] igual a su tInicioLectura. Ninguna escritura posterior (checkpoint, guardado final ni syncUnSku) borra un resembradoEn ya persistido. Las lineas cuya marca de referencia es posterior a resembradoEn[sku] siguen pendientes y se acreditan normalmente."
    origen: "ADR 0001:23-24,34-35; decision de la persona (31/10/2026); contrato original R-7; hueco detectado por autor-aceptacion (02/11/2026, una linea anterior registrada despues se acreditaria encima del absoluto: sobreventa) y cerrado dentro de la intencion aprobada de R-7; hallazgo 5 de revisor-alcance (02/11/2026, siembra via syncUnSku)"
  - id: R-8
    texto: "Persistencia: una cache de comprobantes de la cuenta en .cache/comprobantes.json (id, dia de Argentina, TipoFc, estado ok/pendiente/ilegible, intentos, y lineas Shopify por deposito) con retencion de 7 dias para ids no relevantes y de 30 dias para comprobantes con lineas Shopify, consumidas o no; los consumos por par viven dentro de la libreta del par y se escriben en la MISMA escritura que el baseline, tanto en el checkpoint como en el guardado final, y ninguna escritura posterior (checkpoint, guardado final ni syncUnSku) borra consumos ya persistidos. Un consumo nunca se poda mientras su comprobante siga en la cache de comprobantes: la antiguedad de las dos podas se mide con la misma regla (el dia de Argentina del comprobante). Un SKU en error, ambiguo, no_activado o no alcanzado por una interrupcion no consume credito. En DRY_RUN no se persisten consumos. El campo ultimaCorridaExitosa y la ventana [ultimaCorridaExitosa, ahora] se retiran."
    origen: "hallazgos 6 y 7 del segundo juez; decisiones D-6 y D-7 de la persona (02/11/2026); reemplaza R-8 del contrato original; hallazgo 1 de revisor-alcance (02/11/2026, podas desalineadas reacreditan una venta vieja)"
  - id: R-9
    texto: "El refresco consulta /search por dias calendario de Argentina: el dia de hoy y, una sola vez despues de medianoche, el dia anterior, que despues queda cerrado; si el ultimo refresco exitoso es anterior a ayer, el lookback se extiende hasta ese dia con un tope de 7 dias. tInicioLectura se toma ANTES de llamar a getStockDeposito."
    origen: "hallazgos 1 y 5 del segundo juez; reemplaza R-9 del contrato original (ventana [ultimaCorridaExitosa, ahora])"
  - id: R-10
    texto: "En modo --full el clasificador corre con el mismo refresco unico y la misma regla contable que en incremental; el costo no depende del numero de SKUs del par."
    origen: "decision D-4 de la persona (02/11/2026); reemplaza R-10 del contrato original"
  - id: R-11
    texto: "Primera corrida con registro o perdida de la libreta del par: se fija corte igual a tInicioLectura en la libreta; las lineas Shopify del deposito con marca de referencia anterior al corte se registran consumidas con motivo pre-corte y no se acreditan; su cantidad se informa agregada en el resumen."
    origen: "docs/analisis/2026-11-02-rediseno-clasificador.md (Alternativa B, primera corrida y perdida de cache)"
  - id: R-12
    texto: "El clasificador no falla en silencio: un error del refresco se loguea una vez por corrida con su mensaje; ejecutarPar imprime un resumen por par con clasificador (no_requerido, ok, parcial o fallo), causa_venta_shopify, causa_desconocida, creditos_pendientes, creditos_pre_corte, creditos_vencidos, notas_credito_shopify, comprobantes_pedidos, comprobantes_pendientes y comprobantes_ilegibles; evaluarCorrida en src/resultado.js devuelve ok false cuando clasificador es fallo, y la corrida sale con codigo distinto de cero despues de haber aplicado las escrituras y guardado la libreta."
    origen: "AGENTS.md invariante 5; hallazgo 4 del segundo juez; decisiones D-5 y D-8 de la persona (02/11/2026)"
  - id: R-13
    texto: "src/index.js parsea argv con parseArgs estricto (opciones declaradas, sin posicionales): un token desconocido es error de uso con salida 2, y un valor de escritura_absoluta o de motivo igual a --full, --cron, --locations o --sku no cambia el modo de ejecucion. La compuerta resuelta (escritura_absoluta, leida del entorno) llega a correrTodosLosPares tanto en el modo por defecto como en --full. --qty acepta solo una cantidad entera en valor (entero seguro mayor o igual a 0: 3 y 3.0 valen 3); 2.5, 1e-1, 3.0001 o cualquier otro valor no entero es error de uso con salida 2, antes de llamar a ninguna dependencia (invariante 6)."
    origen: "hallazgo 8 del segundo juez; hallazgo 2 de revisor-alcance (02/11/2026, compuerta que no llega al sync sin que nada falle); revision de codigo del 02/11/2026, hallazgo N-9 (src/argv.js:71-72, src/sync.js:437-438); AGENTS.md invariante 6"
  - id: R-14
    texto: "Se preservan los contratos existentes: la suite completa del repo pasa sin debilitar, saltear ni borrar tests, con una unica excepcion autorizada por la persona el 02/11/2026 (decision D-7): se retira test/libreta-ultima-corrida-exitosa.test.js, y los casos que prueban ultimaCorridaExitosa en test/incremental-checkpoint-multi-par.test.js y test/sku-individual-usa-libreta-por-par.test.js se reemplazan por casos equivalentes sobre los consumos del registro (el checkpoint y syncUnSku no borran consumos ya persistidos), sin quitar la propiedad que protegian. Segunda excepcion autorizada por la persona el 02/11/2026 (textual: \"Mover el chequeo a main.js\"): el caso de test/migracion-libreta-legada.test.js que exigia que src/index.js importara { correrTodosLosPares } desde ./sync.js, incompatible con CA-13 (index.js importa solo dotenv/config y { main }), pasa a verificar la cadena completa: src/index.js importa { main } desde ./main.js, src/main.js importa { correrTodosLosPares } desde ./sync.js sin alias, y src/main.js no declara ni asigna un correrTodosLosPares local (function, const, let, var, desestructuracion, class ni asignacion); ademas, src/main.js usa como valor el correrTodosLosPares importado fuera del import, todo respaldo de deps.correrTodosLosPares (con ??, con || o como default de una desestructuracion) es ese identificador importado, y src/main.js no menciona ejecutarPar ni migrarLibretaLegada, que necesitaria cualquier copia del orquestador con otro nombre; se conserva la propiedad que protegia, R-11 de docs/contratos/deltas-dot-mas-isla-galerias.md:120-122: el entrypoint real usa el correrTodosLosPares de sync.js, que migra la libreta legada del DOT, y no una copia local."
    origen: "AGENTS.md seccion Gates de revision; hallazgo 9 del segundo juez; decision D-7 de la persona (02/11/2026); decision de la persona (02/11/2026): \"Mover el chequeo a main.js\"; nota 7 de revisor-alcance (ronda 5b, 02/11/2026, copia local con otro nombre usada como respaldo)"
  - id: R-15
    texto: "La compuerta manual no aplicada no sale en verde (invariante 5): el [RESUMEN] de cada par lleva compuerta_pedidos (SKUs de escritura_absoluta presentes en el stock del deposito del par) y compuerta_aplicados (de esos, los que quedaron actualizado, sin_cambios o dry con el absoluto), y ejecutarPar devuelve aparte, sin imprimirlos, esos SKUs en compuertaSkus: { pedidos, aplicados, noActivados }, donde noActivados son los pedidos que quedaron no_activado. Un SKU de una lista de escritura_absoluta es no aplicado si (a) no quedo aplicado (actualizado, sin_cambios o dry) en ningun par, o (b) en algun par no pendiente donde estaba pedido quedo en un estado que no es aplicado ni no_activado, por ejemplo error, ambiguo o no_encontrado; un par pendiente no cuenta, y no_activado es el unico estado que se tolera en un par si el SKU se aplico en otro (queda visible en el [RESUMEN] de ese par). Con algun SKU no aplicado, evaluarCorridaMultiPar(porPar, umbral, { escrituraAbsoluta }) devuelve ok false con compuertaNoAplicados, y main imprime una sola linea [COMPUERTA][ERROR] que nombra esos SKUs y sale con codigo distinto de cero, despues de aplicar las escrituras y guardar las libretas; main trata un veredicto sin compuertaNoAplicados como lista vacia. Ningun valor del entorno puede formar en la salida de main un comando de workflow, ni una linea que empiece con :: ni un ##[ en cualquier posicion: vale sanear la linea o, antes de llamar a ninguna dependencia, rechazar como error de uso con salida 2 un SKU con caracteres de control, :: o ##[. Con escritura_absoluta igual a todos no hay regla por SKU. Vale en el modo por defecto y en --full."
    origen: "revision de codigo del 02/11/2026, hallazgo I-1 (src/sync.js:1005, src/sync.js:1092-1103, src/main.js:75-77); AGENTS.md invariante 5; R-12 y R-13; importantes 1, 2 y 3 de revisor-alcance (ronda 5b, 02/11/2026) y decision del orquestador de tolerar solo no_activado"
criterios:
  - id: CA-1
    requisitos: [R-1]
    tipo: mecanico
    superficie: datos
    texto: "Test del cliente: buscarComprobantes manda fechaDesde y fechaHasta como YYYY-MM-DD de Argentina (a las 22:30 de Argentina del 12/08 manda 2026-08-12, no 2026-08-13) y page; fetchComprobantesDetalle pide los ids de a uno con el ritmo configurado; con fetch simulado, una corrida completa autentica una sola vez y una tanda de 429 que suma mas de 5 minutos de espera entre stock y comprobantes corta la corrida en vez de esperar por id; fetchComprobanteById no esta en DEPS_REALES; el cliente real marca un id como definitivo solo ante 400, 404 o una respuesta 200 que no es un comprobante interpretable, y nunca ante 429 o 5xx con los reintentos o el presupuesto agotados."
    comando: "node --test test/comprobantes-contabilium.test.js test/sesion-contabilium.test.js"
  - id: CA-2
    requisitos: [R-2]
    tipo: mecanico
    superficie: datos
    texto: "Test de las funciones puras: el comprobante real 177960828 (FCB, Shopify, 25020, Inventario 127356, Codigo IEY-C09-GRIS, Cantidad 1, FechaAlta 2026-08-12T19:14:11.633, FechaEmision 2026-08-12T19:14:29.66) devuelve una linea con marca de referencia 2026-08-12T22:14:29.660Z; \" iey-x \" se normaliza a \"IEY-X\"; Inventario de CENTRAL 96667 o FULL ML 97094, Origen vacio, IDIntegracion 24528, TipoFc COT, y lineas sin Codigo devuelven cero lineas; una NCB Shopify/25020 del deposito devuelve cero lineas acreditables y se reconoce como nota de credito."
    comando: "node --test test/clasificador-causa.test.js"
  - id: CA-3
    requisitos: [R-3]
    tipo: mecanico
    superficie: infra
    texto: "Test de costo con dependencias simuladas: dos corridas seguidas sobre el mismo dia no vuelven a pedir el detalle de ningun id ya visto; los COT de /search no generan pedido de detalle; una corrida sin SKUs con delta distinto de cero ni credito pendiente no llama a buscarComprobantes; con 150 ids nuevos y tope 60, la corrida pide 60 y deja 90 pendientes que pide la corrida siguiente."
    comando: "node --test test/clasificador-costo-acotado.test.js"
  - id: CA-4
    requisitos: [R-4]
    tipo: mecanico
    superficie: datos
    texto: "Test de huecos: si buscarComprobantes lanza, los SKUs con delta aplican el delta sin credito y suman causa_desconocida sin abortar; si un id de detalle de cinco lanza, los otros cuatro se registran y el fallido queda pendiente para la corrida siguiente y evaluarCorrida devuelve ok false; un id con error no transitorio en cinco corridas seguidas se pide en las tres primeras, queda ilegible desde la tercera, no se pide en la cuarta ni en la quinta, se cuenta en comprobantes_ilegibles y esas tres corridas dan clasificador ok y evaluarCorrida ok true; un id con error transitorio en cuatro corridas seguidas nunca pasa a ilegible y las cuatro dan ok false; ningun caso emite una linea de log que contenga el codigo de un SKU contado como causa_desconocida, salvo las lineas [SET] y [DRY] preexistentes con su formato exacto (que registran la escritura, no alertan)."
    comando: "node --test test/clasificador-huecos.test.js"
  - id: CA-5
    requisitos: [R-5]
    tipo: mecanico
    superficie: datos
    texto: "Test de regresion con el caso real del censo de agosto (comprobante 177960828, SKU IEY-C09-GRIS, 1 unidad, orden #4586): delta -1 no escribe en Shopify y marca la linea consumida. Casos adicionales: delta -3 con credito 1 escribe -2; delta +4 con credito 1 escribe +5; un credito consumido no explica una baja posterior del mismo SKU; una linea con marca de referencia posterior a tInicioLectura menos el margen no se acredita en esa corrida y si en la siguiente, aunque el SKU no tenga delta (saltea el atajo); con dos SKUs donde uno es prefijo del otro (por ejemplo FUNDA-X-IPHONE16 y FUNDA-X-IPHONE16PRO), el credito de uno nunca se aplica al otro."
    comando: "node --test test/regresion-censo-agosto.test.js"
  - id: CA-6
    requisitos: [R-6]
    tipo: mecanico
    superficie: infra
    texto: "Test de contrato sobre el YAML: escritura_absoluta y motivo existen con default vacio, ningun bloque run: contiene ${{ inputs.motivo }}, ${{ inputs.escritura_absoluta }}, ${{ env.MOTIVO }} ni ${{ env.ESCRITURA_ABSOLUTA }}, el comando node no recibe --motivo ni --escritura-absoluta, y el step de validacion falla si escritura_absoluta no esta vacio y motivo esta vacio o tiene solo espacios. Ronda 5 (N-10): con motivos y alcances maliciosos (LF, CR, CRLF, valores que empiezan con ::, ::stop-commands::, %0A), el step ejecutado con bash emite como maximo un comando de workflow, ::warning:: o ::error::, cuyo texto no sale del valor; no deja un ::stop-commands:: abierto ni con un token reusable de otra corrida; y si sale con 0, el valor sigue en el log. Ronda 5b: los payloads de motivo y de escritura_absoluta suman ##[error]INYECCION al inicio y en medio del valor (recuento ##[error]INYECCION), y el simulador del runner (test/_helpers-comandos-workflow.js) sigue el orden de actions/runner: una linea que despues de recortar al inicio empieza con :: es un comando ::, y cualquier otra linea que contiene ##[ en cualquier posicion es un comando del formato viejo; el token de stop-commands se compara sin distinguir mayusculas. Los controles positivos prueban que una linea propia con el valor y ##[ es un comando aunque este escapado, y que ##[ dentro de los datos de un ::warning:: no lo es."
    comando: "node --test test/compuerta-manual-workflow.test.js"
  - id: CA-7
    requisitos: [R-7]
    tipo: mecanico
    superficie: datos
    texto: "Test de la compuerta: con escritura_absoluta para un SKU con una linea Shopify acreditable, se escribe el absoluto, el baseline queda resembrado, la libreta guarda resembradoEn para ese SKU, la linea queda consumida con motivo absoluto y la corrida siguiente no la acredita; una linea con marca de referencia anterior a resembradoEn que se registra recien en un refresco posterior queda consumida con motivo absoluto y no cambia el valor escrito; una linea posterior a resembradoEn se acredita normalmente; un SKU sembrado se comporta igual con motivo sembrado; un id que quedo pendiente por el tope en la corrida de la compuerta y pasa a ok en una corrida posterior, con referencia anterior a resembradoEn, queda consumido con motivo absoluto; la compuerta con /search caido igual guarda resembradoEn; un syncUnSku que siembra un SKU sin baseline guarda resembradoEn y la corrida siguiente de ejecutarPar no acredita una linea anterior; syncUnSku no borra un resembradoEn ya persistido."
    comando: "node --test test/compuerta-manual-absoluta.test.js"
  - id: CA-8
    requisitos: [R-8]
    tipo: mecanico
    superficie: datos
    texto: "Test de persistencia: una corrida interrumpida despues de un checkpoint deja baseline y consumo juntos para los SKUs procesados y ninguno de los dos para los no alcanzados; al reanudar no se reacredita nada ya consumido; un SKU en error, uno no_activado y uno ambiguo conservan su credito y lo consumen cuando se resuelven; ni el checkpoint ni syncUnSku borran consumos ya persistidos; en DRY_RUN la libreta no cambia; la cache poda ids no relevantes de mas de 7 dias; un consumo cuyo comprobante sigue en la cache no se poda (linea de 30 dias y una hora con su consumo: no se reacredita); la libreta ya no contiene ultimaCorridaExitosa."
    comando: "node --test test/libreta-ledger-checkpoint.test.js test/incremental-checkpoint-multi-par.test.js test/sku-individual-usa-libreta-por-par.test.js"
  - id: CA-9
    requisitos: [R-9]
    tipo: mecanico
    superficie: datos
    texto: "Test de la consulta: el primer refresco despues de medianoche de Argentina consulta ayer y hoy y marca ayer cerrado; los refrescos siguientes del mismo dia consultan solo hoy; con ultimo refresco exitoso de hace 4 dias consulta esos 4 dias y hoy; con 10 dias consulta como maximo 7; tInicioLectura es anterior a la primera llamada de getStockDeposito."
    comando: "node --test test/ventana-comprobantes.test.js"
  - id: CA-10
    requisitos: [R-10]
    tipo: mecanico
    superficie: datos
    texto: "Test en modo --full con varios SKUs con delta y un credito acreditable: buscarComprobantes se llama exactamente una vez por corrida, fetchComprobantesDetalle como maximo una vez, y el SKU con credito aplica la regla contable igual que en incremental."
    comando: "node --test test/clasificador-modo-full.test.js"
  - id: CA-11
    requisitos: [R-11]
    tipo: mecanico
    superficie: datos
    texto: "Test de primera corrida: sin cache ni corte previo, una linea Shopify del deposito con marca de referencia anterior a tInicioLectura queda consumida pre-corte, no modifica el valor escrito y aparece en creditos_pre_corte; una linea posterior al corte se acredita normalmente en la corrida siguiente."
    comando: "node --test test/ledger-primera-corrida.test.js"
  - id: CA-12
    requisitos: [R-12]
    tipo: mecanico
    superficie: cli
    texto: "Test de falla visible: con buscarComprobantes lanzando en una corrida con deltas, el log contiene una linea [CLASIFICADOR][ERROR] con el mensaje, el resumen impreso del par muestra clasificador fallo y los contadores nuevos (incluidos notas_credito_shopify y comprobantes_ilegibles), la libreta se guardo, y evaluarCorrida devuelve ok false; sin deltas el estado es no_requerido y evaluarCorrida devuelve ok true."
    comando: "node --test test/clasificador-falla-visible.test.js test/resultado.test.js"
  - id: CA-13
    requisitos: [R-13]
    tipo: mecanico
    superficie: cli
    texto: "Test de argv: correr src/index.js con un token desconocido sale con 2 sin llamar a Contabilium; con ESCRITURA_ABSOLUTA=--full en el entorno y sin flag --full el modo elegido es incremental; un valor --cron no arranca el cron; con ESCRITURA_ABSOLUTA=SKU-A en el entorno, correrTodosLosPares recibe escrituraAbsoluta con SKU-A tanto en el modo por defecto como en --full. Ronda 5 (N-9): --qty 2.5, 1e-1, 3.0001 y 0.5 son ErrorDeUso con salida 2, y main devuelve 2 sin llamar a ninguna dependencia; --qty 3 y 3.0 dan el entero 3, y syncUnSku lo recibe."
    comando: "node --test test/index-argv.test.js"
  - id: CA-14
    requisitos: [R-14]
    tipo: mecanico
    superficie: infra
    texto: "La suite completa del repo pasa, test/libreta-ultima-corrida-exitosa.test.js ya no existe, y el caso movido de test/migracion-libreta-legada.test.js verifica la cadena src/index.js -> src/main.js -> src/sync.js; ronda 5b: ademas verifica que src/main.js usa como valor el correrTodosLosPares importado fuera del import, que todo respaldo de deps.correrTodosLosPares (??, || o default de desestructuracion) es ese identificador, y que src/main.js no menciona ejecutarPar ni migrarLibretaLegada."
    comando: "npm test"
  - id: CA-15
    requisitos: [R-15]
    tipo: mecanico
    superficie: cli
    texto: "Test con main, correrTodosLosPares real sobre dos pares (DOT e isla) y evaluarCorridaMultiPar real, en el modo por defecto y en --full. Un SKU inexistente en los dos pares (IEY-C09-GRIX) y uno que queda no_encontrado en el DOT y no_activado en la isla dan codigo distinto de 0, una sola linea [COMPUERTA][ERROR] que los nombra y ok false con compuertaNoAplicados. Con uno aplicado y otro inexistente, la linea nombra solo el inexistente, y la escritura y el guardado del aplicado igual ocurren. Un SKU aplicado en el DOT y no_activado en la isla da 0, sin linea de error, con compuerta_pedidos=1 y compuerta_aplicados=0 en el [RESUMEN] de la isla. Ronda 5b: un SKU aplicado en la isla y en error en el DOT, y uno aplicado en la isla y ambiguo en el DOT, dan codigo distinto de 0, una sola linea [COMPUERTA][ERROR] que lo nombra y compuertaNoAplicados con ese SKU; cada escenario con lista de SKUs fija compuertaSkus con pedidos, aplicados y noActivados. Todos aplicados (actualizado o sin_cambios) da 0. En DRY_RUN, el SKU inexistente da rojo y uno dry cuenta como aplicado. Con todos no hay linea de error. Un valor de ESCRITURA_ABSOLUTA con salto de linea, con :: o con ##[ (al inicio o en medio) no produce en la salida de main ninguna linea que el simulador del runner tome como comando (:: al inicio o ##[ en cualquier posicion), tanto si la corrida sigue y reporta la compuerta con codigo distinto de 0 como si main la rechaza como error de uso con salida 2 sin correr el sync. Casos puros de evaluarCorridaMultiPar: la condicion (b) da rojo en cualquiera de los dos pares; no_activado en todos los pares da rojo; un par pendiente o un par sin el SKU en su stock no activan la condicion (b); con dos SKUs, solo el que fallo va a la lista. Sin tercer argumento, evaluarCorridaMultiPar se comporta como antes."
    comando: "node --test test/compuerta-no-aplicada.test.js"
congelado: {sha256: "d09ff45450d25c6f8480cf8173239d7929a46b5d7e24bbe1a15e0e34fd207a87", por: "autor-aceptacion", fecha: "2026-11-02T16:09:49+00:00"}
```

## Cierre (02/11/2026)

- Evidencia: `arn verificar` registró CA-1 a CA-15 en verde, todos con exit 0, en
  `clasificador-causa-comprobante/20261102T161345Z`. `npm test` dio 341 de 341, `ai/scripts/verify.sh`
  dio `VERIFY_PASS` con exit 0, y `arn aceptacion verificar` confirmó que el oráculo coincide.
- Juicio: `clasificador-causa-comprobante/juez-20261102T161440Z`, veredicto **APRUEBA**. Ese juez
  recibió el diff truncado por tope (`ARN-W072`).
- Juez independiente (opus, agente): **APROBADO CON OBSERVACIONES**. Ninguna observación bloquea. No
  cuenta para `arn cerrar`.
- `arn cerrar`: `cerrable: si`.
- Fuera de alcance (`Aparte`), notas de las revisiones:
  - N-2: un id pendiente se poda a los 7 días sin contador.
  - N-3: `detalle.Id` no se compara con el id pedido. Si Contabilium devolviera el mismo comprobante
    para dos ids, el crédito se acreditaría dos veces.
  - N-4: un 401 o 403 no corta el lote.
  - N-5: el presupuesto de espera es compartido entre los pares.
  - N-6: hay un hueco entre el checkpoint y un corte abrupto. Ya existía.
  - N-7: la libreta no se escribe de forma atómica. Ya existía.
  - N-8: una caché de comprobantes corrupta se descarta sin log.
  - Con `modo=locations` y la compuerta cargada, la corrida sale 0.
  - `--qty` acepta `0x10` y `1e2`.
  - La compuerta despachada con `dry_run=true` (el valor por defecto) solo simula.
  - El cuerpo de un error de Contabilium se loguea sin sanear `##[`.
  - Una carrera de unos 30 s entre la compuerta y una venta puede sumar +1 (R-7 lo permite).
