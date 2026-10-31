# Interfaz asumida para multi-par y deltas (para que el implementador la siga)

Nada de esto existe hoy en `src/*.js`. Es la interfaz mínima, consistente con el estilo ya usado en
el repo (funciones puras separadas de la IO, parámetros explícitos en vez de leer `process.env`
adentro de cada función, todo documentado con el hallazgo/invariante que protege), contra la que se
escribieron los tests oráculo. El implementador puede ajustar nombres si documenta el porqué, pero
**el contrato funcional (qué entra, qué sale, qué invariante protege) es lo que los tests verifican**
y no debería cambiar sin volver a pasar por `revisor-alcance`.

## 1. Pares de configuración — `src/pares.js` (nuevo módulo)

```js
// placeholder/pendiente: la isla todavía no tiene gid ni depositoId reales
// (ver R-9). Un par con cualquiera de los dos vacío, null, o igual a este
// sentinel, queda marcado `pendiente: true` y el sync lo omite sin fallar.
export const VALOR_PENDIENTE = "PENDIENTE";

export function construirPares(env = process.env) {
  return [
    {
      nombre: "dot",
      stateKey: "dot",
      depositoId: env.CONTABILIUM_DOT_DEPOSITO_ID || null,
      locationId: env.SHOPIFY_DOT_LOCATION_ID || null,
      pendiente: esValorPendiente(env.CONTABILIUM_DOT_DEPOSITO_ID) || esValorPendiente(env.SHOPIFY_DOT_LOCATION_ID),
    },
    {
      nombre: "galerias-pacifico",
      stateKey: "galerias-pacifico",
      depositoId: env.CONTABILIUM_ISLA_DEPOSITO_ID || null,
      locationId: env.SHOPIFY_ISLA_LOCATION_ID || null,
      pendiente: esValorPendiente(env.CONTABILIUM_ISLA_DEPOSITO_ID) || esValorPendiente(env.SHOPIFY_ISLA_LOCATION_ID),
    },
  ];
}

export function esValorPendiente(v) {
  return v === undefined || v === null || v === "" || v === VALOR_PENDIENTE;
}
```

Agregar o quitar un par (R-2) es agregar/quitar una entrada de este arreglo — nunca tocar
`sync.js`/`shopify.js`/`contabilium.js` para eso.

## 2. Semántica de deltas — nueva función pura en `src/sync.js`

```js
// calcularEscritura — decide qué valor escribir en Shopify SIN escribir nada.
// Pura, sin IO, para poder testearla sin red (mismo patron que
// decidirReintento en contabilium.js o evaluarCorrida en resultado.js).
//
//   baseline         — lo que Contabilium decía en la corrida anterior para
//                       este SKU en este par (viene de libreta.contabilium;
//                       null si es la primera corrida de este SKU/par — NO
//                       confundir con 0, que es un valor real).
//   contabiliumActual — lo que Contabilium dice AHORA.
//   shopifyActual     — lo que Shopify tiene AHORA en la location de este par
//                       (puede ya reflejar una venta web que achicó el stock).
//
// Devuelve { nuevoValor, delta, sembrado }.
//   - sembrado: true  -> no habia baseline, se siembra el valor de Contabilium
//     tal cual (unica situacion en la que se admite escribir un "absoluto": la
//     primera vez que se ve el SKU en este par, cuando no hay delta que calcular).
//   - sembrado: false -> nuevoValor = shopifyActual + (contabiliumActual - baseline).
//     NUNCA nuevoValor = contabiliumActual directamente salvo en el caso sembrado.
export function calcularEscritura({ baseline, contabiliumActual, shopifyActual }) {
  if (baseline === null || baseline === undefined) {
    return { nuevoValor: Math.round(contabiliumActual), delta: null, sembrado: true };
  }
  const delta = contabiliumActual - baseline;
  return { nuevoValor: Math.round(shopifyActual + delta), delta, sembrado: false };
}
```

`procesarSku` pasa a llamar esta función antes de decidir si escribe, y usa `nuevoValor` (nunca
`stockObjetivo`/`contabiliumActual` directo) como `quantity` de `setearStock`. El `baseline` sale de
`libreta.contabilium[sku]` (el campo que YA existe en la libreta desde H5/anomalías, hoy sin usar
para esto).

## 3. Multi-location en Shopify — parámetro OBLIGATORIO, sin default a una location real

