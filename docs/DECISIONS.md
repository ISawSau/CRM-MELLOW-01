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
- **Sin `GET /?ids=…` (corrección, octubre de 2026):** el changelog de la v26.0 dice «Root requests using `GET /?ids=...` return an error. Use per-object requests or supported batching». La lectura de las creatividades de los anuncios usaba esa petición múltiple, y como va antes que Insights, la cuenta se quedaba «Aún sin datos» con el error de Meta. Ahora cada creatividad se pide por su ruta (`GET /{creative_id}?fields=…&thumbnail_width=320&thumbnail_height=320`) y solo las nuevas. Una creatividad borrada o sin acceso (código 100) se salta y no frena las métricas; los límites, el token y la red sí detienen la sincronización con su error. El cliente rechaza cualquier petición a la raíz o con `ids`, y la API simulada de los tests responde a `/?ids=` con el mismo error que Meta.

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

## Fase 8 · Análisis

### D-066 · Gráficas con ECharts en canvas y paleta validada

- Apache ECharts 6 (Apache-2.0), importado por módulos (líneas, barras, rejilla, tooltip, leyenda y accesibilidad) con el renderizador canvas. El tooltip también va en canvas (`renderMode: 'richText'`): el modo HTML mete estilos en línea que la CSP estricta bloquea.
- Paleta categórica de ocho tonos en orden fijo, una versión para temas claros y otra para oscuros (los mismos tonos), elegida según la luminancia del fondo del tema. Validada con el validador de la guía de visualización contra el fondo de los dos temas: pasa banda de luminosidad, croma, separación para daltonismo (ΔE ≥ 8 entre vecinos) y visión normal. En el tema claro cuatro tonos quedan por debajo de 3:1 con el fondo, así que cada gráfica tiene vista de tabla, leyenda y etiquetas directas en las barras.
- Un solo eje en cada gráfica, líneas de 2 px, el periodo anterior en discontinua y el color sigue a la serie (no al orden). La gráfica se repinta al cambiar de tema.

### D-067 · Un motor de consultas para dashboards, comparativas y alertas

- `analysis:query` suma las métricas diarias de las cuentas activadas con un filtro (todo, cliente, cuenta, campaña, creatividad o etiqueta) y agrupa por día, semana (de lunes), mes, cuenta, cliente, campaña, creatividad o etiqueta. Compara con el periodo anterior o con el mismo del año anterior. Los grupos que no caben se suman en «Otros». Las métricas derivadas y las propias se calculan en la interfaz con el mismo motor de la tabla (D-059).
- El alcance y la frecuencia no se ofrecen aquí: no se pueden sumar entre días ni entre cuentas.
- Las fechas son las de cada cuenta (como en Ads Manager); con cuentas en varias zonas horarias, el «día» de cada una es el suyo.

### D-068 · Dashboards en los ajustes de la bóveda

- Lista de dashboards con sus widgets (cifra, líneas, barras, tabla y ranking), cada uno con métrica, agrupación, periodo y ancho. Uno global por defecto («General») y los que se creen, globales o de un cliente. Se guardan cifrados en los ajustes y cuentan como cambio para la sincronización entre equipos.

### D-069 · Alertas que solo avisan dentro de la app

- Cada alerta: datos (todo, un cliente o una cuenta), métrica, mayor o menor que un umbral y ventana de días completos sin contar hoy. Se comprueban tras cada sincronización con Meta y al guardarlas.
- Cada aviso se guarda en `alert_events` con una copia de la alerta, uno por alerta y día de cierre del periodo (no se repite cada hora). Se ven en Análisis → Alertas, con un contador en la barra lateral y en Inicio, y se marcan como vistos al abrir Alertas. No hay notificaciones fuera de la app (SPEC §1).

### D-070 · Inicio con Meta

- La tarjeta «Gasto y ROAS» de Inicio (prevista para la fase 6) y la de alertas usan el mismo motor: gasto de hoy, 7 y 30 días y ROAS de 30 días de todas las cuentas, en la moneda de visualización.

## Fase 9 · Negocio

### D-071 · Facturación: el CRM registra facturas, no las emite

- En España el software que emite facturas tiene que cumplir el reglamento Verifactu (RD 1007/2023). Con el RD-ley 15/2025 es obligatorio desde el 1 de enero de 2027 para quien paga el impuesto de sociedades y desde el 1 de julio de 2027 para el resto. El CRM no emite facturas: se emiten con un programa que cumpla la norma y aquí se **registran** (número, cliente, concepto, fechas, base, IVA, total calculado, moneda, estado y PDF adjunto). Antes de ampliar este módulo para emitir facturas hay que volver a revisar la norma.
- Entidades nuevas del motor: **Factura** (estados Pendiente, Cobrada y Vencida; vistas Todas, Pendientes de cobro, Por estado y calendario de Vencimientos) y **Gasto** (concepto, cliente, fecha, importe, moneda, categoría y recibo). Al cliente se le añaden el **acuerdo** (fee fijo mensual, porcentaje del gasto, por proyecto o una combinación), el porcentaje acordado y las relaciones inversas.
- Resumen por cliente (sección Facturación):
  - lo **facturado**, por fecha de emisión;
  - lo **cobrado**, por fecha de cobro;
  - lo **pendiente** y lo **vencido**, de todas las fechas, al tipo de cambio de hoy;
  - los **gastos** asociados;
  - la **inversión** en Meta de sus cuentas;
  - lo **previsto** por el acuerdo: el fee mensual prorrateado por los días del periodo (mes medio de 365/12 días) y el porcentaje sobre la inversión;
  - el **beneficio**, que es lo cobrado menos los gastos.
