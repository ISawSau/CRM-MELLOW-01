# Decisiones técnicas

Registro de las decisiones relevantes y su motivo. Las más recientes, al final.

---

## Fase 0 · Cimientos (02/10/2026)

### D-001 · Versiones base

Electron 44 (Chromium 152, Node 24.21), electron-vite 5, Vite 7, React 19, TypeScript 6.0, Vitest 5, Playwright 1.63, electron-builder 26.

- **Vite 7 y no 8:** electron-vite 5 (la última estable) solo admite Vite ≤ 7. `@vitejs/plugin-react` 5.2 es compatible con ambos.
- **TypeScript 6.0 y no 7:** typescript-eslint 8 exige TypeScript < 6.1.
- **Node 24 LTS** (`.nvmrc`): es la versión de Node que lleva Electron 44 por dentro, así los tests y la app usan la misma. En Arch es el paquete `nodejs-lts-krypton`.

### D-002 · Proyecto montado a mano, sin plantilla

Se crean solo los archivos necesarios en lugar de usar `create-electron-vite`, para no arrastrar ejemplos ni configuración que no se usa.

### D-003 · SQLite cifrada: better-sqlite3-multiple-ciphers con alias `better-sqlite3`

- En `package.json`, `better-sqlite3` es un alias de npm de `better-sqlite3-multiple-ciphers`. Drizzle importa `better-sqlite3` por su nombre; con el alias recibe la versión con cifrado sin parches.
- Cifrado en modo SQLCipher 4 (`cipher='sqlcipher'`, `legacy=4`) con clave en bruto de 32 bytes: no se aplica el PBKDF2 de SQLCipher porque la derivación ya la hace Argon2id.
- Verificado: el archivo no tiene la cabecera "SQLite format" y una clave errónea da `SQLITE_NOTADB`.
- El paquete trae binarios **N-API** precompilados (válidos para Node y Electron a la vez), así que no hace falta recompilar para Electron ni tener compilador. `npmRebuild: false` en electron-builder. Los tests de Vitest se ejecutan con Node normal.

### D-004 · Argon2id con hash-wasm

El Node de Electron no incluye `crypto.argon2` (Electron usa BoringSSL; comprobado: `ERR_CRYPTO_ARGON2_NOT_SUPPORTED`). Se usa hash-wasm (MIT, WebAssembly, sin módulo nativo).

Parámetros: 128 MiB, 3 pasadas, paralelismo 1 (~1 s en un portátil; ~0,9 s medido en la máquina de CI). Supera el mínimo de OWASP (19 MiB, 2 pasadas). Se guardan en `vault.json`, así que se pueden subir más adelante sin romper bóvedas.

### D-005 · Esquema de claves: clave maestra con dos ranuras

Cambia la SPEC §5 (aprobado por el usuario el 02/10/2026):

- Una **clave maestra** aleatoria de 32 bytes cifra todo. Nunca se guarda en claro.
- En `vault.json` hay dos **ranuras**: la clave maestra cifrada con AES-256-GCM bajo una clave derivada de la contraseña (Argon2id), y otra bajo una clave derivada de la clave de recuperación. Cada ranura lleva como datos asociados el id de la bóveda, la generación de clave y el nombre de la ranura, así que no se puede copiar entre bóvedas.
- La clave de la base de datos es `HKDF-SHA256(clave maestra, "crm-mellow/db/v1")`. Los archivos (fase 4) usarán otra subclave.
- **Cambiar la contraseña** solo vuelve a cifrar la ranura: es instantáneo y `crm.db` no se toca.
- **Rotar la clave** genera una clave maestra nueva, re-cifra `crm.db` (`PRAGMA rekey`) y genera una clave de recuperación nueva. Orden a prueba de cortes: copia de seguridad → `vault.json.pending` → re-cifrado → sustitución de `vault.json`. Si se corta a medias, el siguiente desbloqueo lo detecta y lo completa.
- Las contraseñas se normalizan a Unicode NFC antes de derivar, para que una "ñ" escrita en Windows y en Linux dé la misma clave.

### D-006 · Clave de recuperación

160 bits aleatorios en base32 de Crockford: 32 caracteres en 8 grupos de 4 (`XXXX-XXXX-…`). Sin letras ambiguas; al escribirla se aceptan minúsculas, espacios y guiones, y se corrigen I/L→1 y O→0.

### D-007 · Contraseña: solo un mínimo de 8 caracteres

`MIN_PASSWORD_LENGTH = 8` en `src/shared/ipc.ts`, sin ninguna otra regla (ni mayúsculas, ni números, ni símbolos): "aaaaaaaaaa" o "11111111" son válidas. Confirmado por el usuario el 02/10/2026, después de explicarle que una contraseña de 4 cifras ("2021") solo tiene 10.000 combinaciones y se podría adivinar en pocas horas con el archivo de la bóveda en la mano. Un test cubre los dos ejemplos.

### D-008 · `.lock` con latido

El `.lock` guarda equipo, PID, id de instancia, hora de apertura y un latido que se actualiza cada 30 s. Un lock sin latido en 2 minutos se considera abandonado (la app se cerró por un corte de luz, por ejemplo). Un lock reciente de otro equipo avisa y permite forzar. El lock se toma al desbloquear y se suelta al bloquear o cerrar.

### D-009 · Migraciones propias sobre SQL de drizzle-kit

- `drizzle-kit generate` crea el SQL en `drizzle/` a partir de `src/main/db/schema.ts`. Vite lo incrusta en el bundle (`import.meta.glob`), así que no hay que empaquetar la carpeta.
- Un ejecutor propio (`src/main/db/migrate.ts`) las aplica en orden, cada una en su transacción, y registra cada una en `_migrations`.
- **Antes de migrar una base de datos con datos**, copia `crm.db` y `vault.json` a `backups/AAAAMMDD-HHMMSS-antes-de-migrar-vX-a-vY/`. La copia incluye el `vault.json` del momento para que se pueda abrir con la contraseña válida entonces.
- `vault.json` guarda `schemaVersion`. Una app que conoce menos migraciones se niega a abrir la bóveda.

