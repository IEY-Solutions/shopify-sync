# Interfaz asumida para `clasificador-causa-comprobante` (diseño B)

> **Nota de reemplazo (02/11/2026).** El diseño de "ventana temporal"
> (`calcularVentanaComprobantes`, `determinarCausaSku`, `ultimaCorridaExitosa`, búsqueda lazy por
> SKU con delta negativo) fue **reemplazado** el 02/11/2026 por la alternativa B aprobada por la
> persona ("B: registro de comprobantes (Recommended)"). Análisis y diagramas:
> `docs/analisis/2026-11-02-rediseno-clasificador.md` y `docs/diseno/arquitectura.html`. Todo lo
> que sigue es la interfaz de B contra la que se escribieron los tests oráculo.

Rol: `autor-aceptacion`. Estas son decisiones de interfaz, no implementación. El implementador
puede cambiar nombres internos, pero **los nombres exportados, las formas de los archivos en disco
y los formatos de log de esta página son lo que verifican los tests**. Cambiarlos exige volver a
pasar por `revisor-alcance`.

Convención en todo el documento: "ART" es `America/Argentina/Buenos_Aires` (UTC-3 fijo, sin
horario de verano desde 2009).

---

## 0. Principio de compatibilidad con la suite existente

La suite ya tiene ~20 archivos que llaman a `ejecutarPar` con `deps` armados a mano, sin ninguna de
las dependencias nuevas. B no puede romperlos (R-14). Por eso **todas las dependencias nuevas son
opcionales en `deps`**:

| dep nueva | si falta en `deps` |
|---|---|
| `ahora()` | `new Date()` |
| `crearSesion()` | no hay sesión: se pasa `undefined` como último argumento a las funciones de Contabilium |
| `rutaRegistroComprobantes()`, `cargarRegistroComprobantes(ruta)`, `guardarRegistroComprobantes(registro, ruta)` | registro vacío en memoria, sin persistir |
| `buscarComprobantes`, `fetchComprobantesDetalle` | el refresco falla (el `TypeError` se captura) y el clasificador queda en `fallo`, **visible** (log + resumen). Nunca un "no disponible" silencioso |

Las escrituras que producen esos tests viejos no cambian: con el registro vacío el crédito es 0 y
la regla contable se reduce al delta puro de hoy.

---

## 1. Sesión de Contabilium por corrida — `src/contabilium.js`

```js
export const RITMO_MINIMO_COMPROBANTES_MS = 1500;

export function crearSesionContabilium({
  baseUrl = process.env.CONTABILIUM_API_URL,
  clientId = process.env.CONTABILIUM_CLIENT_ID,
  clientSecret = process.env.CONTABILIUM_CLIENT_SECRET,
  ritmoComprobantesMs = RITMO_MINIMO_COMPROBANTES_MS,
  dormir = delay,           // (ms) => Promise. Inyectable: los tests no duermen de verdad.
} = {}) -> sesion
```

- `sesion` lleva el `token` (se pide **una vez**, la primera vez que hace falta, y se reutiliza),
  el `estado = { esperaAcumuladaMs, ultimoError, agotado }` compartido por **todas** las llamadas de
  la corrida, el ritmo y `dormir`.
- `ritmoComprobantesMs` menor a 1500 se **sube** a 1500 (R-1: "no menor a 1500 ms").
- **Todo** lo que duerme usa `sesion.dormir`: el ritmo entre páginas de stock (500 ms, como hoy),
  el ritmo entre detalles (≥ 1500 ms) y la espera de un 429/5xx en `conReintentos`. Si la espera de
  un 429 usa el `delay` real, los tests de presupuesto se cuelgan y fallan por timeout.
- **Presupuesto único**: el techo de 5 min (`PRESUPUESTO_ESPERA_MS`) se mide contra
  `sesion.estado.esperaAcumuladaMs`, que suman stock, `/search` y detalles. Cuando
  `decidirReintento` rechaza **por presupuesto**, se marca `sesion.estado.agotado = true` y, desde
  ahí, **ninguna** llamada de esa sesión vuelve a hacer un request: falla enseguida con un error
  "presupuesto de espera de la corrida agotado". Eso es "cortar la corrida en vez de esperar por id".

Firmas (el último parámetro es la sesión; si se omite, cada función crea una propia, para no romper
`syncUnSku`, `syncTodos` ni `diagnostico-locations`):

```js
export async function getStockDeposito(depositoId = null, sesion = null)   // igual que hoy
export async function buscarComprobantes({ fechaDesde, fechaHasta }, sesion = null)
export async function fetchComprobantesDetalle(ids, sesion = null)
```

- `buscarComprobantes`: `GET {baseUrl}/api/comprobantes/search?fechaDesde=YYYY-MM-DD&fechaHasta=YYYY-MM-DD&page=N`,
  sin `id` (no hay filtro de depósito server-side). Pagina con `TotalItems` y tamaño de página 50
  hasta traer todo. Devuelve los ítems crudos de `/search` (cada uno trae al menos `Id` y `TipoFc`).
  Si `fechaDesde` o `fechaHasta` no cumplen `/^\d{4}-\d{2}-\d{2}$/`, **rechaza sin hacer ningún
  request** (el único formato probado en producción es día, `iey-ai/.../route.ts:32-46`).
- `fetchComprobantesDetalle`: `GET {baseUrl}/api/comprobantes/?id={id}`, **de a uno**, con
  `await sesion.dormir(ritmo)` entre un id y el siguiente, nunca en paralelo. Devuelve un arreglo
  alineado con `ids`:
  `{ id, ok: true, detalle }` o `{ id, ok: false, error: "<mensaje>", definitivo: <bool> }`
  (`definitivo` = **solo** 400, 404, o un 200 que no es un comprobante; cualquier otro error, también
  401, 403 o 422, es `definitivo: false`; ver la tabla de abajo). **Un id que
  falla no rechaza la promesa ni corta el lote**; un 5xx/429 se reintenta con `conReintentos`. Con
  la sesión agotada, los ids restantes vuelven `ok: false` sin request (el test también acepta que
  rechace, siempre que no haga requests).
- **Ronda 3, tabla de `definitivo`** (CA-1 ampliado; caso real 173386407). Un 200 es un
  comprobante **interpretable** solo si el cuerpo se parsea como JSON, es un objeto,
  `Number(Id)` es finito y `Items` es un arreglo. Si no, `ok: false`, `definitivo: true`, y
  **nunca** `ok: true`.

  | respuesta del id (tras `conReintentos`) | `ok` | `definitivo` |
  |---|---|---|
  | 200 interpretable | `true` | — |
  | 200 con cuerpo vacío o que no es JSON, sin `Id`, o con `Items` que no es arreglo | `false` | `true` |
  | 400, 404 | `false` | `true` |
  | 401, 403, 422 (ronda 4), y cualquier otro status que no sea 400/404 | `false` | `false` |
  | 5xx/429/red con los 4 intentos agotados | `false` | `false` |
  | corte por presupuesto de la corrida, o sesión ya agotada (sin request) | `false` | `false` |

  Por qué 401/403/422 no son definitivos: un token vencido, un permiso o una validación del lado
  de Contabilium no son culpa del comprobante. Si fueran definitivos, al tercer error un
  comprobante legítimo pasaría a `ilegible` y su crédito se perdería (subventa permanente). Si se
  reintentan o no queda a criterio del implementador; ningún test lo fija. Un 401/403/422 tampoco
  rechaza la promesa ni corta el lote.

  Lo fija `test/comprobantes-contabilium.test.js` (casos "Ronda 3" y "Ronda 4").
- `fetchComprobanteById` puede quedar como helper interno, pero **no** figura en `DEPS_REALES` ni
  en el import de `src/sync.js`.

`src/sync.js` exporta `DEPS_REALES` (hoy es `const` privada) para que el test pueda verificarlo:

```js
export const DEPS_REALES = {
  getStockDeposito, resolverSku, setearStock,
  cargarLibretaCompleta, guardarSnapshot, rutaSnapshotPara, esDryRun, SNAPSHOT_PATH, migrarLibretaLegada,
  buscarComprobantes, fetchComprobantesDetalle,
  crearSesion: () => crearSesionContabilium(),
  ahora: () => new Date(),
  rutaRegistroComprobantes, cargarRegistroComprobantes, guardarRegistroComprobantes,
};
```

**Una sesión por corrida.** `correrTodosLosPares` llama `deps.crearSesion()` **una sola vez** y
la comparte con todos los pares. `ejecutarPar` llamado suelto (sin el contexto de corrida) crea la
suya. La sesión se pasa como **último argumento** a `deps.getStockDeposito(depositoId, sesion)`,
`deps.buscarComprobantes(rango, sesion)` y `deps.fetchComprobantesDetalle(ids, sesion)`.

## 2. Funciones puras — `src/clasificador-causa.js`