**Corrección de esta ronda (hallazgo bloqueante 1 de `revisor-alcance`, 2026-10-29):** la primera
versión de este diseño proponía `locationId = process.env.SHOPIFY_DOT_LOCATION_ID` como default en
`buscarVariantePorSku`/`leerStockActual`/`setearStock`. Eso es exactamente la fuga que R-9 prohíbe:
si el loop de pares (todavía no escrito) omitiera pasar `locationId` para el par de la isla
—por bug, o porque `par.locationId` vale el sentinel `"PENDIENTE"` y alguna capa intermedia lo
trata como falsy—, el default no caía en "ninguna location real": caía en la location REAL del
DOT. Eso es escribir en la location real equivocada, en silencio — peor que no escribir nada.

**Decisión:** estas tres funciones dejan de tener default. `locationId` es un parámetro obligatorio;
si falta, la función explota con un error claro en el momento de la llamada, nunca cae en un valor
real adivinado:

```js
export async function buscarVariantePorSku(sku, locationId) {
  if (!locationId) throw new Error(`buscarVariantePorSku(${sku}): locationId es obligatorio, no hay default`);
  ...
}
export async function leerStockActual(inventoryItemId, locationId) {
  if (!locationId) throw new Error(`leerStockActual(${inventoryItemId}): locationId es obligatorio, no hay default`);
  ...
}
export async function setearStock(inventoryItemId, quantity, changeFromQuantity, locationId) {
  if (!locationId) throw new Error(`setearStock(${inventoryItemId}): locationId es obligatorio, no hay default`);
  ...
}
```

Esto es **la segunda línea de defensa**, no la única: la primera y más importante es que el chequeo
de "este par está pendiente" pasa en la capa de orquestación (sección 7, `ejecutarPar`), ANTES de
llegar a `resolverSku`/`buscarVariantePorSku`/`leerStockActual`/`setearStock`, para un par con
`pendiente: true`. Un par pendiente nunca debería ni intentar llamar a estas funciones — el `throw`
de arriba es el guardarrail de "por si algo en el medio falla igual", no el mecanismo principal.
`test/par-isla-pendiente.test.js` agrega el caso que ejercita exactamente esto con un spy que falla
el test si cualquiera de las tres funciones de bajo nivel llega a invocarse para el par pendiente.

## 3.1. `resolverSku` también pasa a recibir `locationId` explícito

**Corrección de esta ronda (hallazgo bloqueante 2):** la sección 3 original no decía nada de
`resolverSku` (`src/shopify.js:326-343`), que es la función que `procesarSku` (`src/sync.js:122-179`)
llama en realidad — no llama `buscarVariantePorSku` directo. Si `resolverSku` se queda sin tomar
`locationId`, toda la corrección de la sección 3 es cosmética: la cadena real
par → `procesarSku` → `resolverSku` → `buscarVariantePorSku`/`leerStockActual` sigue sin tener forma
de saber para qué location está resolviendo.

`resolverSku` pasa a exigir `locationId` también, sin default, y lo threadea a las dos funciones de
bajo nivel que llama:

```js
export async function resolverSku(sku, locationId) {
  if (!locationId) throw new Error(`resolverSku(${sku}): locationId es obligatorio, no hay default`);

  const c = cargarCache(); // la cache de inventoryItemId por sku es independiente del locationId:
  const cacheado = c[sku]; // el id de la variante no cambia entre locations, solo el stock sí.

  if (cacheado) {
    const available = await leerStockActual(cacheado, locationId);
    return { inventoryItemId: cacheado, available, desdeCache: true };
  }

  const resultado = await buscarVariantePorSku(sku, locationId);
  if (!resultado) return null;

  c[sku] = resultado.inventoryItemId;
  guardarCache();
  return { ...resultado, desdeCache: false };
}
```

Y `procesarSku` (`src/sync.js`) pasa a tomar `locationId` como parámetro (en vez de ninguno, hoy
implícito vía los defaults de `shopify.js`) y lo pasa tanto a `resolverSku` como a `setearStock`.
Con esto, la cadena completa desde el par hasta la escritura es explícita de punta a punta: en
ningún punto intermedio hay un lugar donde el `locationId` se pueda perder o resolver por default.

## 4. El plan de escritura por par — nueva función pura, sin red

Para poder probar "cada par escribe solo en su location, nunca en la de otro ni en CENTRAL" sin
mockear `fetch`, se asume una función pura intermedia que decide, para un par y un stock ya leído de
Contabilium, qué se intentaría escribir (sin llamar a Shopify todavía):

