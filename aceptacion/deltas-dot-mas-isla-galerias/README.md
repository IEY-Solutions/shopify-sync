# Evidencia de aceptación — `deltas-dot-mas-isla-galerias`

Rol: `autor-aceptacion`. Esta carpeta es la evidencia que exige `contrato-feature` (paso 1 del
"ciclo del oráculo"). Todos los `CA-#` del contrato son `tipo: mecanico`, así que la evidencia
**es** el test que corre el `comando:` de cada uno — no hay un artefacto separado que "representar"
acá. Por eso:

- Los tests NUEVOS se escribieron **directamente en `test/*.test.js`**, con el mismo nombre de
  archivo que cada `comando:` del contrato, porque `arn verificar`/`node --test` necesitan que el
  archivo exista exactamente en esa ruta para poder ejecutarlo. Duplicarlos acá adentro (en
  `aceptacion/deltas-dot-mas-isla-galerias/test/...`) sería una segunda fuente de verdad que se
  desincroniza del archivo real la primera vez que alguien lo edite; en cambio, el repo YA tiene la
  convención de que los tests viven en `test/` (los 8 archivos `test/*.test.js` preexistentes), así
  que seguirla es "sin ver código nuevo de implementación" (no toqué nada bajo `src/`) sin inventar
  una convención nueva de carpetas.
- Esta carpeta (`aceptacion/deltas-dot-mas-isla-galerias/`) contiene el **índice** que mapea cada
  `CA-#` a su archivo, el **diseño de interfaz asumido** que el implementador tiene que seguir (ver
  `DISENO-INTERFAZ.md`), y el **log de la corrida en rojo** contra el código actual (ver
  `rojo-2026-10-29.md`), que es la prueba de que el oráculo mide algo real y no un criterio
  ya satisfecho o roto.

## Índice CA → archivo → estado

| CA | archivo | acción tomada |
|---|---|---|
| CA-1 | `test/sync-deltas.test.js` | nuevo |
| CA-2 | `test/multi-par.test.js` + `test/orquestacion-pares.test.js` | `multi-par.test.js` nuevo (funciones puras); `orquestacion-pares.test.js` **nuevo en esta ronda** (orquestación real, ver abajo) |
| CA-3 | `test/libreta-multi-location.test.js` + `test/orquestacion-pares.test.js` | `libreta-multi-location.test.js` nuevo; `orquestacion-pares.test.js` agrega el ángulo de dos pares vía `ejecutarPar`, no solo vía `guardarSnapshot` directo |
| CA-4 | `test/no-tocar-central.test.js` | nuevo |
| CA-5 | `test/sku-match.test.js` | **extendido post-juez** (ver "Arreglo post-juez" abajo) |
| CA-6 | `test/cantidades-enteras.test.js` | nuevo |
| CA-7 | `test/libreta.test.js` + `test/orquestacion-pares.test.js` | `libreta.test.js` sin cambios (ya alcanzaba para I/O de un archivo); `orquestacion-pares.test.js` **agregado en esta ronda** para cubrir la regla de negocio real (el marcado/desmarcado del loop, no solo el I/O — ver "Por qué CA-7..." abajo); **pendiente de decisión de la persona sobre el `comando:` de CA-7** (ver "Arreglo post-juez") |
| CA-8 | `test/resultado.test.js` + `test/workflow.test.js` | `resultado.test.js` **extendido** (casos agregados al final, nada reescrito); `workflow.test.js` sin cambios |
| CA-9 | `test/regresion-h3-absoluto.test.js` | nuevo; **extendido post-juez** (ver "Arreglo post-juez" abajo) |
| CA-10 | `test/par-isla-pendiente.test.js` + `test/orquestacion-pares.test.js` | `par-isla-pendiente.test.js` **extendido en esta ronda** con el caso de fuga del hallazgo bloqueante 1 (spy que falla si un par pendiente llama a Shopify); `orquestacion-pares.test.js` repite esa propiedad a nivel de integración con dos pares |

## Ronda 2 (2026-10-29) — correcciones pedidas por `revisor-alcance`