Se retiran `clasificarComprobante`, `calcularVentanaComprobantes`, `VENTANA_DEFAULT_MS` y
`determinarCausaSku`. Quedan, sin IO, sin leer el reloj y sin mutar sus argumentos:

```js
export const ID_INTEGRACION_SHOPIFY = 25020;
export const TIPOS_FACTURA = new Set(["FCA", "FCB", "FCE", "FCM"]);
export const TIPOS_NOTA_CREDITO = new Set(["NCA", "NCB", "NCE", "NCM"]);
export const MARGEN_ACREDITACION_MS = 5 * 60_000;

export function parsearFechaArgentina(texto) -> Date | null
export function diaArgentina(fecha /* Date */) -> "YYYY-MM-DD"
export function lineasAcreditables(detalle, depositoId) -> [{ comprobanteId, sku, cantidad, referencia }]
export function esNotaCreditoShopify(detalle, depositoId) -> boolean
export function claveConsumo(comprobanteId, sku) -> `${comprobanteId}:${sku}`
export function creditoAcreditable({ lineas, consumos, tInicioLectura, margenMs = MARGEN_ACREDITACION_MS })
  -> { credito, claves }
```

- **`parsearFechaArgentina`**: Contabilium manda `FechaAlta`/`FechaEmision` **sin zona**
  (`"2026-08-12T19:14:29.66"`, verificado por la persona el 02/11/2026). Un texto sin zona es hora
  ART: `"2026-08-12T19:14:29.66"` → `2026-08-12T22:14:29.660Z`, con cualquier `TZ` del proceso.
  Fracción de 1 a 7 dígitos (`.66` son 660 ms; `.6601234` de .NET se trunca a 660 ms). Si el texto
  trae `Z` o un offset (`-03:00`), se respeta. Texto vacío o inválido → `null`. **Prohibido**
  `new Date(texto)` o `Date.parse(texto)` sobre un texto sin zona: en el runner (UTC) da 3 h
  corridas, y los tests corren con `TZ=UTC` para detectarlo.
- **`diaArgentina`**: día calendario ART. `2026-08-13T01:30:00Z` (22:30 ART del 12/08) →
  `"2026-08-12"`. Sin `getDate()` locales: con `Intl.DateTimeFormat(..., { timeZone: ART })` o
  restando 3 h a mano.
- **`lineasAcreditables(detalle, depositoId)`**: líneas solo si `Origen === "Shopify"`,
  `Number(IDIntegracion) === 25020`, `String(Inventario) === String(depositoId)` y `TipoFc` en
  `TIPOS_FACTURA`. Si no, `[]`. Por línea: `sku = String(Codigo ?? "").trim().toUpperCase()` (sin
  `Codigo` → se ignora la línea), `cantidad = Math.floor(Number(Cantidad))` (entero; el piso es el
  lado seguro: acreditar de menos es subventa, de más es sobreventa; `cantidad <= 0` o no finita →
  se ignora), `referencia` = **la mayor** entre `FechaAlta` y `FechaEmision` parseadas como ART, en
  ISO (`toISOString()`); si una falta, la otra. Los ítems del mismo comprobante con el mismo `sku`
  normalizado se **suman en una sola línea** (la clave de consumo es `comprobanteId:sku`).
  `comprobanteId = Number(detalle.Id)`. Para guardar en la caché las líneas del depósito propio de
  un comprobante, el implementador llama `lineasAcreditables(detalle, String(detalle.Inventario))`.
- **`esNotaCreditoShopify`**: `true` solo para `NCA/NCB/NCE/NCM` con `Origen="Shopify"`,
  `IDIntegracion=25020` e `Inventario` del par. Se cuentan, nunca se acreditan (D-8).
- **`creditoAcreditable`**: `lineas` son las de **un** SKU en el depósito del par
  (`[{ comprobanteId, sku, cantidad, referencia }]`); suma las que no están en `consumos` (objeto
  indexado por `claveConsumo`) y cuya `referencia` es **estrictamente anterior** a
  `tInicioLectura - margenMs`. Devuelve también sus claves, para marcarlas consumidas.

**Regla contable** (R-5), aplicada en `ejecutarPar` para un SKU no sembrado y no alcanzado por la
compuerta: `nuevoValor = Math.round(shopifyActual + (contabiliumActual - baseline) + credito)`.
Con cualquier signo de delta. El crédito se consume entero aunque solo explique parte del delta
(D-2).

## 3. Caché de comprobantes de la cuenta — `.cache/comprobantes.json`

Exportado desde `src/sync.js` (mismo patrón que la libreta):

```js
export function rutaRegistroComprobantes(dirCache = <repo>/.cache) -> join(dirCache, "comprobantes.json")
export function cargarRegistroComprobantes(ruta) -> registro   // archivo ausente, corrupto o con v != 1 -> registro vacío
export function guardarRegistroComprobantes(registro, ruta)    // mkdir -p; se recomienda *.tmp + rename
```

Forma en disco (los tests la siembran y la leen cruda):

```json
{
  "v": 1,
  "ultimoRefrescoOk": "2026-08-13T03:30:00.000Z",
  "diasCerrados": ["2026-08-12"],
  "comprobantes": {
    "177960828": {
      "id": 177960828,
      "dia": "2026-08-12",
      "tipoFc": "FCB",
      "estado": "ok",
      "intentos": 0,
      "vistoEn": "2026-08-12T22:30:00.000Z",
      "inventario": "127356",
      "notaCreditoShopify": false,
      "lineas": [{ "comprobanteId": 177960828, "sku": "IEY-C09-GRIS", "cantidad": 1, "referencia": "2026-08-12T22:14:29.660Z" }]
    }
  }
}
```

- Clave = `String(id)`. `estado`: `ok` (detalle leído, o `COT` descartado por `/search`),
  `pendiente` (todavía sin detalle: por tope o por error; `intentos` cuenta **todos** los errores,
  transitorios o no) o `ilegible` (3 errores `definitivo`; no se vuelve a pedir y se cuenta).
  `inventario` siempre como string.
- **`ilegible`** (ronda 2, análisis 4.2, caso real P0-S2:212-213, `Id=173386407`): un id pasa a
  `ilegible` en el refresco en que acumula su **tercer** error `definitivo: true` (400, 404 o un
  detalle que no se puede interpretar como comprobante). Un error transitorio (5xx, 429, red,
  presupuesto agotado) suma a `intentos` pero **nunca** acerca a `ilegible`: el id queda `pendiente`
  y se reintenta siempre. Con errores solo definitivos, `intentos` llega a 3 justo al pasar a
  `ilegible` (lo fija CA-4). Si se mezclan, la cuenta de definitivos es del implementador (se
  sugiere un campo `intentosDefinitivos`); ningún test la lee. Un `ilegible` no tiene `lineas`: no
  dispara el refresco y se poda a los 7 días como cualquier entrada sin líneas.
  `lineas` solo para Shopify/25020/factura; vacío en el resto.
- **`dia` de una entrada (ronda 4, R-8 "el día de Argentina del comprobante")**: es el día ART
  **del comprobante**, calculado con `diaArgentina` sobre su **marca de referencia**: la misma que
  usa R-2 y que `lineasAcreditables` pone en `referencia` (la mayor entre `FechaAlta` y
  `FechaEmision` parseadas como ART; si una falta, la otra). Se fija así:
  - con el detalle leído (`ok` con detalle, o `ilegible` si alguna vez hubo detalle): el día ART de
    esa referencia. **Se recalcula al pasar a `ok`**: un id que entró `pendiente` y después se lee
    toma el día del comprobante, no el del primer avistaje;
  - sin detalle (`pendiente`, `ilegible` sin detalle, o `COT` descartado por `/search`): provisorio,
    el día ART de `tInicioLectura` de la corrida que lo vio por primera vez. Esas entradas no
    tienen líneas, así que su `dia` nunca decide la poda de un consumo.
  Por qué: una venta online de las 23:30 ART del día R vista recién el R+1 (pendiente por el tope)
  con `dia` = R+1 se conservaría en la caché hasta el R+32, mientras su consumo (día de su
  `referencia`, R) se podaría el R+31: ese día la línea quedaría sin consumir y se acreditaría otra
  vez. Lo fija el caso "venta online de las 23:30 ART" de `test/libreta-ledger-checkpoint.test.js`,
  que lee `comprobantes["651"].dia` crudo.
- **Poda**, contra el día ART de `tInicioLectura`: entradas **sin** líneas, más de 7 días → se
  borran; entradas **con** líneas, más de 30 días → se borran, y las unidades que el par todavía no
  había consumido se suman a `creditos_vencidos`. `diasCerrados` se poda a 7 días. La poda se mide
  **siempre** con el `dia` guardado en la entrada (el de arriba), y es **la misma** regla y el
  **mismo** `dia` que usa la condición 2 de la poda de consumos (sección 4): para una entrada con
  líneas, `dia` = día ART de la `referencia` de sus líneas = día ART de la `referencia` de sus
  consumos.