```js
// armarPlanDeEscritura — por SKU, calcula la escritura (via calcularEscritura)
// y la amarra a la location/par que la originó. No llama a Shopify.
//   par           — { nombre, stateKey, depositoId, locationId, pendiente }
//   stockPorSku   — Map<sku, cantidad> de ESTE deposito (ya viene filtrado:
//                    viene de getStockDeposito(par.depositoId))
//   baselinePorSku — Map<sku, cantidad> (de libreta.contabilium de ESTE par)
//   shopifyPorSku  — Map<sku, cantidad> (lo que resolverSku devolvio para ESTE par)
// Devuelve [{ sku, par: par.nombre, locationId: par.locationId, nuevoValor, delta, sembrado }]
export function armarPlanDeEscritura(par, stockPorSku, baselinePorSku, shopifyPorSku) {
  const plan = [];
  for (const [sku, contabiliumActual] of stockPorSku) {
    if (!shopifyPorSku.has(sku)) continue; // no encontrado/no activado: no se planea nada
    const { nuevoValor, delta, sembrado } = calcularEscritura({
      baseline: baselinePorSku.get(sku) ?? null,
      contabiliumActual,
      shopifyActual: shopifyPorSku.get(sku),
    });
    plan.push({ sku, par: par.nombre, locationId: par.locationId, nuevoValor, delta, sembrado });
  }
  return plan;
}
```

Por construcción, cada item del plan lleva el `locationId` del PAR que lo generó: nunca el de otro
par, nunca un literal de CENTRAL, porque la función no tiene ningún otro origen posible para ese
campo. `test/multi-par.test.js` y `test/no-tocar-central.test.js` verifican exactamente esta
propiedad, variando los pares y los stocks de entrada.

## 5. Estado persistido por location — `rutaSnapshotPara`

```js
// rutaSnapshotPara — construye la ruta de la libreta de UN par. Antes habia
// un solo SNAPSHOT_PATH global; con multi-par cada stateKey tiene su archivo,
// para que la base de un par nunca se lea ni se pise con la de otro (R-3).
export function rutaSnapshotPara(stateKey, dirCache = join(__dirname, "..", ".cache")) {
  return join(dirCache, `last-sync.${stateKey}.json`);
}
```

`cargarLibretaCompleta`/`guardarSnapshot` NO cambian de firma (ya aceptan `ruta` como parámetro);
sólo cambia qué ruta les pasa el loop de pares en `src/index.js`.

## 6. El guardarrail agregado — `evaluarCorridaMultiPar` en `src/resultado.js`

```js
// evaluarCorridaMultiPar — agrega el veredicto de evaluarCorrida() por cada
// par activo. Un par `pendiente` (R-9) se reporta pero NO se exige que haya
// sincronizado nada: no es un fallo que el par de la isla este pendiente.
// Pero si TODOS los pares terminan pendientes o en error, la corrida entera
// no puede salir en verde (nunca "no hice nada en ningun lado" == exito).
//   porPar: { [stateKey]: resumenDeSyncTodos | { pendiente: true, motivo } }
// Devuelve { ok, motivo, detalle: { [stateKey]: { ok, motivo, pendiente } } }
export function evaluarCorridaMultiPar(porPar, umbral) { ... }
```

## 7. La orquestación de un par — `ejecutarPar` (nueva, en `src/sync.js`)

Se propone `src/sync.js` y no `src/index.js` porque `src/index.js` hoy ejecuta efectos de lado
(parsea `argv`, agenda cron, llama `syncTodos()`) **al importarse** — no exporta nada para testear
sin disparar esos efectos. `test/orquestacion-pares.test.js` necesita poder `import { ejecutarPar }`
sin levantar un cron ni leer `process.argv`, así que la función de orquestación tiene que vivir en
un módulo que sea solo-librería, como ya es `src/sync.js` (de donde ya se importan `syncTodos`,
`armarPlanDeEscritura`, `rutaSnapshotPara`). `src/index.js` pasa a limitarse a construir los pares
y llamar `ejecutarPar` por cada uno, igual que hoy llama `syncTodos()`.

**Agregado en esta ronda (hallazgo bloqueante 2).** Ninguno de los tests de antes de esta ronda
ejercita el loop real de pares: `test/multi-par.test.js` y `test/no-tocar-central.test.js` solo
prueban `construirPares`/`armarPlanDeEscritura`, que son funciones puras sin red. Falta una pieza
de orquestación intermedia, con dependencias inyectables, que sea el punto único donde:

1. se decide, ANTES de tocar Shopify o Contabilium, si el par está pendiente (R-9) — y si lo está,
   se corta ahí, sin llamar ninguna de las dependencias de abajo;
2. se resuelve la ruta de la libreta de ESE par (`rutaSnapshotPara`, sección 5);
3. se lee Contabilium, se resuelve y escribe en Shopify usando el `locationId`/`depositoId` de ESE
   par (secciones 3 y 3.1), y
