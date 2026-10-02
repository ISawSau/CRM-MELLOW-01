import { app, clipboard, dialog, BrowserWindow } from 'electron'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { AppError } from '@shared/errors'
import type { AutoLock } from '../auto-lock'
import type { ConfigStore } from '../config'
import type { VaultService } from '../vault/vault-service'
import { createDataHandlers } from './data-handlers'
import type { IpcHandlers } from './register'

const CLIPBOARD_CLEAR_MS = 60_000

export interface HandlerDeps {
  vault: VaultService
  config: ConfigStore
  autoLock: AutoLock
  getWindow: () => BrowserWindow | null
}

export function createHandlers({ vault, config, autoLock, getWindow }: HandlerDeps): IpcHandlers {
  /**
   * Rutas que el renderer puede usar: solo las elegidas en el selector nativo y la
   * última bóveda. Así una interfaz comprometida no puede crear ni abrir carpetas
   * arbitrarias del disco.
   */
  const allowedPaths = new Set<string>()
  const allow = (p: string) => allowedPaths.add(resolve(p))
  const lastPath = config.get().lastVaultPath
  if (lastPath) allow(lastPath)
  const requireAllowed = (p: string) => {
    if (!allowedPaths.has(resolve(p))) throw new AppError('PATH_NOT_ALLOWED')
  }

  const remember = () => {
    const p = vault.currentPath
    if (p) {
      allow(p)
      config.setLastVaultPath(p)
    }
  }

  return {
    'app:info': () => ({
      version: app.getVersion(),
      platform: process.platform,
      hostname: hostname(),
      isPackaged: app.isPackaged,
    }),

    'app:activity': () => autoLock.touch(),

    'vault:status': () => vault.status(),

    'vault:pickFolder': async ({ purpose }) => {
      const win = getWindow()
      const options: Electron.OpenDialogOptions = {
        title:
          purpose === 'create' ? 'Elige dónde crear la bóveda' : 'Elige la carpeta de la bóveda',
        buttonLabel: purpose === 'create' ? 'Crear aquí' : 'Abrir bóveda',
        properties: ['openDirectory', 'createDirectory'],
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      const picked = result.canceled ? undefined : result.filePaths[0]
      if (!picked) return null
      allow(picked)
      return picked
    },

    'vault:create': async ({ parentPath, name, password }) => {
      requireAllowed(parentPath)
      const result = await vault.create(parentPath, name, password)
      allow(join(parentPath, name))
      remember()
      autoLock.start()
      return result
    },

    'vault:open': ({ path }) => {
      requireAllowed(path)
      const status = vault.open(path)
      remember()
      return status
    },

    'vault:unlock': async ({ password, force }) => {
      const status = await vault.unlock(password, force)
      autoLock.start()
      return status
    },

    'vault:recover': async ({ recoveryKey, newPassword, force }) => {
      const status = await vault.recover(recoveryKey, newPassword, force)
      autoLock.start()
      return status
    },

    'vault:lock': () => {
      autoLock.stop()
      return vault.lock()
    },

    'vault:close': () => {
      autoLock.stop()
      config.setLastVaultPath(null)
      return vault.close()
    },

    'vault:changePassword': ({ currentPassword, newPassword }) =>
      vault.changePassword(currentPassword, newPassword),

    'vault:rotateKey': ({ password }) => vault.rotateKey(password),

    'settings:setAutoLock': ({ minutes }) => vault.setAutoLockMinutes(minutes),

    'settings:setAppearance': (appearance) => vault.setAppearance(appearance),

    // La clave de recuperación se copia desde el proceso principal y se borra del
    // portapapeles al minuto si sigue ahí.
    'clipboard:writeSecret': async ({ text }) => {
      await clipboard.writeText(text)
      setTimeout(() => {
        void clipboard.readText().then((current) => {
          if (current === text) clipboard.clear()
        })
      }, CLIPBOARD_CLEAR_MS).unref()
    },

    ...createDataHandlers(vault, getWindow),
  }
}