Ver `rojo-2026-10-29.md`, apartado "Ronda 2", para el detalle de qué cambió y por qué: un
hallazgo bloqueante sobre un default peligroso en `locationId` (sección 3 de
`DISENO-INTERFAZ.md`), un hallazgo bloqueante sobre la falta de un test de orquestación real
(`test/orquestacion-pares.test.js`, nuevo, y la función `ejecutarPar` que ese test exige —
sección 7 de `DISENO-INTERFAZ.md`), y un hallazgo importante sobre CA-7/R-7 (cubierto ahora
también por `orquestacion-pares.test.js`, caso (c)).

### Por qué CA-5 (`test/sku-match.test.js`) no se tocó

El texto de R-5/CA-5 pide que la coincidencia de SKU "sku:\"...\" entre comillas y verificación del
sku devuelto" valga para todos los pares, no solo el DOT. La función que hace esa verificación,
`elegirVarianteExacta(edges, sku)`, y el escapado, `escaparValorBusqueda`, son **puras y no reciben
ni usan ningún locationId ni depositoId**: deciden exclusivamente a partir de los `edges` que ya
llegaron de Shopify y del string del SKU. No tienen ninguna noción de "para qué par" se está
resolviendo, así que no hay nada específico de multi-par que puedan romper ni que agregarles.  Lo
que sí es específico de multi-par es *con qué locationId* se pide la query (eso vive en
`buscarVariantePorSku`/`leerStockActual`, no en `elegirVarianteExacta`), y eso está cubierto por
`test/multi-par.test.js` (CA-2), que es donde corresponde.

### Por qué CA-7 (`test/libreta.test.js`) no se tocó, y por qué eso NO alcanzaba (corregido en la ronda 2)

`parsearLibreta`, `parsearSnapshotContabilium`, `cargarSnapshot`, `cargarLibretaCompleta` y
`guardarSnapshot` ya reciben la ruta del archivo como parámetro explícito (`ruta = SNAPSHOT_PATH`
con default, pero sobreescribible). Son multi-location "gratis" **para el I/O**: correr el mismo
test con dos rutas de archivo temporal distintas (como ya hace `conDirTemporal`) demuestra que un
archivo no pisa a otro, simplemente porque son archivos distintos. `test/libreta-multi-location.test.js`
(CA-3) ya cubría ese ángulo de I/O.

Lo que la ronda 1 tenía débil (hallazgo importante de `revisor-alcance`): la regla de negocio real
de R-7 — "un SKU no resuelto nunca se marca como resuelto" — no vive en `guardarSnapshot`/
`cargarLibretaCompleta` (que solo leen y escriben lo que se les pasa), vive en la lógica de
marcado/desmarcado del loop (hoy `syncTodos`, `src/sync.js:269-283`: `if (resultado === "actualizado"
|| resultado === "sin_cambios") snapshotNuevo[sku] = cantidad; else delete snapshotNuevo[sku]`).
Ningún test corría esa decisión con DOS pares en la misma invocación. `test/orquestacion-pares.test.js`
(caso (c), agregado en esta ronda) corre `ejecutarPar` para un par donde un SKU compartido SÍ se
resuelve y otro donde el MISMO SKU no se resuelve, y confirma que el snapshot de cada par queda
marcado de forma independiente del otro.

### Por qué `resultado.test.js` se extendió y no se reescribió (CA-8)

El archivo ya cubre al 100% la regla de "una corrida sin escrituras no sale en 0" para **un** resumen
(`evaluarCorrida`). Lo que falta para multi-par es la regla de agregación: con dos pares, ¿cuándo el
conjunto completo puede salir en verde? Se agregaron casos al final del archivo (sin tocar los
existentes) que ejercitan una función nueva, `evaluarCorridaMultiPar`, que se describe en
`DISENO-INTERFAZ.md`.

## Ronda 3 (2026-10-29) — R-10/CA-11, R-11/CA-12, R-12/CA-13

Tres requisitos nuevos, agregados por `revisor-codigo` sobre `ejecutarPar`, que **ya existe** en
`src/sync.js` (a diferencia de las rondas 1 y 2, donde todo era hipotético): la función no respeta
`DRY_RUN`, no migra la libreta legada del DOT, y no tiene ni atajo incremental ni checkpointing.
Ver `DISENO-INTERFAZ.md`, sección "Ronda 3", para la interfaz asumida de cada uno.