- Todo se convierte a la moneda de visualización con el tipo del BCE de cada fecha (D-056). Si falta un tipo, el importe no se suma y se avisa.

### D-072 · Documentos: los archivos sueltos de la bóveda

- Entidad nueva **Documento** (nombre, tipo, cliente, fecha, archivos y notas), con su sección en la barra lateral y la relación inversa en la ficha del cliente. Ahí se guardan los informes generados y los resultados de las herramientas, cifrados como cualquier archivo de la bóveda (D-044). También sirve para contratos y otros documentos.

### D-073 · FFmpeg empaquetado y verificado por huella

- Para el vídeo hace falta FFmpeg. El paquete npm `ffmpeg-static` descarga el binario en un script de instalación, y los scripts de npm están desactivados (D-021). Por eso `scripts/descargar-ffmpeg.mjs` descarga el mismo binario y lo verifica antes de guardarlo en `vendor/ffmpeg/`, que está fuera de git. El script se ejecuta en CI, en los scripts de instalación y a mano.
  - El binario sale de la versión b6.1.1 de github.com/eugeneware/ffmpeg-static: FFmpeg 7 con x264, compilado por John Van Sickle para Linux y por Gyan Doshi para Windows.
  - Se comprueba su SHA-256 contra las huellas fijadas en el propio script.
- Va en el instalador fuera del asar (`resources/ffmpeg/`), con el texto de su licencia (GPL-3.0) en `resources/licencias/`. Es un programa aparte que la app ejecuta y no se enlaza con ella. El código fuente de FFmpeg está en ffmpeg.org/releases y en la versión b6.1.1 de ffmpeg-static.
- Seguridad:
  - Se lanza sin shell y con argumentos que salen de presets cerrados.
  - Solo lee los vídeos que el usuario elige. Un vídeo soltado sobre la ventana llega por su `File` real: el preload saca la ruta con `webUtils.getPathForFile` y la manda por un canal que no está en la lista blanca de la interfaz, así que una interfaz comprometida no puede pedir rutas inventadas.
  - Al guardar en la bóveda, la salida se escribe en `<bóveda>/.herramientas/`, se cifra al importarla y se borra. Esa carpeta se vacía también al bloquear.
- Presets:
  - **Comprimir:** mismo formato, con el lado mayor limitado a 1.920 px.
  - **Formatos de Meta:** 9:16 (1080×1920), 1:1 (1080×1080) y 4:5 (1080×1350). Si el vídeo no encaja, se recorta para llenar o se añaden bandas negras.
  - **Codificación:** H.264 con CRF 20, 24 o 28 según la calidad, y AAC a 128 kb/s o sin sonido. Lleva `faststart` y se quitan los metadatos.
  - El avance se lee de `-progress` y la conversión se puede cancelar.

### D-074 · Imágenes con el canvas de Chromium (sin sharp)

- La SPEC preveía sharp para comprimir imágenes. El canvas de Chromium ya hace lo necesario: decodifica JPEG, PNG, WebP, GIF y AVIF, redimensiona con suavizado de alta calidad y codifica JPEG, PNG y WebP con calidad ajustable. Además no añade módulos nativos que compilar en cada plataforma.
- `createImageBitmap` respeta la orientación EXIF de las fotos del móvil. Al volver a codificar se pierden los metadatos (EXIF, GPS), que es lo deseable al mandar imágenes a terceros. Al pasar a JPEG, el fondo transparente se rellena de blanco.

### D-075 · PDF en la interfaz con pdf-lib y pdf.js (sin Ghostscript)

- **Unir** y **dividir** por rangos («1-3, 5, 8-»; vacío: una página por PDF) con pdf-lib (MIT).
- **Comprimir** tiene tres niveles:
  - **Ligera:** reescribe el archivo con flujos de objetos, sin pérdida.
  - **Media y fuerte:** pintan cada página con pdf.js (Apache-2.0) a 150 o 100 ppp y la guardan como JPEG (calidad 0,75 o 0,6). Reducen mucho los PDF con fotos, pero el texto deja de poder seleccionarse, y la interfaz lo avisa.
  - Si el resultado no es más pequeño, se guarda el original.
- No se usa Ghostscript: tiene licencia AGPL (o comercial) y otro binario de decenas de MB, y lo que aporta sobre esto no compensa.
- pdf.js corre en el hilo principal de la interfaz: la CSP no permite workers (`worker-src 'none'`), así que se le da el módulo del worker ya cargado (`globalThis.pdfjsWorker`). La versión 6 no usa `eval`, y las fuentes se pintan como trazos (`disableFontFace`), sin inyectar estilos.
- Las dos librerías son dependencias de desarrollo: Vite las mete en el código de la interfaz y se cargan solo al usarlas. Así no entran en el instalador como módulos de Node, ni el canvas nativo opcional de pdf.js.

