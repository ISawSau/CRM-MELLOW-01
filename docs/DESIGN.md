# Diseño visual · tokens

Estado: **propuesta pendiente de aprobación**. No se construyen pantallas hasta que se apruebe (SPEC §8).

Fuente: https://yellowmellow.cc (HTML, `style.css` y `growth.css` leídos el 02/10/2026). No hay capturas en el repositorio; los valores salen directamente de las hojas de estilo de la web.

---

## 1. Lo que define el portfolio

| Rasgo | En la web | Cómo se traslada al CRM |
|---|---|---|
| Fondo oscuro cálido | Casi negro marrón (`#0d0908`), no gris ni azul. | Tema oscuro por defecto con esa base. |
| Acento melocotón | `#e0a47c` para enlaces activos, botones, números destacados. No hay amarillo. | Acento principal. Sobre fondo claro solo como fondo con texto oscuro, nunca como texto (contraste 2,0:1 sobre papel). |
| Paleta tierra | Terracota `#bc6b4a` (números de sección, flechas), vino `#7a2e27` (detalles, cuadraditos). | Terracota y vino como acentos secundarios: índices, marcadores, estados. |
| Esquinas rectas | Ningún `border-radius` salvo avatares redondos. | Radio 0 en botones, campos, tablas, menús y paneles. Solo avatares y puntos de estado son redondos. |
| Líneas finas en vez de sombras | Separaciones con bordes de 1 px semitransparentes (`rgba(224,164,124,.22)`). Sin sombras, sin degradados. | Superficies separadas por líneas de 1 px. Sombra solo en elementos flotantes (paleta Ctrl+K, menús), muy sutil. |
| Tipografía display en mayúsculas | Archivo 800, mayúsculas, interletraje negativo. | Solo títulos de pantalla y cifras KPI grandes. Nunca en tablas ni formularios. |
| "Eyebrows" | Texto pequeño, mayúsculas, interletraje 0,16 em, con número de sección (`01`). | Etiquetas de grupo en la barra lateral, cabeceras de sección y de columnas de tabla. |
| Monoespaciada para datos técnicos | JetBrains Mono en logs y pasos. | IDs, nombres de campaña, logs de sincronización, atajos de teclado. |
| Cuadraditos de 6 px | Marcador de estado (`::before` 6×6 px) y separadores. | Indicador de estado en listas y barra de estado (cuadrado, no círculo). |
| Flechas tipográficas | `→`, `↗`, `↓` dentro del texto de botones y listas. | `↗` en enlaces externos, `→` en acciones de navegación. |
| Movimiento discreto | `cubic-bezier(0.2, 0.7, 0.2, 1)`, 0,2 s; respeta `prefers-reduced-motion`. | Igual. Sin animaciones decorativas en pantallas de trabajo. |
| Foco visible | Contorno de 2 px melocotón con 3 px de separación. | Igual en toda la app (accesibilidad por teclado). |
| Selección de texto | Fondo melocotón, texto tinta. | Igual. |

Lo que **no** se copia: el marquee, la cuadrícula de puntos del hero, los efectos de desenfoque y los easter eggs. Son de una web de presentación, no de una herramienta de trabajo diaria.

---

## 2. Paleta base

Valores tal cual en la web (primera columna) más los que añado para cubrir lo que la web no necesita (marcados con *).

| Token | Valor | Origen |
|---|---|---|
| `ink` | `#0d0908` | web |
| `ink-soft` | `#17100e` | web |
| `ink-raised` * | `#211815` | derivado de `ink-soft`, un paso más claro |
| `ink-muted` | `#5a4a43` | web |
| `paper` | `#fdf6ee` | web |
| `paper-sunken` * | `#f4ebe1` | derivado de `paper`, un paso más oscuro |
| `paper-muted` | `#cbbeb5` | web |
| `peach` | `#e0a47c` | web |
| `terracotta` | `#bc6b4a` | web |
| `terracotta-deep` * | `#9c4f30` | terracota oscurecida para texto sobre papel |
| `wine` | `#7a2e27` | web |
| `ok` | `#9fbf7a` | web (`--ok` en growth.css) |
| `ok-deep` * | `#4f6b2e` | verde para texto sobre papel |
| `danger` * | `#e8806a` | rojo cálido legible sobre tinta |
| `danger-deep` * | `#a3322a` | rojo para texto sobre papel |
| `warn` * | `#e6c06a` | ámbar legible sobre tinta |
| `warn-deep` * | `#8a5a12` | ámbar para texto sobre papel |