| CA | archivo | acción tomada |
|---|---|---|
| CA-11 | `test/dry-run-multi-par.test.js` | nuevo |
| CA-12 | `test/migracion-libreta-legada.test.js` | nuevo; **corregido** tras hallazgo de `revisor-alcance` (ver abajo) |
| CA-13 | `test/incremental-checkpoint-multi-par.test.js` | nuevo; **corregido** tras hallazgo de `revisor-alcance` (ver abajo) |

Ver `rojo-2026-10-29.md`, apartado "Ronda 3", para el detalle del rojo (por inferencia estática,
sin Bash en esta sesión, igual que las rondas 1 y 2).

### Corrección de CA-12 — el entrypoint real tiene que migrar por sí solo

`revisor-alcance` encontró que la versión original de `test/migracion-libreta-legada.test.js`
probaba bien `migrarLibretaLegada` aislada y el flujo completo de `ejecutarPar` llamado **a mano**
después de migrar a mano, pero nunca el entrypoint real (`src/index.js`, el loop que corre todos
los pares): un implementador podía hacer pasar el test sin tocar `index.js` en absoluto,
reproduciendo el bug real de R-11 en producción.

**Corrección:** el loop de orquestación (antes local, no exportado, dentro de `src/index.js`) se
extrae a `src/sync.js` como `correrTodosLosPares(pares, deps)` exportada — mismo patrón que ya se
usó para sacar `ejecutarPar` de `index.js`. Es `correrTodosLosPares` quien llama
`migrarLibretaLegada` para el par `"dot"`, antes de `ejecutarPar(dot, ...)`. `src/index.js` queda
reducido a un wrapper que arma `pares`/`deps` desde `process.argv`/`process.env` y llama a
`correrTodosLosPares`. Se agregó un caso nuevo al test que importa y ejercita
`correrTodosLosPares` de punta a punta, con un archivo legado real en un directorio temporal, y
confirma la migración **sin** que el test invoque `migrarLibretaLegada` a mano. Ver
`DISENO-INTERFAZ.md`, sección "Ronda 3" / R-11/CA-12, "Dónde se llama", para el detalle completo.

### Última corrección de CA-12 — fitness function contra la duplicada de `index.js`

`revisor-alcance` encontró (confirmado con `grep`) que el caso de punta a punta agregado en la
corrección anterior importa y ejercita `correrTodosLosPares` **desde `src/sync.js`**, pero
`src/index.js` sigue teniendo su propia función local `correrTodosLosPares` (líneas 22-28, no
exportada, sin parámetros), que es la que literalmente corre en producción
(`src/index.js:142`, `correrTodosLosPares().then(...)`). Un implementador podía agregar
`correrTodosLosPares` a `sync.js` para poner ese caso en verde sin tocar `index.js` en absoluto, y
el bug de R-11 seguiría vivo en producción.

**Corrección (última ronda permitida sobre CA-12):** se agregaron dos tests al final de
`test/migracion-libreta-legada.test.js` que leen el texto fuente de `src/index.js` con
`readFileSync` (sin importarlo ni ejecutarlo, porque cargar `index.js` dispara su modo real contra
argv/env/red reales) y verifican, por regex sobre ese texto: (1) que `index.js` importa
`correrTodosLosPares` desde `"./sync.js"`; (2) que `index.js` no declara su propia
`function`/`const correrTodosLosPares` local. Ver `DISENO-INTERFAZ.md`, sección "Ronda 3" /
R-11/CA-12, apartado "Última ronda de arreglo", para el detalle completo y por qué es un chequeo
de texto fuente y no de ejecución.

### Corrección de CA-13 — el checkpoint se verifica por contenido, no solo por conteo