### D-076 · Informes en PDF: HTML con gráficas SVG impreso por Chromium

- Las plantillas son una lista de bloques: portada, cifras clave, evolución diaria, barras, tabla, comparativa, texto fijo y comentarios del periodo. Se guardan cifradas en los ajustes de la bóveda (`reports.templates`) y cuentan como cambio para la sincronización. Viene una de serie, «Informe mensual».
- Al generar se eligen plantilla, cliente (o todas las cuentas), periodo, moneda (por defecto la del cliente o la de visualización) y comentarios. Las cifras salen del motor de Análisis (D-067) con las métricas propias y el hold rate configurados.
- El proceso principal construye un HTML A4 con todo dentro:
  - los estilos;
  - las fuentes de la app en base64;
  - las gráficas en SVG, hechas con ECharts en modo servidor con la paleta validada del tema claro.
- El HTML se imprime con `printToPDF` en una ventana oculta, que:
  - no tiene JavaScript;
  - usa una sesión propia solo en memoria;
  - bloquea todas las peticiones salvo la del propio documento (`informe://`);
  - aplica una CSP sin scripts.
- El texto del usuario (comentarios, nombres de clientes y campañas) se escapa.
- El PDF se guarda como Documento del cliente (tipo Informe), se ve en la propia página (pdf.js) y se puede exportar.

### D-077 · La autoprueba de la instalación cubre la fase 9

- `crm-mellow --autoprueba` comprueba también que FFmpeg arranca y tiene x264, que ECharts genera SVG y que la impresión a PDF funciona. Así el CI lo prueba en cada instalador de Windows y Linux y en Arch.

## Fase 10 · Gmail

### D-078 · Gmail en solo lectura, sin guardar correo

- **Permiso:** `gmail.readonly`, comprobado en la documentación oficial de la API v1. El permiso mínimo `gmail.metadata` no admite el parámetro de búsqueda `q`, y sin él no se pueden encontrar los hilos de unas direcciones concretas. No se pide ningún permiso que envíe, modifique o borre correo. Enviar desde el CRM queda para más adelante (SPEC §7.12).
- **Cuenta de Google:**
  - Se usa el mismo proyecto de Google Cloud que Drive (D-051): si Drive está conectado se reutiliza su id de cliente; si no, se escribe uno.
  - `gmail.readonly` es un permiso restringido. La guía de Google exime de verificación las apps de uso personal (menos de 100 usuarios): se publica en producción y se acepta el aviso de «app no verificada». En producción el token de actualización no caduca a los 7 días, como sí pasa en modo de pruebas.
  - El token se guarda en la base de datos cifrada. Al desconectar se revoca en Google.
- **Qué se busca:**
  - Las direcciones de los campos de email del registro y, en un cliente, también las de sus contactos (hasta 20).
  - La búsqueda es `{from:x to:x cc:x …}`: las llaves son el operador «O» de la búsqueda oficial de Gmail.
  - Se piden 15 hilos por página con `threads.list` y cada hilo con `threads.get` en formato `metadata` (solo las cabeceras From y Subject y los extractos), 5 a la vez.
  - El cuerpo del correo no se descarga: «Abrir en Gmail» lleva al hilo en el navegador.
- **Límites:** según la documentación, 6.000 unidades por minuto y usuario; `threads.list` cuesta 10 unidades y `threads.get` 40, así que una página son 610. Ante un 429 o `rateLimitExceeded` se pide esperar un minuto. Si la API no está activada en el proyecto, se explica cómo activarla. Con un 401 se renueva el token una vez.
- **Sin copia local:** el correo no se guarda en la bóveda ni en disco. Los hilos se piden al abrir la ficha y se guardan 5 minutos en memoria («Actualizar» los vuelve a pedir). La caché se borra al bloquear.
- **Pruebas:** sin cuenta de Google en este entorno, se prueba contra un Google simulado (token, revoke, perfil, `threads.list` con la búsqueda y `threads.get`), en tests unitarios y de interfaz, con el consentimiento del navegador simulado.

## Fase 11 · X y LinkedIn

### D-079 · LinkedIn por su API de publicidad, en solo lectura

- **Gratis con aprobación:** la Advertising API de LinkedIn no cuesta dinero, pero hay que solicitarla en el portal de desarrolladores. Con el nivel de desarrollo ya se pueden leer las cuentas que administra el usuario, que es todo lo que necesita una app personal. Solo se piden `r_ads` y `r_ads_reporting` (lectura): nada que cree o modifique campañas.
- **Versión y llamadas**, comprobadas en la documentación oficial actual (versión `202609`, cabeceras `LinkedIn-Version` y `X-Restli-Protocol-Version: 2.0.0`):
  - `GET /rest/adAccounts?q=search` y `GET /rest/adAccounts/{id}/adCampaigns?q=search`, paginadas con `pageSize` y `pageToken` (`metadata.nextPageToken`).
  - `GET /rest/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY` con `dateRange` y `accounts` en sintaxis Rest.li y la lista de `fields` (máximo 20). Esta llamada no pagina y corta en 15.000 filas, así que se pide en trozos de 90 días.
  - Campos: `costInLocalCurrency` (texto), `impressions`, `clicks`, `landingPageClicks`, `externalWebsiteConversions` y `conversionValueInLocalCurrency`.
