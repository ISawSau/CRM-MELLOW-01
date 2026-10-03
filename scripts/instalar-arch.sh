#!/usr/bin/env bash
# Instala todo lo necesario para desarrollar y probar CRM Mellow en Arch Linux.
#
# Uso, desde la carpeta del repositorio:
#     bash scripts/instalar-arch.sh
#
# Opciones:
#     --sin-preguntas   no pide confirmación a pacman (para automatizar)
#
# Qué hace:
#   1. Instala con pacman (repositorios oficiales de Arch) git, Node.js LTS, npm y
#      las bibliotecas que necesita Electron. Si ya tienes Node.js 22.12 o superior,
#      no lo toca.
#   2. Instala las dependencias del proyecto con `npm ci` (versiones exactas del
#      package-lock.json).
#   3. Ejecuta los tests para comprobar que todo funciona.
#
# No usa sudo para npm ni instala nada fuera de pacman y de la carpeta del proyecto.

set -euo pipefail

NODE_MIN_MAJOR=22
NODE_MIN_MINOR=12
SIN_PREGUNTAS=0
for arg in "$@"; do
  case "$arg" in
    --sin-preguntas) SIN_PREGUNTAS=1 ;;
    -h | --help)
      sed -n '2,19p' "$0"
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg" >&2
      exit 2
      ;;
  esac
done

paso() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }
error() {
  printf '\033[1;31mError:\033[0m %s\n' "$1" >&2
  exit 1
}

[ -f /etc/arch-release ] || error "este script es para Arch Linux (no se encuentra /etc/arch-release)."

if [ "$(id -u)" -eq 0 ]; then
  error "no lo ejecutes como root. Usa tu usuario normal; el script pedirá la contraseña de sudo solo para pacman."
fi
command -v sudo >/dev/null || error "hace falta sudo para instalar paquetes con pacman."

cd "$(dirname "$0")/.."
[ -f package.json ] || error "no se encuentra package.json; ejecuta el script desde el repositorio."

node_ok() {
  command -v node >/dev/null || return 1
  local v major minor
  v="$(node --version | sed 's/^v//')"
  major="${v%%.*}"
  minor="$(echo "$v" | cut -d. -f2)"
  [ "$major" -gt "$NODE_MIN_MAJOR" ] || { [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ]; }
}

# Bibliotecas que Electron necesita en tiempo de ejecución (las mismas que declara
# el paquete pacman de la app) y fuse2 para poder abrir el AppImage.
PAQUETES=(git gtk3 nss alsa-lib libxss libxtst libnotify xdg-utils at-spi2-core util-linux-libs libsecret fuse2)
if node_ok; then
  echo "Node.js $(node --version) ya instalado: se mantiene."
  command -v npm >/dev/null || PAQUETES+=(npm)
else
  # nodejs-lts-krypton = Node.js 24 LTS, la misma versión que usa Electron por dentro.
  PAQUETES+=(nodejs-lts-krypton npm)
fi

paso "Instalando paquetes del sistema con pacman"
echo "Paquetes: ${PAQUETES[*]}"
echo "(Arch no admite actualizaciones parciales, así que pacman actualizará también el sistema: -Syu.)"
PACMAN_OPTS=(-Syu --needed)
[ "$SIN_PREGUNTAS" -eq 1 ] && PACMAN_OPTS+=(--noconfirm)
sudo pacman "${PACMAN_OPTS[@]}" "${PAQUETES[@]}"

node_ok || error "Node.js sigue sin estar disponible o es anterior a ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}."
echo "Node.js $(node --version), npm $(npm --version)"

paso "Instalando dependencias del proyecto (npm ci)"
npm ci

paso "Descargando Electron (se verifica con las sumas SHA-256 del propio paquete)"
node node_modules/electron/install.js

paso "Descargando FFmpeg para el vídeo (se verifica con su huella SHA-256)"
node scripts/descargar-ffmpeg.mjs

paso "Comprobando que todo funciona (tests unitarios)"
npm test

paso "Listo"
cat <<'FIN'
Comandos útiles (desde esta carpeta):
  npm run dev           abrir la app en modo desarrollo
  npm test              tests unitarios
  npm run test:e2e      tests de la interfaz (abre la app)
  npm run dist:linux    generar el paquete pacman y el AppImage en release/

Para instalar el paquete generado:
  sudo pacman -U release/CRM-Mellow-*-linux-x64.pacman
FIN