### D-010 · Endurecimiento de Electron

Además de lo que pide CLAUDE.md:

- La interfaz se sirve desde un protocolo propio `app://crm` (no `file://`), con la CSP en cabecera y bloqueo de rutas que salen de la carpeta de la interfaz.
- CSP de producción: `default-src 'none'`, scripts y estilos solo de `'self'`, sin `unsafe-inline` ni `unsafe-eval`, sin conexiones externas.
- El renderer no puede hacer ninguna petición de red: un filtro de `webRequest` cancela todo lo que no sea `app://crm`. Toda la red (Meta, Google…) la hará el proceso principal.
- Sesión solo en memoria (`partition: 'crm'`, sin caché): Chromium no guarda cookies, localStorage ni caché de la interfaz en disco.
- **Corrector ortográfico desactivado** en todas las sesiones en el momento de crearlas: Chromium descargaba diccionarios de `redirector.gvt1.com` (Google) al arrancar, y esa petición no pasa por `webRequest`. Detectado con el registro de red; ahora un test lo vigila.
- Todos los permisos del navegador denegados; descargas bloqueadas; `window.open` y la navegación externa bloqueados (los enlaces `https` y `mailto` se abren en el navegador del sistema).
- IPC: solo se aceptan mensajes de la ventana principal y de `app://crm`; entrada validada con zod; el preload expone solo `invoke` y `on` sobre una lista blanca.
- Las rutas de disco que acepta el IPC son solo las elegidas en el selector nativo de carpetas (o la última bóveda), para que una interfaz comprometida no pueda crear ni abrir carpetas arbitrarias.
- La clave de recuperación se copia al portapapeles desde el proceso principal y se borra a los 60 s si sigue ahí.
- Bloqueo automático por inactividad (15 min por defecto), y también al suspender el equipo o bloquear la sesión.
- Empaquetada: sin menú (y sin DevTools), y se niega a arrancar con `--remote-debugging-port` o `--inspect`.
- **Fuses:** RunAsNode, NODE_OPTIONS, `--inspect` y privilegios de `file://` desactivados; solo se carga código desde `app.asar` con verificación de integridad; cifrado de cookies activado. `scripts/verificar-fuses.mjs` lo comprueba en CI.

Chromium sigue escribiendo cachés internas (GPU, estado de la sesión por defecto) en la carpeta de datos de la app (`~/.config/CRM-Mellow`, `%APPDATA%\CRM-Mellow`). No contienen datos de usuario: la interfaz usa la sesión en memoria y los datos solo pasan por el proceso principal. Ahí está también `config.json`, con la ruta de la última bóveda.

### D-011 · Instaladores: NSIS para Windows; pacman y AppImage para Linux (Arch)

Cambia la SPEC §2: el usuario usará Arch, así que el `.deb` se sustituye por un paquete **pacman** (`.pacman`, se instala con `sudo pacman -U`). Se mantiene el **AppImage** como opción portable que no necesita instalarse.

- `productName` sin espacios (`CRM-Mellow`): con `/opt/CRM Mellow`, el sandbox SUID de Chromium falla (`execvp: /opt/CRM`). Detectado al probar el paquete en Arch. El nombre visible sigue siendo "CRM Mellow".
- Las dependencias pacman se declaran a mano: las de electron-builder por defecto incluyen paquetes que ya no existen en Arch (`http-parser`, `libappindicator-gtk3`).
- Sandbox de Chromium en Arch: el script de instalación del paquete deja `chrome-sandbox` sin SUID si el kernel permite user namespaces (el kernel normal de Arch), y lo pone SUID si no (p. ej. `linux-hardened`). La app nunca se ejecuta con `--no-sandbox`. El AppImage necesita user namespaces (no admite SUID).
- NSIS por usuario (sin pedir permisos de administrador). Desinstalar no borra nada de la bóveda.
- **Instalador de Windows sin firmar:** firmar cuesta dinero. SmartScreen avisará la primera vez.
- Verificado en un contenedor de Arch: instalación con pacman, dependencias resueltas, `ldd` sin bibliotecas que falten, autoprueba correcta (pacman y AppImage) y desinstalación limpia.

### D-012 · Autoprueba de la instalación

`crm-mellow --autoprueba` crea una bóveda temporal con los parámetros reales, la bloquea y la desbloquea, comprueba que no quedan `-wal`, `-shm` ni `.lock`, la borra y devuelve el código 0 o 1. Sirve para verificar el paquete en CI (Playwright no puede controlar la app empaquetada porque los fuses lo impiden, como debe ser) y al usuario para comprobar una instalación.

### D-013 · CI en GitHub Actions

- En cada PR y push a `main`: lint, tipos, formato, tests unitarios y tests de interfaz con el sandbox activado (en el runner de Ubuntu se permiten los user namespaces en lugar de usar `--no-sandbox`).
- En cada push a `main` (y a mano desde Actions): instalador de Windows en `windows-latest` y paquetes de Linux en `ubuntu-latest`, con verificación de fuses y autoprueba de la app empaquetada. Después, en un contenedor de Arch real: script de instalación, `pacman -U` y autoprueba.
- En Windows, el CI usa el mismo `scripts/instalar-windows.ps1` que el usuario, para que quede probado en un Windows real.
- Coste cero en un repo privado: la cuenta gratuita incluye 2.000 minutos al mes y 500 MB de almacenamiento de artefactos (medido en GB-hora a lo largo del mes); sin método de pago, al agotarse se bloquea en lugar de cobrar (documentación de GitHub, consultada el 02/10/2026). Los instaladores se guardan 5 días para no llenar el almacenamiento.

### D-014 · Scripts de instalación de un comando

- `scripts/instalar-arch.sh`: pacman (repositorios oficiales) + `npm ci` + descarga verificada de Electron + tests. Usa `-Syu` porque Arch no admite actualizaciones parciales. No se ejecuta como root.
- `scripts/instalar-windows.ps1`: winget (Git y Node.js LTS solo si faltan) + `npm ci` + Electron + tests. Guardado en UTF-8 con BOM para que Windows PowerShell 5.1 lea bien las tildes.
- Los dos se prueban en CI (Windows real y contenedor de Arch).
- Los scripts de instalación de las dependencias están desactivados (D-021). Electron 44 descarga su binario al usarse por primera vez, y los dos scripts lo descargan explícitamente al instalar.

