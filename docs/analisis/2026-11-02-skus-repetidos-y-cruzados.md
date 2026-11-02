# SKUs repetidos y cruzados en el catálogo de Shopify (location DOT)

Fecha: 2026-11-02. Análisis de **solo lectura**: no se modificó nada en Shopify ni en Contabilium.

Fuentes: export `inventory_export_1.csv` (2.760 variantes, location «IEY® Shopping Dot Baires») y log de la corrida `41487050841` del sync (líneas `[SKIP] dot/...`: 304 SKUs «no existe en Shopify» y 50 «SKU ambiguo»). El log **no trae cantidades de Contabilium**, solo el SKU y el motivo; por eso acá solo se informa el stock que muestra Shopify en el DOT.

## 1. Resumen

- SKUs repetidos (en más de una variante): **77** grupos, 158 variantes.
  - **A1 universal** (un solo artículo que sirve para varios modelos): 7
  - **A2 SKU mal cargado** (una variante tiene el SKU de otra): 13 grupos, que se arreglan corrigiendo 13 variantes
  - **A3 producto duplicado**: 0
  - **A4 dudoso**: 57 (todos son el caso iPhone 16e / 17e, ver sección 4)
- SKUs repetidos que el sync marcó `ambiguo` (o sea, que existen en Contabilium DOT): 50 de 77.
- **B, SKUs cruzados en variantes con SKU único**: 2 variantes (2 forman un par invertido).
- Correcciones propuestas cuyo SKU correcto **aparece en la lista «no existe en Shopify»** del log (evidencia fuerte): 13 de 15.

**Lo más importante:** casi todo el problema se concentra en tres productos del combo con cargador de auto y uno de batería Samsung, donde a una tanda de variantes nueva (iPhone 17, iPhone 18, Samsung S26) se le copió el SKU de otro producto. Además, en el combo Qi2 Carbon Azul las variantes iPhone 18 Pro y 18 Pro Max tienen los SKUs intercambiados.

## 2. Acciones para el admin de Shopify

Ordenadas por prioridad (sección 6). «Fila» es la fila del CSV exportado, para ubicar la variante rápido.