- **Cuándo se poda (ronda 4)**: en cada refresco **y además al cargarse** la caché: en
  `ejecutarPar`, apenas se toma `tInicioLectura` (paso 3 de la sección 5) y **antes** del paso 5,
  es decir antes de que el par mire sus líneas sin consumir, con la misma regla y ese mismo
  `tInicioLectura`. Esa poda corre aunque después el refresco no haga falta o falle. Motivo, dos fallas juntas: la poda en
  memoria borra un comprobante de 31 días, **falla** el guardado de la caché y la libreta **sí** se
  guarda con su consumo podado; en la corrida siguiente, con `/search` caído, la caché vieja
  todavía tendría la línea, ya sin consumo, y se acreditaría. Podar al cargar la saca antes de
  calcular créditos. Lo fija el caso "falla el guardado de la caché ... se poda AL CARGARSE" de
  `test/libreta-ledger-checkpoint.test.js`. `cargarRegistroComprobantes(ruta)` no cambia de firma.
  La caché podada al cargar se guarda con el próximo guardado normal (después del refresco); si no
  hay refresco, no hace falta guardarla: la próxima carga vuelve a podar.
- **Regla de antigüedad (ronda 3, R-8, hallazgo 1 de `revisor-alcance`)**: "más de N días" se mide
  **siempre** en días calendario ART, entre el `dia` de la entrada y el día ART de
  `tInicioLectura`: `antiguedadDias = (díaHoy − dia)` en días enteros; se poda si
  `antiguedadDias > N`. **Nunca** se mide en horas contra la `referencia` (la poda de consumos de
  la sección 4 usa esta misma regla). Ejemplo fijado por CA-8: con `tInicioLectura` el 12/08 a las
  13:00 ART, una línea del 13/07 a las 12:00 ART (30 días y 1 hora) tiene `antiguedadDias = 30` y
  **sigue** en la caché; el 13/08 tiene 31 y se borra. Una entrada **con** líneas Shopify se
  conserva hasta los 30 días **esté consumida o no**: el consumo es del par y la caché es de la
  cuenta. Lo que dice R-8 sobre "líneas no consumidas" es para qué sirve la retención, no un
  criterio para podar antes.
- Se guarda después de cada refresco, **también en `DRY_RUN`** (es dato de solo lectura).
- Compartida por todos los pares: un comprobante es de la cuenta, no del par.

## 4. Consumos dentro de la libreta del par

`last-sync.<stateKey>.json` sigue en `__v: 2` (campos opcionales nuevos, mismo criterio que
`contabilium`; no se bumpea la versión porque eso descartaría todas las libretas y resembraría con
absolutos). Forma:

```json
{
  "__v": 2,
  "skus": { "IEY-C09-GRIS": 4 },
  "contabilium": { "IEY-C09-GRIS": 4 },
  "corte": "2026-08-01T00:00:00.000Z",
  "resembradoEn": { "IEY-A": "2026-08-12T16:00:00.000Z" },
  "consumos": {
    "177960828:IEY-C09-GRIS": { "cantidad": 1, "motivo": "delta", "referencia": "2026-08-12T22:14:29.660Z", "en": "2026-08-12T22:30:00.000Z" }
  }
}
```

`motivo` ∈ `delta` (regla contable) · `absoluto` (compuerta) · `sembrado` · `pre-corte`.

```js
export function guardarSnapshot(snap, ruta = SNAPSHOT_PATH, contabilium = null, contabilidad = null)
//   contabilidad = { corte, consumos, resembradoEn } | null
export function cargarLibretaCompleta(ruta) -> { skus, contabilium, corte, consumos, resembradoEn }
```

- `contabilidad` dado → se escriben **ese** `corte`, **esos** `consumos` y **ese** `resembradoEn`
  en el **mismo** `writeFileSync` que `skus` y `contabilium` (R-8: baseline y consumo juntos).
- `contabilidad` `null` (llamadas viejas de 3 argumentos: `syncUnSku`, los wrappers de los tests
  existentes) → se **conservan** el `corte`, los `consumos` y el `resembradoEn` que ya hay en
  disco. Nunca se borran.

### 4.1 `resembradoEn` — el corte por SKU (R-7 ampliado, ronda 2)

- **Dónde**: objeto `resembradoEn` en la raíz de la libreta del par, `{ [sku]: ISO }`, con el SKU
  normalizado como en `skus`. El valor es **exactamente** `tInicioLectura.toISOString()` de la
  corrida que escribió el absoluto (compuerta) o sembró el SKU (lo fija CA-7 con `===`).
- **Cuándo se escribe**: para cada SKU cuyo resultado de compuerta o sembrado es `actualizado` o
  `sin_cambios` (mismo criterio que el consumo, sección 5 paso 8). Si el SKU vuelve a resembrarse
  más adelante, el valor se **reemplaza** por el `tInicioLectura` nuevo. Un SKU que solo aplica la
  regla contable no lo toca.
- **Cómo se escribe**: en la **misma** escritura que el baseline (`contabilium[sku]`) y los
  consumos de esa corrida, dentro de `contabilidad` (checkpoint o guardado final). Nunca en un
  guardado aparte: si el baseline queda resembrado y `resembradoEn` no, la próxima corrida
  acreditaría encima del absoluto. En `DRY_RUN` no se escribe (no hay guardado).
- **Cuándo se aplica**: cada vez que el par mira sus líneas sin consumir, es decir al empezar la
  corrida (con lo que ya está en el registro) **y después de cada refresco** (con lo que se acaba
  de registrar), antes de calcular créditos. Toda línea del depósito del par con
  `sku ∈ resembradoEn` y `referencia < resembradoEn[sku]` (estricto) que no esté en `consumos` se
  consume con el motivo del resembrado (`absoluto` o `sembrado`), su `cantidad` y su `referencia`,
  y **no** entra en `creditoAcreditable`. No suma a `causa_venta_shopify` ni a
  `creditos_pre_corte`; deja de contar en `creditos_pendientes`. Las líneas con
  `referencia >= resembradoEn[sku]` siguen pendientes y se acreditan con la regla contable.
- **El motivo**: el valor de `resembradoEn` es la fecha sola (contrato R-7). Para saber qué motivo
  poner en un consumo tardío, el implementador guarda el motivo aparte; se sugiere
  `resembradoPor: { [sku]: "absoluto" | "sembrado" }` en la misma escritura. Ningún test lee ese
  campo; sí leen el `motivo` del consumo.
- **Relación con `corte` (R-11)**: es el mismo mecanismo con otro alcance. `corte` es el instante
  desde el que el par empezó a llevar cuentas: lo anterior ya está en el baseline del primer
  sembrado de **todos** los SKUs y se consume `pre-corte`. `resembradoEn[sku]` es lo mismo para
  **un** SKU cuyo baseline se reinició después: lo anterior ya está en el absoluto. Una línea se
  consume si es anterior a **cualquiera** de los dos. Si es anterior al `corte`, el motivo es
  `pre-corte` y suma `creditos_pre_corte` (paso 5, se evalúa primero, y así CA-11 no cambia); si
  está en `[corte, resembradoEn[sku])`, el motivo es `absoluto` o `sembrado`. En la primera corrida
  de un par, `corte = tInicioLectura` y cada SKU sembrado recibe `resembradoEn[sku] = tInicioLectura`:
  coinciden, y todo lo anterior es `pre-corte`. Los casos de CA-7 usan `corte` del 01/08, así que
  sus líneas caen siempre en el tramo de `resembradoEn`.
- **Poda**: un `resembradoEn[sku]` se puede borrar cuando su antigüedad, con la regla de días ART
  de la sección 3 (día ART de `resembradoEn[sku]` contra el día ART de `tInicioLectura`), es mayor
  que 30: toda línea anterior es de ese día o de antes, así que ya salió de la caché. Nunca se
  borra por otro motivo ni con una regla en horas. Ningún test fija la poda.
- **Siembra vía `syncUnSku` (ronda 3, R-7 ampliado, hallazgo 5 de `revisor-alcance`)**: cuando
  `syncUnSku` escribe el absoluto porque el SKU no tiene baseline en la libreta del DOT, y el
  resultado es `actualizado` o `sin_cambios`, guarda en la **misma** escritura que el baseline
  `resembradoEn[sku] = tInicioLectura.toISOString()` (con `tInicioLectura = deps.ahora()` tomado al
  empezar `syncUnSku`, antes de leer el stock o de usar `--qty`) y el motivo `sembrado` (por
  ejemplo en `resembradoPor`). La corrida siguiente de `ejecutarPar` consume las líneas anteriores
  de ese SKU con motivo `sembrado`. Cuando `syncUnSku` aplica un delta (el SKU ya tenía baseline),
  **no** toca `resembradoEn`: conserva el de ese SKU y el de todos los demás, igual que `corte` y
  `consumos`. Ver sección 4.2.
