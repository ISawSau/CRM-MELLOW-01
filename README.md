# CRM Mellow

CRM personal de media buying: app de escritorio local-first para Windows y Linux (Arch), con todos los datos cifrados en una carpeta portable (la bóveda).

- Especificación: [`docs/SPEC.md`](docs/SPEC.md)
- Decisiones técnicas: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Diseño: [`docs/DESIGN.md`](docs/DESIGN.md)

## Instalar para desarrollar

Desde la carpeta del repositorio:

- **Arch Linux:** `bash scripts/instalar-arch.sh`
- **Windows (PowerShell):** `powershell -ExecutionPolicy Bypass -File scripts\instalar-windows.ps1`

Instalan Git y Node.js si faltan, las dependencias del proyecto y ejecutan los tests. Después, `npm run dev` abre la app.

## Instaladores

Cada push a `main` genera en GitHub Actions el instalador de Windows (`.exe`) y los paquetes de Linux (`.pacman` para Arch y `.AppImage`). Se descargan desde la pestaña **Actions** → la ejecución → **Artifacts** (se guardan 5 días).

- Arch: `sudo pacman -U CRM-Mellow-*-linux-x64.pacman`
- Windows: ejecutar el `.exe` (está sin firmar: SmartScreen avisará; "Más información" → "Ejecutar de todas formas").

Para comprobar una instalación: `crm-mellow --autoprueba`.
