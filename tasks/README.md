# Tareas — `sku-universal-multivarianta`

Descomposición de la feature congelada en `.agents/.arn/feature.md` (R-1 a R-19, CA-1 a CA-14,
`congelado.sha256 fd967fe4…2130`). La evidencia está en `aceptacion/sku-universal-multivarianta/`.
Ni el contrato ni la evidencia se editan en ninguna tarea.

## Formato (supuesto, no había uno previo en el repo)

`tasks/` estaba vacío (solo `.gitkeep`) y ningún documento del repo define tareas `T#`. Cada
archivo `T##-*.md` lleva lo que piden `.claude/agents/implementador.md` y la skill
`contrato-especialista`: archivos permitidos, `CA-#`, contexto, presupuesto, dificultad y gate.

Reglas comunes a todas las tareas:

- **Gate de cada tarea:** `npm test` (línea `test:` de `AGENTS.md`) en verde, más los comandos de
  `CA-#` o de test de apoyo que la tarea indique. Un intento es un cambio más una corrida del gate.
- **Los tests de los CA no existen todavía.** Cada tarea escribe su archivo de test **primero**.
  Copia los números, ids y líneas literales de los escenarios citados, sin inventar casos más
  débiles. Si un escenario contradice el contrato, se anota en Dudas y no se elige solo.
- **Solo lectura siempre:** `.agents/.arn/feature.md`, `aceptacion/**`, `src/main.js`, `src/argv.js`,
  `src/resultado.js`, `src/pares.js`, `.github/**`, `.env` (que nunca se lee).
- **Archivos permitidos:** solo los que lista cada tarea. Cualquier otro necesario va en `Dudas`
  y la tarea queda `Bloqueado`.
- `test/_helpers-sku-universal.js` es un helper compartido de fixtures (variantes V1…V5, pares,
  consulta y mutación inyectadas). Se crea en T03; las tareas siguientes solo **agregan**
  exportaciones y no cambian la semántica de las que ya existen.
- Nunca se debilita, saltea (`skip`, `todo`, `only`) ni borra un test existente (AGENTS.md).
- Todas las tareas tocan `src/sync.js` o `src/shopify.js`: **van en serie, en este orden.** No
  hay paralelismo posible sin conflictos.
- Hasta T14 la feature no se despliega: entre T03 y T13 los 7 SKUs curados pasan por estados
  intermedios. Después de T02 ningún test existente usa un SKU curado, así que el resto de la
  suite no se ve afectado.

## Secuencia

| T# | Resumen | R-# | CA-# | Dificultad | Intentos | Depende de |
|---|---|---|---|---|---|---|
| [T01](T01-lista-curada.md) | Constante exportada con los 7 pares `{sku, variantes}` y pertenencia por string exacto | R-1 | CA-1 | fácil | 2 | — |
| [T02](T02-migracion-fixture.md) | Migrar `SKU_APPLYFIT` y sus usos a `IEY-COMBO-CARBON-VERDE-IP16E` sin tocar aserciones | R-15, R-9 | CA-10 (+ CA-6 parcial) | fácil | 2 | T01 |
| [T03](T03-resolucion-multivariante.md) | `src/shopify.js`: la búsqueda exacta devuelve las N variantes de un curado, control de conteo esperado, nunca `SkuAmbiguoError` | R-2, R-7, R-6 | apoyo (subcasos de CA-2 F1-F4 y CA-14 D) | media | 2 | T02 |
| [T04](T04-calculo-unico.md) | Función pura: tres caminos de R-4, doble piso 0, crédito sumado una vez, `null` excluido | R-3, R-4 | apoyo (ejemplos normativos de R-4, CA-2, CA-3) | media | 2 | T01 |
| [T05](T05-libreta-pendiente-escrito.md) | Libreta: campos opcionales `pendiente` y `escrito`, persistencia inmediata, no pisados por checkpoint/final/`--full`, descarte de mal formados | R-10, R-13 (forma) | apoyo (CA-7 §9, CA-9 §8) | media | 2 | T01 |
| [T06](T06-camino-universal-ejecutarpar.md) | `ejecutarPar` sin pendiente previo: journal antes de mutar, N escrituras, resolución única, `escrito`, destino más chico, sin siembra por `cambioDeDestino`, bypass del atajo | R-2, R-3, R-4, R-5, R-7, R-9, R-10, R-13, R-14 | CA-2, CA-3 | difícil | 3 | T03, T04, T05 |
| [T07](T07-reintento-pendiente.md) | Reintento del mismo `nuevoValor` por variante (a)/(b)/(c), crash, variantes de más o de menos, atajo y `--full` | R-11, R-10, R-5 | CA-7 | difícil | 3 | T06 |
| [T08](T08-contabilium-durante-pendiente-y-escrito.md) | Cierre del pendiente al `contabiliumObjetivo` y cadena `escrito` + bypass | R-12, R-13, R-14 | CA-8, CA-9 | media | 2 | T07 |
| [T09](T09-no-regresion-y-resumen.md) | Línea `[UNIVERSAL]` (3 formas + `[reintento]`), claves `universales`/`universales_pendientes`, no-regresión de duplicados no curados | R-8, R-6 | CA-4, CA-5 | media | 2 | T08 |
| [T10](T10-pendiente-credito-siembra.md) | Pendiente con crédito o siembra marcado "requiere compuerta", no se reintenta solo | R-17 | CA-12 §1-§4 | media | 2 | T09 |
| [T11](T11-variante-no-activada.md) | Variante no activada: caso (a) benigno, caso (b) error, en la corrida normal | R-18 | CA-13 (todo menos A-3.2) | media | 2 | T10 |
| [T12](T12-compuerta-multivariante.md) | Compuerta `ESCRITURA_ABSOLUTA` en las N variantes, con prioridad sobre el journal, consumo de crédito y `resembradoEn` | R-16 (+ R-17, R-18 bajo compuerta) | CA-11, CA-12 §5, CA-13 A-3.2 | difícil | 3 | T11 |
| [T13](T13-sku-puntual.md) | `--sku` (`syncUnSku`/`procesarSku`) por el mismo camino universal; lanza si un curado queda sin resolver | R-19 (+ R-1 controles F) | CA-14 | difícil | 3 | T11 |
| [T14](T14-pasada-final.md) | Corrida completa de los 14 CA y de `npm test`, sin editar nada | R-9, R-15 | CA-6 (y los 14 juntos) | fácil | 1 | T01-T13 |

## Cobertura R-# → T#

| R | T# |
|---|---|
| R-1 | T01, T13 (controles de prefijo y extensión por `--sku`) |
| R-2 | T03, T06, T13 |
| R-3 | T04, T06 |
| R-4 | T04, T06 (incluye la excepción de `cambioDeDestino`) |
| R-5 | T06, T07 |
| R-6 | T03 (no cambia la resolución), T09 (CA-4) |
| R-7 | T03, T06 |
| R-8 | T09 (los `[ERROR]` con prefijo `<par>/<sku>` ya nacen así en T06, T07, T10 y T11) |
| R-9 | T02, T06, T14 |
| R-10 | T05, T06, T07 |
| R-11 | T07 |
| R-12 | T08 |
| R-13 | T05, T06, T08 |
| R-14 | T06, T08 |
| R-15 | T02, T14 |
| R-16 | T12 |
| R-17 | T10, T12 |
| R-18 | T11, T12 |
| R-19 | T13 |

## Departamento

Uno solo: backend / middleware de sincronización (`src/shopify.js`, `src/sync.js`, `test/*`).
