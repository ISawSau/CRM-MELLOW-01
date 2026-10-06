import { app } from 'electron'
import { spawn } from 'node:child_process'
import { chmodSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { UpdateTarget } from './updates'

/**
 * Cómo se actualiza la app de escritorio desde ella misma (D-120), según cómo se instaló:
 *
 *   Windows   baja el instalador, lo abre y la app se cierra para que pueda sustituirla.
 *   AppImage  baja el AppImage nuevo junto al que está en uso, lo pone en su lugar (mismo
 *             nombre, así los accesos directos siguen valiendo) y la app se vuelve a abrir.
 *   pacman    no se puede instalar sin contraseña de administrador: lo baja a Descargas y
 *             da el comando para instalarlo.
 *
 * Sin empaquetar (desarrollo) no hay destino: solo se avisa. `testDir` (tests) baja el
 * .pacman a esa carpeta.
 */
export function desktopUpdateTarget(testDir?: string): UpdateTarget | null {
  if (testDir) return pacman(() => testDir)
  if (!app.isPackaged) return null
  if (process.platform === 'win32')
    return {
      suffix: '-windows-x64-instalador.exe',
      dir: () => join(tmpdir(), 'crm-mellow-actualizacion'),
      install: async (file) => {
        spawn(file, [], { detached: true, stdio: 'ignore' }).unref()
        // Se cierra (subiendo antes lo pendiente) para que el instalador pueda sustituirla.
        setTimeout(() => app.quit(), 1_000)
        return { kind: 'installing' }
      },
    }
  if (process.platform === 'linux') {
    const appImage = process.env['APPIMAGE']
    if (appImage)
      return {
        suffix: '-linux-x86_64.AppImage',
        dir: () => dirname(appImage),
        install: async (file) => {
          chmodSync(file, 0o755)
          renameSync(file, appImage)
          app.relaunch({ execPath: appImage, args: [] })
          app.quit()
          return { kind: 'installing' }
        },
      }
    return pacman(() => app.getPath('downloads'))
  }
  return null
}

function pacman(dir: () => string): UpdateTarget {
  return {
    suffix: '-linux-x64.pacman',
    dir,
    install: async (file) => ({ kind: 'command', command: `sudo pacman -U "${file}"` }),
  }
}
