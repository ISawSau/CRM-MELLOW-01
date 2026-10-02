# CRM Mellow

CRM personal de media buying: app de escritorio local-first para Windows y Linux (Arch), con todos los datos cifrados en una carpeta portable (la bóveda).

- Especificación: [`docs/SPEC.md`](docs/SPEC.md)
- Decisiones técnicas: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Diseño: [`docs/DESIGN.md`](docs/DESIGN.md)

## Instalar para desarrollar

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

## Instaladores

Cada push a `main` genera en GitHub Actions el instalador de Windows (`.exe`) y los paquetes de Linux (`.pacman` para Arch y `.AppImage`). Se descargan desde la pestaña **Actions** → la ejecución → **Artifacts** (se guardan 5 días).

- Arch: `sudo pacman -U CRM-Mellow-*-linux-x64.pacman`
- Windows: ejecutar el `.exe` (está sin firmar: SmartScreen avisará; "Más información" → "Ejecutar de todas formas").

Para comprobar una instalación: `crm-mellow --autoprueba`.