- `ultimaCorridaExitosa` **se retira**: no se lee, no se escribe y, si una libreta vieja lo trae, el
  próximo guardado no lo copia (D-7). `parsearUltimaCorridaExitosa` desaparece.
- `cargarLibretaCompleta`: archivo ausente → `{ skus: {}, contabilium: null, corte: null, consumos: {}, resembradoEn: {} }`;
  libreta v2 sin los campos → `corte: null, consumos: {}, resembradoEn: {}`; **archivo corrupto → exactamente
  `{ skus: {}, contabilium: null }`**, igual que hoy, porque `test/libreta.test.js:194` lo congela
  con `deepEqual` y no se toca. `ejecutarPar` lee `libreta.corte ?? null`, `libreta.consumos ?? {}`
  y `libreta.resembradoEn ?? {}`.
- `ejecutarPar` pasa siempre la `contabilidad` completa en memoria (lo cargado + lo consumido en
  esta corrida), en cada checkpoint y en el guardado final. En `DRY_RUN` no hay guardado (igual que
  hoy).
- **Poda de consumos (ronda 3, R-8 corregido).** Un consumo `"<id>:<sku>"` se puede podar **solo
  si se cumplen las dos**:
  1. su comprobante `<id>` **ya no está** en la caché de comprobantes (después de la poda de la
     caché de esta misma corrida, si la hubo), y
  2. su antigüedad, medida con la **misma** regla que la caché (sección 3: días calendario ART
     entre el día ART de su `referencia` y el día ART de `tInicioLectura`), es mayor que 30.

  Mientras el comprobante siga en la caché, el consumo **no** se poda, tenga la antigüedad que
  tenga: la línea todavía existe y, sin su consumo, se acreditaría de nuevo (sobreventa). La
  condición 2 es la que protege la pérdida de la caché: si la caché se pierde y la libreta no, el
  refresco vuelve a traer hoy y ayer, y sus consumos son recientes, así que no se podan.
  **Prohibido** medir la antigüedad del consumo en horas contra la `referencia` (bug del hallazgo
  1: una línea del día D a las 20:00 ART tenía su consumo podado el D+30 a las 21:00 mientras la
  caché la conservaba hasta el D+31). Lo fijan los dos casos "Ronda 3" de
  `test/libreta-ledger-checkpoint.test.js`.

  **Ronda 4.** Las dos condiciones son **independientes** y se exigen las dos: podar un consumo
  mirando solo el día de su `referencia` (condición 2) sin comprobar que el comprobante ya salió
  de la caché (condición 1) está **prohibido**, aunque con una caché coherente den lo mismo. La
  condición 1 se evalúa contra la caché **después** de sus podas de esta corrida (al cargar y en
  el refresco). Lo fijan los tres casos "Ronda 4" de `test/libreta-ledger-checkpoint.test.js`:
  una entrada con `dia` de hace 10 días y un consumo de hace 40 (condición 1 sola); la venta de
  las 23:30 ART vista al día siguiente (`dia` recalculado al pasar a `ok`); y la falla del
  guardado de la caché seguida de `/search` caído (poda al cargar).

### 4.2 `syncUnSku` con dependencias inyectables (ronda 3)

```js
export async function syncUnSku(sku, manualQty = null, deps = {})
```

`deps` es **opcional y parcial**: cada clave que falta toma el valor real. Las llamadas de dos
argumentos (`main` en `src/main.js`, modo `--sku`, que hace `d.syncUnSku(modo.sku, modo.qty)`; y
`test/sku-individual-usa-libreta-por-par.test.js`) no cambian. Desde la ronda 3 `src/index.js` no
llama a `syncUnSku`: delega todo en `main` (sección 7.1).

| clave de `deps` | real por defecto | uso |
|---|---|---|
| `rutaSnapshotPara(stateKey)` | `rutaSnapshotPara` (`.cache/` del repo) | ruta de la libreta del DOT (`"dot"`) |
| `cargarLibretaCompleta(ruta)` | `cargarLibretaCompleta` | leer baseline, `corte`, `consumos`, `resembradoEn` |
| `guardarSnapshot(snap, ruta, contabilium, contabilidad)` | `guardarSnapshot` | la única escritura de la libreta |
| `getStockDeposito(depositoId, sesion)` | `getStockDeposito` | solo sin `manualQty` |
| `resolverSku(sku, locationId)`, `setearStock(inventoryItemId, quantity, changeFromQuantity, locationId)` | los de `src/shopify.js` | Shopify |
| `esDryRun()` | `esDryRun` | |
| `ahora()` | `() => new Date()` | `tInicioLectura` |

- `locationId` sigue siendo `process.env.SHOPIFY_DOT_LOCATION_ID`, como hoy.
- **Rutas (ronda 4, interfaz fijada).** Toda la E/S de disco de `syncUnSku` pasa por `deps`, con
  una sola ruta:
  1. `const ruta = d.rutaSnapshotPara("dot")`, donde `d` son las `deps` completadas con las reales.
     **Prohibido** usar la `rutaSnapshotPara` importada (hoy `src/sync.js:332`) o `SNAPSHOT_PATH`
     cuando `deps` trae `rutaSnapshotPara`.
  2. La lectura es `d.cargarLibretaCompleta(ruta)` y la escritura `d.guardarSnapshot(snap, ruta, ...)`,
     con **esa** `ruta` y siempre explícita (un `guardarSnapshot` sin ruta cae en el `SNAPSHOT_PATH`
     del repo). Si `syncUnSku` migra la libreta legada, es con `d.migrarLibretaLegada(d.SNAPSHOT_PATH, ruta)`.
  3. Ninguna otra escritura de disco. En particular, no se combina un `guardarSnapshot` importado
     con `d.esDryRun()`: si `deps` trae `guardarSnapshot`, se usa ese.
- Las claves tienen los mismos nombres y firmas que en `DEPS_REALES`/`ejecutarPar`, así que el
  `depsFake` de `test/_helpers-clasificador.js` sirve tal cual. Los casos CA-7 (g) y (h) llaman
  `syncUnSku(sku, qty, depsFake({ dir, ..., encierro }))` sobre un directorio temporal. **No**
  respaldan ni restauran `.cache/last-sync.dot.json`: `node --test` corre
  `test/sku-individual-usa-libreta-por-par.test.js` en otro proceso, en paralelo, y ese sí lo
  respalda y restaura; una restauración desde acá le pisaría el estado a mitad de su caso. En su
  lugar, tres redes de seguridad que **impiden** la escritura en vez de deshacerla:
  1. `DRY_RUN=true` en el entorno y un `fetch` que lanza (si se ignora `deps` entera, no escribe
     en Shopify ni sale a la red);
  2. `encierro` en `depsFake`: `rutaSnapshotPara`, `cargarLibretaCompleta`, `guardarSnapshot`,
     `migrarLibretaLegada` y las del registro anotan la ruta y **lanzan antes de tocar el disco** si
     no está dentro del directorio temporal. El test assierta que `rutaSnapshotPara("dot")` se
     llamó, que cada `cargarLibretaCompleta` y cada `guardarSnapshot` usó exactamente
     `<dir>/last-sync.dot.json`, y que no hubo violaciones;
  3. `guardiaDeEscriturasEnRepo(t)`: mientras corre el caso, **cualquier** escritura del proceso
     (`node:fs` sincrónico, con callback o con promesas, también con import nombrado, vía
     `syncBuiltinESMExports`) sobre una ruta dentro del repo lanza y queda anotada. Cubre el
     camino que (2) no ve: el `guardarSnapshot` importado con la ruta importada y el `esDryRun` de
     `deps` (`false`). El test assierta que la lista quedó vacía.
- La escritura de la libreta: con `contabilidad = null` (3 argumentos) cuando no siembra, que
  conserva todo lo que hay en disco; o con `contabilidad = { corte, consumos, resembradoEn }`
  armada desde lo **cargado** más el `resembradoEn[sku]` nuevo, cuando siembra. Nunca con un
  `resembradoEn` o unos `consumos` vacíos o parciales.

## 5. `ejecutarPar` — orden y opciones

```js
export async function ejecutarPar(par, deps = DEPS_REALES, {
  full = false, checkpointCada = CHECKPOINT_CADA, escrituraAbsoluta = null,
  margenAcreditacionMs = MARGEN_ACREDITACION_MS,   // 5 min (D-6)
  topeDetalles = 60,                                // D-6
} = {})
```

1. `par.pendiente` → devuelve sin tocar **ninguna** dep (igual que hoy; `test/par-isla-pendiente`).
2. Libreta y registro se cargan **sincrónicamente**, antes del primer `await` (mismo motivo que el
   comentario actual de `src/sync.js:508-513`).
