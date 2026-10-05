# CRM Mellow

[English](README.md) · **Español**

Un CRM personal para media buyers de Meta. Funciona en Windows, Linux y Android, sin conexión, y guarda todos tus datos cifrados en una única carpeta portable (la _bóveda_). Es gratis, no tiene cuentas ni servidores y nunca escribe en tus cuentas publicitarias.

La interfaz está en español de España y en inglés británico; el idioma se elige en la pantalla de contraseña o en Ajustes.

## Qué hace

- **Clientes y contactos** con pipelines, campos propios, vistas guardadas (tabla, lista, kanban, calendario y galería), filtros, deshacer y papelera.
- **Meta Ads en solo lectura:** campañas, conjuntos y anuncios con histórico diario, una tabla al estilo de Ads Manager, métricas propias (con un parser de fórmulas seguro, sin `eval`), desgloses, un clic para ver la vista previa pública de cada anuncio y colores según el CPA o el ROAS objetivo de cada cliente.
- **Análisis:** dashboards, comparativas entre periodos, alertas, ritmo de gasto del mes, detección de fatiga creativa y registro de tests A/B con contraste de significación.
- **Tareas, briefs y notas,** con plantillas y un cronómetro que registra las horas por cliente.
- **Biblioteca de creatividades y copies:** archivos cifrados con miniaturas, vinculados solos a los anuncios que los usan.
- **Facturación:** facturas, cobros, facturado y beneficio por hora, e informes en PDF para clientes.
- **Herramientas de archivos** (escritorio): comprimir y convertir imágenes, vídeo (FFmpeg) y PDF.
- **Gmail en solo lectura:** los hilos de correo de cada cliente y contacto.
- **Sincronización entre equipos** con tu propio Google Drive o cualquier carpeta sincronizada, con copias de seguridad automáticas.
- **Personalización:** editor de temas, tarjetas de Inicio configurables, iconos de las secciones y colecciones propias.

## Privacidad y seguridad

- Todo vive en la carpeta de la bóveda que elijas. La base de datos es SQLite cifrada con SQLCipher 4 y los archivos adjuntos van cifrados con AES-256-GCM. La contraseña pasa por Argon2id y hay una clave de recuperación por si la olvidas.
- Los tokens de Meta y Google solo se guardan dentro de la base de datos cifrada.
- La conexión con Meta usa solo el permiso `ads_read`: la app no puede crear, editar, pausar ni borrar anuncios, ni cambiar presupuestos.
- Sin telemetría. Las únicas conexiones son a Meta y a Google (si las conectas) y, salvo que lo desactives, una consulta diaria a los Releases de GitHub de este repositorio para saber si hay versión nueva.
- Electron endurecido: aislamiento de contexto, sandbox, sin Node en la interfaz, CSP estricta y los enlaces externos se abren en tu navegador.

## Instalar