- **Acceso:**
  - Por OAuth con el id y el secreto de la app del usuario (LinkedIn exige el secreto para canjear el código), con la dirección de vuelta fija `http://localhost:53135/linkedin`, que hay que registrar en la app. También se puede pegar un token generado en el portal.
  - Los tokens duran 60 días y las apps normales no reciben token de actualización: la app avisa una semana antes de que caduque y pide reconectar.
  - El token y el secreto se guardan en la base de datos cifrada.
- **Sincronización:**
  - Las cuentas descubiertas se crean sin activar (`li_<id>`); la cuenta de pruebas de LinkedIn se omite.
  - Al activar una cuenta se descarga el último año; después, cada tres horas mientras la app está abierta, desde siete días antes del último dato (LinkedIn corrige conversiones atrasadas).
  - Ante un 401 (token caducado) o un 429 se para y se muestra el error en la cuenta.
- **Pruebas:** sin cuenta de LinkedIn en este entorno, se prueba contra una API simulada con las mismas URL, cabeceras, paginación y sintaxis Rest.li, en tests unitarios y de interfaz.

### D-080 · X por CSV, y LinkedIn también por CSV

- **X:** la API de X es de pago por uso (no hay nivel gratuito con lectura de anuncios), así que se descarta por la regla de cero costes. X entra con los CSV que exporta X Ads.
- **LinkedIn sin aprobación:** los CSV de Campaign Manager sirven igual mientras LinkedIn no aprueba la API o si el usuario no quiere pedirla.
- **Importación:**
  - Lector de CSV propio: detecta el separador (`,`, `;` o tabulador), comillas, BOM y el preámbulo de LinkedIn (la cabecera se busca entre las primeras filas).
  - Propone el mapeo por sinónimos de las cabeceras en español e inglés, y deduce el formato de fecha y el separador decimal de los datos. El usuario lo puede corregir y se recuerda por plataforma y cabeceras para la próxima vez.
  - Las filas de totales y las que no tienen fecha se descartan y se cuentan.
  - Reimportar un periodo sustituye esos días (por cuenta y campaña), no los duplica.
- **Mismas tablas que Meta:** las métricas van a `ad_insights_daily` (niveles cuenta y campaña) y `ad_actions`, con la plataforma en `ad_accounts.platform`. Así Análisis, Inicio, Facturación, Informes y alertas las incluyen sin cambios, y los filtros por cuenta y cliente funcionan igual. Las conversiones se guardan como compras (cuentan en ROAS y CPA) u «otras conversiones», a elección del usuario.
- **Moneda:** cada cuenta tiene la suya. Los tipos del BCE se descargan también tras importar o sincronizar LinkedIn, aunque Meta no esté conectado.

## Fase 12 · Personalización avanzada

### D-081 · Temas propios: los mismos tokens, guardados en la bóveda

- Un tema propio tiene la misma forma que los predefinidos (18 tokens de color y los colores de las etiquetas). Se valida con el mismo esquema, que solo admite `#rrggbb` o `rgba(…)`, así que en las variables CSS no puede entrar nada que no sea un color.
- Los temas se guardan en la base de datos cifrada (`appearance.themes`) y viajan con la sincronización. Como mucho hay 30. No pueden reutilizar el id de un tema predefinido.
- Si se borra el tema en uso, se vuelve al oscuro.
- El editor parte de un tema existente y aplica los cambios al momento a toda la app. Al cancelar se vuelve al tema guardado.
- **Contraste:** se calcula con la fórmula WCAG 2.x, componiendo la opacidad sobre el fondo, para 19 parejas de texto y fondo (texto, secundario, tenue, acento, botón, estados y etiquetas). Las que no llegan a 4,5:1 se avisan sin impedir guardar: es la app del usuario. Así se cumple la regla de no usar un amarillo de marca como texto sobre blanco (SPEC §8).
- Se aplica con la CSSOM (`style.setProperty`), compatible con la CSP sin `unsafe-inline` (D-017).

### D-082 · Inicio configurable reutilizando los widgets de Análisis

- El diseño de Inicio es una lista ordenada de elementos guardada en la bóveda (`home.layout`). Cada elemento es una tarjeta de serie o un widget de Análisis con la misma definición que en los dashboards (D-068).
- Quitar una tarjeta solo la oculta; se vuelve a añadir desde «Personalizar». «Restablecer Inicio» borra el ajuste y vuelve al diseño de serie.
- Los widgets de Inicio miran todas las cuentas activadas. Para un cliente concreto están sus dashboards en Análisis.

### D-083 · Plantillas de brief definitivas

- La estructura sigue abierta, porque el usuario aún no ha fijado la suya. Una plantilla puede llevar:
  - fecha de entrega a N días;
  - hasta 30 tareas, cada una con su fecha límite relativa.
- Crear desde plantilla se hace en el proceso principal. Crea el brief y sus tareas enlazadas al brief.
  - El cliente no se copia a las tareas: en ese momento el brief aún no tiene cliente, porque las relaciones se enlazan después.
