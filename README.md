# CRM Mellow

CRM personal de media buying: app de escritorio local-first para Windows y Linux (Arch), con todos los datos cifrados en una carpeta portable (la bóveda).

- Especificación: [`docs/SPEC.md`](docs/SPEC.md)
- Decisiones técnicas: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Diseño: [`docs/DESIGN.md`](docs/DESIGN.md)

## Instalar la app

No hace falta ningún comando de desarrollo. En la página **[Releases](https://github.com/ISawSau/CRM-MELLOW-01/releases)** de este repositorio hay una versión por cada fase terminada, con el instalador de cada sistema y las instrucciones:

- **Windows:** descargar el `.exe`, doble clic y seguir el asistente. Está sin firmar: si sale «Windows protegió su PC», pulsar «Más información» → «Ejecutar de todas formas».
- **Arch Linux:** descargar el `.pacman` e instalarlo con `sudo pacman -U <archivo>`. Después, abrir «CRM Mellow» desde el menú de aplicaciones.

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

## Builds intermedios

Cada push a `main` genera también los instaladores en GitHub Actions (pestaña **Actions** → la ejecución → **Artifacts**, se guardan 5 días). Para comprobar una instalación: `crm-mellow --autoprueba`.