3. `tInicioLectura = deps.ahora()` **antes** de `await deps.getStockDeposito(depositoId, sesion)` (R-9).
4. `corte = libreta.corte ?? tInicioLectura` (primera corrida o libreta perdida, R-11).
5. Líneas del depósito del par con `referencia < corte` y sin consumir → consumidas `pre-corte`
   (también las que aparecen en refrescos posteriores, por ejemplo ids que quedaron pendientes por
   tope o error en la primera corrida). Suman `creditos_pre_corte` en unidades. En el mismo paso,
   y otra vez después del refresco, se aplica `resembradoEn` (sección 4.1): líneas de un SKU
   resembrado con `referencia < resembradoEn[sku]` → consumidas `absoluto`/`sembrado`.
6. **¿Refresco?** Sí si algún SKU (no `NO_SINCRONIZABLE`) tiene baseline y `cantidad !== baseline`,
   o si queda alguna línea del depósito del par sin consumir. Un SKU sembrado no dispara. **Como
   máximo un refresco por corrida**, compartido por los pares (`correrTodosLosPares` le pasa a cada
   `ejecutarPar` un contexto de corrida interno con la sesión, el registro y el resultado del
   refresco).
7. **Refresco**: un solo `deps.buscarComprobantes({ fechaDesde, fechaHasta }, sesion)`:
   - `fechaHasta` = día ART de `tInicioLectura`;
   - sin `ultimoRefrescoOk` → `fechaDesde` = ayer;
   - `ultimoRefrescoOk` del mismo día ART → `fechaDesde` = hoy;
   - si no, `fechaDesde` = día ART de `ultimoRefrescoOk`, nunca antes de hoy − 6 (máximo 7 días
     consultados, hoy incluido).
   Con la búsqueda OK: `ultimoRefrescoOk = tInicioLectura`; los días anteriores a hoy consultados
   entran a `diasCerrados`. Ids nuevos `COT` → `ok` sin detalle. Resto → `pendiente`. Se piden
   como máximo `topeDetalles` ids, **primero los pendientes viejos** (id ascendente), después los
   nuevos en el orden de `/search`, en **una sola** invocación de `deps.fetchComprobantesDetalle`
   (ninguna si la lista está vacía). Un id ya `ok`/`ilegible` no se vuelve a pedir nunca. Si
   `fetchComprobantesDetalle` rechaza entera, todos esos ids quedan `pendiente`.
8. **Loop**. Atajo incremental solo si `!alcanzaAbsoluta && !full && snapshotPrevio[sku] === cantidad`
   **y el SKU no tiene crédito acreditable**. Para cada SKU resuelto:
   - compuerta o sembrado → valor absoluto; `resembradoEn[sku] = tInicioLectura`; las líneas del
     SKU con `referencia < tInicioLectura` (sin margen: el absoluto ya las incorpora; dejarlas
     pendientes inflaría Shopify) se consumen con motivo `absoluto` o `sembrado`, las ya
     registradas ahora y las que se registren en refrescos posteriores (sección 4.1); las
     posteriores siguen pendientes;
   - si no → regla contable con `creditoAcreditable`.
   El crédito se marca consumido **solo** si el resultado es `actualizado` o `sin_cambios` (en
   `dry` se calcula pero no se persiste). `error`, `ambiguo`, `no_encontrado`, `no_activado` o no
   alcanzado → ni baseline ni consumo.
9. Checkpoint y guardado final: `deps.guardarSnapshot(snapshotNuevo, ruta, contabiliumNuevo, { corte, consumos, resembradoEn })`
   (`resembradoEn` completo: lo cargado más lo resembrado en esta corrida; lo fija CA-7 (d)).
   Son las **únicas** llamadas a `guardarSnapshot` de `ejecutarPar` (igual que hoy): el `corte` y
   las marcas `pre-corte` viajan en la primera de ellas, no en un guardado extra al empezar. Los
   tests de interrupción hacen fallar "el segundo `guardarSnapshot`" y cuentan con eso.
10. Imprime el resumen (sección 6) y devuelve los contadores.

## 6. Resumen, log y salida

`ejecutarPar` devuelve los contadores de hoy (`actualizado`, `dry`, `sin_cambios`, `no_encontrado`,
`no_activado`, `error`, `ambiguo`, `no_sincronizable`, `saltado`, `total`, `planDry`) más:

| campo | qué es |
|---|---|
| `clasificador` | `no_requerido` (no hizo falta refresco) · `ok` · `parcial` (quedaron ids pendientes **solo** por el tope) · `fallo` (falló `/search`, el presupuesto, falta la dep, o algún detalle pedido en **esta** corrida falló y su id quedó `pendiente`). Un id que en esta corrida pasa a `ilegible`, o que ya era `ilegible`, **no** produce `fallo` (ronda 2) |
| `causa_venta_shopify` | **unidades** acreditadas por la regla contable en esta corrida |
| `causa_desconocida` | con `clasificador` `fallo` o `parcial`: SKUs con delta no sembrado y `delta + credito !== 0`. Con `ok`: 0 |
| `creditos_pendientes` | unidades del depósito del par sin consumir al terminar |
| `creditos_pre_corte` | unidades marcadas `pre-corte` en esta corrida |
| `creditos_vencidos` | unidades podadas sin consumir (30 días) |
| `notas_credito_shopify` | notas de crédito Shopify/25020 del depósito registradas en esta corrida |
| `comprobantes_pedidos` | ids de detalle pedidos en esta corrida |
| `comprobantes_pendientes` | ids en estado `pendiente` en el registro al terminar |
| `comprobantes_ilegibles` | ids en estado `ilegible` en el registro al terminar (ronda 2). Se sigue mostrando en cada corrida hasta que la poda de 7 días los borra: es la forma visible de que hay comprobantes que el clasificador no pudo leer, sin dejar la corrida en rojo para siempre |

- **Resumen impreso**: un solo `console.log` por par, con el formato
  `[RESUMEN] <par.nombre>: clave=valor clave=valor ...` que incluye como mínimo todas las claves de
  la tabla más los contadores de hoy. Sin SKUs (el repo y sus logs son públicos).
- **Log de error**: `console.error("[CLASIFICADOR][ERROR] <par.nombre>: <err.message>")`, **una
  vez por corrida**. Nunca una línea por SKU para `causa_desconocida` (ADR 0001:45-46).
- **Ronda 3 (CA-4): ninguna línea nombra un SKU de `causa_desconocida`.** Con la salvedad de las
  líneas de escritura que `ejecutarPar` ya imprime hoy, con su formato **exacto** y sin nada
  agregado:
  `  [SET] <par.nombre>/<sku>: <antes> -> <después>` y
  `  [DRY] <par.nombre>/<sku>: actualizaria <antes> -> <después> (no se escribe, DRY_RUN=true)`.
  Ninguna otra línea de log (de cualquier canal y con cualquier palabra, diga o no
  "desconocida") puede contener el código de un SKU contado en `causa_desconocida`. No se puede
  agregar la causa, el crédito ni un aviso a las líneas `[SET]`/`[DRY]`. Por qué la salvedad:
  CA-4 dice "ninguna línea", pero esos SKUs se escriben (R-4: se aplica el delta) y la línea
  `[SET]` preexistente los nombra. Ver "Choques" en `rojo-2026-11-02.md`, ronda 3.
  "Cualquier canal" (ronda 4): el test captura `console.log`, `warn`, `error`, `info`, `debug`,
  `trace` y `dir`, y el texto escrito directo en `process.stdout`/`process.stderr`.
- **`evaluarCorrida`** (`src/resultado.js`): después de los chequeos actuales, si
  `resumen.clasificador === "fallo"` → `{ ok: false, motivo }` con un motivo que menciona el
  clasificador. `parcial`, `ok`, `no_requerido` o ausente no cambian nada.
- **Salida** (reescrito en la ronda 5b, en términos de `main`, sección 7.1): en el modo por defecto
  y en `--full`, `main` devuelve `1` cuando `evaluarCorridaMultiPar` da `ok: false`, y `src/index.js`
  hace `process.exit(codigo)` con lo que devuelve `main`. El veredicto se calcula después de que
  `correrTodosLosPares` terminó (escrituras aplicadas y libretas guardadas). No hace falta otro
  camino.

### 6.1 Compuerta no aplicada (ronda 5, R-15/CA-15; revisión de código del 02/11, I-1)

Problema: con `ESCRITURA_ABSOLUTA=IEY-C09-GRIX` (tipeo), o con un SKU que queda `no_encontrado`,
`no_activado`, `ambiguo` o `error` en todos los pares, no se escribe ningún absoluto y la corrida
sale 0 (`src/sync.js:1005`, `1092-1103`; `src/main.js:75-77`). Invariante 5.

**Dónde se calcula cada cosa:**