- Guardar un brief como plantilla convierte cada título (H1-H3) de su contenido en una sección:
  - el párrafo en cursiva de debajo pasa a ser la indicación;
  - si debajo hay una lista, la sección es de tipo «Lista».
- Las plantillas guardadas antes de esta fase siguen siendo válidas: los campos nuevos tienen valor por defecto.

### D-084 · Colecciones personalizadas sobre el mismo motor

- **Sin migración:** el motor ya guardaba registros, campos, vistas y enlaces con una columna `entity` de texto. Una colección solo añade su definición al ajuste `data.collections`: nombre, singular, género, letra e id `col-<nombre>`. La validación de entidades del proceso principal pasa a aceptar las de sistema y las colecciones.
- Al crearla se siembra igual que una entidad de sistema: campo de título «Nombre» (obligatorio), «Notas» y la vista «Todos». El resto lo añade el usuario en Ajustes → Campos, incluidas relaciones con clientes u otras entidades (con su campo inverso).
- **Borrado seguro:**
  - Una colección solo se borra vacía (sus registros van antes a la papelera) y cuando ningún campo de otra entidad la enlaza.
  - Al borrarla desaparecen sus campos, sus vistas y lo que tenga en la papelera, con confirmación. También se vacía la pila de deshacer, cuyas acciones podrían referirse a ella.
  - Como no se pierde ningún registro activo, no hace falta copia de seguridad.
- Como mucho hay 50 colecciones. La barra lateral las muestra en un grupo propio («04 colecciones»), y la búsqueda global y la paleta de comandos las incluyen.

## Arreglos tras la v0.13.0

### D-085 · Meta en cuentas grandes: primero las métricas, límites de desarrollo y progreso

- **Fallo:** con una cuenta grande solo llegaban la estructura y los presupuestos, sin métricas. La app pedía las creatividades nuevas una a una **antes** de las métricas. La documentación oficial («Rate Limiting» de la Marketing API) da al acceso de desarrollo, que es el de una app sin App Review, una puntuación máxima de 60 cada 300 s, a 1 punto por lectura, con 300 s de bloqueo al llegar al tope. Con cientos de creatividades se llegaba al límite, se agotaban los reintentos y la cuenta fallaba antes de pedir Insights.
- **Orden nuevo:**
  1. Estructura: campañas, conjuntos y anuncios.
  2. Métricas por cuenta, campaña, conjunto y anuncio, cada nivel de los días más recientes a los más antiguos.
  3. Desgloses.
  4. Creatividades, miniaturas y actividad.
- **Creatividades:** con más de 15 nuevas se leen por páginas de 100 del listado `GET /act_{id}/adcreatives`, que la documentación da como forma de lectura, con `thumbnail_width` y `thumbnail_height`. Si quedan, se piden de una en una con un tope de 15 por sincronización. Si Meta limita, se espera como mucho una vez y el resto queda para la próxima sincronización: las creatividades nunca hacen fallar la cuenta.
- **Límites:** ante un error de límite se espera lo que indica Meta en `estimated_time_to_regain_access`, o una espera exponencial de hasta 5 minutos, hasta 12 veces, en vez de rendirse a la quinta. La espera se ve en la interfaz.
- **Demasiados datos:** el error «Please reduce the amount of data you're asking for» ya no se reintenta igual. El trozo se parte por la mitad hasta llegar a un día y, si ni así, se pide como informe asíncrono.
- **Fallos parciales:** si un nivel o un desglose falla, se sigue con los demás y ese trozo pasa a la cola del histórico, que lo reintenta como informe asíncrono. La cuenta muestra un aviso («Faltan métricas por anuncio de algunos días…») hasta la siguiente sincronización.
- **Progreso:** se calculan los pasos de la sincronización (estructura, cada nivel y trozo de días, cada desglose, creatividades y actividad) y los del histórico. La barra de Campañas muestra:
  - el paso en curso;
  - los pasos hechos y totales;
  - el tiempo restante, estimado con el ritmo real, esperas incluidas;
  - la cuenta atrás si Meta ha pedido esperar.
  
  La barra de estado muestra el porcentaje.

### D-086 · LinkedIn, integración opcional desactivada de serie

- Petición del usuario: LinkedIn sobra en el día a día. Pasa a ser una integración opcional en Ajustes → Integraciones opcionales, **desactivada de serie** (`linkedin.enabled`).
- Desactivada, la sección se llama «X Ads»: solo importa CSV de X y no tiene pestaña de API. LinkedIn no se sincroniza ni se puede conectar. Los datos y la conexión que ya hubiera se conservan, y al reactivarla vuelve todo.

### D-087 · Sección Perfil antes de Inicio

- Petición del usuario: lo propio va en una sección **Perfil**, la primera de la barra lateral, y no en Ajustes. Tiene dos pestañas:
  - **Datos:** los datos personales, fiscales y de empresa, la moneda y la zona horaria.
  - **Cuentas conectadas:** el estado de Meta, la sincronización y copias, X y LinkedIn, con un botón a donde se gestiona cada uno. También la conexión de Gmail y las integraciones opcionales.