4. se actualiza el snapshot de ESE par sin que lo que pasó en otro par lo afecte (R-3/R-7).

Esta función no existe hoy en `src/*.js`; el implementador la agrega (nombre exacto a su
criterio — `ejecutarPar` en `src/sync.js` es la propuesta, documentada acá porque
`test/orquestacion-pares.test.js` la exige para poder probar la cadena completa sin red real):

```js
// ejecutarPar — orquesta UN par de punta a punta: Contabilium -> Shopify -> libreta.
// Nunca lee ni escribe nada fuera del depositoId/locationId de ESTE par.
//
//   par  — { nombre, stateKey, depositoId, locationId, pendiente }
//   deps — inyectable para poder testear sin red (default: las funciones reales
//          de contabilium.js/shopify.js/sync.js):
//     {
//       getStockDeposito,       // (depositoId) => Promise<Map<sku, cantidad>>
//       resolverSku,            // (sku, locationId) => Promise<{inventoryItemId, available} | null>
//       setearStock,            // (inventoryItemId, quantity, changeFromQuantity, locationId) => Promise<void>
//       cargarLibretaCompleta,  // (ruta) => { skus, contabilium }
//       guardarSnapshot,        // (snap, ruta, contabilium) => void
//       rutaSnapshotPara,       // (stateKey, dirCache?) => string
//     }
//
// Devuelve, para un par pendiente: { pendiente: true, motivo } SIN haber
// llamado ninguna de las deps de Shopify/Contabilium.
// Para un par activo: el resumen de contadores de syncTodos (actualizado,
// dry, sin_cambios, no_encontrado, no_activado, error, ambiguo, saltado,
// total), calculado usando calcularEscritura (sección 2) por SKU.
export async function ejecutarPar(par, deps = DEPS_REALES) {
  if (par.pendiente) {
    return { pendiente: true, motivo: `par "${par.nombre}": depositoId/locationId sin confirmar` };
  }
  // ... a partir de aca, deps.getStockDeposito(par.depositoId), deps.resolverSku(sku, par.locationId),
  // deps.setearStock(..., par.locationId), deps.rutaSnapshotPara(par.stateKey), etc.
  // El `if (par.pendiente) return` de arriba es la PRIMERA linea de la funcion,
  // antes de cualquier otra cosa: es la garantia de "nunca llega a llamar estas
  // funciones en absoluto", no una entre varias ramas posibles.
}
```

El loop de pares en `src/index.js` pasa a ser `for (const par of construirPares()) { resultados[par.stateKey] = await ejecutarPar(par); }`, y el resultado agregado se le pasa a `evaluarCorridaMultiPar` (sección 6).

`test/orquestacion-pares.test.js` corre `ejecutarPar` con `deps` enteramente inyectadas (fakes en
memoria para Contabilium/Shopify, y `cargarLibretaCompleta`/`guardarSnapshot` reales contra un
directorio temporal, siguiendo el patrón de `conDirTemporal` de `test/libreta-multi-location.test.js`)
para DOS pares en la misma invocación, y confirma: (a) cada par escribe/lee contra exactamente su
propio `locationId`, nunca el del otro ni uno hardcodeado; (b) el par pendiente no genera ninguna
llamada hacia los fakes de Shopify (lectura o escritura); (c) un SKU no resuelto en el par A nunca
queda marcado como resuelto en el snapshot del par A por efecto de lo que pasó en el par B, y
viceversa (R-7 a nivel de dos pares reales, no solo de la función pura de I/O).

## Resumen de huecos que esto deja explícitos para el implementador

- Nombres exactos de las env vars de la isla (`CONTABILIUM_ISLA_DEPOSITO_ID`,
  `SHOPIFY_ISLA_LOCATION_ID`): son una propuesta razonable, no están confirmadas por la persona.
  Si el implementador elige otros nombres, `test/par-isla-pendiente.test.js` y
  `test/multi-par.test.js` van a señalarlo con claridad (fallan con "Cannot find" o con el par
  esperado ausente), no en silencio.
- El sentinel `"PENDIENTE"` para R-9 es una convención propuesta; cualquier equivalente que haga
  `pendiente: true` sin valores reales sirve, siempre que `construirPares` lo exponga como booleano.
- El nombre exacto `ejecutarPar` (sección 7) y su archivo (`src/index.js` vs. `src/sync.js`) son una
  propuesta, no una decisión cerrada. Lo que no es negociable sin volver a pasar por
  `revisor-alcance` es el contrato funcional: deps inyectables, el chequeo de `pendiente` como
  primera línea antes de cualquier IO, y que `locationId`/`depositoId` lleguen siempre desde `par`,
  nunca desde un default ni una variable global.