| qué | dónde | por qué ahí |
|---|---|---|
| conteos por par | `ejecutarPar` (cada par) | es el único que sabe qué `resultado` tuvo cada SKU alcanzado |
| SKUs no aplicados (condiciones a y b, abajo) | `evaluarCorridaMultiPar(porPar, umbral, { escrituraAbsoluta })`, pura | es el único punto que ve todos los pares **y** el veredicto; sigue siendo pura y testeable sin IO |
| línea `[COMPUERTA][ERROR]` y código de salida | `main` (`src/main.js`), con el veredicto | `main` ya imprime `[FALLO]` y decide el código; `evaluarCorridaMultiPar` no loguea |

**Por par (`ejecutarPar`)**, dos claves nuevas en el `[RESUMEN]` y en el valor devuelto, **siempre
presentes** (0 con la compuerta apagada):

| clave | qué cuenta |
|---|---|
| `compuerta_pedidos` | SKUs del stock leído del depósito del par para los que `escrituraAbsolutaAlcanzaA(sku)` es verdadero (con una lista: los de la lista que están en ese stock; con `todos`: todos los del stock) |
| `compuerta_aplicados` | de esos, los que terminaron en `actualizado`, `sin_cambios` **o `dry`** con el absoluto |

Además, el valor devuelto (no el `[RESUMEN]`: el resumen no nombra SKUs) lleva

```js
compuertaSkus: {
  pedidos: string[],      // los de compuerta_pedidos
  aplicados: string[],    // de los pedidos, actualizado | sin_cambios | dry con el absoluto
  noActivados: string[],  // de los pedidos, no_activado (ronda 5b)
}
```

con los SKUs de cada conjunto. Un pedido que no está en `aplicados` ni en `noActivados` quedó en
cualquier otro estado (`error`, `ambiguo`, `no_encontrado`, `no_sincronizable`, ...): el cruce no
necesita saber cuál. Un par `pendiente` no lo trae y no aplica nada. **Por qué `noActivados` y no
un mapa sku → estado** (ronda 5b): el cruce solo distingue tres casos (aplicado, tolerado, fallido),
y una lista por caso es lo mínimo que lo expresa; `pedidos` ya estaba y no cambia de forma.

**`dry` cuenta como aplicado.** En `DRY_RUN` ningún SKU se escribe. Si `dry` no contara, ensayar la
compuerta en `dry_run` (lo que el workflow recomienda para validar) saldría siempre en rojo, y el
rojo dejaría de decir algo. Es la misma regla de `evaluarCorrida`, que cuenta `dry` como efectivo, y
de la libreta, que avanza el baseline de un `dry` en memoria. El tipeo se detecta igual en `DRY_RUN`
(nadie lo pide ni lo aplica).

**Cruce (`evaluarCorridaMultiPar(porPar, umbral = UMBRAL_ERROR_DEFECTO, opciones = {})`):**

- Si `opciones.escrituraAbsoluta` es un `Set`, un SKU del `Set` va a `noAplicados` si se cumple
  **cualquiera** de estas dos condiciones (ronda 5b, decisión del orquestador por la invariante 5):
  - **(a)** no figura en `compuertaSkus.aplicados` de **ningún** par (un par sin `compuertaSkus`,
    por ejemplo uno `pendiente`, no aplica nada);
  - **(b)** en algún par **no pendiente** donde figura en `compuertaSkus.pedidos` (está en el stock
    del depósito del par), no figura ni en `aplicados` ni en `noActivados`: quedó `error`,
    `ambiguo`, `no_encontrado` u otro estado que no es aplicado ni `no_activado`.
  Si `noAplicados` no está vacío, `ok: false`, con un `motivo` que menciona la compuerta, aunque
  todos los pares estén bien. `detalle[par].ok` **no** cambia por esto: el rojo es de la corrida,
  no de un par.
- Devuelve siempre `compuertaNoAplicados: string[]` (vacío si no hay).
- **Solo `no_activado` se tolera** en un par si el SKU se aplicó en otro. Hoy la isla de Galerías
  tiene la mayoría de los SKUs `no_activado`, y ponerla en rojo haría inutilizable la compuerta. Lo
  deja visible el `[RESUMEN]` de ese par: `compuerta_aplicados < compuerta_pedidos`. Hasta la ronda
  5 se toleraba **cualquier** estado si el SKU se aplicó en otro par; `revisor-alcance` mostró que
  así un SKU en `error` o `ambiguo` en el **DOT** y aplicado en la isla salía 0 sin ninguna línea
  que lo nombrara. Lo fijan los escenarios 4b/4c y los casos puros 9e a 9i de
  `test/compuerta-no-aplicada.test.js`.
- Un SKU de la lista que no está en el stock de un par (no está en sus `pedidos`) no activa (b) en
  ese par: el depósito no lo tiene y no hay nada que aplicar ahí.
- Con `escrituraAbsoluta` `null`, ausente o `"todos"`: no hay regla por SKU. Con `todos` no hay una
  lista contra la cual contrastar, y una corrida en la que no se aplicó nada ya cae en la regla de
  siempre (`efectivos === 0`).
- Se suma a las reglas de siempre: no reemplaza ninguna (umbral de error, total 0, `clasificador`
  `fallo`, todos pendientes).

**`main`**: pasa `{ escrituraAbsoluta: modo.escrituraAbsoluta }` como tercer argumento de
`evaluarCorridaMultiPar`, en el modo por defecto y en `--full`.

**`main` tolera un veredicto sin `compuertaNoAplicados`** (ronda 5b, importante 1 de
`revisor-alcance`): lo trata como `[]`, por ejemplo con `veredicto?.compuertaNoAplicados ?? []`.
Por qué: `deps.evaluarCorridaMultiPar` es inyectable, y el doble congelado de
`test/index-argv.test.js:228-231` devuelve `{ ok: true, motivo, detalle: {} }`, sin ese campo. Un
`main` que hiciera `veredicto.compuertaNoAplicados.length` lanzaría `TypeError` y rompería los
casos de la ronda 3 (`index-argv.test.js:270`, `:282` y `:286-302`). La garantía "devuelve siempre
`compuertaNoAplicados`" es del `evaluarCorridaMultiPar` real, no de cualquier dependencia que se
inyecte. El doble no se modifica.

Si la lista no está vacía, imprime con `console.error` **una** línea:

```
[COMPUERTA][ERROR] <n> SKU(s) de ESCRITURA_ABSOLUTA no quedaron aplicados: <sku>, <sku>
```

Texto mínimo que fija el test: empieza con `[COMPUERTA][ERROR]`, aparece una sola vez y contiene
cada SKU no aplicado y ninguno de los aplicados. Después siguen el `[FALLO]` y el código 1 de
siempre.

- **Nombrar los SKUs sí vale.** La lista es manual y corta, el operador necesita saber cuál falló, y
  el workflow ya la imprime en "Alcance". Es la **excepción explícita** a "ningún SKU en el log" de
  la sección 6, y **no choca con CA-4**: el control de CA-4 mira los SKUs contados en
  `causa_desconocida`, y un SKU de la compuerta nunca se cuenta ahí (rama del absoluto,
  `src/sync.js:1049-1052`). Además, CA-4 llama a `ejecutarPar`, no a `main`, que es quien imprime
  la línea. El `[RESUMEN]` sigue sin nombrar SKUs.
- **Sin reabrir N-10.** Los SKUs vienen de un valor libre del entorno. Ni esta línea, ni el
  `motivo` del veredicto (que `main` imprime en `[FALLO]`), ni la línea `[USO]` pueden formar un
  comando de workflow. Eso incluye las dos formas que acepta el runner (sección 8): una línea física
  que empieza con `::` (el valor trae `\n` o `\r`) y, **ronda 5b**, un `##[` en **cualquier**
  posición de la línea (formato viejo). Una línea que imprime node empieza con `[COMPUERTA]`, nunca
  es un comando `::`, así que un SKU con `##[` adentro la convierte en un comando del formato viejo.
  `JSON.stringify` escapa `\n` y `\r`, pero **no** toca `##[`. Formas aceptadas, cualquiera:
  1. **Sanear la línea**: reemplazar los caracteres de control y neutralizar `::` y `##[` en cada
     SKU que se imprime (por ejemplo, `#` → `%23`, o un reemplazo visible como `#⁠#[`); la
     corrida sigue y la línea nombra el SKU saneado.
  2. **Rechazar el valor**: `parsearEscrituraAbsoluta` (o `resolverModo`) lanza `ErrorDeUso` ante
     un SKU con caracteres de control, `::` o `##[`, y `main` devuelve 2 antes de llamar a
     ninguna dependencia. El mensaje de `[USO]` no lleva el valor crudo.
  El caso 8 acepta las dos: con código 2 exige que el sync no haya corrido; con otro código exige
  `≠ 0` y al menos una línea `[COMPUERTA][ERROR]`. En los dos casos pasa **toda** la salida de
  `main` por el simulador del runner (`test/_helpers-comandos-workflow.js`) y exige cero comandos
  y ninguna pausa `stop-commands`.

