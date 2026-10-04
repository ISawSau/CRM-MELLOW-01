# CRM Mellow

CRM personal de media buying: app local-first para Windows, Linux (Arch) y Android (GrapheneOS), con todos los datos cifrados en una carpeta portable (la bóveda).

- Especificación: [`docs/SPEC.md`](docs/SPEC.md)
- Decisiones técnicas: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Diseño: [`docs/DESIGN.md`](docs/DESIGN.md)

## Instalar la app

No hace falta ningún comando de desarrollo. En la página **[Releases](https://github.com/ISawSau/CRM-MELLOW-01/releases)** de este repositorio hay una versión por cada fase terminada, con el instalador de cada sistema y las instrucciones:

- **Windows:** descargar el `.exe`, doble clic y seguir el asistente. Está sin firmar: si sale «Windows protegió su PC», pulsar «Más información» → «Ejecutar de todas formas».
- **Arch Linux:** descargar el `.pacman` e instalarlo con `sudo pacman -U <archivo>`. Después, abrir «CRM Mellow» desde el menú de aplicaciones.
- **Android (GrapheneOS):** descargar el `.apk` en el móvil y abrirlo. Al abrir la app, «Traer desde Google Drive» con el mismo cliente de Google que en el ordenador. Ver abajo «App de Android».

Actualizar es instalar la versión nueva encima. Los datos viven en la bóveda, así que instalar o desinstalar la app nunca los toca.

## Instalar para desarrollar (solo para tocar el código)

Los scripts de instalación están dentro del repositorio, así que primero hay que descargarlo (es privado: la primera vez Git abrirá el navegador para iniciar sesión en GitHub).

**Windows** (en `cmd` o PowerShell):

```
winget install --id Git.Git -e --source winget
```

Cierra la ventana, abre una nueva y:

```
cd %USERPROFILE%
git clone https://github.com/ISawSau/CRM-MELLOW-01.git
cd CRM-MELLOW-01
powershell -ExecutionPolicy Bypass -File scripts\instalar-windows.ps1
```

(En PowerShell, `cd $HOME` en lugar de `cd %USERPROFILE%`.)

**Arch Linux:**

```bash
sudo pacman -S --needed git
git clone https://github.com/ISawSau/CRM-MELLOW-01.git
cd CRM-MELLOW-01
bash scripts/instalar-arch.sh
```

Los scripts instalan Node.js si falta, las dependencias del proyecto y ejecutan los tests; terminan con «Listo». Después, `npm run dev` abre la app.

Para probar una rama que aún no está en `main`: `git checkout <rama>` antes de ejecutar el script.

## App de Android

La app de Android usa la misma interfaz y el mismo motor que el escritorio (D-101). Para que el CI pueda publicar el APK hace falta, **una sola vez**, una clave de firma guardada como secreto del repositorio. Android solo deja actualizar una app si la versión nueva está firmada con la misma clave, así que esta clave hay que guardarla bien (fuera del repositorio, con una copia de seguridad): si se pierde, habría que desinstalar la app y volver a traer la bóveda desde Google Drive.

1. Crear la clave (pide una contraseña y unos datos; basta con tu nombre):
   - **Arch:** `sudo pacman -S --needed jre-openjdk-headless` y después
     `keytool -genkeypair -keystore crm-mellow.jks -alias crm-mellow -keyalg RSA -keysize 4096 -validity 36500`
   - **Windows:** `winget install EclipseAdoptium.Temurin.21.JDK`, abrir una ventana nueva de **PowerShell** (no el «Símbolo del sistema») y pegar entero:
     `keytool -genkeypair -keystore "$HOME\crm-mellow.jks" -alias crm-mellow -keyalg RSA -keysize 4096 -validity 36500`
     (la contraseña no se ve al escribirla; a «¿Es correcto?» se responde `sí`).
2. Pasarla a texto:
   - **Arch:** `base64 -w0 crm-mellow.jks > crm-mellow.txt`
   - **Windows (PowerShell):** `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\crm-mellow.jks")) | Set-Content "$HOME\crm-mellow.txt"` y `notepad "$HOME\crm-mellow.txt"` para copiarlo.
3. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**, cuatro secretos:
   - `ANDROID_KEYSTORE_B64`: el contenido de `crm-mellow.txt` (después borra ese archivo).
   - `ANDROID_KEYSTORE_PASSWORD` y `ANDROID_KEY_PASSWORD`: la contraseña que pusiste.
   - `ANDROID_KEY_ALIAS`: `crm-mellow`.

Sin esos secretos el CI compila y prueba el APK igualmente, pero no lo publica.

Para compilarlo en tu ordenador (Linux, con el Android SDK y su NDK 28.2.13676358, JDK 17+ y Gradle 9.6+): `bash scripts/compilar-android.sh` → `release/*-android-arm64.apk`.

## Builds intermedios

Cada push a `main` genera y prueba los instaladores y el APK de Android en GitHub Actions; cuando sube la versión, se publican en **Releases** con sus notas y sumas SHA-256. Al lanzar el CI a mano también quedan un día en **Actions** → la ejecución → **Artifacts**, si cabe en el almacenamiento gratuito. Para comprobar una instalación: `crm-mellow --autoprueba`.
