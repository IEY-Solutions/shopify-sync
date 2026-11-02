# Evidencia de aceptación — `clasificador-causa-comprobante` (diseño B)

Rol: `autor-aceptacion`. Todos los `CA-#` del contrato (`.agents/.arn/feature.md`) son
`tipo: mecanico`: la evidencia **es** el test que corre el `comando:` de cada uno. Los tests viven
en `test/` con el nombre exacto que pide cada comando (mismo criterio que
`deltas-dot-mas-isla-galerias`). No se tocó nada bajo `src/` ni `.github/`.

- Interfaz asumida: `DISENO-INTERFAZ.md` (reemplaza la del diseño de ventana temporal, retirado el
  02/11/2026).
- Rojo de esta ronda, qué se reescribió, qué es nuevo y qué se retiró: `rojo-2026-11-02.md`.
  La sección "Ronda 2 (02/11/2026)", al final, cubre los dos ajustes posteriores: `resembradoEn[sku]`
  (R-7/CA-7 ampliados; `DISENO-INTERFAZ.md` sección 4.1) y `ilegible` sin rojo permanente, con el
  contador nuevo `comprobantes_ilegibles` (CA-4; `DISENO-INTERFAZ.md` secciones 3 y 6).
  La sección "Ronda 3 (02/11/2026): hallazgos de revisor-alcance" cubre el texto nuevo de R-6, R-7,
  R-8 y R-13: podas alineadas por día ART, `definitivo` en el cliente real, `no_activado`/`ambiguo`,
  `syncUnSku` con `resembradoEn`, compuerta que llega al sync vía `main` (`src/main.js`), prefijos
  de SKU y motivo de solo espacios. Trae la tabla de implementación incorrecta contra el caso que
  la detecta y dos choques con el texto del contrato (CA-4 literal y R-8 "no consumidas").
  La sección "Ronda 4 (02/11/2026): última ronda antes de congelar" cierra los tres importantes de
  `revisor-alcance`: `syncUnSku` encerrado en el directorio temporal (encierro de `depsFake` más
  una guardia que hace lanzar cualquier escritura dentro del repo), la poda de consumos con la
  condición "sigue en la caché" probada sola (`dia` del comprobante recalculado al pasar a `ok`,
  poda de la caché al cargarse) y la forma exacta de `src/index.js`. Suma 401/403/422 no
  definitivos (CA-1) y más canales de consola en CA-4. No cambia el contrato.
  La sección "Ronda 5 (02/11/2026): revisión de código" viene después de que la persona
  descongelara el oráculo, con la implementación ya en `src/`. Suma cuatro cosas:
  - I-1, compuerta no aplicada en verde: R-15/CA-15 nuevos, `test/compuerta-no-aplicada.test.js`,
    `DISENO-INTERFAZ.md` 6.1.
  - N-9, `--qty` no entero: R-13/CA-13.
  - N-10, inyección de comandos de workflow con el motivo o el alcance: R-6/CA-6, con un control
    de comportamiento y `DISENO-INTERFAZ.md` 8.
  - El caso de `test/migracion-libreta-legada.test.js` movido a la cadena
    `index.js` → `main.js` → `sync.js` por decisión de la persona ("Mover el chequeo a main.js";
    R-14/CA-14).

  La sección trae la tabla de implementación incorrecta contra el caso que la detecta, el rojo
  esperado contra el `src/` actual y los choques revisados con grep.
  La sección "Ronda 5b: arreglo tras revisión de alcance" cierra los 3 importantes y las notas 4,
  5, 7 y 9 de `revisor-alcance`:
  - `main` tolera un veredicto sin `compuertaNoAplicados` (el doble de `index-argv` no se tocó).
  - En la compuerta solo se tolera `no_activado` en un par si el SKU se aplicó en otro (decisión del
    orquestador). `error`, `ambiguo` o `no_encontrado` donde estaba pedido es rojo. `compuertaSkus`
    suma `noActivados` (R-15/CA-15).
  - El formato viejo `##[` del runner entra en el simulador, en los payloads y en los arreglos
    aceptables (R-6/CA-6, R-15/CA-15). El simulador se comparte en
    `test/_helpers-comandos-workflow.js`.
  - El caso 8 de CA-15 acepta también el rechazo como error de uso (código 2).
  - El caso de migración suma el eslabón 4: el respaldo es el `correrTodosLosPares` importado
    (R-14/CA-14).
  - Las referencias viejas a `index.js` de `DISENO-INTERFAZ.md` quedan reescritas en términos de
    `main`.
- Historia de las rondas anteriores (diseño viejo): `rojo-2026-10-31.md`, `HISTORIAL.md`.

## Mapa CA → archivo de test

