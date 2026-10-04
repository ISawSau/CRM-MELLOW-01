# CRM personal de media buying

App personal (un solo usuario) de escritorio y Android para gestionar clientes, media buying en Meta, tareas, briefs, creatividades, facturación e informes. Local-first, 100 % gratuita, funciona igual en Windows y Linux, y guarda todos los datos en una única carpeta portable ("bóveda").

La especificación completa está en `docs/SPEC.md`. Léela antes de cualquier tarea y respétala. Si algo de lo que te pido la contradice, avísame antes de hacerlo.

## Forma de trabajar

- Construimos fase por fase, en el orden de `docs/SPEC.md` sección 9. No adelantes trabajo de fases futuras.
- Al empezar una fase: resume qué vas a hacer, qué archivos crearás y qué dependencias añadirás, y espera mi confirmación.
- Al terminar una fase: la app debe arrancar, la funcionalidad debe ser usable, los tests deben pasar y el empaquetado debe funcionar en Windows y Linux.
- Registra cada decisión técnica relevante (y su motivo) en `docs/DECISIONS.md`.
- Si cambia el alcance o el diseño, actualiza `docs/SPEC.md` en el mismo cambio.
- Commits pequeños y descriptivos, en español.

## Reglas fijas

- Cero costes: nada de servicios de pago, servidores propios ni dependencias con licencia comercial obligatoria.
- Interfaz en español de España por defecto (fechas dd/mm/aaaa, números 1.234,56, semana empieza en lunes, zona horaria por defecto Europe/Madrid) y también en inglés británico (1,234.56), elegible en la pantalla de contraseña y en Ajustes. Todo texto visible se escribe en español dentro de `t()` / `tn()` / `tc()` de `@shared/i18n` y su traducción va en `src/shared/i18n/en/` (el test de cobertura falla si falta alguna). Nunca `t()` en el nivel superior de un módulo.
- Los datos solo viven en la bóveda. Nunca escribas datos de usuario fuera de ella (salvo la configuración mínima que indica qué bóveda abrir).
- La base de datos va siempre cifrada. Tokens y credenciales solo dentro de la base de datos cifrada, nunca en archivos de texto ni en variables de entorno.
- Conexión con Meta en solo lectura. No implementes ninguna acción que modifique campañas.
- Antes de usar cualquier API externa (Meta Graph/Marketing API, Google Drive, Gmail, X, LinkedIn), comprueba en la documentación oficial actual la versión vigente, los nombres exactos de campos, permisos y límites. No te fíes de nombres de memoria.
- Las migraciones de base de datos nunca destruyen datos sin crear antes una copia de seguridad automática.
- Seguridad de Electron: contextIsolation activado, sandbox, sin nodeIntegration en el renderer, CSP estricta, enlaces externos en el navegador del sistema.
- Fórmulas de usuario evaluadas con un parser seguro, nunca con eval.

## Entorno de trabajo (Claude Code en la nube)

- Trabajas en una máquina Linux en la nube, sin pantalla. No puedes ver la ventana de la app, así que verifica con tests (Vitest y, si el entorno lo permite, Playwright con Electron en modo sin pantalla). En cada entrega dime los comandos exactos para probarla en mi ordenador con Windows y con Linux, y qué debería ver.
- El workflow de GitHub Actions ejecuta los tests y genera los instaladores de Windows y Linux y el APK de Android (probado en el emulador) en cada push a main. Los instaladores se descargan desde Releases (en Actions solo quedan un día al lanzar el CI a mano, D-100). Además, al cerrar cada fase se sube la versión en `package.json` (fase 0 → 0.1.0, fase 1 → 0.2.0…) y el CI publica la versión en Releases con los instaladores y las instrucciones (`.github/notas-version.md`).
- El repositorio nunca contiene datos reales: añade a `.gitignore` cualquier bóveda, base de datos, archivo `.env`, credenciales y carpetas de build. Ningún token ni credencial en el repositorio ni en las variables del entorno de la nube.
- Si una tarea necesita un dominio bloqueado por la red del entorno, dime cuál para que lo añada en lugar de buscar rodeos.
- Al terminar una fase, resumen de cambios y pull request hacia main.

## Comandos

| Qué | Comando |
|---|---|
| Instalar todo (Arch) | `bash scripts/instalar-arch.sh` |
| Instalar todo (Windows) | `powershell -ExecutionPolicy Bypass -File scripts\instalar-windows.ps1` |
| Instalar solo dependencias | `npm ci` |
| Desarrollo | `npm run dev` |
| Lint, tipos, formato | `npm run lint` · `npm run typecheck` · `npx prettier --check .` |
| Tests unitarios | `npm test` |
| Tests de interfaz | `npm run test:e2e` (en un Linux sin pantalla: `xvfb-run -a npm run test:e2e`) |
| Tests de interfaz móvil | `npm run test:e2e:movil` (Chromium con pantalla de móvil, D-101) |
| Generar migración | `npm run db:generate` (tras cambiar `src/main/db/schema.ts`) |
| Descargar FFmpeg (vídeo) | `node scripts/descargar-ffmpeg.mjs` (lo hacen ya los scripts de instalación) |
| Build Windows | `npm run dist:win` → `release/*.exe` |
| Build Linux | `npm run dist:linux` → `release/*.pacman` y `release/*.AppImage` (necesita `bsdtar`) |
| APK de Android | `bash scripts/compilar-android.sh` → `release/*-android-arm64.apk` (Android SDK + NDK 28.2.13676358, Gradle 9.6+) |
| Autoprueba de una instalación | `crm-mellow --autoprueba` (Android: `adb shell am start -n cc.yellowmellow.crm/.MainActivity --ez autoprueba true`) |

En la nube los tests de interfaz no se pueden ejecutar como root (Chromium no admite el sandbox como root): hay que usar un usuario normal, nunca `--no-sandbox`.