`revisor-alcance` encontró que el caso de checkpoint periódico original solo contaba
`llamadas.guardarSnapshot.length > 1`, sin mirar nunca el contenido de una llamada intermedia —
dado el antecedente de H3 (corridas en verde que en realidad no habían guardado nada real), eso
no alcanzaba. Se extendió el caso para capturar el contenido (no solo el conteo) de cada llamada
a `guardarSnapshot`, y confirmar que la llamada intermedia tiene exactamente los SKUs procesados
hasta ese punto con sus valores correctos (ni vacía, ni con el snapshot final adelantado, ni con
SKUs de otro par). Se agregó además un caso de interrupción real: el checkpoint mismo falla al
escribir en su segunda invocación (IO real, directorio temporal), y el test confirma, leyendo el
archivo **del disco**, que el primer checkpoint exitoso sigue persistido. Ver
`DISENO-INTERFAZ.md`, sección "Ronda 3" / R-12/CA-13, para el detalle completo.

## Arreglo post-juez (2026-10-29)

El juez rechazó el cierre del contrato por tres criterios cuyo oráculo no evidenciaba de verdad lo
que el `texto:` del `CA-#` dice probar. La implementación en `src/` ya era correcta (confirmado por
`revisor-codigo` en rondas anteriores); el problema era exclusivamente del diseño del test. Se
tocó solo `test/`, nada bajo `src/`.

### CA-5 — coincidencia de SKU para un par que no es el DOT

Veredicto del juez: *"ningún caso ejercita un par distinto del DOT [...] la evidencia citada no lo
demuestra."* Como ya se explicaba arriba ("Por qué CA-5 no se tocó"), `elegirVarianteExacta` es pura
y no toma `locationId`, así que ningún caso sobre ella puede, por diseño, demostrar nada
multi-location — el análisis de la ronda 2 identificó correctamente la función equivocada para
probar esto, y de ahí el rechazo del juez.

Se agregó a `test/sku-match.test.js` un caso que llama a `buscarVariantePorSku(sku, locationId)` —
la función real que sí recibe `locationId` sin default y que un par no-DOT usa para resolver un
SKU — con un `locationId` de una isla (`gid://shopify/Location/99988877766`, distinto del DOT). Se
mockeó `globalThis.fetch` (único punto de red real del módulo) con un fixture donde el mismo SKU
(`IEY-103-NEGRO`) tiene `available` distinto en las dos locations (10 en el DOT, 4 en la isla), y se
confirma que pedir la isla devuelve 4 y pedir el DOT devuelve 10 — o sea, que la resolución no se
confunde de location. Si `buscarVariantePorSku` ignorara el `locationId` recibido y siempre
preguntara por el DOT, este caso fallaría (ambas llamadas devolverían 10).

### CA-9 — regresión de H3 por el camino real de escritura

Veredicto del juez: *"solo ejercita la función pura calcularEscritura [...] si procesarSku o
ejecutarPar volvieran a escribir el absoluto de Contabilium [...] los tres casos seguirían en
verde."*

Se agregó a `test/regresion-h3-absoluto.test.js` un caso que corre `ejecutarPar` (el camino real)
con un `deps.setearStock` espía y el resto de las `deps` fakeadas en memoria, reproduciendo el
escenario de H3: baseline previo = 10, Contabilium ahora en 12 (reposición), Shopify ya en 8 (venta
web en el medio). El delta correcto es `8 + (12-10) = 10`. El caso confirma que `setearStock` se
llama con `quantity = 10` (el resultado de `calcularEscritura`) y no con `12` (el valor crudo de
Contabilium). Si `ejecutarPar` pasara `cantidad` en lugar de `nuevoValor` a `deps.setearStock`, la
aserción `quantity === 10` fallaría (el valor real pasado sería `12`).

### CA-7 — decisión pendiente de la persona sobre el `comando:`

Veredicto del juez: *"el README dice que la cobertura de dos pares está en
`test/orquestacion-pares.test.js`, pero ese archivo no es el comando de CA-7 y no se corrió en este
cierre."* Es correcto: el caso (c) de `test/orquestacion-pares.test.js` (de la ronda 2) ya cubre la
regla de negocio real de R-7 con dos pares reales compartiendo un SKU, uno resuelto y otro no — pero
el `comando:` de `CA-7` en el contrato solo corre `test/libreta.test.js`.