## 7. `src/index.js` y `argv` estricto — módulo nuevo `src/argv.js`

```js
export class ErrorDeUso extends Error { /* name = "ErrorDeUso", codigoSalida = 2 */ }
export function resolverModo(argv, env = {}) ->
  { modo: "locations" | "sku" | "cron" | "full" | "incremental", sku, qty, escrituraAbsoluta }
```

- `node:util` `parseArgs({ args: argv, strict: true, allowPositionals: false, options: { sku: string, qty: string, cron: boolean, full: boolean, locations: boolean } })`.
  **No** se declaran `--escritura-absoluta` ni `--motivo`: esos valores viajan solo por entorno
  (R-6). Token desconocido, posicional, opción sin valor, o valor que empieza con `-` (por ejemplo
  `--sku --cron`) → `ErrorDeUso`.
- El modo depende **solo** de `argv`. `escrituraAbsoluta` sale de `env.ESCRITURA_ABSOLUTA`:
  vacío → `null`; `todos` → `"todos"`; lista con comas → `Set` de SKUs normalizados. Que valga
  `--full` o `--cron` no cambia el modo. `MOTIVO` no lo leen `main` ni `resolverModo` (lo imprime
  el workflow).
- **`--qty` (ronda 5, N-9; invariante 6):** vale si `Number(valor)` es un entero seguro `>= 0` **en
  valor** (`Number.isSafeInteger`), y `qty` es ese número. `"3"` y `"3.0"` dan `3`, y `"0"` da
  `0`. `"2.5"`, `"1e-1"`, `"3.0001"`, `"0.5"`, `"abc"`, `"Infinity"` y `"NaN"` son `ErrorDeUso`
  (salida 2), antes de llamar a cualquier dependencia. Los negativos ya caen por la regla del valor
  que empieza con `-`. No se fija la forma textual: `"1e2"` es 100 y vale. Hoy
  (`src/argv.js:71-72`) se valida con `Number.isFinite` y `syncUnSku` guarda `2.5` como baseline
  (`src/sync.js:437-438`).
- `main` (sección 7.1) hace `try { resolverModo(argv, env) } catch (e) { if (e instanceof ErrorDeUso) { console.error(...); return 2 } throw e }`
  **antes** de crear sesión, leer libretas o llamar a Contabilium o Shopify, y `src/index.js`
  sale con ese `2` (`process.exit(codigo)`). Hasta la ronda 2 esto lo hacía `index.js`.
- **`parsearEscrituraAbsoluta` (ronda 5b, opcional).** Puede rechazar como `ErrorDeUso` (salida 2)
  un SKU con caracteres de control, `::` o `##[`. Es una de las dos formas aceptadas de que la
  línea `[COMPUERTA][ERROR]` no forme un comando de workflow (sección 6.1); la otra es sanear la
  línea. Si rechaza, el mensaje de `ErrorDeUso` que `main` imprime en `[USO]` tampoco puede formar
  un comando (no incluye el valor crudo).

### 7.1 `main(argv, env, deps)` — módulo nuevo `src/main.js` (ronda 3, R-13/CA-13, forma (a))

Hallazgo 2 de `revisor-alcance`: si `resolverModo` se prueba solo como función pura, un `index.js`
que valida `argv` pero no pasa `escrituraAbsoluta` a `correrTodosLosPares` (o la pasa en un solo
camino) deja todo en verde con la compuerta muerta. Se elige la **forma (a)**: el cableado entero
pasa a una función importable sin efectos.

```js
// src/main.js — importarlo NO tiene efectos: no importa "dotenv/config", no lee process.env ni
// process.argv, no llama process.exit, no importa node-cron en el nivel superior (solo con
// import() dinámico dentro del modo cron).
export async function main(argv, env, deps = {}) -> Promise<number | null>
```

- `argv` y `env` son los únicos orígenes de datos: `main` llama `resolverModo(argv, env)` y nunca
  mira `process.env` ni `process.argv`.
- Devuelve el código de salida: `2` ante `ErrorDeUso` (sin llamar a ninguna dep), `0`/`1` según
  `evaluarCorridaMultiPar` en los modos por defecto y `--full`, `null` en `--cron` (el proceso sigue
  vivo). `main` **no** llama `process.exit`.
- `deps`, todas opcionales (si falta, la real):

  | clave | real |
  |---|---|
  | `correrTodosLosPares(pares, depsSync, opciones)` | `correrTodosLosPares` de `src/sync.js` |
  | `construirPares(env)` | `construirPares` de `src/pares.js`, llamado con el `env` recibido |
  | `evaluarCorridaMultiPar(porPar, umbral, { escrituraAbsoluta })` | el de `src/resultado.js` (tercer argumento desde la ronda 5, sección 6.1) |
  | `syncUnSku(sku, qty)` | el de `src/sync.js` |

- **La compuerta llega al sync en los dos caminos**: en el modo por defecto,
  `correrTodosLosPares(pares, <deps reales o undefined>, { escrituraAbsoluta })`; en `--full`,
  `correrTodosLosPares(pares, <ídem>, { full: true, escrituraAbsoluta })`, con `escrituraAbsoluta`
  tal como la devuelve `resolverModo` (`null`, `"todos"` o un `Set`).
- `src/index.js` queda reducido a: `import "dotenv/config"`, importar `main` de `./main.js`,
  `const codigo = await main(process.argv.slice(2), process.env)` y `if (codigo !== null)
  process.exit(codigo)`. **No** llama `correrTodosLosPares` por su cuenta. El test lo verifica
  leyendo el texto de `src/index.js` (importa de `./main.js`, llama
  `main(process.argv.slice(2), process.env…)` y no contiene `correrTodosLosPares(`): es la única
  forma de atar el cableado real a `main` sin ejecutar `index.js` contra el `.cache/` del repo.
- **Forma exacta de `index.js` (ronda 4, importante 3 de `revisor-alcance`).** El control anterior
  se eludía importando con alias (`import { correrTodosLosPares as correr } from "./sync.js"`) o
  pasándole a `main` un tercer argumento que reemplaza el cableado. Sin contar comentarios,
  `index.js`:
  1. importa **solo** dos módulos, con estas dos formas exactas: `import "dotenv/config";` e
     `import { main } from "./main.js";` (sin alias, sin namespace, sin `import()` dinámico, sin
     `require`, `createRequire`, `eval` ni `Function`, sin `export`);
  2. contiene la llamada `main(process.argv.slice(2), process.env)` **exactamente una vez**, con
     **dos** argumentos, y ninguna otra llamada a `main`;
  3. menciona el identificador `main` solo en ese import y en esa llamada, y `process.argv` y
     `process.env` solo dentro de esa llamada;
  4. no menciona `correrTodosLosPares`, `syncUnSku`, `ejecutarPar`, `syncTodos` ni `resolverModo`.
  Ejemplo que cumple:
  ```js
  import "dotenv/config";
  import { main } from "./main.js";

  const codigo = await main(process.argv.slice(2), process.env);
  if (codigo !== null) process.exit(codigo);
  ```
  Lo fija el caso "CA-13 (ronda 4): src/index.js importa solo ..." de `test/index-argv.test.js`.
  Además, `deps.construirPares` se llama una vez, con el `env` recibido, en el modo por defecto; y
  ante un `ErrorDeUso` no se llama a ninguna dep, tampoco a `construirPares` ni a
  `evaluarCorridaMultiPar`.
- Lo prueban los casos "Ronda 3" de `test/index-argv.test.js`, con `deps.correrTodosLosPares`
  simulado. Los subprocesos de los casos que salen con 2 siguen igual.
- **El respaldo real es el importado (ronda 5b, nota 7 de `revisor-alcance`).** El caso de
  `test/migracion-libreta-legada.test.js` que verifica la cadena `index.js` → `main.js` → `sync.js`
  suma un eslabón 4, sin fijar el estilo del cableado. Sin contar comentarios, `main.js`:
  - usa el `correrTodosLosPares` importado como **valor** fuera del import (no cuentan
    `deps.correrTodosLosPares` ni la clave `correrTodosLosPares:`);
  - si tiene un respaldo `deps.correrTodosLosPares ?? X` o `|| X`, o una desestructuración
    `correrTodosLosPares: y = X`, ese `X` es `correrTodosLosPares`;
  - no menciona `ejecutarPar` ni `migrarLibretaLegada`.
  Por qué estas tres y no "el respaldo tiene que ser `deps.correrTodosLosPares ?? correrTodosLosPares`":
  la primera impide un import muerto; la segunda cierra el patrón exacto que encontró el revisor
  (`deps.correrTodosLosPares ?? correrPares`); la tercera cierra una copia local del orquestador
  con cualquier nombre y cualquier forma de cablearla, porque toda copia necesita `ejecutarPar` (o
  migrar la libreta), y `main` no tiene por qué usar ninguno de los dos. El `src/main.js` actual
  (`correrTodosLosPares: deps.correrTodosLosPares ?? correrTodosLosPares`, `src/main.js:69`) pasa
  las tres.