### D-015 · Formato español

`Intl` con `es-ES` y `useGrouping: 'always'`: con la regla de CLDR, `es-ES` no agrupa los números de 4 cifras ("1234,56" en lugar de "1.234,56").

### D-016 · Avisos de `npm audit`

4 avisos moderados en esbuild antiguo dentro de drizzle-kit (servidor de desarrollo de esbuild). drizzle-kit solo se usa en desarrollo para generar el SQL y no arranca ese servidor; no llega a la app. Se revisará al actualizar drizzle-kit.

### D-017 · Sistema de temas

- Un tema es un objeto `{ id, name, scheme, colors }` con un valor para cada token semántico de `docs/DESIGN.md`, validado con zod (los colores solo pueden ser `#rrggbb` o `rgba(...)`). Se aplica escribiendo variables CSS en `<html>` (CSSOM, compatible con la CSP sin `unsafe-inline`).
- Predefinidos: `oscuro` (por defecto) y `claro`. Un test exige contraste AA en ambos.
- Pensado para el editor de temas de la fase 12: un tema propio será un objeto más, guardado en la bóveda y validado con el mismo esquema.
- La apariencia (tema y densidad) se guarda dentro de la bóveda, no en `config.json`, porque CLAUDE.md solo permite guardar fuera la ruta de la bóveda. Antes de desbloquear se usa la apariencia por defecto.

### D-018 · Cifras con Archivo

La versión empaquetada de DM Sans no tiene cifras tabulares (se comprobó con fontTools: no tiene la función `tnum` y los dígitos tienen anchos distintos). Las cifras que deben alinearse usan Archivo, que sí las tiene (`--font-numeric`, clase `.num`).

### D-019 · Paleta Ctrl+K sin el diálogo de Radix

cmdk trae `Command.Dialog`, basado en Radix Dialog, que inyecta una etiqueta `<style>` (react-remove-scroll) que la CSP bloquearía. Se usa `Command` dentro de un modal propio (overlay, Escape y devolución del foco). Los tests de interfaz fallan si aparece cualquier error de consola o violación de la CSP durante el flujo completo.

### D-020 · Navegación sin router

En la fase 0 la sección activa es un estado de React. Las secciones futuras muestran en qué fase llegan. Se añadirá un router cuando el motor de datos (fase 1) necesite rutas con parámetros. *Fase 1:* no hizo falta; basta con la sección y el registro abierto en el estado (ver D-035).

### D-021 · `ignore-scripts=true` en `.npmrc`

Detectado al instalar en el Windows del usuario: npm 11 ejecuta `node-gyp rebuild` en `better-sqlite3` (deduce ese script porque el paquete trae un `binding.gyp`) e intenta compilar SQLite con Visual Studio. Sin las herramientas de C++, `npm ci` falla. En el CI no se notaba porque los runners de GitHub sí tienen compilador.

Esa compilación no sirve para nada: el paquete carga primero su binario N-API precompilado (`prebuilds/win32-x64.node`, `linux-x64.node`). Así que en `.npmrc`:

- `ignore-scripts=true`: ninguna dependencia ejecuta scripts al instalarse. `npm run …` y `npm test` siguen funcionando.
- Ventaja de seguridad: los scripts de instalación son el vector típico de los ataques a la cadena de suministro de npm. npm 12 ya los bloquea por defecto.
- Comprobado tras una instalación limpia: sin carpeta `build/` de SQLite, con tests unitarios y de interfaz, empaquetado, fuses y autoprueba correctos.
- No hace falta Visual Studio ni Python para desarrollar.

### D-022 · Página de descarga en GitHub Releases

El usuario no quiere escribir comandos de desarrollo para usar la app. Los instaladores ya existían, pero solo estaban en Actions (dentro de un zip y durante 5 días).

- Al cerrar cada fase se sube la versión en `package.json` (fase 0 → 0.1.0, fase 1 → 0.2.0…). En el siguiente push a `main`, si la versión no está publicada y han pasado todos los tests e instaladores, el CI crea la versión `vX.Y.Z` en Releases con el `.exe`, el `.pacman`, el AppImage, `SHA256SUMS.txt` y las instrucciones de `.github/notas-version.md`.
- Los Releases son gratis y no cuentan para los 500 MB de almacenamiento de Actions.
- Arch: el usuario prefiere el paquete pacman (una línea, `sudo pacman -U`) al AppImage. El AppImage se publica como alternativa sin instalación.
- **Prueba del instalador de Windows en CI** (`scripts/probar-instalador-windows.ps1`): instala el `.exe` en silencio, comprueba el ejecutable y los accesos directos del escritorio y del menú Inicio, abre la app instalada con `--autoprueba`, desinstala y comprueba que no queda nada.
- Sin actualización automática: con el repositorio privado, la app necesitaría un token para consultar Releases, y CLAUDE.md prohíbe guardar credenciales fuera de la base de datos cifrada (y tampoco tendría sentido ponerlo en el código). Se puede reconsiderar si el repositorio pasa a público.

### D-023 · Marca: logo y editor «yellowmellow» (v0.1.1)

- Petición del usuario tras instalar la v0.1.0: el editor debe ser **yellowmellow** y el logo, su foto de perfil.
- `author` en `package.json` es el editor que muestra Windows (Configuración → Aplicaciones y propiedades del `.exe`). El paquete pacman lleva `packager = yellowmellow`.
- El aviso de SmartScreen seguirá diciendo «Editor: desconocido»: ese nombre solo aparece con un instalador firmado, y el certificado cuesta dinero (CLAUDE.md: cero costes).
- La prueba del instalador de Windows comprueba también el editor en el registro de desinstalación y en las propiedades del `.exe`.
- Se publica como v0.1.1 (versión de corrección dentro de la fase 0).

## Fase 1 · Motor de datos