Descarga el archivo de tu sistema en **[Releases](https://github.com/ISawSau/CRM-MELLOW-01/releases/latest)**:

| Sistema | Archivo | Cómo |
|---|---|---|
| Windows 10/11 | `CRM-Mellow-<versión>-windows-x64-instalador.exe` | Doble clic y sigue el asistente. No está firmado (firmarlo cuesta dinero): si aparece «Windows protegió su PC», pulsa _Más información → Ejecutar de todas formas_. |
| Arch Linux | `CRM-Mellow-<versión>-linux-x64.pacman` | `sudo pacman -U CRM-Mellow-<versión>-linux-x64.pacman` |
| Otros Linux | `CRM-Mellow-<versión>-linux-x86_64.AppImage` | Dale permiso de ejecución y ábrelo. |
| Android 10+ (arm64) | `CRM-Mellow-<versión>-android-arm64.apk` | Ábrelo en el móvil y permite instalar apps desde el navegador. Pensada para GrapheneOS: no necesita Google Play Services. |

`SHA256SUMS.txt` sirve para comprobar las descargas. Para actualizar, instala la versión nueva encima: tus datos están en la bóveda, nunca en la app.

## Conectar tus cuentas

La app no trae credenciales compartidas: creas las tuyas (gratis) y se quedan en tu bóveda.

- **Google Drive y Gmail:** en [Google Cloud Console](https://console.cloud.google.com/), crea un proyecto, activa la _Google Drive API_ (y la _Gmail API_ si quieres el correo), configura la pantalla de consentimiento y añádete como usuario de prueba. Después crea un cliente OAuth de tipo **Aplicación de escritorio** y pega en la app su id de cliente (termina en `.apps.googleusercontent.com`) y su secreto. El mismo cliente de escritorio sirve también en Android. Drive usa el permiso `drive.file`, así que la app solo ve los archivos que ella misma crea.
- **Meta:** en la configuración del negocio, crea un usuario del sistema, asígnale tus cuentas publicitarias con acceso solo para ver el rendimiento y genera un token para tu app con solo el permiso `ads_read` y caducidad _Nunca_. Pégalo en _Campañas_.

Cada pantalla de ajustes de la app te guía por estos pasos.

## Compilar desde el código

Hace falta Git y Node.js 22.12 o posterior (los scripts lo instalan si falta). Los scripts de instalación lo preparan todo y ejecutan los tests:

```bash
# Arch Linux
git clone https://github.com/ISawSau/CRM-MELLOW-01.git && cd CRM-MELLOW-01
bash scripts/instalar-arch.sh
```

```powershell
# Windows (PowerShell)
git clone https://github.com/ISawSau/CRM-MELLOW-01.git; cd CRM-MELLOW-01
powershell -ExecutionPolicy Bypass -File scripts\instalar-windows.ps1
```

| Qué | Comando |
|---|---|
| Solo las dependencias | `npm ci` |
| Desarrollo | `npm run dev` |
| Lint, tipos y formato | `npm run lint` · `npm run typecheck` · `npx prettier --check .` |
| Tests unitarios | `npm test` |
| Tests de interfaz (Playwright + Electron) | `npm run test:e2e` (en un Linux sin pantalla: `xvfb-run -a npm run test:e2e`; nunca como root) |
| Tests de la interfaz móvil | `npm run test:e2e:movil` |
| Instalador de Windows | `npm run dist:win` → `release/*.exe` |
| Paquetes de Linux | `npm run dist:linux` → `release/*.pacman`, `release/*.AppImage` (necesita `bsdtar`) |
| APK de Android | `bash scripts/compilar-android.sh` → `release/*-android-arm64.apk` (Android SDK, NDK 28.2.13676358, JDK 17+, Gradle 9.6+) |
| Autoprueba de una instalación | `crm-mellow --autoprueba` |

GitHub Actions pasa los tests en cada push y genera los instaladores de Windows y Linux y el APK de Android (probado en un emulador). Cuando sube la versión de `package.json`, el workflow publica la versión en Releases.

### Firmar la app de Android en tu fork

Android solo actualiza una app si el APK nuevo está firmado con la misma clave, así que el CI necesita una clave de firma guardada como secretos del repositorio (sin ellos compila y prueba el APK igualmente, pero no lo publica):

1. Crea la clave: `keytool -genkeypair -keystore crm-mellow.jks -alias crm-mellow -keyalg RSA -keysize 4096 -validity 36500` (en Windows, en PowerShell y con `"$HOME\crm-mellow.jks"`). Guárdala, con una copia de seguridad, fuera del repositorio.
2. Pásala a texto: `base64 -w0 crm-mellow.jks > crm-mellow.txt` (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\crm-mellow.jks")) | Set-Content "$HOME\crm-mellow.txt"`).
3. En _Settings → Secrets and variables → Actions_ añade `ANDROID_KEYSTORE_B64` (el contenido del archivo de texto), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` y `ANDROID_KEY_ALIAS` (`crm-mellow`).

## Documentos del proyecto

- [`docs/SPEC.md`](docs/SPEC.md): la especificación completa y las fases de construcción.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): cada decisión técnica y su motivo.
- [`docs/DESIGN.md`](docs/DESIGN.md): el diseño visual.

## Contribuir

Es una herramienta personal que se comparte tal cual. Los fallos y las sugerencias son bienvenidos en [Issues](https://github.com/ISawSau/CRM-MELLOW-01/issues); para cambios grandes, abre antes un issue. Todo texto visible pasa por `t()` en español y su traducción al inglés va en `src/shared/i18n/en/`: el test de cobertura falla si falta alguna.

## Licencia

[MIT](LICENSE) © yellowmellow.

Los instaladores de escritorio incluyen también FFmpeg (GPL-3.0, se ejecuta como programa aparte) y libheif (LGPL-3.0). Sus licencias y su código fuente están en [`build/licencias/`](build/licencias/LEEME.txt).

CRM Mellow no está afiliado a Meta ni a Google, ni cuenta con su respaldo.