---

## 3. Tokens semánticos por tema

La app usa siempre los semánticos, nunca los de paleta directamente.

| Token | Oscuro (por defecto) | Claro |
|---|---|---|
| `--bg` | `ink` | `paper` |
| `--bg-raised` (paneles, barra lateral) | `ink-soft` | `paper-sunken` |
| `--bg-hover` | `ink-raised` | `#efe4d8` |
| `--text` | `paper` | `ink` |
| `--text-muted` | `paper-muted` | `ink-muted` |
| `--text-faint` (marcadores de posición) | `#a8978d` | `#6b5a52` |
| `--line` | `rgba(224,164,124,.22)` | `rgba(13,9,8,.16)` |
| `--line-strong` | `rgba(224,164,124,.45)` | `rgba(13,9,8,.32)` |
| `--accent` (fondo de botón principal, selección) | `peach` | `peach` |
| `--on-accent` (texto sobre acento) | `ink` | `ink` |
| `--accent-text` (enlaces, cifras destacadas) | `peach` | `terracotta-deep` |
| `--index` (números de sección, flechas) | `terracotta` | `terracotta-deep` |
| `--marker` (cuadraditos, detalles) | `wine` sobre claro / `terracotta` sobre oscuro | `wine` |
| `--success` | `ok` | `ok-deep` |
| `--danger` | `danger` | `danger-deep` |
| `--warning` | `warn` | `warn-deep` |
| `--focus` | `peach` | `wine` |

### Contraste comprobado (WCAG 2.x)

| Combinación | Ratio | Uso |
|---|---|---|
| `paper` sobre `ink` | 18,5:1 | texto principal oscuro |
| `paper-muted` sobre `ink` / `ink-soft` / `ink-raised` | 10,9 / 10,4 / 9,6 | texto secundario |
| `#a8978d` sobre `ink` | 7,1:1 | texto tenue |
| `peach` sobre `ink` | 9,2:1 | acento como texto en oscuro |
| `terracotta` sobre `ink` | 5,0:1 | índices (AA) |
| `ok` / `danger` / `warn` sobre `ink` | 9,6 / 7,3 / 11,4 | estados |
| `ink` sobre `paper` | 18,5:1 | texto principal claro |
| `ink-muted` sobre `paper` / `paper-sunken` | 7,9 / 7,1 | texto secundario |
| `#6b5a52` sobre `paper` | 6,1:1 | texto tenue |
| `terracotta-deep` sobre `paper` | 5,5:1 | acento como texto en claro (la terracota original da 3,7, insuficiente) |
| `ok-deep` / `danger-deep` / `warn-deep` sobre `paper` | 5,6 / 6,4 / 5,5 | estados |
| `ink` sobre `peach` | 9,2:1 | botón principal |
| `peach` sobre `paper` | **2,0:1** | prohibido como texto |
| `wine` sobre `ink` | **2,1:1** | solo decorativo, nunca texto |

---

## 4. Tipografía

Las tres familias de la web, todas con licencia SIL Open Font License (gratuitas). Se empaquetan dentro de la app (paquetes Fontsource). No se cargan desde Google Fonts, para que la app funcione sin internet y la CSP no tenga que permitir dominios externos.

| Token | Familia | Pesos | Uso |
|---|---|---|---|
| `--font-display` | Archivo | 700, 800 | títulos de pantalla en mayúsculas, cifras KPI grandes |
| `--font-body` | DM Sans | 400, 500, 600 | toda la interfaz |
| `--font-mono` | JetBrains Mono | 400, 500 | IDs, nombres técnicos, logs, atajos |

Cifras: `font-variant-numeric: tabular-nums` en tablas, totales, KPIs y barra de estado, para que las columnas de números queden alineadas.

Escala (la web usa 17 px de base; una app densa necesita menos):