| # | Prioridad | Producto (handle) | Variante | Acción | Respaldo |
|---|---|---|---|---|---|
| 1 | alta | `combo-magsafe-funda-carbon-azul-estacion-de-carga-inalambrica-3-en-1-qi2` | Negro / iPhone 18 Pro Max (fila 5, stock DOT 2) | Cambiar el SKU de `IEY-COMBO-IEYQ222N-CARBON-AZUL-IP18PRO` a `IEY-COMBO-IEYQ222N-CARBON-AZUL-IP18PM` | par invertido; propuesto ya existe en otra variante; confianza alta |
| 2 | alta | `combo-magsafe-funda-carbon-azul-estacion-de-carga-inalambrica-3-en-1-qi2` | Negro / iPhone 18 Pro (fila 4, stock DOT 1) | Cambiar el SKU de `IEY-COMBO-IEYQ222N-CARBON-AZUL-IP18PM` a `IEY-COMBO-IEYQ222N-CARBON-AZUL-IP18PRO` | par invertido; propuesto ya existe en otra variante; confianza alta |
| 3 | alta | `combo-magsafe-samsung-funda-ring-gris-bateria-inalambrica-ultrafina-5000-mah` | Gris Plateado / Samsung S26 Ultra (fila 700, stock DOT 0) | Cambiar el SKU de `IEY-COMBO-IEYC08N-S-RING-GRIS-S26ULTRA` a `IEY-COMBO-IEYC08P-S-RING-GRIS-S26ULTRA` | propuesto está en «no existe en Shopify»; confianza alta |
| 4 | alta | `combo-magsafe-samsung-funda-ring-gris-bateria-inalambrica-ultrafina-5000-mah` | Gris Plateado / Samsung S26 (fila 698, stock DOT 0) | Cambiar el SKU de `IEY-COMBO-IEYC08N-S-RING-GRIS-S26` a `IEY-COMBO-IEYC08P-S-RING-GRIS-S26` | propuesto está en «no existe en Shopify»; confianza alta |
| 5 | alta | `combo-magsafe-samsung-funda-ring-gris-bateria-inalambrica-ultrafina-5000-mah` | Gris Plateado / Samsung S26 Plus (fila 699, stock DOT 0) | Cambiar el SKU de `IEY-COMBO-IEYC08N-S-RING-GRIS-S26PLUS` a `IEY-COMBO-IEYC08P-S-RING-GRIS-S26PLUS` | propuesto está en «no existe en Shopify»; confianza alta |
| 6 | alta | `combo-car-magsafe-funda-cargador-de-auto` | Plateado / iPhone 18 Pro (fila 169, stock DOT 0) | Cambiar el SKU de `IEY-COMBO-IEY108N-TRANSP-IP18PRO` a `IEY-COMBO-IEY108P-TRANSP-IP18PRO` | propuesto está en «no existe en Shopify»; confianza alta |
| 7 | alta | `combo-car-magsafe-funda-cargador-de-auto` | Plateado / iPhone 18 Pro Max (fila 170, stock DOT 0) | Cambiar el SKU de `IEY-COMBO-IEY108N-TRANSP-IP18PM` a `IEY-COMBO-IEY108P-TRANSP-IP18PM` | propuesto está en «no existe en Shopify»; confianza alta |
| 8 | alta | `combo-car-magsafe-funda-cargador-de-auto` | Plateado / iPhone 18 Ultra (fila 171, stock DOT 0) | Cambiar el SKU de `IEY-COMBO-IEY108N-TRANSP-IP18ULTRA` a `IEY-COMBO-IEY108P-TRANSP-IP18ULTRA` | propuesto está en «no existe en Shopify»; confianza alta |
| 9 | alta | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Negro / iPhone 18 Pro (fila 184, stock DOT 0) | Cambiar el SKU de `IEY-COMBO-IEY108N-CARBON-NEGRO-IP18PRO` a `IEY-COMBO-IEY108N-CARBON-AZUL-IP18PRO` | propuesto está en «no existe en Shopify»; confianza alta |
| 10 | alta | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Negro / iPhone 18 Pro Max (fila 185, stock DOT 0) | Cambiar el SKU de `IEY-COMBO-IEY108N-CARBON-NEGRO-IP18PM` a `IEY-COMBO-IEY108N-CARBON-AZUL-IP18PM` | propuesto está en «no existe en Shopify»; confianza alta |
| 11 | alta | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Negro / iPhone 18 Ultra (fila 186, stock DOT 0) | Cambiar el SKU de `IEY-COMBO-IEY108N-CARBON-NEGRO-IP18ULTRA` a `IEY-COMBO-IEY108N-CARBON-AZUL-IP18ULTRA` | propuesto está en «no existe en Shopify»; confianza alta |
| 12 | media | varios | iPhone 17, iPhone 17 Pro, iPhone 16 Pro | `APPLYFIT-CLEAR-IP16PRO-17-17PRO`: unificar el stock en una sola variante o decidir cómo se representa (ver 3.A1) | SKU universal, ambiguo en el sync |
| 13 | media | varios | iPhone 13 Pro Max, iPhone 14 Plus | `APPLYFIT-CLEAR-IP13PM-14PLUS`: unificar el stock en una sola variante o decidir cómo se representa (ver 3.A1) | SKU universal, ambiguo en el sync |
| 14 | media | varios | Samsung S25 Plus, Samsung S24 Plus | `APPLYFIT-CLEAR-S24PLUS-S25PLUS`: unificar el stock en una sola variante o decidir cómo se representa (ver 3.A1) | SKU universal, ambiguo en el sync |
| 15 | media | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Negro / iPhone 17 Pro Max (fila 1744, stock DOT 2) | Cambiar el SKU de `IEY-COMBO-IEY108N-CARBON-NEGRO-IP17PM` a `IEY-COMBO-IEY108N-CARBON-AZUL-IP17PM` | propuesto está en «no existe en Shopify»; confianza alta |
| 16 | media | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Negro / iPhone 17 Pro (fila 1743, stock DOT 2) | Cambiar el SKU de `IEY-COMBO-IEY108N-CARBON-NEGRO-IP17PRO` a `IEY-COMBO-IEY108N-CARBON-AZUL-IP17PRO` | propuesto está en «no existe en Shopify»; confianza alta |
| 17 | media | varios (combos y fundas con iPhone 16e/17e) | 57 pares 16e/17e | Decidir modelo: ver pregunta P1 (sección 4) | dudoso |
| 18 | baja | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Negro / iPhone 17 (fila 1741, stock DOT 2) | Cambiar el SKU de `IEY-COMBO-IEY108N-CARBON-NEGRO-IP17` a `IEY-COMBO-IEY108N-CARBON-AZUL-IP17` | propuesto está en «no existe en Shopify»; confianza alta |
| 19 | baja | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Negro / iPhone 17 Air (fila 1742, stock DOT 2) | Cambiar el SKU de `IEY-COMBO-IEY108N-CARBON-NEGRO-IP17AIR` a `IEY-COMBO-IEY108N-CARBON-AZUL-IP17AIR` | propuesto está en «no existe en Shopify»; confianza alta |
| 20 | baja | varios | Samsung S25, Samsung S24 | `APPLYFIT-CLEAR-S24-S25`: unificar el stock en una sola variante o decidir cómo se representa (ver 3.A1) | SKU universal |
| 21 | baja | varios | iPhone 15, iPhone 16 | `APPLYFIT-CLEAR-IP15-16`: unificar el stock en una sola variante o decidir cómo se representa (ver 3.A1) | SKU universal |
| 22 | baja | varios | iPhone 17e, iPhone 13, iPhone 13 Pro, iPhone 14, iPhone 16e | `APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`: unificar el stock en una sola variante o decidir cómo se representa (ver 3.A1) | SKU universal |
| 23 | baja | varios | iPhone 17 Pro Max, iPhone 16 Pro Max | `APPLYFIT-CLEAR-IP16PM-17PM`: unificar el stock en una sola variante o decidir cómo se representa (ver 3.A1) | SKU universal |

## 3. Detalle por grupo

### A2. SKU mal cargado (13)

**`IEY-COMBO-IEY108N-CARBON-NEGRO-IP17PM`**: 2 variantes, stock DOT total 127, en 0: 0, no aparece como ambiguo (no está en Contabilium DOT, o el sync no lo procesó).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 1652 | `combo-car-magsafe-funda-negro-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 17 Pro Max | 125 | correcta |
| 1744 | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 17 Pro Max | 2 | SKU equivocado → `IEY-COMBO-IEY108N-CARBON-AZUL-IP17PM` (en «no existe en Shopify») |

**`IEY-COMBO-IEY108N-CARBON-NEGRO-IP17PRO`**: 2 variantes, stock DOT total 116, en 0: 0, no aparece como ambiguo (no está en Contabilium DOT, o el sync no lo procesó).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 1743 | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 17 Pro | 2 | SKU equivocado → `IEY-COMBO-IEY108N-CARBON-AZUL-IP17PRO` (en «no existe en Shopify») |
| 1751 | `combo-car-magsafe-funda-negro-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 17 Pro | 114 | correcta |

