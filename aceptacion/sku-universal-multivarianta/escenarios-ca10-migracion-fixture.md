# CA-10 — Migración del fixture `SKU_APPLYFIT` de los tests de `verificar-cache-sku`

Cubre: **R-15** (y la parte de R-9 que dice "migran de fixture según R-15, sin cambiar sus
aserciones").

Comando de referencia: `node --test test/migracion-fixture-cache-sku.test.js`.

Sin red ni git. El test **no** usa `git` en ningún momento: un clon superficial de CI puede no
tener el commit `3abeda7`. Lee las copias congeladas de
`aceptacion/sku-universal-multivarianta/fixtures-originales/` (ver el `README.md` de esa carpeta)
y los archivos actuales de `test/`.

## Constantes del escenario

| Nombre | Valor |
|---|---|
| `SKU_VIEJO` | `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E` (curado, R-1 punto 4; el fixture de `3abeda7`, `test/_helpers-cache-sku.js:30`) |
| `SKU_NUEVO` | el valor **actual** de `SKU_APPLYFIT`, importado de `test/_helpers-cache-sku.js` (no un literal del test) |
| Reemplazo por defecto (R-15) | **`IEY-COMBO-CARBON-VERDE-IP16E`**: grupo A4, `docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md:224`, el mismo que CA-4 A usa como "con variante establecida en caché" |

Esta evidencia **confirma** el reemplazo por defecto del contrato: `IEY-COMBO-CARBON-VERDE-IP16E`.
R-15 deja que el implementador elija otro del grupo A2 o A4. El test lee `SKU_NUEVO` del helper
actual, así que con otro SKU válido sigue pasando, siempre que se cumplan los chequeos (a) a (c).

## Pares de archivos comparados

| Copia congelada (`fixtures-originales/`) | Archivo actual del repo |
|---|---|
| `_helpers-cache-sku.js` | `test/_helpers-cache-sku.js` |
| `cache-sku-duplicados.test.js` | `test/cache-sku-duplicados.test.js` |
| `cache-sku-verificada.test.js` | `test/cache-sku-verificada.test.js` |
| `cache-sku-caminos-de-escritura.test.js` | `test/cache-sku-caminos-de-escritura.test.js` |
| `cache-sku-resumen.test.js` | `test/cache-sku-resumen.test.js` |

Si falta alguna copia congelada o algún archivo actual, el test **falla** (no se saltea ni pasa en
vacío, invariante 5).

---

## 1 — Comparación byte a byte (R-15 "preserva exactamente la forma y las aserciones")

Para cada par de la tabla:

1. `esperado = copia.replaceAll(SKU_VIEJO, SKU_NUEVO)`. El reemplazo es de **toda** aparición del
   string completo, sin regex ni mayúsculas/minúsculas.
2. Se parten `esperado` y `actual` en líneas por `\n`. El `\r` final, si lo hay, queda **dentro**
   de la línea, así que un cambio de fin de línea cuenta como diferencia.
3. Se descartan de **los dos lados** las líneas que son comentario (definición de abajo).
4. Las dos secuencias que quedan tienen que ser **iguales**: misma cantidad de líneas y cada
   línea igual byte a byte, en el mismo orden.

### Qué cuenta como "comentario" (lo único que se ignora)

Una línea es comentario **si y solo si** cumple `/^[ \t]*\/\//`, es decir, después de la sangría
(espacios o tabs) empieza con `//`.

**No** se ignoran:

- un comentario al final de una línea de código (`assert.equal(a, b); // nota`): la línea entera
  se compara;
- comentarios de bloque `/* … */` ni líneas de JSDoc que empiezan con ` * ` (hoy las copias
  congeladas no tienen ninguno);
- líneas en blanco: se comparan como cualquier otra (agregar o sacar una línea vacía es una
  diferencia).

Con esta regla el implementador puede reescribir, agregar o sacar líneas de comentario libremente
(R-15: "en los comentarios, la descripción del caso real que motiva el fixture"). Cualquier otro
cambio en el código es una falla.

### Resultado esperado con el reemplazo por defecto

En las copias congeladas, `SKU_VIEJO` aparece **dos** veces:

| Copia | Línea | ¿Comentario? | Qué tiene que quedar en el actual |
|---|---|---|---|
| `_helpers-cache-sku.js` | 30: `export const SKU_APPLYFIT = "APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E";` | no | exactamente `export const SKU_APPLYFIT = "IEY-COMBO-CARBON-VERDE-IP16E";` (el nombre de la constante se conserva) |
| `cache-sku-duplicados.test.js` | 10: `// Caso real: APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E esta en 5 variantes; el sync` | sí | libre: es comentario y se ignora |

El resto de los tests usa la constante `SKU_APPLYFIT`, no el literal. Con el reemplazo por
defecto, entonces, el único cambio de código de los 5 archivos es el string de la línea 30 del
helper. Todo lo demás (variantes inyectadas, `variantId`, `inventoryItemId`, `available`,
cantidad de variantes de cada test, valores esperados y textos esperados) queda idéntico.

### Casos que el test tiene que rechazar (cada uno, por sí solo, da rojo)

| # | Cambio en el archivo actual | Por qué falla |
|---|---|---|
| N1 | Se borra un `assert.equal(...)` de `cache-sku-verificada.test.js` | la secuencia de líneas no comentario difiere, y el conteo de `assert` baja (§2) |
| N2 | Un `test(` pasa a `test.skip(` o a `test.todo(` | la línea difiere |
| N3 | Un test arma 4 variantes donde la copia armaba 5 (por "ajustarlo" al catálogo real del SKU nuevo) | la línea difiere. R-15: la consulta es inyectada y conserva la cantidad |
| N4 | Un `available: 4` pasa a `available: 3` | la línea difiere |
| N5 | Un texto esperado de `[AVISO]` cambia algo además del SKU (p. ej. `5 variantes` por `2 variantes`) | la línea difiere |
| N6 | `SKU_APPLYFIT` se renombra (p. ej. a `SKU_DUPLICADO`) | la línea 30 del helper y todos sus usos difieren |
| N7 | Una línea de código queda comentada con `// ` delante para "sacarla" | esa línea desaparece del lado actual y la secuencia difiere |

## 2 — Conteos de bloques y aserciones (R-15, AGENTS.md "Gates de revisión")

Para cada uno de los 5 pares, sobre el texto **completo** (con comentarios), la cantidad de
apariciones de cada patrón tiene que ser igual en la copia congelada y en el actual:

| Patrón | Qué cuenta |
|---|---|
| `/\btest\(/g` | bloques `test()` |
| `/\bdescribe\(/g` | bloques `describe()` |
| `/\bassert(\.\w+)?\(/g` | llamadas a `assert` (`assert(...)`, `assert.equal(...)`, `assert.deepEqual(...)`, …) |

Conteos de referencia sobre las copias congeladas (informativos: el test los calcula en tiempo de
ejecución y no los tiene escritos a mano):

| Copia | `test(` | `describe(` | `assert…(` |
|---|---|---|---|
| `_helpers-cache-sku.js` | 2 | 0 | 0 |
| `cache-sku-duplicados.test.js` | 6 | 0 | 42 |
| `cache-sku-verificada.test.js` | 12 | 0 | 86 |
| `cache-sku-caminos-de-escritura.test.js` | 7 | 0 | 40 |
| `cache-sku-resumen.test.js` | 3 | 0 | 19 |

Como el conteo se hace sobre el texto completo, mover una aserción a un comentario la saca de la
comparación de §1, pero el conteo sigue igual. Por eso §1 y §2 se exigen juntos: N7 falla por §1.

## 3 — Los cuatro chequeos sobre el SKU de reemplazo

Con `SKU_NUEVO` leído del helper actual y la lista curada leída de la constante exportada por
`src/shopify.js` (la de CA-1, pares `{sku, variantes}`):

**(a) No está en la lista curada.** Ningún `sku` de los 7 pares es igual a `SKU_NUEVO`.
Con el reemplazo por defecto: `IEY-COMBO-CARBON-VERDE-IP16E` no es igual a ninguno de los 7.
*Rechazo:* `SKU_NUEVO = "APPLYFIT-CLEAR-IP15-16"` (curado, R-1 punto 3) da rojo.

**(b) No es prefijo ni extensión de ninguno de los 7.** Para cada `c` de la lista:
`!c.startsWith(SKU_NUEVO) && !SKU_NUEVO.startsWith(c)`. Como (a) ya descarta la igualdad, (b)
mira el prefijo estricto en los dos sentidos.
*Rechazos:* `SKU_NUEVO = "APPLYFIT-CLEAR-IP15-16-NEGRO"` (extensión de un curado) y
`SKU_NUEVO = "APPLYFIT-CLEAR-IP13-13PRO-14-16E"` (recorte del viejo) dan rojo.

**(c) Aparece en el informe.** `docs/analisis/2026-11-02-skus-repetidos-y-cruzados.md` contiene
el string `SKU_NUEVO`. Para no aceptar una coincidencia parcial con un SKU más largo, se busca
**entre comillas invertidas**: el informe tiene que contener `` `<SKU_NUEVO>` ``.
Con el reemplazo por defecto: la línea 224 contiene `` `IEY-COMBO-CARBON-VERDE-IP16E` ``.
*Rechazo:* `SKU_NUEVO = "IEY-INVENTADO-NO-EXISTE"` da rojo.

> Supuesto de esta evidencia: (c) se busca con comillas invertidas porque el informe escribe así
> todos los SKUs y porque `IEY-COMBO-CARBON-VERDE-IP16E` sin comillas también aparecería dentro de
> un SKU más largo que lo extendiera. Si el informe un día cambia de formato, este chequeo se
> ajusta junto con el informe.

**(d) Ningún archivo de test conserva el SKU viejo fuera de comentarios.** En
`test/cache-sku-duplicados.test.js`, `test/cache-sku-verificada.test.js`,
`test/cache-sku-caminos-de-escritura.test.js` y `test/cache-sku-resumen.test.js` (y, por
consecuencia de §1, en `test/_helpers-cache-sku.js`), ninguna línea que **no** sea comentario
según la regla de §1 contiene `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`.
Una línea de comentario que lo nombre (p. ej. explicando la migración) está permitida.
*Rechazo:* dejar en `cache-sku-resumen.test.js` un `const sku = "APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E";`
da rojo, aunque `SKU_APPLYFIT` ya esté migrado.

## 4 — Qué no prueba este criterio

- Que los 4 tests migrados **pasen**: eso lo prueba CA-6 (`npm test`).
- Que las copias congeladas sean fieles a `3abeda7`: eso se fijó una sola vez al escribir la
  evidencia (`fixtures-originales/README.md`). Quien revise puede contrastarlo a mano con
  `git show 3abeda7:test/<archivo>`. El test no lo hace.
- Que `IEY-COMBO-CARBON-VERDE-IP16E` se comporte como duplicado de variante única: eso es CA-4 A
  y CA-14 D.
