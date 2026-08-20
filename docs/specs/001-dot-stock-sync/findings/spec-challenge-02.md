# SPEC_CHALLENGE 02 — Spec 001 / dot-stock-sync

- **Fecha:** 2026-08-19 · **Actor:** `spec-challenger` (read-only, contexto limpio)
- **Alcance revisado:** `iey-ai › evidence/p0-*.md`, ambas specs, `acceptance.md`,
  `spec-challenge-01.md`, `coherencia-2026-08-19.md`, código de `shopify-sync/src` y `test`,
  código de `iey-ai` en `origin/main`.
- **No se re-challengean:** D-01..D-09 (decisiones tomadas), C-01..C-06 (ya registradas).
  F-01..F-26 se citan sólo donde uno sigue abierto.

## Veredicto: `revision_required`

**13 bloqueantes · 9 importantes · 3 menores.**

La v2 cerró de verdad lo que el challenge 01 pedía sobre el **estado** (dos campos de base,
journal, lock, compuerta absoluta, `no_activado`, umbral de re-siembra). Lo que **no** cerró es el
**clasificador de causa**, que es la pieza nueva y la única que justifica pasar de absoluto a
deltas: la fórmula está definida sobre un caso (venta simple, SKU simple, ventana implícita) que no
es el caso observado — el único comprobante real de esa rama es un **combo** y llegó **14 días
tarde**. Además el sistema propuesto **no tiene ningún escritor que repare**: detecta y avisa, pero
la corrección depende siempre de una persona que hoy no tiene forma de enterarse. Y 3 de los 8
gates no son ejecutables con los entornos y credenciales que existen.

Un detalle que cambia la urgencia en el sentido bueno: **hoy el sistema está convergido y medido**.
Ese es el mejor punto de partida posible para un cutover, y se degrada solo con el tiempo.

---

## BLOQUEANTES

### G2-01 — Hay dos contratos y se contradicen en si la reconciliación escribe

C-05 registró que existen dos specs; lo que no estaba registrado es que **ya divergieron en el
comportamiento**:

| | `shopify-sync` spec + acceptance | `iey-ai` spec |
|---|---|---|
| ¿La reconciliación escribe? | **Sí, en un caso**: un delta `pendiente` más de N minutos lo levanta la reconciliación "que sí puede escribirlo" (`acceptance.md:128-129`) | **No**: G-05 exige "cero escrituras" (`spec.md:181`) |
| Invariantes | 13 | 10 |
| Gates | ninguno | G-01..G-08 |
| Criterios de aceptación | 24 | ninguno |
| Alcance | incluye "Corrección de H3, H4, H5, H8, H12" | no lo incluye |

Ninguno de los dos es verificable solo: los gates no tienen AC y los AC no tienen gate. Se
implementaría contra el documento que tenga abierto quien implemente. Además el contrato declarado
vive en el repo que la propia spec manda **archivar**.

→ Un único documento normativo (recomendación: en `iey-ai`), con una lista de invariantes, los 24
AC y los 8 gates en una matriz `AC ↔ gate ↔ evidencia`, y una regla única sobre qué puede escribir
la reconciliación.

### G2-02 — El mecanismo central nunca fue observado; sus gates son descubrimiento disfrazado de verificación

Todo el valor del rediseño ("push en segundos") descansa en el webhook de la integración `29489`,
del que **no se verificó nada**: la URL Callback es un placeholder, y los tres riesgos abiertos son
sus tres propiedades constitutivas — si notifica cambios de un componente, si notifica sólo el
depósito `127356`, y —no listado en ninguna spec— **si reintenta ante fallo**. G-01 y G-04 no son
gates: son el experimento que todavía no se hizo.

Si el webhook no notifica el cambio de un componente, la regla 13 / AC-17 es inimplementable y el
**98,8 %** de los cambios reales (401 de 406 son combos) no se entera.

→ Spike acotado **previo a la aprobación**: apuntar la URL Callback a un endpoint que sólo loguee,
provocar un cambio real y registrar payload, disparo por componente vs combo, alcance por depósito
y comportamiento ante 500/timeout.

### G2-03 — Nada repara: entrega "a lo sumo una vez", reconciliación que no pisa, compuerta sin disparador

Cuatro decisiones correctas por separado se combinan en un sistema sin lazo de corrección:

1. AC-9: el endpoint responde **2xx siempre** → se renuncia al reintento del emisor.
2. AC-9b: rate limit con techo global → bajo ráfaga **se descartan notificaciones**.
3. Invariante 4 / AC-7: la divergencia **se reporta, no se pisa**. AC-18 sólo habilita escribir
   deltas **que están en el journal**; una notificación perdida no deja entrada.
4. AC-2 auto-cura **sólo cuando llega la siguiente notificación de ese SKU**. Para un SKU que no
   vuelve a moverse (2.434 de 2.562 no se movieron entre dos corridas), "la siguiente" puede no
   llegar nunca.

Cada notificación perdida = un SKU permanentemente desfasado, sin fecha de vencimiento y sin nadie
que lo corrija. Es el modo de falla que originó el proyecto, movido de la capa del cron a la del
evento.

Peor: **el disparador de la compuerta D-02 no existe**. El caso F-02 (el local cuenta y corrige
Contabilium hacia abajo) produce **divergencia negativa**, y AC-3b manda la divergencia negativa a
"métrica agregada, no alerta". El único error que la compuerta existe para reparar está clasificado
por contrato en el balde silencioso.

→ (a) Quién garantiza convergencia sin intervención humana; (b) el **trigger objetivo** de D-02.

### G2-04 — El signo está invertido para notas de crédito: una devolución infla el stock en +2

`Σ cantidades` es positiva para toda línea. Para una **venta** funciona (`−1 + 1 = 0`). Para una
**nota de crédito** el signo se da vuelta: Contabilium repone (`+1`) y la fórmula suma otro `+1` →
**delta `+2`** por una unidad devuelta.

Es sobreoferta generada por el mecanismo que existe para evitarla. Y no es hipotético: la
integración `25020` tiene *"¿Deshabilitar reposición de stock en devoluciones?"* **desmarcado**.

→ Signo por **tipo de comprobante**, un AC gemelo de AC-1b para la devolución, y regla por defecto
para tipos no contemplados (no compensar y marcar).

### G2-05 — El comprobante nombra el combo; el stock se movió en los componentes

El stock de un combo **no es un dato propio**: se calcula desde sus componentes. Cuando se factura
un combo contra el DOT, `Δ_contabilium` aparece en **los componentes** mientras la línea nombra
**el combo**:

- el **componente** recibe su `Δ = −1` sin compensación → **descuenta dos veces**;
- el **combo** recibe compensación `+1` sin `Δ` propio → **empuje espurio** → sobreoferta.

No es un borde: **el único comprobante de la rama V2 leído en detalle es un combo**
(`IEY-COMBO-CARBON-NEGRO-S25ULTRA x1`) más "una línea sin código". El 100 % de la evidencia de esa
rama es un combo, y AC-1b la ejemplifica con un SKU simple.

→ Compensar **después de descomponer** cada línea en sus componentes; qué se hace con líneas sin
código; un AC con el comprobante real como caso de prueba.

### G2-06 — La "ventana" de comprobantes no está definida, y sin consumo *exactly-once* falla en las dos direcciones

AC-1 dice "ningún comprobante … menciona ese SKU **en la ventana**" y nunca la define.

- **Ventana fija hacia atrás**: tres notificaciones dentro de la ventana suman el mismo comprobante
  tres veces → `+2` de sobreoferta. Y si el webhook se perdió y `Δ` abarca 5 días, la ventana de
  24 h no ve el comprobante → doble descuento.
- **Ventana anclada al último avance de `base[SKU]`**: correcta, pero exige que cada línea se
  consuma **una sola vez** con marca durable. No está en la spec ni en los 24 AC.

**Sub-riesgo sin verificar:** el caso real tiene **14 días** entre la orden y la emisión. El stock
se mueve en la emisión, pero no está verificado qué representa el campo de fecha de la API.

→ Libro mayor de líneas consumidas con clave `(id_comprobante, línea, sku)`, anclaje al último
avance de la base, campo de fecha verificado, y un AC de "el mismo comprobante no compensa dos
veces".

### G2-07 — AC-1b y AC-9 son incompatibles: 75 s de lecturas en un handler que muere a los ~47 s

`/search` no puebla `Canal` ni `Inventario`: hay que ir al detalle de cada comprobante. La evidencia
cifra el costo en *"~150 comprobantes/día, ~75 s a 2 req/s"*. AC-9 exige terminar bien por debajo
del techo de ~48 s de Vercel Hobby — techo que no es teórico: los 502 de `iey-ai` llegaban a los
47-48 s consistentes.