**`IEY-COMBO-IEY108N-CARBON-NEGRO-IP17`**: 2 variantes, stock DOT total 48, en 0: 0, no aparece como ambiguo (no está en Contabilium DOT, o el sync no lo procesó).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 1741 | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 17 | 2 | SKU equivocado → `IEY-COMBO-IEY108N-CARBON-AZUL-IP17` (en «no existe en Shopify») |
| 1749 | `combo-car-magsafe-funda-negro-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 17 | 46 | correcta |

**`IEY-COMBO-IEY108N-CARBON-NEGRO-IP17AIR`**: 2 variantes, stock DOT total 16, en 0: 0, no aparece como ambiguo (no está en Contabilium DOT, o el sync no lo procesó).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 1742 | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 17 Air | 2 | SKU equivocado → `IEY-COMBO-IEY108N-CARBON-AZUL-IP17AIR` (en «no existe en Shopify») |
| 1750 | `combo-car-magsafe-funda-negro-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 17 Air | 14 | correcta |

**`IEY-COMBO-IEYC08N-S-RING-GRIS-S26ULTRA`**: 2 variantes, stock DOT total 4, en 0: 1, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 697 | `combo-magsafe-samsung-funda-ring-gris-bateria-inalambrica-ultrafina-5000-mah` | Combo MagSafe Samsung – Funda Ring & Batería Inalámbrica Ultrafina 5000 mAh | Gris Azulado / Samsung S26 Ultra | 4 | correcta |
| 700 | `combo-magsafe-samsung-funda-ring-gris-bateria-inalambrica-ultrafina-5000-mah` | Combo MagSafe Samsung – Funda Ring & Batería Inalámbrica Ultrafina 5000 mAh | Gris Plateado / Samsung S26 Ultra | 0 | SKU equivocado → `IEY-COMBO-IEYC08P-S-RING-GRIS-S26ULTRA` (en «no existe en Shopify») |

**`IEY-COMBO-IEYC08N-S-RING-GRIS-S26`**: 2 variantes, stock DOT total 2, en 0: 1, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 695 | `combo-magsafe-samsung-funda-ring-gris-bateria-inalambrica-ultrafina-5000-mah` | Combo MagSafe Samsung – Funda Ring & Batería Inalámbrica Ultrafina 5000 mAh | Gris Azulado / Samsung S26 | 2 | correcta |
| 698 | `combo-magsafe-samsung-funda-ring-gris-bateria-inalambrica-ultrafina-5000-mah` | Combo MagSafe Samsung – Funda Ring & Batería Inalámbrica Ultrafina 5000 mAh | Gris Plateado / Samsung S26 | 0 | SKU equivocado → `IEY-COMBO-IEYC08P-S-RING-GRIS-S26` (en «no existe en Shopify») |

**`IEY-COMBO-IEYC08N-S-RING-GRIS-S26PLUS`**: 2 variantes, stock DOT total 2, en 0: 1, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 696 | `combo-magsafe-samsung-funda-ring-gris-bateria-inalambrica-ultrafina-5000-mah` | Combo MagSafe Samsung – Funda Ring & Batería Inalámbrica Ultrafina 5000 mAh | Gris Azulado / Samsung S26 Plus | 2 | correcta |
| 699 | `combo-magsafe-samsung-funda-ring-gris-bateria-inalambrica-ultrafina-5000-mah` | Combo MagSafe Samsung – Funda Ring & Batería Inalámbrica Ultrafina 5000 mAh | Gris Plateado / Samsung S26 Plus | 0 | SKU equivocado → `IEY-COMBO-IEYC08P-S-RING-GRIS-S26PLUS` (en «no existe en Shopify») |

**`IEY-COMBO-IEY108N-TRANSP-IP18PRO`**: 2 variantes, stock DOT total 0, en 0: 2, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 166 | `combo-car-magsafe-funda-cargador-de-auto` | Combo Car MagSafe – Funda Transparente & Cargador de Auto | Negro / iPhone 18 Pro | 0 | correcta |
| 169 | `combo-car-magsafe-funda-cargador-de-auto` | Combo Car MagSafe – Funda Transparente & Cargador de Auto | Plateado / iPhone 18 Pro | 0 | SKU equivocado → `IEY-COMBO-IEY108P-TRANSP-IP18PRO` (en «no existe en Shopify») |

**`IEY-COMBO-IEY108N-TRANSP-IP18PM`**: 2 variantes, stock DOT total 0, en 0: 2, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 167 | `combo-car-magsafe-funda-cargador-de-auto` | Combo Car MagSafe – Funda Transparente & Cargador de Auto | Negro / iPhone 18 Pro Max | 0 | correcta |
| 170 | `combo-car-magsafe-funda-cargador-de-auto` | Combo Car MagSafe – Funda Transparente & Cargador de Auto | Plateado / iPhone 18 Pro Max | 0 | SKU equivocado → `IEY-COMBO-IEY108P-TRANSP-IP18PM` (en «no existe en Shopify») |

**`IEY-COMBO-IEY108N-TRANSP-IP18ULTRA`**: 2 variantes, stock DOT total 0, en 0: 2, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 168 | `combo-car-magsafe-funda-cargador-de-auto` | Combo Car MagSafe – Funda Transparente & Cargador de Auto | Negro / iPhone 18 Ultra | 0 | correcta |
| 171 | `combo-car-magsafe-funda-cargador-de-auto` | Combo Car MagSafe – Funda Transparente & Cargador de Auto | Plateado / iPhone 18 Ultra | 0 | SKU equivocado → `IEY-COMBO-IEY108P-TRANSP-IP18ULTRA` (en «no existe en Shopify») |