- Ajustes se queda con lo que es de la app y de la bóveda: apariencia, colecciones, campos, papelera, sincronización, seguridad y bóveda.

### D-088 · Los ajustes de cada sección, dentro de la sección

- Petición del usuario: los campos no deben estar todos en Ajustes, sino en cada sección. Cada sección del motor de datos (Notas, Clientes, Tareas, Briefs, las colecciones…) tiene un botón **⚙ Ajustes** junto a «+ Nuevo…» que abre sus ajustes:
  - **Campos:** qué datos se guardan de cada registro, con su tipo, si son de serie y si están ocultos. Se añaden, editan, ordenan, eliminan y restauran.
  - **Plantillas:** solo en Briefs (D-083).
  - **Colección:** solo en las colecciones; nombre, singular, género y letra.
- Ajustes conserva lo general. Las colecciones se siguen creando y borrando en Ajustes → Colecciones.
- La clave interna de cada campo deja de mostrarse: no le dice nada al usuario.

### D-089 · Temas: importar, exportar, crear con IA, fondo, esquinas e iconos

- **Estructura ampliada.** Los temas guardados antes siguen valiendo, porque todo lo nuevo tiene valor por defecto:
  - `radius`: esquinas, de 0 a 24 px. Se aplica a botones, campos, tarjetas, ventanas, menús y etiquetas.
  - `background`: imagen o vídeo con ajuste, velo y desenfoque.
  - `icons`: icono de cada sección de la barra lateral, de 1 o 2 caracteres. Se valida para que no entren marcas ni caracteres de control.
  - La fase de diseño puede añadir más tokens (tipografías, sombras…) con el mismo método.
- **Fondo:**
  - El archivo se elige con el diálogo del sistema y se guarda cifrado en la bóveda, como los adjuntos. Se ve por `vault://`, ya permitido en la CSP para imágenes y vídeo.
  - El vídeo va sin sonido y en bucle.
  - Un velo del color de fondo encima mantiene el texto legible.
  - La limpieza de archivos huérfanos no borra los fondos de los temas.
- **Exportar** guarda un JSON (`formato: crm-mellow-tema`) donde elige el usuario. No incluye el id ni el fondo, que es un archivo de esta bóveda.
- **Importar** acepta ese archivo o el JSON pegado. Admite el objeto del tema solo y el bloque de código con el que suelen responder las IA. Se valida con el mismo esquema y explica qué campo falla.
- **Crear con IA:** no hay IA dentro de la app, porque costaría dinero (regla de cero costes). La app copia unas instrucciones para cualquier chat de IA: la descripción del usuario, la estructura con el tema actual de ejemplo y las reglas de contraste. El usuario pega la respuesta en Importar.

### D-090 · Interfaz en inglés, sin dependencias

- Petición del usuario: poder cambiar a inglés desde la pantalla de contraseña, con formatos ingleses. Cambia la regla «toda la interfaz en español» de CLAUDE.md, con la aprobación expresa del usuario, que eligió «toda la app» y «formato inglés».
- **Sin biblioteca de traducciones:** un `t()` propio de unas líneas (`src/shared/i18n`). El texto en español es la clave del diccionario inglés, así que el español sigue siendo el texto de origen y los tests en español no cambian. Hay variables `{x}`, plurales con `tn()` y contexto con `tc()` para palabras con dos sentidos («Beneficio»: *benefit* o *profit*).
- **Datos de serie y datos del usuario:** el proceso principal traduce al leerlos los nombres de entidades, campos, opciones y vistas. Lo que el usuario escribió no está en el diccionario y no cambia. Si se guarda un texto de serie tal y como se vio traducido, en la bóveda se queda el original en español.
- **Formatos:** `en-GB` (1,234.56, dd/mm/aaaa, semana desde el lunes). Los números que escribe el usuario se leen según el idioma.
- **Dónde se guarda:** en la configuración mínima de fuera de la bóveda, junto a la ruta de la última bóveda. Hace falta antes de desbloquear y no es un dato del usuario. Al cambiar de idioma la ventana se recarga y vuelve a la misma sección. El proceso principal usa el idioma para sus mensajes y para el `--lang` de Chromium.
- **Cobertura:** un test recorre `src` y falla si un texto pasado a `t()`/`tn()`/`tc()` no tiene traducción o usa `${}`, que debe ir como variable. Ahora hay unos 1.800 textos traducidos. Las fórmulas siguen con sus funciones en español (SI, Y, O…), porque son la sintaxis de los datos.

### D-091 · Se quitan X y LinkedIn

- **Qué:** fuera la sección «LinkedIn y X», la conexión con la API de LinkedIn, la importación de CSV de X Ads y Campaign Manager, sus canales IPC, sus textos y sus tests. La app trabaja solo con Meta. El campo «LinkedIn» de los contactos (la URL de su perfil) se queda: no tiene que ver con la publicidad.
- **Por qué:** el usuario no las usa y ocupaban sitio en la barra lateral, en Perfil y en Ajustes.
- **Datos:** la migración `0007_quitar_x_linkedin` borra las cuentas de otras plataformas (`platform <> 'meta'`), sus métricas, objetos, acciones, desgloses y trabajos pendientes, y los ajustes `linkedin.*` y `platforms.mappings`, donde estaba el token de LinkedIn. Como toda migración sobre una bóveda con datos, antes se hace una copia de seguridad automática, así que se puede recuperar. No cambia el esquema: la columna `platform` de `ad_accounts` se queda por si algún día vuelve otra plataforma.