Y con AC-9 respondiendo 2xx siempre, esos fallos son invisibles y no se reintentan (G2-03).

→ La ingesta de comprobantes como **proceso propio**, de modo que el handler consulte estado ya
materializado; o presupuesto de latencia medido y comportamiento definido cuando no alcanza.

### G2-08 — La expansión componente→combo no tiene fuente de datos verificada ni cota de fan-out

La regla 13 / AC-17 necesita el mapa **componente → combos con cantidades**. Lo único verificado es
que `/api/conceptos/search` devuelve `Tipo` — **el tipo, no la composición**. En `iey-ai` la tabla
`ComboDefinition` se puebla **sólo desde el seed** (1.787 combos extraídos de Excel): una foto
vieja, no una fuente viva.

401 de 406 cambios reales son combos: no es un borde, es el sistema. Y no hay **cota de fan-out**:
un componente muy usado puede pertenecer a decenas de combos, y cada notificación se vuelve N
lecturas + N escrituras dentro del handler de G2-07.

→ De dónde sale la composición y con qué frescura; fan-out máximo medido; qué pasa cuando la
expansión no cabe en el presupuesto de la invocación.

### G2-09 — El riesgo 1 sigue abierto, es del mismo tipo que S-2, y probablemente se cierra con los scopes que ya hay

Sobre qué location escribe la integración `25020` sigue **sin verificar**, y está publicando stock
**ahora mismo** en 321 filas. Si escribiera sobre la location DOT habría un **tercer escritor
absoluto** y el diseño de deltas quedaría invalidado igual que si S-2 fuera falso.

Es la única premisa de la familia de S-2 sin cerrar, y no tiene invariante vigilada, ni AC, ni gate.
La razón declarada para no verificarlo ("requiere acceso al admin de Shopify") es **cuestionable**:
la app tiene `read_inventory` y `read_products`, que alcanzan para leer los niveles de un SKU en
todas las locations y observar cuál se mueve.

→ Cerrarlo antes de aprobar: es barato y es sólo lectura.

### G2-10 — F-08 sigue sin resolverse: un SKU que desaparece deja Shopify ofreciendo lo que no hay

S-3 cerró la primera mitad (los ceros se listan). La segunda quedó abierta: un producto **dado de
baja** desaparece del listado. Ninguna spec tiene invariante, AC ni gate para eso.

Bajo deltas es peor que bajo absolutos: no hay notificación, no hay `Δ`, y la reconciliación
—que compara contra la lista de Contabilium— tampoco lo ve. Sobreventa directa, contra D-01.

→ La desaparición como evento de primera clase (diff de conjuntos entre snapshots), con su AC y su
gate.

### G2-11 — G-08 y AC-13b no son ejecutables

1. G-08 dice "cambiar el depósito de la integración **en un entorno de prueba**". Ese entorno **no
   existe**: Contabilium no tiene sandbox. Hacerlo en producción significa redirigir la facturación
   real de las ventas de Shopify al DOT.
2. AC-13b exige verificación periódica de la config de la integración. Ese dato se obtuvo
   **abriendo un modal del admin con Playwright y el login del usuario**. El chequeo automático
   requeriría scraping autenticado en producción con credenciales personales.
3. La alternativa por API tiene **volumen insuficiente**: 6 órdenes en 19 días, sobre una población
   donde el 50 % ya cae en el DOT por facturación manual.

**Nota relacionada:** la integración `29489` que se creó tiene `ddlDepositoReserva = 127356`. La
vigilancia S-2 nombra sólo a `25020` y no cubre integraciones nuevas apuntadas al DOT.

→ Cómo se lee la config de forma automatizable y con qué credencial; qué señal alternativa dispara
la suspensión de deltas; reformular G-08 como verificación del **detector**.

### G2-12 — G-07 / AC-13: no hay proveedor de WhatsApp ni credencial

D-07 dice textual *"Requiere un proveedor de envío y su credencial"*. Ninguna spec nombra
proveedor, cuenta, número emisor, plantillas ni costo. En `iey-ai` lo único que hay es un helper de
deep-link (`whatsappHref` → `https://wa.me/…`) que abre WhatsApp **en el navegador de un humano**;
no envía nada. G-07 no puede ejecutarse.

AC-13 es el requisito de negocio número uno de la spec. Un contrato que lo declara y deja su único
gate sin proveedor está aprobando el mismo modo de falla que dice cerrar.