**`IEY-COMBO-IEY108N-CARBON-NEGRO-IP18PRO`**: 2 variantes, stock DOT total 0, en 0: 2, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 184 | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 18 Pro | 0 | SKU equivocado → `IEY-COMBO-IEY108N-CARBON-AZUL-IP18PRO` (en «no existe en Shopify») |
| 190 | `combo-car-magsafe-funda-negro-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 18 Pro | 0 | correcta |

**`IEY-COMBO-IEY108N-CARBON-NEGRO-IP18PM`**: 2 variantes, stock DOT total 0, en 0: 2, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 185 | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 18 Pro Max | 0 | SKU equivocado → `IEY-COMBO-IEY108N-CARBON-AZUL-IP18PM` (en «no existe en Shopify») |
| 191 | `combo-car-magsafe-funda-negro-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 18 Pro Max | 0 | correcta |

**`IEY-COMBO-IEY108N-CARBON-NEGRO-IP18ULTRA`**: 2 variantes, stock DOT total 0, en 0: 2, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 186 | `combo-car-magsafe-funda-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 18 Ultra | 0 | SKU equivocado → `IEY-COMBO-IEY108N-CARBON-AZUL-IP18ULTRA` (en «no existe en Shopify») |
| 192 | `combo-car-magsafe-funda-negro-carbon-cargador-de-auto` | Combo Car MagSafe – Funda Carbon & Cargador de Auto | Negro / iPhone 18 Ultra | 0 | correcta |

### A1. Universal (7)

**`APPLYFIT-CLEAR-IP16PRO-17-17PRO`**: 3 variantes, stock DOT total 18, en 0: 1, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 16 | `applyfit-vidrio-templado-iphone-17-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (17 Series) | iPhone 17 | 9 | correcta |
| 18 | `applyfit-vidrio-templado-iphone-17-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (17 Series) | iPhone 17 Pro | 9 | correcta |
| 40 | `applyfit™-vidrio-templado-kit-de-instalacion-16-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (16 Series) | iPhone 16 Pro | 0 | correcta |

El SKU nombra varios modelos y cada variante corresponde a uno de ellos: es un solo artículo físico publicado 3 veces en productos de distintas series. El sync no lo escribe (ambiguo). Opciones: dejar una sola variante con este SKU y a las demás darles otro SKU que no exista en Contabilium (no se sincronizan), o aceptar que el stock se cargue a mano.

**`APPLYFIT-CLEAR-S24-S25`**: 2 variantes, stock DOT total 10, en 0: 1, no aparece como ambiguo (no está en Contabilium DOT, o el sync no lo procesó).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 46 | `applyfit™-vidrio-templado-kit-de-instalacion-s25-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (S25 Series) | Samsung S25 | 10 | correcta |
| 49 | `applyfit™-vidrio-templado-kit-de-instalacion-s24-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (S24 Series) | Samsung S24 | 0 | correcta |

El SKU nombra varios modelos y cada variante corresponde a uno de ellos: es un solo artículo físico publicado 2 veces en productos de distintas series. El sync no lo escribe (ambiguo). Opciones: dejar una sola variante con este SKU y a las demás darles otro SKU que no exista en Contabilium (no se sincronizan), o aceptar que el stock se cargue a mano.

**`APPLYFIT-CLEAR-IP15-16`**: 2 variantes, stock DOT total 9, en 0: 1, no aparece como ambiguo (no está en Contabilium DOT, o el sync no lo procesó).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 36 | `applyfit™-vidrio-templado-kit-de-instalacion-15-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (15 Series) | iPhone 15 | 9 | correcta |
| 39 | `applyfit™-vidrio-templado-kit-de-instalacion-16-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (16 Series) | iPhone 16 | 0 | correcta |

El SKU nombra varios modelos y cada variante corresponde a uno de ellos: es un solo artículo físico publicado 2 veces en productos de distintas series. El sync no lo escribe (ambiguo). Opciones: dejar una sola variante con este SKU y a las demás darles otro SKU que no exista en Contabilium (no se sincronizan), o aceptar que el stock se cargue a mano.