No se puede resolver solo con `test/`: el campo `comando:` del contrato lo edita la persona. La
recomendación de este rol es la opción **(a)**: ampliar el `comando:` de `CA-7` al mismo patrón que
ya usa `CA-8` con dos archivos, en vez de **(b)** duplicar el caso dentro de `test/libreta.test.js`.
Motivo: `test/libreta.test.js` prueba la IO pura de la libreta (un archivo, una ruta) y
`test/orquestacion-pares.test.js` prueba la regla de negocio del loop con dos pares reales — son dos
niveles de prueba distintos y duplicar el caso (b) lo desincroniza la primera vez que alguien edite
uno de los dos archivos sin acordarse del otro, igual que advierte este mismo README sobre no
duplicar tests en `aceptacion/`.

**`comando:` nuevo propuesto para CA-7** (string exacto, mismo patrón que CA-8):

```
node --test test/libreta.test.js test/orquestacion-pares.test.js
```

## Segundo rechazo del juez (2026-10-29) — CA-7 y CA-13, bug real sin detectar

Con el `comando:` de CA-7 ya ampliado (ver arriba), el juez rechazó de nuevo el cierre por un bug
real en el baseline de `contabilium` que ningún caso existente ejercitaba. Ver
`rojo-2026-10-29.md`, apartado "Segundo rechazo del juez", para el veredicto textual completo y el
detalle de por qué ningún caso anterior lo detectaba.

Resumen del veredicto: un SKU `no_activado`/`no_encontrado` no puede dejar un baseline de
`contabilium` (certifica "esto ya se escribió en Shopify" y nunca se escribió); y el checkpoint
periódico no puede persistir como baseline el stock completo de Contabilium, solo lo efectivamente
procesado hasta el corte — si no, el trabajo pendiente de una corrida interrumpida se pierde para
siempre (se ve como delta 0 y se marca resuelto sin escribirse).

Se agregaron, **sin tocar nada bajo `src/`**:

- `test/orquestacion-pares.test.js`, caso (d): secuencia de dos corridas (N: `no_activado` con
  Contabilium=10; N+1: se activa con `available=0`, Contabilium sigue en 10) — confirma que la
  corrida N no deja baseline de `contabilium`, y que la N+1 escribe 10 (sembrado), nunca
  `sin_cambios`.
- `test/orquestacion-pares.test.js`, caso (e) (borde): un SKU con baseline previo que se desactiva
  — el baseline viejo se conserva intacto, no se pisa con el valor nuevo de Contabilium (nunca
  escrito).
- `test/incremental-checkpoint-multi-par.test.js`, caso (c-ter): checkpoint periódico interrumpido
  a mitad de camino — leyendo el archivo en disco, el baseline de `contabilium` tiene exactamente
  los SKUs procesados hasta el corte, nunca el stock completo ni los SKUs todavía no alcanzados.

Mismo límite que el resto de esta carpeta: sin Bash en esta sesión, no se pudo confirmar el rojo
contra el código que el juez vio ni el verde contra un fix en curso (instrucción explícita de no
mirar `src/`). Queda para quien tenga Bash.

## Cuarto rechazo del juez (2026-10-29) — CA-1 y CA-12, dos caminos de escritura sin cubrir

El juez rechazó el cierre por cuarta vez (contrato descongelado). A diferencia de los rechazos
anteriores, esta vez los dos hallazgos son sobre caminos de escritura que ningún caso anterior
ejercitaba, no sobre debilidad del oráculo de un caso existente. Veredicto textual:

> *"CA-1 no cumple: El modo `--sku` (syncUnSku) sigue tomando la línea base de la libreta legada
> `.cache/last-sync.json`. Desde la migración, ese archivo ya no avanza [...] Con `DRY_RUN=false` eso
> escribe en la location real."*
>
> *"CA-12 no cumple: `migrarLibretaLegada` copia tal cual el campo `contabilium` legado [...]
> incluidos los SKU `no_encontrado`, `no_activado`, `error` o `ambiguo` y los que un checkpoint
> todavía no había alcanzado. Después de migrar, esos SKU heredan como base un valor que nunca se
> escribió en Shopify [...] quedan 'sin_cambios' y se marcan resueltos sin escribirse."*