## Ronda 3 (2026-10-29) — R-10/CA-11, R-11/CA-12, R-12/CA-13

**Contexto:** `ejecutarPar` (sección 7) ya existe hoy en `src/sync.js` — a diferencia de las rondas
1 y 2, donde todo lo de esta sección era hipotético. `revisor-codigo` encontró, sobre esa
implementación ya escrita, que `ejecutarPar` quedó con tres huecos respecto del camino legado
(`procesarSku`/`syncTodos`), que sí los resuelve:

1. `ejecutarPar` nunca llama nada equivalente a `esDryRun()`: siempre llama `deps.setearStock`
   cuando hay delta, incluso con `DRY_RUN=true`.
2. El estado del par DOT vive ahora en `rutaSnapshotPara("dot", dirCache)` →
   `.cache/last-sync.dot.json`, un archivo DISTINTO del legado `SNAPSHOT_PATH` →
   `.cache/last-sync.json` (sección 5). Nada migra ni lee el legado como fallback: el primer
   deploy de esta feature hace que el par DOT arranque con libreta vacía, re-siembra todo
   (`sembrado: true` para cada SKU) y pierde la detección de desaparecidos de `detectarAnomalias`
   para esa corrida.
3. `ejecutarPar` no tiene ni el atajo incremental (`if (!full && snapshotPrevio[sku] === cantidad)
   continue`) ni el checkpointing periódico (`CHECKPOINT_CADA`) que tiene `syncTodos`: siempre
   reconsulta los 2500+ SKUs contra Shopify y persiste la libreta una sola vez, al final — la
   misma clase de riesgo que motivó el checkpointing legado (H3: una corrida que muere a mitad de
   camino pierde todo el progreso, no solo el tramo final).

Los tres se resuelven agregando parámetros y una `dep` a la función que YA existe —no se reescribe
`ejecutarPar` desde cero, y no se le agregan funciones nuevas si alcanza con reusar las que ya
tiene como `deps` (`guardarSnapshot`, `rutaSnapshotPara`).

### R-10/CA-11 — dry-run respetado por todos los pares

**Interfaz asumida:** `DEPS_REALES` (sección 7) agrega una entrada `esDryRun` — la misma función
privada que ya usan `procesarSku`/`syncTodos` (`src/sync.js:28-30`), ahora **inyectable** en vez de
llamada directo adentro de `ejecutarPar`, para poder testear los dos modos sin mutar
`process.env.DRY_RUN` real (que es compartido entre tests si corren en el mismo proceso):

```js
const DEPS_REALES = {
  getStockDeposito,
  resolverSku,
  setearStock,
  cargarLibretaCompleta,
  guardarSnapshot,
  rutaSnapshotPara,
  esDryRun, // NUEVO (R-10): antes no estaba, y ejecutarPar nunca la llamaba.
};
```

Dentro de `ejecutarPar`, antes de llamar `deps.setearStock`: si `deps.esDryRun()` es true, nunca se
llama `setearStock`, el resultado de ese SKU es `"dry"` (no `"actualizado"`, mismo vocabulario que
`procesarSku`) y se acumula en un arreglo que el `return` expone explícitamente — no alcanza con un
`console.log` silencioso, porque el test no debe depender de capturar stdout:

```js
// por cada SKU que en modo no-dry hubiera escrito, en dry-run se acumula aca
// en vez de llamar deps.setearStock. Es lo que el test lee para confirmar
// "se reporta explicitamente que habria escrito", sin parsear logs.
planDry.push({ sku, par: par.nombre, locationId: par.locationId, actual: available, nuevoValor });
```

`ejecutarPar` devuelve `{ ...contadores, total, planDry }` (siempre; `planDry` es `[]` si no hubo
nada que simular o si no era dry-run). Igual que en `syncTodos` (`src/sync.js:356`), la libreta
**no se persiste** (`deps.guardarSnapshot` no se llama) cuando `deps.esDryRun()` es true: un dry-run
no puede dejar rastro de "esto ya se sincronizó" para la corrida real siguiente.

`test/dry-run-multi-par.test.js` corre dos pares con `deps.esDryRun = () => true` y confirma:
(a) `deps.setearStock` nunca se invoca para ningún par aunque haya delta en los dos; (b) el
`planDry` devuelto lista exactamente los SKUs/pares/valores que se habrían escrito; (c) ningún par
persiste snapshot (`deps.guardarSnapshot` sin invocar); (d) control negativo con
`deps.esDryRun = () => false`: ahí sí se llama `setearStock` y sí se persiste, para probar que el
corte es específico del flag y no un cortocircuito permanente.