**`APPLYFIT-CLEAR-IP13-13PRO-14-16E-17E`**: 5 variantes, stock DOT total 7, en 0: 4, no aparece como ambiguo (no está en Contabilium DOT, o el sync no lo procesó).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 17 | `applyfit-vidrio-templado-iphone-17-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (17 Series) | iPhone 17e | 7 | correcta |
| 29 | `applyfit™-vidrio-templado-kit-de-instalacion-13-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (13 Series) | iPhone 13 | 0 | correcta |
| 30 | `applyfit™-vidrio-templado-kit-de-instalacion-13-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (13 Series) | iPhone 13 Pro | 0 | correcta |
| 32 | `applyfit™-vidrio-templado-kit-de-instalacion-14-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (14 Series) | iPhone 14 | 0 | correcta |
| 42 | `applyfit™-vidrio-templado-kit-de-instalacion-16-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (16 Series) | iPhone 16e | 0 | correcta |

El SKU nombra varios modelos y cada variante corresponde a uno de ellos: es un solo artículo físico publicado 5 veces en productos de distintas series. El sync no lo escribe (ambiguo). Opciones: dejar una sola variante con este SKU y a las demás darles otro SKU que no exista en Contabilium (no se sincronizan), o aceptar que el stock se cargue a mano.

**`APPLYFIT-CLEAR-IP16PM-17PM`**: 2 variantes, stock DOT total 1, en 0: 1, no aparece como ambiguo (no está en Contabilium DOT, o el sync no lo procesó).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 19 | `applyfit-vidrio-templado-iphone-17-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (17 Series) | iPhone 17 Pro Max | 1 | correcta |
| 41 | `applyfit™-vidrio-templado-kit-de-instalacion-16-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (16 Series) | iPhone 16 Pro Max | 0 | correcta |

El SKU nombra varios modelos y cada variante corresponde a uno de ellos: es un solo artículo físico publicado 2 veces en productos de distintas series. El sync no lo escribe (ambiguo). Opciones: dejar una sola variante con este SKU y a las demás darles otro SKU que no exista en Contabilium (no se sincronizan), o aceptar que el stock se cargue a mano.

**`APPLYFIT-CLEAR-IP13PM-14PLUS`**: 2 variantes, stock DOT total 0, en 0: 2, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 31 | `applyfit™-vidrio-templado-kit-de-instalacion-13-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (13 Series) | iPhone 13 Pro Max | 0 | correcta |
| 34 | `applyfit™-vidrio-templado-kit-de-instalacion-14-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (14 Series) | iPhone 14 Plus | 0 | correcta |

El SKU nombra varios modelos y cada variante corresponde a uno de ellos: es un solo artículo físico publicado 2 veces en productos de distintas series. El sync no lo escribe (ambiguo). Opciones: dejar una sola variante con este SKU y a las demás darles otro SKU que no exista en Contabilium (no se sincronizan), o aceptar que el stock se cargue a mano.

**`APPLYFIT-CLEAR-S24PLUS-S25PLUS`**: 2 variantes, stock DOT total 0, en 0: 2, **ambiguo en el sync** (existe en Contabilium DOT).

| Fila | Handle | Título | Opciones | Stock DOT | Diagnóstico |
|---|---|---|---|---|---|
| 47 | `applyfit™-vidrio-templado-kit-de-instalacion-s25-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (S25 Series) | Samsung S25 Plus | 0 | correcta |
| 50 | `applyfit™-vidrio-templado-kit-de-instalacion-s24-series` | ApplyFit™ - Vidrio Templado + Kit de Instalación (S24 Series) | Samsung S24 Plus | 0 | correcta |

El SKU nombra varios modelos y cada variante corresponde a uno de ellos: es un solo artículo físico publicado 2 veces en productos de distintas series. El sync no lo escribe (ambiguo). Opciones: dejar una sola variante con este SKU y a las demás darles otro SKU que no exista en Contabilium (no se sincronizan), o aceptar que el stock se cargue a mano.

### A3. Producto duplicado (0)

Ninguno.

### A4. Dudoso (57)

Todos los grupos A4 son el mismo patrón: el producto tiene una variante «iPhone 16e» y otra «iPhone 17e» con el mismo SKU terminado en `-IP16E`. En todo el catálogo, **58 de 58** variantes «iPhone 17e» usan el sufijo `IP16E` (no existe ningún SKU `IP17E` fuera del vidrio ApplyFit universal), así que parece una convención deliberada: la misma funda para los dos equipos. Pero ni el export ni el log lo confirman, por eso va como dudoso (pregunta P1). En todos los pares la variante 17e está en 0 y el stock está en la 16e.