→ Proveedor, dueño de la cuenta, credencial, y el **fallback** mientras WhatsApp no esté.

### G2-13 — El cutover no está definido, y el escritor absoluto está vivo

Ninguna spec define la secuencia de corte: quién apaga el escritor absoluto, en qué orden respecto
de la siembra de las dos columnas, qué pasa con los SKUs que el sistema viejo saltea, ni cómo se
prueba el módulo nuevo sin que el viejo le pise las escrituras cada media hora.

Si los dos conviven, el absoluto borra cada delta y deja `shopify_esperado` mintiendo, lo que
convierte la reconciliación en ruido desde el día uno. Y hay una ventana desperdiciándose: hoy el
estado es **conocido y convergido**, la mejor semilla posible — y es una propiedad del momento, no
del diseño.

Nótese que "archivar `shopify-sync`" **no** apaga el disparador: el cronjob externo sigue
existiendo.

→ La secuencia de cutover como parte del contrato: orden, punto de no retorno, criterio de éxito,
siembra desde un `--full` reciente, coexistencia prohibida o acotada por kill switch, y destino del
cronjob y del repo.

---

## IMPORTANTES

### G2-14 — Los 41 ambiguos y los 81 faltantes no tienen régimen permanente ni destinatario
Nadie define a quién se reportan, con qué frecuencia ni qué pasa si nunca se arreglan. El único
canal de alerta cubre reconciliación vencida y S-2, así que estos SKUs quedan fuera de todo aviso.
Agrava: los 41 son **todos combos**, o sea caen sobre el camino que concentra el 98,8 % de los
cambios; y su deduplicación requiere saber cuál variante tiene historial de órdenes, que hoy no se
puede leer por falta de `read_orders`.

### G2-15 — `shopify_esperado` diverge de forma monótona y nunca se retira
Una venta online con retiro en DOT descuenta en Shopify y **nunca** en el DOT de Contabilium. El
módulo no puede verla (sin `read_orders`). `shopify_esperado − shopify_real` crece una unidad por
venta y **no hay evento que lo devuelva a cero**, salvo la compuerta manual. Sin regla de retiro, la
métrica sube para siempre y termina siendo el "reporte que nadie mira" que F-03 quería evitar.

### G2-16 — Combos + deltas + dos sumideros: la sobreoferta que D-06 aceptó es estática; ésta crece
Si se vende **el combo** online, Shopify descuenta la variante del combo y **no** la del componente;
Contabilium no mueve el DOT; el componente sigue ofreciendo una unidad que ya no está, y **nada** la
corrige. D-06 se aceptó sobre el régimen **absoluto**; bajo deltas el efecto es acumulativo.

### G2-17 — AC-20 (kill switch) no dice qué pasa con la base mientras las escrituras están apagadas
Si `base[SKU]` avanza con el kill switch activo, todos los deltas del período se pierden en
silencio; si no avanza, al reanudar hay que aplicar un delta grande sin `changeFromQuantity`
confiable. Tampoco hay gate para AC-20.

### G2-18 — El secreto en el path va a quedar en logs sí o sí
El alta de la integración pide **sólo** URL Callback, y el webhook no firma ni envía headers: el
secreto **tiene** que ir en la URL. AC-9b afirma que "nunca se escribe en logs", lo cual no es
controlable: los logs de acceso de la plataforma y el panel de cron-job.org guardan la URL completa.
Además AC-9b exige "límite de tasa por origen" sin nombrar el componente que lo provee.

### G2-19 — El módulo nuevo va a convivir con un pipeline del DOT que ya existe en `iey-ai`
Ya existen `dot-replenishment/`, `satellite-replenishment/` y `syncStockSateliteLocal`, más un
warehouse con `contabiliumDepositoId: "127356"` en Postgres. **El mismo depósito ya tiene
representación de stock en la misma base**, mantenida por otro pipeline con su propio checkpoint. La
spec no lo nombra. Su tabla de prior art fue escrita sobre un checkout viejo y arrastra rutas que ya
no existen.

### G2-20 — Dependencias operativas con fecha y con dueño externo, ausentes de los riesgos
(a) el disparo automático de `iey-ai` va a necesitar **otro PAT fine-grained**, que un miembro pide
pero **un owner aprueba**; el actual vence el **2027-08-20**. (b) el **token de automatización de la
app de Shopify vence el 2026-12-02**. (c) la deduplicación y el cierre del riesgo 1 requieren acceso
al admin de Shopify, cuyo titular no está declarado.