### D-092 · Meta: «Service temporarily unavailable» y un histórico con menos trozos

- **Qué pasaba:** en cuentas grandes, Meta respondía a veces «Service temporarily unavailable» (código 2) al pedir métricas por anuncio. Tras los reintentos, ese trozo quedaba para segundo plano y la cuenta mostraba el aviso «Faltan métricas por anuncio…». El histórico iba en trozos de un mes por nivel: 123 trozos en una cuenta de unos 31 meses.
- **Ahora:** si un error transitorio sigue después de los reintentos (códigos 1 y 2, o un 5xx), el trozo se pide en la misma sincronización como informe asíncrono, que es como Meta recomienda hacer las consultas pesadas. Solo cuando Meta dice que son demasiados datos se parte el rango, como antes. Si ni el informe asíncrono funciona, se sigue como hasta ahora: el trozo va a segundo plano y queda el aviso.
- **Histórico:** trozos de 12 meses por cuenta, 3 por campaña y por conjunto, y 1 por anuncio, que es donde hay más filas. Una cuenta de 31 meses pasa de 124 trozos a unos 56. Antes de preguntar si un informe ha terminado se espera unos segundos, porque nunca está listo al instante: es una consulta menos por trozo. Con el acceso de desarrollo (60 puntos cada 5 minutos) un histórico grande sigue tardando, pero avanza sin fallar.

### D-093 · Más formatos de imagen, barras de desplazamiento del tema y páginas a todo el ancho

- **Formatos:** Chromium ya lee BMP, ICO y SVG; solo faltaba aceptarlos. El SVG se dibuja como imagen, así que sus scripts no se ejecutan. TIFF se lee en la interfaz con `utif2` (MIT, JavaScript puro, sin `eval`). HEIC/HEIF, las fotos del iPhone, se leen con `heic-decode` (ISC) y `libheif-js` (LGPL-3.0, libheif compilado a WebAssembly). Va en un hilo del proceso principal (`worker_threads`) por dos motivos: no bloquear la app mientras decodifica y no tener que abrir la CSP de la interfaz a `wasm-unsafe-eval`. La interfaz manda los bytes (máximo 100 MB) y recibe los píxeles. Las fotos HEIC se guardan como JPEG cuando el formato es «El mismo». La licencia de libheif va con las demás en `licencias/`, y la autoprueba comprueba que el lector carga en la app instalada.
- **Barras de desplazamiento:** finas, redondeadas y con los colores del tema (`--line-strong`, y el acento al arrastrar), en lugar de las del sistema.
- **Ancho:** las páginas ya no se quedan en 1.200 o 1.400 px. En pantalla completa o en monitores grandes ocupan toda la ventana, y solo los párrafos largos se limitan a 120 caracteres para que se lean bien.

### D-094 · Iconos SVG en la barra lateral

- **Qué:** las letras de las secciones pasan a iconos SVG de Lucide (`lucide-react`, ISC). Cada sección trae uno con sentido: personas para Clientes, megáfono para Campañas, recibo con euro para Facturas… Las colecciones usan «capas».
- **Dónde se eligen:** en Ajustes → Iconos de las secciones, con un buscador sobre un catálogo cerrado de unos 140 iconos (`src/renderer/src/ui/section-icons.tsx`). Solo se importan esos, así que el resto de Lucide no entra en la app. La elección se guarda en la bóveda dentro de la apariencia (`appearance.icons`). `settings:setAppearance` acepta ahora cambios parciales, así que cambiar el tema no borra los iconos.
- **Color:** va en el tema, con dos colores nuevos y opcionales: `icon` (los iconos) e `iconActive` (el de la sección abierta y al pasar el ratón). Los temas sin ellos usan el texto tenue y el acento.
- **Sustituye** a los iconos de 1 o 2 caracteres por tema de D-089. Al importar un tema que los traiga, se ignoran.

### D-095 · Perfil como la página de un usuario de GitHub

- **Primera vez:** si el perfil no está configurado (sin nombre y sin `setupDone`), la pestaña Perfil es un asistente con el mismo formulario y «Saltar por ahora». Al guardar o saltar, `setupDone` pasa a verdadero. Los perfiles de versiones anteriores con nombre cuentan como configurados.
- **Vista:** a la izquierda, la tarjeta con foto, nombre, cargo y empresa, bio, ubicación, email, web y redes. A la derecha, cifras clave, clientes destacados y mapa de actividad. Las cifras reutilizan lo que ya calculan Inicio (clientes), Análisis (gasto y ROAS del mes) y Facturación (facturado en el año), así que no hay consultas nuevas.
- **Redes:** se guarda lo que escribe el usuario, el enlace completo o el usuario. `socialUrl()` arma el enlace con la URL de cada red. Solo acepta `http(s)`; un usuario con espacios o un `javascript:` no pasa la validación. Los logos son de Simple Icons (CC0). LinkedIn no está en Simple Icons, así que se dibuja un «in» propio.
- **Clientes destacados:** hasta 6 ids en el perfil, en el orden elegido. Cada tarjeta muestra la etapa y la inversión del mes.
- **Actividad:** `profile:activity` cuenta por día, en la zona horaria del perfil, las entradas del historial de cambios (`history`) del último año. Son las «contribuciones»: crear, editar o borrar registros. Los niveles de color van de 0 a 4 respecto al día con más cambios.