| SKU | Handle | Stock 16e | Stock 17e | Ambiguo en el sync |
|---|---|---|---|---|
| `IEY-COMBO-CARBON-VERDE-IP16E` | `combo-magsafe-carbon-funda-billetera` | 4 | 0 | no |
| `IEY-CASE-CARBON-VERDE-IP16E` | `magcase-iphone-carbon-17-series`, `magcase-iphone-carbon` | 4 | 0 | no |
| `IEY-COMBO-IEY105N-CARBON-VERDE-IP16E` | `combo-magsafe-funda-carbon-verde-estacion-de-carga-inalambrica-3-en-1` | 4 | 0 | no |
| `IEY-COMBO-IEY105P-CARBON-VERDE-IP16E` | `combo-magsafe-funda-carbon-verde-estacion-de-carga-inalambrica-3-en-1` | 4 | 0 | no |
| `IEY-COMBO-IEYC08P-CARBON-NEGRO-IP16E` | `combo-magsafe-funda-carbon-negro-bateria-inalambrica-ultrafina-5000-mah` | 3 | 0 | sí |
| `IEY-COMBO-CARBON-AZUL-IP16E` | `combo-magsafe-carbon-funda-billetera` | 3 | 0 | no |
| `IEY-CASE-CARBON-AZUL-IP16E` | `magcase-iphone-carbon-17-series`, `magcase-iphone-carbon` | 3 | 0 | no |
| `IEY-COMBO-IEYC09N-CARBON-NEGRO-IP16E` | `combo-magsafe-funda-carbon-bateria-inalambrica-pro-10000-mah` | 3 | 0 | sí |
| `IEY-COMBO-IEYC09P-CARBON-NEGRO-IP16E` | `combo-magsafe-funda-carbon-bateria-inalambrica-pro-10000-mah` | 3 | 0 | sí |
| `IEY-COMBO-IEYQ222N-CARBON-NEGRO-IP16E` | `combo-magsafe-funda-carbon-negro-estacion-de-carga-inalambrica-3-en-1-qi2` | 3 | 0 | sí |
| `IEY-COMBO-IEYQ222B-CARBON-NEGRO-IP16E` | `combo-magsafe-funda-carbon-negro-estacion-de-carga-inalambrica-3-en-1-qi2` | 3 | 0 | sí |
| `IEY-COMBO-IEY105N-TRANSP-IP16E` | `combo-magsafe-funda-estacion-de-carga-inalambrica-3-en-1` | 3 | 0 | no |
| `IEY-COMBO-IEY105P-TRANSP-IP16E` | `combo-magsafe-funda-estacion-de-carga-inalambrica-3-en-1` | 3 | 0 | no |
| `IEY-COMBO-IEY108P-CARBON-NEGRO-IP16E` | `combo-car-magsafe-funda-negro-carbon-cargador-de-auto` | 3 | 0 | sí |
| `IEY-COMBO-IEY105N-CARBON-AZUL-IP16E` | `combo-magsafe-funda-carbon-estacion-de-carga-inalambrica-3-en-1` | 3 | 0 | no |
| `IEY-COMBO-IEY105P-CARBON-AZUL-IP16E` | `combo-magsafe-funda-carbon-estacion-de-carga-inalambrica-3-en-1` | 3 | 0 | no |
| `IEY-COMBO-IEY112N-CARBON-NEGRO-IP16E` | `combo-magsafe-2-funda-carbon-negro-estacion-de-carga-3-en-1-plegable` | 3 | 0 | sí |
| `IEY-COMBO-IEYC08N-CARBON-NEGRO-IP16E` | `combo-magsafe-funda-carbon-negro-bateria-inalambrica-ultrafina-5000-mah` | 3 | 0 | sí |
| `IEY-COMBO-IEYC08N-CARBON-VERDE-IP16E` | `combo-magsafe-funda-carbon-verde-bateria-inalambrica-ultrafina-5000-mah` | 2 | 0 | sí |
| `IEY-COMBO-IEYC08P-CARBON-VERDE-IP16E` | `combo-magsafe-funda-carbon-verde-bateria-inalambrica-ultrafina-5000-mah` | 2 | 0 | sí |
| `IEY-COMBO-CARBON-NEGRO-IP16E` | `combo-magsafe-carbon-funda-billetera` | 2 | 0 | no |
| `IEY-CASE-MATE-IP16E` | `magcase-iphone-matte-17-series`, `magcase-iphone-matte` | 2 | 0 | no |
| `IEY-CASE-CARBON-NEGRO-IP16E` | `magcase-iphone-carbon-17-series`, `magcase-iphone-carbon` | 2 | 0 | no |
| `IEY-COMBO-IEYC09N-CARBON-AZUL-IP16E` | `combo-magsafe-funda-carbon-azul-bateria-inalambrica-pro-10000-mah` | 2 | 0 | sí |
| `IEY-COMBO-IEYC09P-CARBON-AZUL-IP16E` | `combo-magsafe-funda-carbon-azul-bateria-inalambrica-pro-10000-mah` | 2 | 0 | sí |
| `IEY-COMBO-IEYC09N-CARBON-VERDE-IP16E` | `combo-magsafe-funda-carbon-verde-bateria-inalambrica-pro-10000-mah` | 2 | 0 | sí |
| `IEY-COMBO-IEYC09P-CARBON-VERDE-IP16E` | `combo-magsafe-funda-carbon-verde-bateria-inalambrica-pro-10000-mah` | 2 | 0 | sí |
| `IEY-COMBO-IEYQ222N-CARBON-VERDE-IP16E` | `combo-magsafe-funda-carbon-estacion-de-carga-inalambrica-3-en-1-qi2` | 2 | 0 | sí |
| `IEY-COMBO-IEYQ222B-CARBON-VERDE-IP16E` | `combo-magsafe-funda-carbon-estacion-de-carga-inalambrica-3-en-1-qi2` | 2 | 0 | sí |
| `IEY-COMBO-IEYQ222N-CARBON-AZUL-IP16E` | `combo-magsafe-funda-carbon-azul-estacion-de-carga-inalambrica-3-en-1-qi2` | 2 | 0 | sí |
| `IEY-COMBO-IEYQ222B-CARBON-AZUL-IP16E` | `combo-magsafe-funda-carbon-azul-estacion-de-carga-inalambrica-3-en-1-qi2` | 2 | 0 | sí |
| `IEY-COMBO-IEY108N-CARBON-AZUL-IP16E` | `combo-car-magsafe-funda-carbon-cargador-de-auto` | 2 | 0 | no |
| `IEY-COMBO-IEY108P-CARBON-AZUL-IP16E` | `combo-car-magsafe-funda-carbon-cargador-de-auto` | 2 | 0 | sí |
| `IEY-COMBO-IEY108N-CARBON-NEGRO-IP16E` | `combo-car-magsafe-funda-negro-carbon-cargador-de-auto` | 2 | 0 | no |
| `IEY-COMBO-IEY108N-CARBON-VERDE-IP16E` | `combo-car-magsafe-funda-carbon-verde-cargador-de-auto` | 2 | 0 | no |
| `IEY-COMBO-IEY108P-CARBON-VERDE-IP16E` | `combo-car-magsafe-funda-carbon-verde-cargador-de-auto` | 2 | 0 | sí |
| `IEY-COMBO-IEY105N-CARBON-NEGRO-IP16E` | `combo-magsafe-funda-carbon-negra-estacion-de-carga-inalambrica-3-en-1` | 2 | 0 | no |
| `IEY-COMBO-IEY105P-CARBON-NEGRO-IP16E` | `combo-magsafe-funda-carbon-negra-estacion-de-carga-inalambrica-3-en-1` | 2 | 0 | no |
| `IEY-COMBO-IEY112N-CARBON-AZUL-IP16E` | `combo-magsafe-2-funda-carbon-estacion-de-carga-3-en-1-plegable` | 2 | 0 | sí |
| `IEY-COMBO-IEY112N-CARBON-VERDE-IP16E` | `combo-magsafe-2-funda-carbon-verde-estacion-de-carga-3-en-1-plegable` | 2 | 0 | sí |
| `IEY-COMBO-IEYC08N-CARBON-AZUL-IP16E` | `combo-magsafe-funda-carbon-bateria-inalambrica-ultrafina-5000-mah` | 2 | 0 | sí |
| `IEY-COMBO-IEYC08P-CARBON-AZUL-IP16E` | `combo-magsafe-funda-carbon-bateria-inalambrica-ultrafina-5000-mah` | 2 | 0 | sí |
| `IEY-COMBO-IEYC09N-TRANSP-IP16E` | `combo-magsafe-funda-transparente-bateria-inalambrica-pro-10000-mah` | 1 | 0 | sí |
| `IEY-COMBO-IEYC09P-TRANSP-IP16E` | `combo-magsafe-funda-transparente-bateria-inalambrica-pro-10000-mah` | 1 | 0 | sí |
| `IEY-COMBO-IEYQ222N-TRANSP-IP16E` | `combo-magsafe-funda-transparente-estacion-de-carga-inalambrica-3-en-1-qi2` | 1 | 0 | sí |
| `IEY-COMBO-IEYQ222B-TRANSP-IP16E` | `combo-magsafe-funda-transparente-estacion-de-carga-inalambrica-3-en-1-qi2` | 1 | 0 | sí |
| `IEY-COMBO-IEY108N-TRANSP-IP16E` | `combo-car-magsafe-funda-cargador-de-auto` | 1 | 0 | sí |
| `IEY-COMBO-IEY108P-TRANSP-IP16E` | `combo-car-magsafe-funda-cargador-de-auto` | 1 | 0 | sí |
| `IEY-COMBO-IEY112N-TRANSP-IP16E` | `combo-magsafe-2-funda-estacion-de-carga-3-en-1-plegable` | 1 | 0 | sí |
| `IEY-COMBO-IEYC08N-TRANSP-IP16E` | `combo-magsafe-funda-transparente-bateria-inalambrica-ultrafina-5000-mah` | 1 | 0 | sí |
| `IEY-COMBO-IEYC08P-TRANSP-IP16E` | `combo-magsafe-funda-transparente-bateria-inalambrica-ultrafina-5000-mah` | 1 | 0 | sí |
| `IEY-COMBO-IEY108N-C-TRANSP-IP16E` | `combo-car-magsafe-funda-cargador-de-auto-brazo-extensible` | 0 | 0 | no |
| `IEY-COMBO-IEY108P-C-TRANSP-IP16E` | `combo-car-magsafe-funda-cargador-de-auto-brazo-extensible` | 0 | 0 | sí |
| `IEY-COMBO-IEY112B-TRANSP-IP16E` | `combo-magsafe-2-funda-estacion-de-carga-3-en-1-plegable` | 0 | 0 | sí |
| `IEY-COMBO-IEY112B-CARBON-AZUL-IP16E` | `combo-magsafe-2-funda-carbon-estacion-de-carga-3-en-1-plegable` | 0 | 0 | sí |
| `IEY-COMBO-IEY112B-CARBON-NEGRO-IP16E` | `combo-magsafe-2-funda-carbon-negro-estacion-de-carga-3-en-1-plegable` | 0 | 0 | sí |
| `IEY-COMBO-IEY112B-CARBON-VERDE-IP16E` | `combo-magsafe-2-funda-carbon-verde-estacion-de-carga-3-en-1-plegable` | 0 | 0 | sí |