### G2-21 — El régimen interino contradice D-01 y no tiene fecha de vencimiento
Mientras siga corriendo el escritor absoluto, cada venta online con retiro en DOT se **re-infla** en
la pasada siguiente: sobreoferta sistemática, el sesgo contrario al que D-01 eligió.

### G2-22 — F-22 sigue sin decidirse en el contrato aunque el código ya eligió
Ninguna spec nombra `available`, `on_hand` o `committed`. El código usa `available`, que además es
la elección correcta bajo deltas. Pero `changeFromQuantity` opera sobre el `name` elegido, así que
la guarda de concurrencia de AC-15 depende de una decisión que el contrato no fija.

---

## MENORES

### G2-23 — La evidencia todavía recomienda `StockActual` en dos lugares
`p0-s3-stock-cero.md:34-35` y `p0-recomendacion-semantica.md:83-85` contradicen a D-04 y a la
invariante 11. Benigno hoy (0 reservas en el DOT), peligroso mañana — justamente porque la
integración `29489` reserva contra `127356`.

### G2-24 — El alcance arrastra ítems vencidos y deja dos huérfanos
"Corrección de H3, H4, H5, H8, H12": los cuatro primeros están **cerrados** en el repo que se va a
archivar, así que para el módulo nuevo lo correcto es "portar con su red de regresión". **H11**
(1 request de Shopify por SKU) no tiene AC en ningún lado.

### G2-25 — Los "81 productos reales" incluyen ~8 conceptos contables
`IMPUESTOS-PROVINCIALES`, `IVA-IMPORTACION`, `LOGISTICA`, `MERCADERIA-IEY`, `REINTEGROS-01`,
`CORPORATIVO`, `EXHIBIDORES`, `MIX-FUNDAS` son del mismo tipo que los 6 ya excluidos. La lista de no
sincronizables quedó corta.

---

## Preguntas para el usuario

1. **¿Cuál de las dos specs es el contrato?** (G2-01) Recomendación: una sola, en `iey-ai`, con AC +
   gates en una matriz. Es la primera decisión y bloquea a las demás.
2. **Sobreoferta de combos bajo deltas** (G2-16): D-06 se aceptó en régimen absoluto. Bajo deltas se
   acumula y nada la corrige. ¿Se mantiene, o se acota en el DOT?
3. **Alerta de WhatsApp** (G2-12): ¿qué proveedor y con qué cuenta? ¿Qué canal cubre el hueco
   mientras tanto — o se acepta arrancar sin alerta?
4. **Gate G-01 en producción** (G2-02): Contabilium no tiene sandbox. ¿Se autoriza **una**
   modificación de stock real sobre un SKU acordado, reversible y auditada, para ejercer el webhook?
5. **Régimen interino** (G2-21): hasta el cutover, ¿el sync sigue escribiendo absolutos cada 30 min,
   o pasa a `DRY_RUN=true`?
6. **Los 41 duplicados de Shopify** (G2-14): ¿entran al alcance del proyecto o son tarea del negocio
   con fecha?
7. **Trigger de la compuerta D-02** (G2-03): hoy nada le avisa a la persona cuándo usarla.
   ¿Cadencia fija de conteo físico sobre los N SKUs de mayor rotación, o umbral de divergencia que
   **sugiera** el conteo?

## Supuestos documentados (seguros para seguir)

- `available` es el `name` sobre el que opera todo el sistema; se documenta como contrato.
- La fuente de cantidad es `StockConReservas` (D-04), aunque hoy sea idéntica a `StockActual`.
- `causa_desconocida` como métrica agregada y no alerta por SKU es la respuesta correcta al punto
  ciego estructural.
- El punto ciego movimiento/redeclaración **no se puede cerrar** por API. Lo que falta no es
  distinguirlos: es el lazo de reparación (G2-03).

## Invariante destilada

> Un clasificador de causa sólo sirve si la unidad que clasifica es la misma unidad que movió el
> stock: acá los comprobantes hablan de **combos** y de **importes**, mientras el stock se mueve en
> **componentes**, con signo propio por tipo de documento y con días de retraso. Y detectar no es
> reparar: un diseño push con entrega "a lo sumo una vez", reconciliación que no pisa y compuerta
> manual sin disparador **garantiza** deriva permanente — la detección sin un escritor que cierre el
> lazo es sólo un reporte más que nadie va a mirar.