**Por qué un módulo aparte y no importar `index.js`.** `index.js` corre al importarse y su primera
línea es `import "dotenv/config"`: importarlo desde un test cargaría el `.env` real del repo en el
proceso de test (AGENTS.md: nunca leer `.env`) y arrancaría una corrida. Separar la decisión de modo
en `src/argv.js`, puro, deja testear la lógica sin efectos. El cableado real se prueba lanzando
`src/index.js` como subproceso: con `cwd` en un directorio temporal (dotenv no encuentra ningún
`.env`), un entorno armado desde cero, y `CONTABILIUM_API_URL` apuntando a un servidor HTTP local
que cuenta requests. Esos subprocesos solo cubren los casos que tienen que salir con 2: salen antes
de leer la libreta, así que no tocan el `.cache/` del repo. Un subproceso que corriera de verdad la
corrida incremental tocaría `.cache/` del repo (`SNAPSHOT_PATH` y `migrarLibretaLegada` usan rutas
del repo, no del `cwd`), y por eso no se usa.

## 8. Workflow — `.github/workflows/sync.yml`

- El step "Correr sync" deja de pasar `--escritura-absoluta "$ESCRITURA_ABSOLUTA" --motivo "$MOTIVO"`:
  `ESCRITURA_ABSOLUTA` llega por `env:`; `src/index.js` le pasa `process.env` a `main`, y `main` la
  lee solo del `env` que recibe (vía `resolverModo`). `MOTIVO` puede seguir en el `env:` o salir del
  step; no se usa en `node`.
- El step "Validar compuerta manual" sigue leyendo por `env:`, entre comillas. El test lo
  **ejecuta** con `bash` con varias combinaciones de entorno, no solo lo lee.
- **Ronda 3 (R-6/CA-6)**: un `MOTIVO` de solo espacios en blanco (espacios, tabs, saltos de línea)
  cuenta como vacío y hace fallar el step si `ESCRITURA_ABSOLUTA` no está vacío. Hoy el
  `[ -z "$MOTIVO" ]` de `.github/workflows/sync.yml:85` lo deja pasar. Y ningún `run:` puede
  contener `${{ env.MOTIVO }}` ni `${{ env.ESCRITURA_ABSOLUTA }}`: es la misma inyección que
  `${{ inputs.* }}` (Actions expande la expresión en el texto del script antes de que corra bash).
- **Ronda 5 (R-6/CA-6; revisión de código del 02/11, N-10): inyección de comandos de workflow.**
  El runner toma como comando toda línea de la salida que empieza con `::nombre ...::`. Hoy
  `.github/workflows/sync.yml:91` hace `echo "::warning::... Alcance: $ESCRITURA_ABSOLUTA — Motivo: $MOTIVO"`.
  Un `motivo` o un `escritura_absoluta` con `\n` o `\r`, que la API de `workflow_dispatch` acepta,
  emite una línea propia `::error::`, `::add-mask::`, `::stop-commands::`, etc. Los dos inputs son
  texto libre y valen las mismas reglas.

  **Cómo parsea el runner (ronda 5b, verificado por el orquestador en `actions/runner`, rama
  main).** `src/Runner.Worker/ActionCommandManager.cs`, `TryProcessCommand`: prueba
  `ActionCommand.TryParseV2` y, si no parsea, `ActionCommand.TryParse` (formato viejo), **sin flag
  que lo apague**. `src/Runner.Common/ActionCommand.cs`: `TryParseV2` hace `TrimStart()` y exige
  `StartsWith("::")` (desescapa `%0D`, `%0A`, `%25`); `TryParse` busca `IndexOf("##[")` en
  **cualquier posición** de la línea, sin recortar (desescapa `%3B`, `%0D`, `%0A`, `%5D`, `%25`).
  El token de `stop-commands` se compara con `OrdinalIgnoreCase`. Consecuencias: una línea que es
  un comando `::` válido gana como V2 y un `##[` en sus datos queda como dato; **toda otra línea
  con `##[` en cualquier lugar es un comando** (`Motivo: recuento ##[error]X`). Escapar `%`, CR y
  LF no alcanza para un valor impreso fuera de un comando `::`.

  **Regla (la verifica la salida, no el texto del YAML):** con cualquier valor de los dos inputs,
  la salida del step "Validar compuerta manual", partida en `\r\n`, `\r` y `\n`, tiene **como
  máximo un** comando efectivo, contando como comando una línea que, recortada al inicio, empieza
  con `::`, y una línea que no es comando `::` y contiene `##[`. Ese comando es `::warning::` o
  `::error::`, es el que el step emite a propósito y su texto no empieza con el valor. No queda un
  `::stop-commands::` abierto ni uno cuyo token salga del valor. Si el step termina con 0, el valor
  sigue apareciendo en el log (R-6: auditable), escapado o no. El simulador vive en
  `test/_helpers-comandos-workflow.js` y es conservador (cuenta de más, nunca de menos).

  **Arreglos aceptables** (cualquiera, o una combinación; redefinidos en la ronda 5b):
  1. **(a) El valor solo dentro del comando `::`**: los dos valores se imprimen únicamente dentro de
     los datos del único `::warning::` (o `::error::`) del step, escapados como define GitHub:
     `%` → `%25`, `\r` → `%0D` y `\n` → `%0A`, con el `%` primero. Por ejemplo,
     `m="${MOTIVO//'%'/%25}"; m="${m//$'\r'/%0D}"; m="${m//$'\n'/%0A}"`. Ninguna otra línea del step
     lleva el valor: en una línea propia, aun escapado, un `##[` es un comando del formato viejo.
  2. **(b) Rechazar** como **error de validación** un valor con `\r`, `\n` (o cualquier carácter de
     control), `::` o `##[`: el step sale distinto de 0 **antes** del sync, con un `::error::` de
     texto fijo que no incluye el valor. El rechazo vale para los dos inputs. Un motivo multilínea
     o con `::`/`##[` no tiene uso legítimo: el input es un campo de una línea en la UI.
  3. **(c)** `::stop-commands::<token>` antes de imprimir y `::<token>::` después, con un token que
     **no se repite** entre corridas (por ejemplo, `$(openssl rand -hex 16)`). Durante la pausa el
     runner no procesa ni `::` ni `##[`. No vale una expresión `${{ ... }}` dentro del `run:`: el
     test ejecuta el script con `bash`, y ahí `${{` es un error de sintaxis. El test corre una vez
     con valores benignos, toma el token y lo reusa en un payload: un token fijo falla.

  **No aceptables:** imprimir con `printf '%s\n' "$MOTIVO"` "sin el prefijo". Una línea del valor
  que empiece con `::` sigue siendo un comando, y con `\n` cualquier línea puede empezar así.
  Imprimir el valor escapado en una línea propia (`echo "Motivo: $m"`) tampoco: un `##[` la vuelve
  comando. Dejar de imprimir el valor tampoco: rompe R-6. Un control estático ("ninguna línea
  `::x::` interpola `$MOTIVO`") no alcanza: `echo "Motivo: $MOTIVO"` no tiene `::` y con un salto
  de línea o un `##[` igual inyecta. Por eso CA-6 usa un control de comportamiento (ejecuta el step
  y simula el runner) y no uno estático.

  Un literal `%0A` dentro de un comando no es una inyección: el runner lo decodifica **dentro** del
  texto del comando (anotación de varias líneas) y no parte la línea. Los payloads con `%0A` y
  `%0D%0A` quedan como control de que eso no se cuenta mal.

## 9. Huecos que esta interfaz deja documentados (no los resuelven los tests)

1. ~~Compuerta y sembrado solo consumen lo que ya está en el registro.~~ **Cerrado en la ronda 2**
   con `resembradoEn[sku]` (sección 4.1; R-7 y CA-7 ampliados por el orquestador). Lo fijan los
   casos (a) a (d) de `test/compuerta-manual-absoluta.test.js`.
2. Los créditos de un SKU que nunca llega a resolverse (`no_encontrado`) mantienen el refresco
   activo en cada corrida hasta que vencen a los 30 días (≤ 3 páginas de `/search` por corrida).
3. `syncUnSku` (modo `--sku`) sigue aplicando delta puro y no consume créditos: si aplica una baja
   que tenía crédito, Shopify queda 1 abajo hasta la siguiente corrida de `ejecutarPar`, que
   acredita la línea todavía pendiente. Es el lado seguro y se autocorrige.
4. Líneas con `referencia` en `[tInicioLectura − margen, tInicioLectura)` para un SKU absoluto o
   sembrado: se consumen (lado seguro, subventa transitoria). Ningún test fija ese borde.