| Token | Compacta | Cómoda | Uso |
|---|---|---|---|
| `--text-xs` | 11 px | 12 px | eyebrows, cabeceras de columna (mayúsculas, interletraje 0,12 em) |
| `--text-sm` | 12 px | 13 px | celdas de tabla, barra de estado |
| `--text-md` | 13 px | 14 px | texto base, formularios |
| `--text-lg` | 16 px | 17 px | títulos de panel |
| `--text-xl` | 22 px | 24 px | títulos de pantalla (Archivo 800, mayúsculas, interletraje −0,01 em) |
| `--text-kpi` | 28 px | 32 px | cifras grandes de inicio y dashboards (Archivo 800) |

Interlineado: 1,45 en texto corrido, 1,2 en celdas y títulos.

---

## 5. Espaciado, tamaños y forma

- Base de 4 px: `--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 24 · `--space-6` 32 · `--space-7` 48.
- Altura de fila de tabla: 28 px (compacta) / 36 px (cómoda).
- Altura de botones y campos: 28 px / 34 px. El botón principal de la web mide 48 px; aquí solo en pantallas de bienvenida y desbloqueo.
- Barra lateral: 224 px, plegable a 48 px.
- Barra de estado: 24 px.
- `--radius`: **0**. `--radius-round`: 50 % (solo avatares).
- Bordes: 1 px `--line`. Separación entre bloques con líneas, no con tarjetas.
- Elevación: ninguna salvo flotantes, con `0 8px 24px rgba(0,0,0,.35)` en oscuro y `0 8px 24px rgba(13,9,8,.12)` en claro, más borde `--line-strong`.
- Movimiento: `--ease: cubic-bezier(0.2, 0.7, 0.2, 1)`, `--dur: 150ms`. Sin movimiento si el sistema pide reducirlo.

---

## 6. Componentes clave (cómo se ven)

- **Botón principal:** fondo `--accent`, texto `--on-accent`, peso 600, sin radio. Hover: fondo `paper` (oscuro) / `ink` con texto `paper` (claro), igual que en la web.
- **Botón secundario:** transparente, borde `--line`, texto `--text`. Hover: borde y texto `--accent-text`.
- **Campo de texto:** fondo `--bg`, borde `--line`, foco con contorno `--focus`. Etiqueta encima en `--text-muted`.
- **Barra lateral:** fondo `--bg-raised`, grupos con eyebrow numerado (`01 trabajo`, `02 media buying`…) en `--index`. Elemento activo: línea vertical de 2 px `--accent` a la izquierda y texto `--text`.
- **Barra de estado:** 24 px, `--text-sm`, cuadradito de 6 px de color de estado + texto. Mono para la ruta de la bóveda.
- **Paleta Ctrl+K:** panel flotante centrado, sin radio, borde `--line-strong`, campo grande arriba, resultados con atajo en mono a la derecha.
- **Tablas:** cabecera en eyebrow (`--text-xs`, mayúsculas, `--text-muted`), filas separadas por `--line`, sin cebra, hover `--bg-hover`, cifras tabulares alineadas a la derecha.
- **Estados vacíos:** número de sección en `--index`, título corto y un botón con la siguiente acción ("Crear el primer cliente →").

---

## 7. Tono de los textos

La web habla en frases cortas, concretas y sin relleno ("The algorithm only knows what you tell it."), con orden explícito (problema → qué hice → qué cambió) y numeración.

En la app (en español de España):

- Frases cortas, sin adornos ni signos de exclamación.
- Mayúscula solo al inicio y en nombres propios (no "Nuevo Cliente"). Los títulos en mayúsculas lo son solo por estilo (CSS), el texto se escribe normal.
- Botones con verbo claro: "Guardar cambios", "Crear bóveda", "Desbloquear".
- Errores que dicen qué ha pasado y qué hacer: "La contraseña no es correcta. Inténtalo de nuevo o usa la clave de recuperación."
- Estados vacíos con siguiente paso concreto.

---

## 8. Pendiente de tu decisión

1. ¿Tema oscuro por defecto (como la web) o seguir el tema del sistema?
2. ¿Densidad por defecto compacta o cómoda?
3. Colores añadidos (`danger`, `warn` y sus versiones `-deep`): ¿te encajan o prefieres otros tonos?
