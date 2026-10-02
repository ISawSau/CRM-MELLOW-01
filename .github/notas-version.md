Descarga el archivo de tu sistema en **Assets**, aquí abajo. Tus datos no están en el instalador: viven en tu bóveda, así que instalar, actualizar o desinstalar la app nunca los toca.

## Windows

1. Descarga **CRM-Mellow-{{VERSION}}-windows-x64-instalador.exe**.
2. Ábrelo con doble clic. Si aparece «Windows protegió su PC», pulsa **Más información** → **Ejecutar de todas formas**. El aviso sale porque el instalador no está firmado (firmarlo cuesta dinero).
3. Sigue el asistente. Al terminar tendrás **CRM Mellow** en el escritorio y en el menú Inicio.

- **Actualizar:** descarga la versión nueva e instálala encima.
- **Desinstalar:** Configuración → Aplicaciones → CRM Mellow → Desinstalar.

## Arch Linux

1. Descarga **CRM-Mellow-{{VERSION}}-linux-x64.pacman**.
2. Abre una terminal y pega esta línea (si tu carpeta de descargas se llama `Downloads`, cambia `Descargas` por `Downloads`):

   ```
   sudo pacman -U ~/Descargas/CRM-Mellow-{{VERSION}}-linux-x64.pacman
   ```

3. Abre **CRM Mellow** desde el menú de aplicaciones.

- **Actualizar:** igual, con el archivo de la versión nueva.
- **Desinstalar:** `sudo pacman -R crm-mellow`
- **Sin instalar nada:** también está **CRM-Mellow-{{VERSION}}-linux-x86_64.AppImage**. Clic derecho → Propiedades → Permitir ejecutar, y doble clic.

## Comprobar las descargas (opcional)

`SHA256SUMS.txt` tiene la huella SHA-256 de cada archivo. Si coincide con la del archivo descargado, este no se ha alterado.
