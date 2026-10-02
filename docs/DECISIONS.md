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

En la fase 0 la sección activa es un estado de React. Las secciones futuras muestran en qué fase llegan. Se añadirá un router cuando el motor de datos (fase 1) necesite rutas con parámetros.

### D-021 · `ignore-scripts=true` en `.npmrc`

Detectado al instalar en el Windows del usuario: npm 11 ejecuta `node-gyp rebuild` en `better-sqlite3` (deduce ese script porque el paquete trae un `binding.gyp`) e intenta compilar SQLite con Visual Studio. Sin las herramientas de C++, `npm ci` falla. En el CI no se notaba porque los runners de GitHub sí tienen compilador.

Esa compilación no sirve para nada: el paquete carga primero su binario N-API precompilado (`prebuilds/win32-x64.node`, `linux-x64.node`). Así que en `.npmrc`:

- `ignore-scripts=true`: ninguna dependencia ejecuta scripts al instalarse. `npm run …` y `npm test` siguen funcionando.
- Ventaja de seguridad: los scripts de instalación son el vector típico de los ataques a la cadena de suministro de npm. npm 12 ya los bloquea por defecto.
- Comprobado tras una instalación limpia: sin carpeta `build/` de SQLite, con tests unitarios y de interfaz, empaquetado, fuses y autoprueba correctos.
- No hace falta Visual Studio ni Python para desarrollar.
