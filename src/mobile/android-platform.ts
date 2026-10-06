import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { externalUrl, type Platform } from '../main/platform'
import type { NativeRequest } from './server'

export interface AndroidPlatformOptions {
  version: string
  /** Carpeta privada de la app donde viven las bóvedas. */
  vaultsDir: string
  /** Carpeta temporal privada (se vacía al guardar). */
  cacheDir: string
  native: (request: NativeRequest) => Promise<unknown>
}

/**
 * Android (D-101). No hay diálogos del sistema desde Node: la bóveda vive en la carpeta
 * privada de la app, los archivos se suben desde la interfaz y lo que se guarda o se copia
 * pasa por el lado nativo (selector de Android, portapapeles con marca de dato sensible).
 */
/** Abre la app desde la página del navegador (filtro de MainActivity, D-118). */
export const RETURN_TO_APP_URL =
  'intent://volver#Intent;scheme=cc.yellowmellow.crm;package=cc.yellowmellow.crm;end'

export function androidPlatform(o: AndroidPlatformOptions): Platform {
  mkdirSync(o.vaultsDir, { recursive: true })
  const exportsDir = join(o.cacheDir, 'exportar')
  // Servicio en primer plano mientras haya algo que lo necesite (pueden solaparse).
  let holders = 0
  return {
    name: 'android',
    version: () => o.version,
    isPackaged: () => true,
    pickFolder: () => Promise.resolve(o.vaultsDir),
    pickFiles: () => Promise.resolve([]),
    saveAs({ defaultName }) {
      const dir = join(exportsDir, randomBytes(8).toString('hex'))
      mkdirSync(dir, { recursive: true })
      return Promise.resolve(join(dir, defaultName))
    },
    async delivered(path) {
      try {
        const saved = await o.native({ kind: 'save', path, name: basename(path) })
        return typeof saved === 'string' ? saved : null
      } finally {
        rmSync(dirname(path), { recursive: true, force: true })
      }
    },
    async writeClipboard(text, secret) {
      await o.native({ kind: 'clipboard', text, secret })
    },
    openExternal(raw) {
      const url = externalUrl(raw)
      if (url) void o.native({ kind: 'open', url })
    },
    notify(title, body) {
      void o.native({ kind: 'notify', title, body })
    },
    keepRunning(text) {
      if (holders++ === 0) void o.native({ kind: 'busy', on: true, text })
      let released = false
      return () => {
        if (released) return
        released = true
        if (--holders === 0) void o.native({ kind: 'busy', on: false })
      }
    },
    returnToAppUrl: RETURN_TO_APP_URL,
  }
}
