import { dialog, type BrowserWindow } from 'electron'
import type { SyncService } from '../sync/sync-service'
import type { IpcHandlers } from './register'
import { t } from '@shared/i18n'

type SyncChannel = Extract<keyof IpcHandlers, `sync:${string}` | `backups:${string}`>
export type SyncHandlers = Pick<IpcHandlers, SyncChannel>

/** Sincronización y copias de seguridad (SPEC §4). */
export function createSyncHandlers(
  sync: SyncService,
  getWindow: () => BrowserWindow | null,
): SyncHandlers {
  return {
    'sync:status': () => sync.status(),
    // La carpeta se elige en el diálogo del sistema (la interfaz no envía rutas).
    'sync:pickFolder': async () => {
      const win = getWindow()
      const options: Electron.OpenDialogOptions = {
        title: t('Carpeta para sincronizar la bóveda'),
        buttonLabel: t('Usar esta carpeta'),
        properties: ['openDirectory', 'createDirectory'],
      }
      const r = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      const path = r.canceled ? undefined : r.filePaths[0]
      if (!path) return null
      sync.configureFolder(path)
      await sync.sync()
      return sync.status()
    },
    'sync:connectDrive': async (client) => {
      await sync.configureDrive(client)
      await sync.sync()
      return sync.status()
    },
    'sync:disconnect': () => sync.disconnect(),
    'sync:now': async () => {
      await sync.sync()
      return sync.status()
    },
    'sync:resolve': async ({ keep }) => {
      await sync.resolve(keep)
      return sync.status()
    },
    'backups:list': () => sync.listBackups(),
    'backups:create': () => sync.createBackup('manual'),
    'backups:restore': ({ name }) => sync.restoreBackup(name),
    'backups:config': () => sync.backupConfig(),
    'backups:setConfig': (cfg) => sync.setBackupConfig(cfg),
  }
}