### D-024 · Una tabla genérica de registros con valores en JSON

- `records` guarda todos los registros de todas las entidades; los valores van en una columna JSON con el **id** del campo como clave. Renombrar un campo o cambiar su clave para fórmulas no toca los datos.
- `field_defs` define los campos (tipo, configuración, orden, visible, obligatorio, de sistema). `links` guarda las relaciones; `views`, las vistas; `history`, el historial de cada registro.
- Los campos de sistema (el título y el contenido de una nota) se pueden renombrar y ocultar, pero no borrar.
- Borrar un campo lo marca como eliminado; sus valores se conservan y se puede restaurar. Ninguna acción de la interfaz destruye datos sin pasar por la papelera.
- Las dos migraciones nuevas solo crean tablas. Al abrir una bóveda de la v0.1.x, la copia de seguridad automática previa a migrar se hace igualmente (`backups/antes-de-migrar-v1-a-v3`).

### D-025 · Filtros en SQL y en JavaScript, con un test que los compara

- Los filtros sobre campos guardados se traducen a SQL (aprovechan los índices). Los de fórmulas, resúmenes y relaciones se evalúan en JavaScript tras calcular los valores.
- Las dos implementaciones deben dar exactamente el mismo resultado: un test recorre todos los tipos de campo y operadores sobre datos de ejemplo (tildes, `%` y `_`, negativos, cambio de día en Madrid…) y compara ambos caminos.
- El orden se hace siempre en JavaScript con `Intl.Collator('es')`: «Ñu» va detrás de «nube», las tildes no cuentan y los vacíos van al final en ambos sentidos.
- Las comparaciones de texto no distinguen mayúsculas ni tildes («campana» encuentra «Campaña»): en SQL con la función `crm_norm`, registrada en cada conexión.

### D-026 · Búsqueda global con FTS5 sin tildes

- Tabla `search_fts` con `tokenize='unicode61 remove_diacritics 2'`, actualizada en cada escritura. Indexa el título y los campos de texto, texto largo y las etiquetas de las opciones.
- Cada palabra se busca como prefijo y entre comillas, así lo que escribe el usuario nunca se interpreta como sintaxis de FTS5.
- Lo que está en la papelera no sale en la búsqueda.

### D-027 · Parser de fórmulas propio