### R-11/CA-12 — migración explícita de la libreta legada del DOT

**Interfaz asumida:** una función nueva, pura en el sentido de "solo hace IO de archivo, sin red",
`migrarLibretaLegada(rutaLegada, rutaNueva)` en `src/sync.js`, en el mismo estilo que
`guardarSnapshot`/`cargarLibretaCompleta` (recibe rutas explícitas, nunca lee `process.env`
adentro):

```js
// migrarLibretaLegada — primera corrida del par DOT tras este deploy: la
// libreta nueva por-par (rutaSnapshotPara("dot", ...)) no existe todavia,
// pero el legado SNAPSHOT_PATH (.cache/last-sync.json) si tiene la base real
// de las corridas anteriores. Sin esto, el primer run del DOT resiembra todo
// (sembrado:true por SKU) y pierde la deteccion de desaparecidos de una
// corrida a la otra.
//   - rutaNueva ya existe (tiene su propio progreso, migrado o generado
//     organicamente): NO se toca. Nunca se pisa progreso nuevo con el legado.
//   - rutaNueva no existe y rutaLegada tampoco: no hay nada que migrar
//     (deploy en un ambiente sin libreta previa, p.ej. CI limpio).
//   - rutaNueva no existe y rutaLegada si: se copia el contenido crudo tal
//     cual (mismo __v/schema, no cambia nada mas) y se devuelve true.
// Devuelve true si migro, false si no hizo nada (en ninguno de los dos casos
// "false" es un error).
export function migrarLibretaLegada(rutaLegada, rutaNueva) {
  if (existsSync(rutaNueva)) return false;
  if (!existsSync(rutaLegada)) return false;
  mkdirSync(dirname(rutaNueva), { recursive: true });
  writeFileSync(rutaNueva, readFileSync(rutaLegada, "utf-8"), "utf-8");
  return true;
}
```

**Dónde se llama — corregido tras el hueco encontrado por `revisor-alcance` en CA-12:** la primera
versión de esta sección decía "se llama desde el loop de pares en `src/index.js`", pero
`correrTodosLosPares` (el loop que hoy recorre `construirPares(...)` y llama `ejecutarPar` por
cada uno) vivía **adentro de `src/index.js`**, como función local no exportada — no importable
desde un test. Eso dejaba un hueco real: un implementador podía satisfacer
`test/migracion-libreta-legada.test.js` llamando `migrarLibretaLegada` a mano en el test sin tocar
`index.js` en absoluto, y el bug de R-11 (primer deploy del DOT resiembra todo) seguiría vivo en
producción sin que ningún oráculo lo note.

**Corrección:** `correrTodosLosPares` se extrae a `src/sync.js` como función exportada —mismo
patrón que ya se usó para sacar `ejecutarPar` de `index.js`—, y es ahí, adentro de
`correrTodosLosPares`, donde se llama `migrarLibretaLegada` una sola vez por corrida, SOLO para el
par `"dot"`, antes de invocar `ejecutarPar(dot, ...)`:

```js
// src/sync.js
export async function correrTodosLosPares(pares, deps = DEPS_REALES) {
  const parDot = pares.find((p) => p.stateKey === "dot");
  if (parDot) {
    // deps.SNAPSHOT_PATH (no el import directo del modulo) para que un test
    // pueda apuntar la ruta legada a un directorio temporal, sin tocar el
    // .cache/last-sync.json real del repo ni depender de un estado global
    // compartido entre corridas de test.
    deps.migrarLibretaLegada(deps.SNAPSHOT_PATH, deps.rutaSnapshotPara("dot"));
  }

  const porPar = {};
  for (const par of pares) {
    porPar[par.stateKey] = await ejecutarPar(par, deps);
  }
  return porPar;
}
```

`DEPS_REALES` agrega `SNAPSHOT_PATH` (el `const` ya existente, exportado) y `migrarLibretaLegada`
además de lo que ya tenía (sección "Ronda 3" más arriba, entrada `esDryRun`).

```js
// src/index.js — se reduce a un wrapper que arma pares/deps desde
// process.argv/process.env y llama a la función real de sync.js:
import { correrTodosLosPares } from "./sync.js";
import { construirPares } from "./pares.js";
...
const porPar = await correrTodosLosPares(construirPares(process.env));
```