### Por qué ningún caso anterior lo detectaba

- Todos los casos existentes de `test/migracion-libreta-legada.test.js` migraban SKUs que tenían
  entrada en `skus` Y en `contabilium` del legado a la vez (el caso "feliz"). Ninguno probaba un SKU
  con entrada SOLO en `contabilium` (el caso real de un `no_encontrado`/`no_activado`/`error`/
  `ambiguo`, o de un SKU que un checkpoint todavía no había alcanzado antes de la migración): la
  copia "tal cual" del legado pasaba inadvertida porque nunca se la ejercitó con ese shape.
- `syncUnSku` (modo `--sku`, el único camino de escritura del DOT que puede correr con
  `DRY_RUN=false` fuera de `correrTodosLosPares`/`ejecutarPar`) no tenía ningún test propio: todos
  los casos de baseline por-par existentes (`test/migracion-libreta-legada.test.js`,
  `test/orquestacion-pares.test.js`, `test/incremental-checkpoint-multi-par.test.js`) ejercitan
  `ejecutarPar`/`correrTodosLosPares`, nunca `syncUnSku`.

### Casos nuevos agregados (sin tocar `src/`)

| caso | archivo | qué prueba |
|---|---|---|
| CA-1 | `test/sku-individual-usa-libreta-por-par.test.js` (nuevo) | monta la libreta LEGADA con baseline=10 y la libreta POR-PAR del DOT con baseline=15 (ambas en disco real, con backup/restore); llama `syncUnSku(sku, 17)` con `DRY_RUN=false` y Shopify mockeado via `fetch` (`available=8`); confirma que la escritura real usa `quantity=10` (delta contra el baseline POR-PAR), nunca `quantity=15` (delta contra el legado) |
| CA-12 | `test/migracion-libreta-legada.test.js` (caso nuevo) | legado con un SKU `CONFIRMADO` (entrada en `skus` Y `contabilium`) y un SKU `NUNCA-ESCRITO` (solo en `contabilium`, sin entrada en `skus`); tras `migrarLibretaLegada`, `CONFIRMADO` se migra normal y `NUNCA-ESCRITO` NO aparece en el `contabilium` de la libreta nueva |

`syncUnSku` no acepta `deps` como `ejecutarPar`: lee las libretas reales por su ruta real en
`.cache/`, así que el caso de CA-1 escribe/restaura esos dos archivos reales con backup explícito
(no un directorio temporal) y mockea `globalThis.fetch` para el OAuth y el GraphQL de Shopify, con
el mismo patrón que ya usan `test/sku-match.test.js` y `test/contabilium.test.js`. Contabilium se
evita por completo pasando la cantidad a mano (`manualQty`, el modo `--sku ... --qty N` ya
documentado en `package.json`/`src/index.js`), para aislar exclusivamente cuál libreta usa.

**Mismo límite que el resto de esta carpeta:** sin `Bash` en esta sesión, no se pudo confirmar el
rojo contra el código que el juez vio al rechazar, ni el verde contra un fix en curso (instrucción
explícita de no mirar `src/sync.js` para no acoplar el diseño del test al fix). Ver
`rojo-2026-10-29.md`, apartado "Cuarto rechazo del juez", para el detalle de qué se leyó por grep
para diseñar el caso sin ver el cuerpo de las funciones en reparación.

## Quinto rechazo del juez (2026-10-29) — CA-1, CA-2 y CA-4, oráculo que no ejercita el camino real

El juez rechazó el cierre por quinta vez (contrato ya descongelado). Los tres hallazgos son sobre
el mismo patrón: el oráculo existente ejercita una función que **no** es el camino que corre en
producción. Veredicto textual:

> *"CA-1 no cumple: [...] syncUnSku [...] escribe pero no persiste la libreta [...] en la corrida
> siguiente [...] vuelve a aplicar el mismo delta [...] Ningún comando de CA-1 ejercita ese
> camino."*
>
> *"CA-2 no cumple: [...] armarPlanDeEscritura [...] no la llama ningún camino de producción [...]
> El comando de CA-2 no corre dos pares por el camino real de escritura."*
>
> *"CA-4 no cumple: [...] La parte que alimenta un stock [...] ejercita armarPlanDeEscritura, que
> es código muerto en producción. El input real se arma en ejecutarPar → setearStock →
> construirInputSet. [...] no recibe ningún stock como pide el criterio."*