Totales A4: stock DOT 115; variantes en 0: 63 de 114; ambiguos en el sync: 38 de 57.

### B. SKUs cruzados en variantes con SKU único

| Fila | Handle | Opciones | Stock DOT | SKU actual | SKU esperado | Evidencia | Confianza |
|---|---|---|---|---|---|---|---|
| 4 | `combo-magsafe-funda-carbon-azul-estacion-de-carga-inalambrica-3-en-1-qi2` | Negro / iPhone 18 Pro | 1 | `IEY-COMBO-IEYQ222N-CARBON-AZUL-IP18PM` | `IEY-COMBO-IEYQ222N-CARBON-AZUL-IP18PRO` | la opción «iPhone 18 Pro» lleva el sufijo `IP18PRO` en 60 variantes del catálogo; esta tiene `IP18PM`; **par invertido** con la fila 5 | alta |
| 5 | `combo-magsafe-funda-carbon-azul-estacion-de-carga-inalambrica-3-en-1-qi2` | Negro / iPhone 18 Pro Max | 2 | `IEY-COMBO-IEYQ222N-CARBON-AZUL-IP18PRO` | `IEY-COMBO-IEYQ222N-CARBON-AZUL-IP18PM` | la opción «iPhone 18 Pro Max» lleva el sufijo `IP18PM` en 60 variantes del catálogo; esta tiene `IP18PRO`; **par invertido** con la fila 4 | alta |

Como los dos SKUs existen en Shopify (intercambiados), el sync **sí escribe**: el stock de Contabilium del 18 Pro va a la variante 18 Pro Max y viceversa, sin avisar. Como el cambio es un intercambio, en el admin hay que hacerlo en dos pasos (Shopify puede tolerar SKUs repetidos, pero conviene no dejarlos ni un instante si el sync corre): poner un SKU temporal en una, corregir la otra y después la primera.

## 4. Casos dudosos: preguntas para la persona