- En lugar de una librería genérica (SPEC mencionaba expr-eval), un parser pequeño propio. Así se garantiza por diseño lo que pide CLAUDE.md: no existe acceso a propiedades (`.` o `[]`), campos y funciones se buscan en `Map` (nombres como `constructor` no existen), las funciones son una lista cerrada y hay límites de longitud, tokens y profundidad.
- Sintaxis cercana a Excel en español: funciones `SI`, `Y`, `O`, `NO`, `REDONDEAR`, `ABS`, `MIN`, `MAX`, `SUMA`, `PROMEDIO`, `LARGO`, `CONCATENAR`, `MAYUSC`, `MINUSC`, `HOY`, `DIAS`, `ESBLANCO`; argumentos con `;` (o `,`); `&` une textos; `VERDADERO` y `FALSO`.
- Los decimales se escriben con punto (`1.21`): la coma ya separa argumentos. Se explica en el propio editor de fórmulas.
- Dividir entre cero da error («#ERROR» en la tabla, con el motivo al pasar el ratón), no infinito.

### D-028 · Tabla propia con TanStack Virtual

- SPEC preveía TanStack Table. Su versión actual (v9) es nueva y su valor está en ordenar, filtrar y agrupar en el cliente, que aquí hace el motor. Lo que queda (columnas, anchos, selección, teclado) es poco código propio.
- `@tanstack/react-virtual` pinta solo las filas visibles: miles de registros sin perder fluidez.
- Teclado: flechas para moverse, Intro para editar, Escape para cancelar, Espacio para las casillas. El título y la selección quedan fijos al desplazar en horizontal.

### D-029 · Calendario propio

- FullCalendar añade sus estilos con JavaScript en `<head>`, que la CSP estricta bloquea. La vista mensual propia es poco código y respeta el diseño: semana de lunes a domingo, hoy resaltado, doble clic en un día crea un registro con esa fecha y arrastrar cambia la fecha (en «fecha y hora» se conserva la hora local de Madrid).

### D-030 · Texto con formato con Tiptap

- Tiptap 3 (MIT) con `injectCSS: false`: sus estilos base van en `data.css`, sin `<style>` inyectado. Barra con negrita, cursiva, tachado, títulos, listas, cita, código y enlace.
- Los enlaces solo pueden ser `https:` o `mailto:`. Se abren con Ctrl+clic en el navegador del sistema (el proceso principal vuelve a comprobar el protocolo).
- Se guarda el documento JSON y su texto plano (para buscar, exportar y las tarjetas). El proceso principal recalcula el texto plano desde el documento.

### D-031 · Deshacer y rehacer en memoria

- Pila de 100 acciones en el proceso principal: crear, editar, relacionar, duplicar, enviar a la papelera y restaurar. Borrar para siempre no se puede deshacer y lo avisa un diálogo de confirmación.
- La pila vive mientras la bóveda está desbloqueada; al bloquear se vacía, como en cualquier editor.
- Ctrl+Z dentro de un campo de texto deshace el texto, no los datos.

### D-032 · Exportar CSV fuera de la bóveda

- CLAUDE.md dice que los datos solo viven en la bóveda. La exportación a CSV (SPEC §6) es la excepción explícita: solo ocurre cuando el usuario pulsa «Exportar CSV» y elige dónde guardarlo en el diálogo del sistema. La app nunca escribe ese archivo por su cuenta.
- Formato para Excel en español: `;`, coma decimal sin separador de miles, UTF-8 con BOM y saltos CRLF. Los textos que empiezan por `=`, `+`, `-` o `@` se escapan con un apóstrofo para que Excel no los ejecute como fórmula.

### D-033 · Colores de las opciones como tokens del tema

- Las opciones de selección guardan un nombre de color (gris, melocotón, terracota, vino, ámbar, verde, azul, lila), no un valor. Cada tema define el fondo y el texto de cada color, y un test comprueba el contraste AA en todos los temas. Los temas propios de la fase 12 tendrán que definirlos también.

### D-034 · Chromium en español de España

- `--lang=es-ES` al arrancar: los selectores nativos de fecha muestran dd/mm/aaaa y la semana empieza en lunes. Los números se escriben a la española (`1.234,56`) y se leen con `parseNumberEs`.

### D-035 · Navegación y ficha sin router

- La sección activa y el registro abierto son estado de React. La búsqueda de Ctrl+K abre un resultado yendo a su sección con la ficha abierta. Suficiente mientras no haya enlaces profundos entre secciones.

## Fase 2 · Clientes e inicio

### D-036 · Relaciones inversas con un solo vínculo guardado

- Un campo de relación puede ser el inverso de otro (`inverseOf`): «Contactos» del cliente muestra los vínculos de «Cliente» del contacto. El vínculo se guarda una sola vez, en el campo directo; el inverso lo lee y escribe desde el otro lado. Así nunca se desincronizan.
- Si un lado admite un solo registro (un contacto pertenece a un cliente), enlazarlo desde el otro lado lo desengancha del anterior.
- Deshacer guarda una foto exacta de los vínculos afectados antes y después, así que restaura también los desenganches.
- La entidad de destino y el campo del que es inverso no cambian tras crearse: se ignoran si llegan en una edición.
- Al crear una relación en Ajustes → Campos se ofrece crear su inverso en la otra entidad.

### D-037 · Siembra incremental por versiones

- Cada entidad tiene una versión de siembra y cada campo o vista indica desde cuál existe. Al abrir una bóveda antigua se añade solo lo que falta. Un campo cuya clave ya existe (aunque esté eliminado) no se toca, así se respetan los cambios del usuario.
- La marca antigua `data.seeded.nota = true` cuenta como versión 1. La fase 2 añade «Cliente» a Notas (versión 2) y las entidades Clientes y Contactos.
- Los campos inversos se siembran al final, cuando ya existe su campo directo (aunque sea de otra entidad).

### D-038 · Pipelines como campos de selección

- Un pipeline es un campo de selección con `pipeline: true`: las opciones son las etapas (nombre, color y orden editables) y se ve en un kanban agrupado por él. «+ Vista → Pipeline nuevo…» crea el campo con cuatro etapas de partida, su vista kanban y abre la edición de etapas. «Editar etapas» está en la barra del kanban.
- Reutiliza el motor (filtros, orden, historial, deshacer, CSV) sin tablas nuevas.

### D-039 · Perfil dentro de la base de datos cifrada

- El perfil (nombre, empresa, NIF, dirección, email, teléfono, web, IBAN, moneda y zona horaria) es un ajuste de la bóveda validado con zod.
- La foto se recorta y reduce a 256 × 256 px en la interfaz y se guarda como JPEG en data URL (máx. 400 000 caracteres), dentro de la base de datos cifrada. Los archivos grandes llegan en la fase 4 con su almacén cifrado.
- La zona horaria del perfil manda en los filtros relativos («hoy», «últimos 7 días», «este mes»), en el calendario y en los campos de fecha y hora.

### D-040 · Idioma de Chromium en Linux

- En Linux Chromium ignora `--lang` y toma el idioma de las variables de entorno. El proceso principal pone `LANGUAGE=es_ES:es` antes de arrancar Chromium. Chromium solo trae el idioma `es` (no `es-ES`), que basta para dd/mm/aaaa y la semana desde el lunes; los formatos propios de la app usan siempre `es-ES`.

## Fase 3 · Tareas y briefs

### D-041 · Repeticiones con cálculo propio

- SPEC preveía rrule. Las reglas que pide (diaria, semanal en días concretos, mensual, anual, cada N) caben en unas decenas de líneas sobre fechas de calendario, con tests de los casos difíciles (31 → 28 de febrero, 29 de febrero, cada 2 semanas, fin de año). Así no hay dependencia ni conversiones de zona horaria: «el lunes» es el lunes en la zona del perfil.
- La regla es un valor estructurado (frecuencia, intervalo, días, día del mes y modo), validado con zod, no un texto RRULE.
- **Al completar:** al pasar el estado a una opción «Fin» se crea la siguiente tarea, contando desde su fecha límite y nunca antes de mañana. **Según calendario:** al abrir la bóveda y cada hora, cada tarea pendiente con la fecha pasada genera la siguiente desde hoy (la vencida se queda como atrasada).
- La regla pasa a la tarea nueva y la anterior deja de generar: reabrir y volver a cerrar no duplica. La nueva copia los vínculos (cliente, brief…), vuelve a la primera etapa y desmarca la checklist.
- Completar y la creación de la siguiente son una sola acción para Ctrl+Z.
- Qué campos usa: el de repetición, la primera fecha de la entidad (la fecha límite) y el primer campo de selección con opciones «Fin» (el estado).

### D-042 · Checklist y repetición como tipos de campo

- Ambos son tipos del motor (no campos especiales de Tareas): cualquier entidad puede usarlos. La checklist se guarda como lista de elementos con id, texto y marca; en tablas y tarjetas se ve como progreso «2/5»; en fórmulas vale la fracción completada (0–1); su texto entra en la búsqueda.
- Se editan en la ficha (no en la celda de la tabla).

### D-043 · Opciones «Fin» y primera etapa por defecto

- Las opciones de una selección pueden marcarse como «Fin» (Hecha, Aprobado, Archivado). Lo usan los avisos de tareas, las vistas Hoy y Atrasadas y las repeticiones.
- Un registro nuevo empieza en la primera etapa de cada pipeline (una tarea nueva está «Pendiente»; un cliente nuevo, «Prospecto»).

### D-044 · Plantillas de brief como ajuste

- Las plantillas se guardan como ajuste de la bóveda (nombre y secciones con título, tipo e indicación), validadas con zod. Crear un brief desde una plantilla genera el documento de Tiptap con un título por sección, la indicación en cursiva y una lista vacía en las secciones de tipo lista.
- Cambiar una plantilla no toca los briefs ya creados: el contenido es del brief.

## Fase 4 · Archivos y creatividades

### D-045 · Almacén de archivos cifrado y deduplicado

- Cada archivo se guarda una vez en `files/<2 primeros>/<id>.bin`. El id es un HMAC-SHA256 del contenido con una clave de la bóveda: deduplica sin revelar el hash real, que permitiría comprobar si la bóveda contiene un archivo conocido.
- AES-256-GCM por bloques de 1 MiB. Cada bloque usa un nonce propio (base aleatoria + número de bloque) y autentica la cabecera, su posición y si es el último: no se puede manipular, reordenar ni truncar sin que se note. Se puede leer cualquier trozo descifrando solo sus bloques.
- La clave de archivos es aleatoria y se guarda dentro de la base de datos cifrada (`files.key`). Rotar la clave maestra recifra la base de datos y, con ella, esa clave; los archivos no hay que tocarlos.
- Importar va por bloques (archivos grandes sin cargarlos en memoria) y escribe en un temporal que se renombra al final.
- Limpieza: un archivo que ya no usa ningún registro (ni en la papelera ni en sus versiones) se borra pasado un día. Se ejecuta al abrir la bóveda y al vaciar la papelera.

### D-046 · Protocolo vault:// y miniaturas con Chromium

- La interfaz ve los archivos con `vault://file/<id>` y `vault://thumb/<id>`. El proceso principal los descifra al vuelo, admite rangos (avanzar en los vídeos) y nunca escribe nada en claro en el disco. Solo responde con la bóveda abierta y con ids que existen. La CSP solo añade `vault:` a `img-src` y `media-src`.
- Solo se sirven tal cual imágenes que Chromium muestra, vídeo y audio. El resto (SVG incluido) sale como binario, con `nosniff` y `sandbox`.
- Las miniaturas y medidas (ancho, alto, duración) las calcula la interfaz con canvas y `<video>` la primera vez que se ve el archivo, y se guardan cifradas en `thumbs/`. No hacen falta sharp ni ffmpeg hasta la fase 9 (comprimir). Para dibujar en canvas sin «contaminarlo», el protocolo responde con CORS solo para el origen de la app.
- Añadir archivos: el diálogo del sistema (cualquier tamaño, leído por bloques) o arrastrar y soltar (hasta 512 MB por archivo, enviado por IPC). La interfaz nunca envía rutas del disco: así una interfaz comprometida no podría leer archivos arbitrarios del equipo.
- «Guardar una copia» exporta el archivo descifrado donde el usuario elija (acción explícita, como el CSV; D-032).

### D-047 · Versiones manuales

- «Guardar versión» copia los valores actuales del registro (v1, v2…) con una nota. La pestaña Versiones compara cada versión con la actual (el texto, línea a línea) y permite restaurarla. Restaurar es una edición normal: se puede deshacer y queda en el historial.
- Son manuales a propósito: el historial ya guarda cada cambio; una versión marca un momento con sentido (lo que se lanzó). Se usarán para el rendimiento por versión (fase 7).
- Las versiones se borran con el registro y sus archivos siguen protegidos de la limpieza mientras exista alguna versión que los use.

### D-048 · Crear desde una vista hereda sus filtros

- Un registro creado en una vista con filtros sencillos (casilla marcada, «es hoy», una sola opción) nace cumpliéndolos. Por ejemplo, una creatividad creada en «Swipe file» ya es referencia y una tarea creada en «Hoy» vence hoy.

## Fase 5 · Sincronización y copias

### D-049 · Generaciones y contador de cambios, sin fusión

- El destino guarda `sync.json` con una generación que crece en cada subida. Cada equipo guarda en su base de datos cifrada la generación que tiene y un contador de cambios (lo incrementa el motor en cada cambio).
- Nube más nueva y sin cambios aquí: se descarga. Cambios aquí y nube igual: se sube. Las dos cosas a la vez: conflicto. El usuario elige con cuál quedarse y la otra versión se guarda como copia de seguridad (SPEC: sin fusión en la v1).
- La base de datos que se sube ya lleva su nueva generación, así el otro equipo la conoce al descargarla. `sync.json` se escribe al final; si la subida falla, se deshace la generación local para reintentarlo.
- Conectar un destino nuevo no cuenta lo que ya hay como pendiente: si el destino está vacío se sube igualmente, y si tiene datos de otro equipo se descargan (lo de aquí queda en `backups/`).
- Un destino con otra bóveda (otro `vaultId`) se rechaza.

### D-050 · Comprobar la nube después de desbloquear

- La SPEC decía «antes de desbloquear». El token de Google solo puede vivir en la base de datos cifrada (CLAUDE.md), así que no se puede leer sin desbloquear. La comprobación se hace justo después, con un límite de 30 s para no dejar la pantalla esperando sin conexión. Si hay que descargar, la bóveda se cambia y se reabre sola con la misma clave.
- Si la base de datos descargada no se abre con la clave actual (se cambió o rotó la contraseña en el otro equipo), la bóveda queda bloqueada para entrar con la contraseña actual.

### D-051 · Google Drive con credenciales propias del usuario

- OAuth 2.0 para apps de escritorio según la documentación oficial: redirección a un puerto local (`http://127.0.0.1:puerto`), PKCE con S256, `state`, `access_type=offline` y el permiso `drive.file` (la app solo ve lo que crea).
- El id de cliente y el secreto los crea el usuario en su proyecto de Google Cloud (gratis) y se guardan en la base de datos cifrada. Así no hay credenciales en el repositorio (CLAUDE.md) ni un proyecto compartido con límites ajenos.
- Verificado: en modo de pruebas el token de actualización caduca a los 7 días. Publicada (en producción) y con solo permisos no sensibles, no hace falta verificación de Google. Ajustes lo explica paso a paso.
- Subidas: simples hasta 5 MB y reanudables por trozos de 8 MB (múltiplo de 256 KB) por encima, como indica la documentación de Drive. Todo vive en una carpeta propia «CRM Mellow · <id>».
- Sin cuenta de Google en este entorno, el cliente se prueba contra un Drive simulado que reproduce las llamadas documentadas (búsqueda, carpetas, subida multipart, reanudable, PATCH, descarga y borrado), y el inicio de sesión se prueba de punta a punta con un navegador simulado (PKCE, state y canje del código).

### D-052 · Carpeta como destino alternativo

- Además de Drive, cualquier carpeta del equipo sirve de destino, con escrituras atómicas. Cubre el USB que menciona la SPEC, un disco de red y otros programas de sincronización. Lo prueban los tests con dos «equipos» que comparten una carpeta.
- La carpeta no puede estar dentro de la bóveda ni contenerla.

### D-053 · Cuándo se sincroniza

- Al desbloquear, al bloquear (manual o por inactividad), al salir de la app (con un minuto de margen), cada 30 minutos si hay cambios y con el botón de la barra de estado. Al suspender el equipo no hay tiempo de subir: se sube la próxima vez. La barra de estado muestra si hay cambios sin subir, si se está sincronizando, los errores y los conflictos.


## Fase 6 · Meta I

### D-054 · Graph API v26.0, token de usuario del sistema con `ads_read` y solo lectura

- Comprobado en la documentación oficial (octubre de 2026): la versión vigente es la **v26.0** (publicada el 29/07/2026; la v25.0 sigue disponible hasta julio de 2028). Está fijada en `META_API_VERSION`.
- Conexión con un **token de un usuario del sistema** del Business Manager con el permiso **`ads_read`** (lectura de campañas, conjuntos, anuncios e Insights). Se valida con `GET /me` y se listan las cuentas con `GET /me/adaccounts`. El token (y la clave secreta de la app, opcional, para `appsecret_proof` = HMAC-SHA256 del token con la clave, en hexadecimal) solo se guardan en la base de datos cifrada y nunca vuelven a la interfaz.
- El token viaja en la cabecera `Authorization: Bearer`, nunca en la URL; a las URL de paginación que devuelve Meta se les quita el `access_token`.
- **Solo lectura por construcción:** el cliente (`src/main/meta/graph.ts`) no tiene un método genérico de escritura. Solo hace GET y `POST /act_…/insights`, que crea un informe asíncrono de Insights y no modifica nada. Un test comprueba que no se hace ninguna otra petición que no sea GET.

### D-055 · Campos de Insights: núcleo fijo y opcionales que se caen solos

- Campos comprobados en la referencia de Ads Insights: `spend`, `impressions`, `reach`, `frequency`, `clicks`, `inline_link_clicks`, `inline_link_click_ctr`, `cpm`, `cpc`, `actions`, `action_values`, `purchase_roas`, `video_play_actions`, `video_p25…p100_watched_actions`, `video_30_sec_watched_actions`, `results`, `cost_per_result`, `attribution_setting`, y a nivel de anuncio las clasificaciones de calidad, interacción y conversión.
- Como los campos cambian entre versiones, solo un núcleo es obligatorio. Los demás (únicos de enlace, ThruPlay, vídeo, resultados, clasificaciones…) se piden y, si Meta responde con un error 100 que nombra uno, se quita y se repite la petición sin él.
- Se usa `use_unified_attribution_setting=true` para obtener los mismos resultados que Ads Manager (la atribución configurada en cada conjunto).
- Se guarda la respuesta cruda de acciones y valores (JSON), una tabla normalizada `ad_actions` (entidad, día, tipo de acción, número y valor) y el catálogo `ad_action_types`, para usar cualquier acción en las métricas calculadas de la fase 7. Compras, añadidos al carrito y pagos iniciados toman el primer tipo presente de `omni_*`, el estándar y el del píxel, para no contar dos veces el mismo evento.

### D-056 · Tipos de cambio directamente del BCE

- En lugar de un servicio intermedio (Frankfurter), se descargan los XML oficiales del BCE (`eurofxref-hist.xml` la primera vez, `eurofxref-hist-90d.xml` después), gratis, sin clave y desde la fuente. Se guardan en `fx_rates` (5 años) y los días sin publicación (fines de semana y festivos TARGET) usan el último tipo anterior.
- Los importes se guardan en la moneda de la cuenta y se convierten al mostrar, día a día con el tipo de cada fecha. Si una moneda no la publica el BCE, se muestra en la de la cuenta y la interfaz lo avisa.
- Presupuestos: Meta los da en la unidad mínima de la moneda; se dividen entre 100 salvo en las monedas con «offset» 1 de la tabla oficial de Meta (CLP, COP, CRC, HUF, ISK, IDR, JPY, KRW, PYG, TWD, VND).

### D-057 · Ventana de sincronización, histórico asíncrono y límites

- Cada sincronización descarga la estructura y las métricas diarias (niveles cuenta, campaña, conjunto y anuncio) desde el último día descargado menos la ventana de atribución (7 días por defecto, de 1 a 28) hasta hoy, en la zona horaria de la cuenta y en trozos de 10 días. Así se rellena cualquier hueco y se recogen las conversiones atribuidas tarde. Las filas de cada trozo se sustituyen enteras.
- Al activar una cuenta: primero los últimos 30 días y después el histórico hasta el límite documentado («la fecha de inicio no puede ser de hace más de 37 meses»), o desde la creación de la cuenta si es más reciente, con informes asíncronos (`POST /insights` → `report_run_id`, estado `async_status` hasta «Job Completed», resultados en `/{report_run_id}/insights`). Cada mes y nivel es un trozo guardado en `ad_jobs`: si se cierra la app, sigue donde lo dejó (los informes caducan a los 30 días; a partir de 25 se piden de nuevo). Un trozo que falla se reintenta tres veces y después queda marcado para reintentarlo a mano.
- Límites: se leen `X-FB-Ads-Insights-Throttle`, `X-Ad-Account-Usage` y `X-Business-Use-Case-Usage`. Por encima del 75 % de uso se frena antes de cada llamada y por encima del 95 % se espera lo que indique Meta (mínimo un minuto). Los errores de límite (4, 17, 32, 613, 80000–80014) y los transitorios se reintentan con espera exponencial (2 s, 4 s, 8 s… hasta 5 min). Un token caducado o sin permisos (190, 10, 200) para la sincronización y se avisa.
- La sincronización corre en el proceso principal con E/S asíncrona y escrituras por trozos en transacciones cortas, sin bloquear la interfaz. Un utility process necesitaría abrir otra conexión a la base de datos cifrada con la clave; no compensa con este volumen.
- Las miniaturas de las creatividades (las URL de Meta caducan) se descargan y se guardan cifradas en la bóveda; la limpieza de archivos sin usar las respeta.

### D-058 · Cuentas en tabla propia y qué cuenta como cambio para sincronizar equipos

- Las cuentas publicitarias viven en `ad_accounts` (con el estado de sincronización) y no como entidad del motor de datos: sus datos vienen de Meta y no se editan. La asignación a un cliente es un campo `client_id`; la ficha del cliente muestra sus cuentas.
- Los datos de Meta se pueden volver a descargar, así que no cuentan como cambios para la sincronización entre equipos (no provocan conflictos). Sí cuentan conectar o desconectar, activar cuentas, asignarlas a clientes y los ajustes.
- Las fechas de las métricas son las de la zona horaria de cada cuenta (como en Ads Manager): unos datos diarios no se pueden repartir en otra zona. Las horas (sincronizaciones, inicio y fin de campañas) se muestran en la zona de la app.
- Para los tests de interfaz, la app acepta una API de Meta y un BCE falsos con `CRM_TEST_GRAPH_URL`, `CRM_TEST_ECB_URL` y `CRM_TEST_META_POLL_MS`, solo sin empaquetar. Sin cuenta publicitaria en este entorno, el cliente se ha probado contra una API simulada que reproduce las respuestas documentadas.

## Fase 7 · Meta II

### D-059 · Métricas con clave corta, fórmulas propias con el parser seguro

- Cada métrica tiene una clave corta que sirve de columna y de nombre en las fórmulas (`gasto`, `compras`, `roas`, `hook_rate`…). Cualquier acción de Meta se usa como `acc_<tipo>` (número) y `val_<tipo>` (valor), con los puntos del tipo cambiados por `_`. Las acciones que una fila no tiene valen 0.
- El proceso principal suma por días (con la conversión de moneda de cada día) y la interfaz calcula las derivadas y las métricas propias con el mismo parser seguro de las fórmulas de campos (sin `eval`, D-027). Una división entre cero deja la celda vacía.
- Los porcentajes van ya en tanto por cien (un CTR de 1,5 % vale 1.5), como en Ads Manager; las métricas propias con formato porcentaje siguen la misma regla.
- El hold rate es configurable (por defecto `thruplays / impresiones * 100`), como pedía la SPEC (§10, cuestión abierta).

### D-060 · Presets de columnas y formato condicional

- Cuatro presets de serie (Rendimiento, Ecom rendimiento, Creatividades, Entrega y configuración) que no se modifican: se guardan copias. Los propios guardan columnas, orden y reglas de formato condicional (mayor que, menor que, entre; con los colores de las etiquetas, que ya cumplen el contraste AA en cada tema). Todo en los ajustes cifrados de la bóveda.

### D-061 · Alcance y frecuencia del periodo, pedidos a Meta

- El alcance, la frecuencia y los clics únicos no se pueden sumar por días. Si las columnas los usan, la app los pide a Meta para el periodo exacto (`/{campaña|conjunto|cuenta}/insights` sin `time_increment`, por filas y para el total) y los guarda en `ad_range_stats`. Sin conexión, se ven vacíos.

### D-062 · Desgloses activables por cuenta y nivel

- Edad (`age`), sexo (`gender`), país (`country`), plataforma (`publisher_platform`), ubicación (`publisher_platform,platform_position`) y dispositivo (`impression_device`), combinaciones comprobadas en la documentación de desgloses. Se guardan en `ad_breakdowns` (sumables: gasto, impresiones, clics y acciones).
- Al activar uno se descarga para todo lo que ya hay con informes asíncronos por meses (los mismos `ad_jobs`, con su desglose) y después en cada sincronización. Al desactivarlo se borran sus datos. La interfaz avisa de que multiplican el volumen.
- La documentación avisa de que, desde agosto de 2026, `impression_device` puede no estar disponible de forma síncrona en algunas cuentas; los informes asíncronos sí lo dan.

### D-063 · Última edición significativa con el historial de actividad

- `GET /act_…/activities` (AdActivity: `event_type`, `event_time`, `object_id`) devuelve por defecto una semana. Cuentan como significativos los cambios de presupuesto, puja, segmentación, optimización, creatividad y calendario, y las creaciones; no los cambios de estado ni de nombre. Se lee desde la última vez en cada sincronización.
- Para lo anterior a la conexión se muestra la fecha de última actualización (`updated_time`) marcada como «aprox.», con la explicación en la propia celda.

### D-064 · Vínculo creatividad-anuncio

- Tabla `creative_links` (creatividad, anuncio, origen). Manual: desde la ficha de la creatividad se busca el anuncio y se elige. Automático: si el nombre del anuncio contiene el **código** de la creatividad (campo nuevo, como palabra) o encaja con una **convención de nombres** configurable (`{cliente}_{angulo}_{formato}_v{version}`; `{*}` vale cualquier cosa) con una sola creatividad. Lo que se desvincula a mano queda marcado para que el automático no lo rehaga.
- Con los vínculos: rendimiento de la creatividad (ficha) y ranking por etiqueta (Campañas → Creatividades). Una creatividad con dos etiquetas cuenta en las dos. Las cuentas en otras monedas se convierten día a día; si falta un tipo de cambio, esos importes se dejan fuera y se avisa.
- Pendiente: la coincidencia por hash de imagen (Meta usa su propio `image_hash`, que no coincide con el HMAC de la bóveda) y el rendimiento por versión.

### D-065 · Moneda del cliente

- Si la cuenta está asignada a un cliente con el campo «Moneda» relleno, la tabla de esa cuenta usa esa moneda; si no, la global de Campañas → Ajustes.