### Por qué ningún caso anterior lo detectaba

- El caso de CA-1 (4to rechazo) confirmaba que `syncUnSku` **lee** el baseline correcto (por-par),
  pero nunca confirmaba que, después de escribir, ese mismo archivo quedara **actualizado**. Un
  `syncUnSku` que escribe en Shopify pero no persiste (o persiste mal) la libreta por-par pasa
  inadvertido con ese caso, y recién se manifiesta en la corrida siguiente, que ningún caso corría.
- Todos los casos de CA-2 (`test/multi-par.test.js`) y CA-4 (`test/no-tocar-central.test.js`)
  llamaban `armarPlanDeEscritura` directamente — una función pura que ningún camino de producción
  invoca (`ejecutarPar` arma el input real con `calcularEscritura` + `construirInputSet`, no con
  `armarPlanDeEscritura`). Un bug introducido en el camino real (`ejecutarPar`/`setearStock`/
  `construirInputSet`) podía dejar estos casos en verde sin que la producción estuviera resuelta.

### Casos nuevos agregados (sin tocar `src/`)

| caso | archivo | qué prueba |
|---|---|---|
| CA-1 | `test/sku-individual-usa-libreta-por-par.test.js` (caso nuevo) | tras `syncUnSku(sku, 20)` con `DRY_RUN=false` y sin baseline previo (sembrado), lee del disco real `rutaSnapshotPara("dot")` y confirma que `skus[sku]` y `contabilium[sku]` quedaron en 20; después simula "la corrida siguiente" con `ejecutarPar` real (deps fake, mismo Contabilium=20, Shopify ya en 20) y confirma `sin_cambios=1` y **cero** llamadas a `setearStock` |
| CA-2 | `test/multi-par.test.js` (caso nuevo) | corre `ejecutarPar` real para los dos pares de fixture en una sola invocación, con deps fake y un spy de `setearStock`, y confirma que cada par escribe exclusivamente con su propio `locationId`, nunca mezclado con el del otro |
| CA-4 | `test/no-tocar-central.test.js` (dos casos reemplazados) | se quitaron los dos casos que llamaban `armarPlanDeEscritura` directo; se agregó un caso que corre `ejecutarPar` real para DOT e isla con un fixture que incluye un SKU "también en CENTRAL" (bajo un `depositoId` hipotético de CENTRAL) y confirma que ningún `setearStock` ni `getStockDeposito` del camino real se llama jamás con el `locationId`/`depositoId` de CENTRAL; se mantuvo, reescrito sobre `ejecutarPar`, el caso del par con `locationId: null` (hueco de datos) que no debe rellenarse con CENTRAL |

`armarPlanDeEscritura` sigue teniendo sus casos originales en `test/multi-par.test.js` (prueban una
propiedad real de esa función pura), pero ya no son la única evidencia de CA-2/CA-4: ahora el
`comando:` de esos CA también ejercita `ejecutarPar`, el camino real.

**Mismo límite que el resto de esta carpeta:** sin `Bash` en esta sesión, no se pudo confirmar el
rojo contra el código que el juez vio al rechazar, ni el verde contra el fix en curso en paralelo
(instrucción explícita de no mirar `src/` más de lo necesario para conocer la interfaz pública ya
usada por `test/orquestacion-pares.test.js`: `ejecutarPar(par, deps)`, `construirPares(env)`,
`rutaSnapshotPara(stateKey, dir?)`, `cargarLibretaCompleta(ruta)`, `guardarSnapshot(snap, ruta,
contabilium)`). Ver `rojo-2026-10-29.md`, apartado "Quinto rechazo del juez", para el detalle.

## Qué corrí para confirmar el rojo

Ver `rojo-2026-10-29.md`: la salida real de `node --test` sobre cada archivo nuevo/extendido, contra
el código actual (sin ningún cambio en `src/*.js`). Todos fallan hoy, como tienen que fallar.