| CA | R | archivo(s) | estado |
|---|---|---|---|
| CA-1 | R-1 | `test/comprobantes-contabilium.test.js`, `test/sesion-contabilium.test.js` | reescrito + nuevo; ronda 3: `definitivo` en el cliente real (+5 casos); ronda 4: 401/403/422 no definitivos (+1 caso) |
| CA-2 | R-2 | `test/clasificador-causa.test.js` | reescrito |
| CA-3 | R-3 | `test/clasificador-costo-acotado.test.js` | reescrito |
| CA-4 | R-4 | `test/clasificador-huecos.test.js` | reescrito; ronda 2: `ilegible` sin rojo permanente (+2 casos); ronda 3: ninguna línea nombra un SKU de `causa_desconocida` (helper endurecido); ronda 4: captura también `info`/`debug`/`trace`/`dir` y `stdout`/`stderr` |
| CA-5 | R-5 | `test/regresion-censo-agosto.test.js` | reescrito (caso real 177960828); ronda 3: SKUs prefijo (+2 casos) |
| CA-6 | R-6 | `test/compuerta-manual-workflow.test.js` | reescrito (ejecuta el step con bash); ronda 3: `${{ env.* }}` y motivo de solo espacios (+2 casos); ronda 5: N-10, sin comandos de workflow inyectados por motivo o alcance (simulador del runner, +4 casos); ronda 5b: formato viejo `##[` (simulador compartido, payloads `##[error]`, +2 controles positivos) |
| CA-7 | R-7 | `test/compuerta-manual-absoluta.test.js` | reescrito; ronda 2: `resembradoEn` (+4 casos, a-d); ronda 3: tope, `/search` caído, `syncUnSku` (+4 casos, e-h); ronda 4: (g) y (h) encerrados en el directorio temporal |
| CA-8 | R-8 | `test/libreta-ledger-checkpoint.test.js`, `test/incremental-checkpoint-multi-par.test.js`, `test/sku-individual-usa-libreta-por-par.test.js` | nuevo + 3 casos reemplazados (D-7); ronda 3: podas alineadas, `no_activado`, `ambiguo` (+4 casos); ronda 4: condición "sigue en la caché" sola, `dia` recalculado, poda al cargar (+3 casos) |
| CA-9 | R-9 | `test/ventana-comprobantes.test.js` | reescrito |
| CA-10 | R-10 | `test/clasificador-modo-full.test.js` | reescrito (D-4: clasificador encendido) |
| CA-11 | R-11 | `test/ledger-primera-corrida.test.js` | nuevo |
| CA-12 | R-12 | `test/clasificador-falla-visible.test.js`, `test/resultado.test.js` | nuevo + extendido |
| CA-13 | R-13 | `test/index-argv.test.js` | nuevo; ronda 3: `main(argv, env, deps)` y delegación de `index.js` (+5 casos); ronda 4: forma exacta de `index.js` (+1 caso), `construirPares` registrado; ronda 5: N-9, `--qty` entero en valor (+3 casos) |
| CA-14 | R-14 | `npm test` (suite completa) + caso "ya no existe" en `test/libreta-ledger-checkpoint.test.js` | ver pendiente abajo; ronda 5: caso de `test/migracion-libreta-legada.test.js` movido a la cadena `index.js` → `main.js` → `sync.js` (segunda excepción de R-14); ronda 5b: eslabón 4 (el respaldo es el importado; `main.js` no menciona `ejecutarPar` ni `migrarLibretaLegada`) |
| CA-15 | R-15 | `test/compuerta-no-aplicada.test.js` | nuevo (ronda 5, I-1): compuerta no aplicada en rojo, en el modo por defecto y en `--full`; ronda 5b: solo se tolera `no_activado` (+4 escenarios `error`/`ambiguo` en el DOT, +5 casos puros), `compuertaSkus.noActivados`, caso 8 con `##[` y con la alternativa "error de uso" |

Segundo helper (ronda 5b, sin `.test.js`): `test/_helpers-comandos-workflow.js`, el simulador del
parser de comandos del runner de GitHub (formato `::` y formato viejo `##[`), con las líneas de
`actions/runner` de las que sale el modelo. Lo usan CA-6 y el caso 8 de CA-15.

Helper compartido (sin `.test.js`, no corre como suite): `test/_helpers-clasificador.js`, reescrito
para B. Trae el comprobante real 177960828 tal como lo verificó la persona, un reloj fijable
(`deps.ahora`), un `conDirTemporal` **asíncrono** (el anterior borraba el directorio en el primer
`await`), los fakes de `ejecutarPar` con contadores separados de invocaciones y de ids, y lectores
de los archivos crudos en disco.

## Pendiente que no pude hacer (sin Bash)

~~`test/libreta-ultima-corrida-exitosa.test.js` sigue en el árbol.~~ Resuelto: el orquestador
verificó con Bash que el archivo ya no existe y que nunca estuvo en git, así que no hace falta
`git rm`.

Sigue pendiente correr la ronda 4 con Bash (comandos al final de `rojo-2026-11-02.md`) y confirmar
que `.cache/last-sync.dot.json` no cambia al correr la suite.

Ronda 5: el orquestador confirmó con Bash el rojo inferido (330 tests, 308 pass, 22 fail).

Ronda 5b: falta confirmar con Bash el rojo inferido (341 tests, 311 pass, 30 fail; comandos al
final de la sección "Ronda 5b"), correr `arn feature validar` sobre el contrato ampliado y volver a
congelar después de `revisor-alcance`.

## Cómo se protegió cada oráculo contra una implementación incorrecta

Ver la tabla "implementación incorrecta → test que la detecta" en `rojo-2026-11-02.md`.