Esto exige exportar `SNAPSHOT_PATH` (hoy es un `const` interno sin `export`, `src/sync.js:26`) y
agregar `migrarLibretaLegada` a `DEPS_REALES` — son los dos únicos cambios de visibilidad que este
punto necesita. `correrTodosLosPares` se llama en cada arranque del proceso (no solo "la primera
vez" de forma explícita), pero por el chequeo `existsSync(rutaNueva)` de `migrarLibretaLegada` es un
no-op a partir de la segunda corrida: queda idempotente sin necesidad de una bandera de "ya migré"
separada.

`test/migracion-libreta-legada.test.js` prueba dos capas:
1. `migrarLibretaLegada` como función de IO aislada (con un directorio temporal, patrón
   `conDirTemporal` de `test/libreta-multi-location.test.js`): que copia cuando corresponde, que no
   pisa progreso nuevo, que es un no-op sin legado. Y un caso de cadena manual: migra y después
   corre `ejecutarPar("dot", ...)` con deps fake, confirmando que el baseline migrado
   (`libreta.contabilium`) se usa para calcular el delta (R-1) — nunca `sembrado: true` para un SKU
   que ya estaba en el legado.
2. **El hueco que cierra esta ronda:** un caso de punta a punta que llama **`correrTodosLosPares`**
   (no `migrarLibretaLegada` a mano) con un archivo legado real en un directorio temporal, y
   confirma que, para el par `"dot"`, la migración ya ocurrió ANTES de la primera escritura — sin
   que el test tenga que invocar `migrarLibretaLegada` explícitamente. Esto es lo que vuelve
   imposible reproducir el bug de R-11 sin que el test lo note: si `correrTodosLosPares` no llama a
   `migrarLibretaLegada` (o si `index.js` sigue con el loop local no exportado), este caso falla al
   importar el símbolo o al comprobar que el baseline post-migración se usó.

**Última ronda de arreglo (hueco encontrado por `revisor-alcance` con `grep`, tercera y última
corrección permitida sobre CA-12):** el caso de punta a punta del punto 2 importa
`correrTodosLosPares` **desde `src/sync.js`** y lo ejercita ahí. Eso deja un hueco que ningún test
de comportamiento puede cerrar: un implementador puede agregar `correrTodosLosPares` a `sync.js`
(dejando ese caso en verde) **sin borrar** la función local duplicada y no exportada que hoy vive
en `src/index.js` (líneas 22-28, `async function correrTodosLosPares()`, sin `export`, sin
parámetros `pares`/`deps`), que es la que literalmente corre en producción (`src/index.js`, línea
142: `correrTodosLosPares().then(...)`). Si esa duplicada sigue viva, la migración de R-11 nunca
se ejecuta en producción, aunque todos los tests de comportamiento de este archivo estén en verde —
exactamente el mismo patrón de riesgo que ya motivó el punto 2.

**Corrección:** se agregan dos tests nuevos, al final de `test/migracion-libreta-legada.test.js`,
que leen el **texto fuente** de `src/index.js` con `readFileSync` (no lo importan ni lo ejecutan) y
verifican, con una expresión regular sobre ese texto:
1. que `src/index.js` **importa** `correrTodosLosPares` desde `"./sync.js"` (algo como
   `import { ..., correrTodosLosPares, ... } from "./sync.js"`);
2. que `src/index.js` **no declara** su propia `function correrTodosLosPares(...)` ni
   `const correrTodosLosPares = ...` local.

Es deliberado que estos dos tests lean texto plano en vez de importar el módulo: `src/index.js` no
es una librería pura — al cargarlo (`import "dotenv/config"`, el parseo de `process.argv`, el
`cron.schedule`, y en particular la línea 142 que dispara la corrida real) se ejecuta su modo real
contra `argv`/`.env`/red reales del proceso que corre los tests, lo cual no es seguro ni
determinista en un test (y potencialmente pega contra Contabilium/Shopify de producción). Por eso
es una "fitness function" — un chequeo estructural sobre el código fuente, no sobre su
comportamiento en runtime — y es un patrón válido para esta clase de duplicado silencioso
justamente porque el comportamiento (el caso del punto 2) y la estructura (de dónde viene el
símbolo que se ejecuta) pueden ir en verde por separado: solo chequeando ambos a la vez queda
cerrado el hueco.

### R-12/CA-13 — incremental y checkpoint también en el loop multi-par

**Interfaz asumida:** dos parámetros nuevos en la firma de `ejecutarPar`, en vez de funciones
nuevas — el mismo patrón que ya usa `syncTodos({ full })`, extendido con la cadencia de
checkpoint (que en `syncTodos` es la constante privada `CHECKPOINT_CADA`, ahora parametrizable para
que el test no dependa de un número mágico de 200 SKUs):

```js
export async function ejecutarPar(
  par,
  deps = DEPS_REALES,
  { full = false, checkpointCada = CHECKPOINT_CADA } = {}
) {
  ...
}
```

No se agrega una dep `guardarCheckpoint` nueva: alcanza con llamar la dep que YA existe,
`deps.guardarSnapshot(snapshotNuevo, ruta, stock)`, más de una vez durante el loop en vez de una
sola vez al final — exactamente el mismo patrón de `syncTodos` (`src/sync.js:349-352,356`), solo
que ahora `ruta` viene de `deps.rutaSnapshotPara(par.stateKey)` (por-par) en vez de la global.

Dentro del loop de `ejecutarPar`:

```js
// Atajo incremental (R-12): igual que syncTodos (src/sync.js:322-326), pero
// por par. Un SKU sin cambio desde la libreta de ESTE par no se re-consulta
// contra Shopify -- salvo reconciliacion completa explicita (full: true).
if (!full && snapshotPrevio[sku] === cantidad) {
  contadores.saltado++;
  continue; // no cuenta para el checkpoint: no se tocó Shopify para este SKU
}

... // resolverSku/setearStock como ya esta

procesados++;
if (!deps.esDryRun() && procesados % checkpointCada === 0) {
  deps.guardarSnapshot(snapshotNuevo, ruta, stock);
}
```

El `deps.guardarSnapshot(snapshotNuevo, ruta, stock)` final (ya existente, al salir del `for`) no
se quita: el checkpoint periódico es ADEMÁS del guardado final, no en su lugar — un checkpoint
mid-loop solo adelanta cuándo queda a salvo el progreso parcial.

`test/incremental-checkpoint-multi-par.test.js` corre dos pares con una libreta previa donde varios
SKUs no cambiaron: confirma que esos SKUs nunca llegan a `deps.resolverSku` (se cuentan en
`saltado`, no en `total` procesado); que con `{ full: true }` sí se reconsultan todos aunque la
libreta diga que no cambiaron; y que con varios SKUs que sí cambian y un `checkpointCada` chico
(2), `deps.guardarSnapshot` se invoca más de una vez durante la corrida de un mismo par — no solo
al final.

**Corregido tras el hueco encontrado por `revisor-alcance` en CA-13:** el caso (c) original solo
contaba `llamadas.guardarSnapshot.length > 1` — un conteo que un implementador podía pasar llamando
`guardarSnapshot` dos veces con cualquier contenido (incluso vacío, o con el snapshot final
adelantado, o mezclando SKUs de otro par), sin que el test lo notara. Dado el antecedente de H3
(corridas en verde que en realidad no habían guardado nada real), eso no alcanza. Ahora:

- El spy de `guardarSnapshot` en `depsFake` captura también el **contenido** de `snap` (una copia,
  no la referencia — el loop sigue mutando el mismo objeto después), no solo `ruta` y `cantidad`.
- El caso (c) verifica que la primera llamada intermedia (antes de que el `for` termine) tiene
  exactamente los SKUs procesados hasta ese punto, con sus valores de Contabilium correctos — ni
  vacía, ni con el snapshot final completo adelantado (el conjunto de claves de la llamada
  intermedia es un subconjunto propio del de la llamada final), ni con claves de SKUs que
  pertenecen al otro par de la corrida.
- Se agrega un caso (e) de interrupción real: `deps.guardarSnapshot` (la escritura REAL a disco,
  no el spy) explota en su segunda invocación — simulando un fallo real de IO (`ENOSPC` o
  similar) al persistir el checkpoint, no un error de `resolverSku`/`setearStock` (esos ya se
  catchean por-SKU dentro del loop y nunca abortan la corrida). Como la llamada a
  `deps.guardarSnapshot` dentro del loop no está envuelta en `try`/`catch` (mismo patrón no
  defensivo que ya tiene `syncTodos`, `src/sync.js:349-352`), la excepción se propaga sin
  tragarse y `ejecutarPar(...)` rechaza. Usando un directorio temporal real (mismo patrón que
  `test/libreta-multi-location.test.js` y `test/orquestacion-pares.test.js`), el test lee el
  archivo de la libreta **del disco** (no el spy en memoria) con `cargarLibretaCompleta(ruta)` y
  confirma que el primer checkpoint, exitoso antes del que explota, quedó persistido con sus
  valores correctos — y que lo procesado después de ese checkpoint, nunca llegado a persistir,
  no aparece.