- **P1 (iPhone 16e / 17e, 57 grupos).** ¿La funda/combo de iPhone 16e es la misma que la de 17e? Si **sí**: dejar una sola variante con el SKU `-IP16E` (o sumar ambas en un título «16e / 17e») para que el sync deje de marcarlo ambiguo. Si **no**: hay que crear SKUs `-IP17E` en Contabilium y cargarlos en las variantes 17e. Hoy 38 de estos SKUs existen en Contabilium DOT y el sync no los escribe.
- **P2 (stock alto en combos que no están en Contabilium DOT).** En `combo-car-magsafe-funda-negro-carbon-cargador-de-auto` las variantes iPhone 17 Pro Max (fila 1652), 17 Pro (1751), 17 (1749) y 17 Air (1750) muestran 125, 114, 46 y 14 unidades en el DOT. Sus SKUs (`IEY-COMBO-IEY108N-CARBON-NEGRO-IP17*`) **no** aparecen como ambiguos en el log aunque están repetidos, lo que indica que no existen en el depósito DOT de Contabilium. ¿De dónde sale ese stock? ¿Es carga manual? Después de corregir las filas 1741 a 1744 (sección 2) el SKU deja de estar repetido, pero el sync tampoco lo va a tocar mientras no exista en Contabilium.
- **P3 (ApplyFit iPhone 18 Ultra).** La variante «iPhone 18 Ultra» de `applyfit™-vidrio-templado-kit-de-instalacion-18-series` (fila 28, stock 0) tiene el SKU `APPLYFIT-CLEAR-IP18FOLD`, mientras que en el resto del catálogo «iPhone 18 Ultra» se codifica `IP18ULTRA`. ¿«Fold» y «Ultra» son el mismo equipo? Ninguno de los dos SKUs aparece en el log, así que no hay evidencia para proponer un cambio. Confianza baja.
- **P4 (variantes faltantes, no es un SKU cruzado).** El log tiene `IEY-COMBO-IEY108N/108P-C-S-TRANSPARENTE-S23FE` y `-S24FE` en «no existe en Shopify», y el producto `combo-car-magsafe-samsung-funda-transparente-cargador-de-auto-con-brazo-extensible` no tiene variantes S23 FE ni S24 FE. ¿Hay que crearlas?
- **P5 (opción con un typo).** En `combo-magsafe-samsung-funda-carbon-azul-estacion-de-carga-inalambrica-3-en-1` dos variantes (filas 631 y 634) tienen el modelo «Samsung S2» con SKU `...-S26`. El SKU parece correcto; probablemente la opción debería decir «Samsung S26». No afecta al sync.

## 5. Metodología, heurísticas y límites

- **Lectura:** el CSV con el módulo `csv` de Python (con BOM). El stock es `On hand (current)` de la location DOT. Del log se tomaron las líneas `[SKIP] dot/<SKU>: no existe en Shopify` y `[SKIP] dot/<SKU>: SKU ambiguo: N variantes ...`; en el log cada línea aparece duplicada, se deduplicó. Para los 50 ambiguos, la cantidad N del log coincide con la cantidad de variantes del export en todos los casos.
- **Estructura del SKU de los combos:** `IEY-COMBO-<cargador+letra de color>-<funda y color>-<modelo>`, por ejemplo `IEY-COMBO-IEY108P-CARBON-AZUL-IP17`. Para fundas: `IEY-CASE-<línea>-<color>-<modelo>`.
- **Letra de color del cargador (verificada en el catálogo):** opción Color Blanco → `B` (208/208), Negro → `N` (507/507), Plateado → `P` (252/255), Gris Plateado → `P` (638/641), Gris Azulado → `N` (641/641). Las 6 excepciones son justamente las variantes corregidas en A2. En productos donde la opción Color es el color de la funda (Azul/Verde), el cargador es siempre `N`.
- **Sufijo de modelo (inferido del catálogo):** cada opción de modelo tiene un sufijo dominante (por ejemplo iPhone 18 Pro → `IP18PRO` en 60 de 61, iPhone 18 Pro Max → `IP18PM` en 60 de 61, Samsung S25 Fe → `S25FE`, iPhone 12/12 Pro → `IP12/12PRO`). La única excepción es el par invertido. iPhone 17e → `IP16E` en todos los casos (por eso P1).
- **Heurística A2/B (prefijo):** dentro de un mismo producto y un mismo valor de Color, todas las variantes deberían compartir el prefijo (cargador + funda); la variante con prefijo minoritario se marca y se propone el prefijo mayoritario con su propio sufijo de modelo. Confianza **alta** si el SKU propuesto figura en «no existe en Shopify» (Contabilium lo tiene y Shopify no) o si es un par invertido; **media** si no.
- **Heurística color de funda:** se comparó el color del handle (`funda-carbon-azul`, etc.) y la opción Color de las fundas contra el SKU. No hubo discrepancias (`TRANSP` = Transparente es una abreviatura usada de forma consistente).
- **Límites:** (1) si un producto entero tiene el prefijo mal, la heurística de mayoría no lo ve; (2) el log solo cubre SKUs que Contabilium tiene en el DOT, así que un SKU que «no aparece» puede existir en otro depósito; (3) el log no trae cantidades de Contabilium, así que no se puede medir cuánto stock real queda sin sincronizar; (4) no se consultó el estado (activo/borrador) de los productos: el CLI de Shopify no se usó; (5) los productos sin opciones de modelo/color (adaptadores, cargadores sueltos) solo se revisaron por repetición, no por cruce.

## 6. Prioridad

Criterio usado para ordenar la tabla de la sección 2: primero los pares invertidos (el sync escribe hoy stock en el producto equivocado), después los repetidos que el sync marca ambiguos (existen en Contabilium y no se sincronizan) ponderados por el stock DOT del grupo, después los cruces con SKU único, y al final los universales y dudosos.