### D-096 · Animaciones ASCII en la pantalla de contraseña

- **Qué:** tres animaciones a la derecha de la pantalla de contraseña, dibujadas con caracteres (` .:-=+*#%@`) en un canvas con el color de acento:
  - **Gravedad:** la de yellowmellow.cc. Una nube de 26.000 puntos que pasa de planeta a pozo de gravedad, agujero de gusano y disco de acreción, girando en los tres ejes, con luz y profundidad.
  - **El ojo:** el iris del logo, con anillos que giran, una pupila que se dilata al teclear, parpadeo y temblor al fallar.
  - **Cerradura:** la rueda de una caja fuerte, que gira con cada tecla y se sacude al fallar.
  - En Ajustes → Apariencia también se puede elegir «Una distinta cada vez» o «Ninguna».
- **Dónde se guarda:** en la configuración mínima de fuera de la bóveda, como el idioma. Hace falta antes de desbloquear y no es un dato del usuario.
- **Coste:** 30 fotogramas por segundo como máximo. Se para con la ventana oculta y, si el sistema pide menos movimiento, se queda en un fotograma fijo. Sin dependencias. Las escenas son funciones puras (`ascii-scenes.ts`) que rellenan un búfer de brillo.

### D-097 · Tema «Mellow» de serie, al estilo de Hyprland, con el estilo configurable

- **Por qué:** al usuario la interfaz le parecía saturada y de estilo antiguo. Pidió un tema principal ambientado en los escritorios «aesthetic» de Hyprland (HyDE, sh1zicus), con el estilo de antes disponible en Ajustes.
- **Mellow** (nuevo, de serie):
  - Colores: oscuro casi negro, con el ámbar y el naranja del logo. Pasa AA.
  - Paneles flotantes separados por huecos de 10 px, esquinas de 10 px (14 px en los paneles).
  - Borde de 2 px en degradado ámbar→naranja en el panel activo, como la ventana con foco en Hyprland.
  - Barra lateral con elementos en píldora; barra inferior con módulos en píldora, como Waybar.
  - Títulos sin mayúsculas, sin transparencia y con animaciones suaves.
  - Los temas de antes se llaman ahora «Clásico oscuro» y «Clásico claro». Quien ya los tenía elegidos los conserva; las bóvedas sin elección pasan a Mellow.
- **Estilo dentro del tema** (`style`, editable en el editor de temas): disposición (clásica o flotante), huecos, grosor del borde activo, degradado, transparencia, opacidad de paneles, desenfoque, animaciones (ninguna, suaves, marcadas) y títulos (normales o en mayúsculas). Se aplica con atributos en `<html>` y variables CSS (`styles/hypr.css`). Los temas guardados antes reciben el estilo clásico, así que no cambian.
- **Transparencia:**
  - **cristal:** fondo dentro de la app (el del tema o un degradado con sus colores) y paneles con `backdrop-filter`. Igual en Windows y Linux.
  - **ventana:** ventana transparente. En Linux con `transparent: true` (el desenfoque lo pone el compositor; en Hyprland con una regla «blur»). En Windows 11 con el material acrílico.
  - Como se decide al crear la ventana, se guarda en la configuración mínima de fuera de la bóveda (`windowTransparent`) y se aplica al reabrir la app. Por defecto no hay transparencia, como pidió el usuario.
- **Animaciones:**
  - Las páginas entran con un leve desplazamiento; los diálogos, la paleta y el fondo oscuro aparecen con una transición.
  - Al abrir la bóveda, los paneles entran como ventanas, solo esa vez (`data-intro`).
  - Se respeta «reducir movimiento» del sistema.

### D-098 · Plantillas de correo sin enviar desde la app

- **Qué:** plantillas de asunto y texto con variables (`{nombre}`, `{cliente}`, `{mi_nombre}`, `{empresa}`, `{fecha}`, `{mes}`). Se gestionan en Ajustes → Plantillas de correo. La ficha de un cliente o contacto tiene «Escribir correo…»: elige plantilla, rellena las variables y los destinatarios (los emails del registro y, en un cliente, los de sus contactos), y deja editarlo antes de abrirlo.
- **Cómo sale:** se abre en la ventana de redactar de Gmail en el navegador (`mail.google.com/mail/?view=cm…`) o en el programa de correo del equipo (`mailto:`), o se copia. La app no envía nada, así que Gmail sigue en solo lectura (`gmail.readonly`) sin pedir más permisos. Funciona aunque Gmail no esté conectado.
- **Datos:** en la bóveda (ajuste `mail.templates`, hasta 50). Sin guardar, se ven tres de serie en el idioma de la app: seguimiento de propuesta, informe mensual y recordatorio de factura.
