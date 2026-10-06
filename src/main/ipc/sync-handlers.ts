import type { Platform } from '../platform'
import type { SyncService } from '../sync/sync-service'
import { asGoogleError } from '../sync/google-auth'
import type { IpcHandlers } from './run'
import { t } from '@shared/i18n'

type SyncChannel = Extract<keyof IpcHandlers, `sync:${string}` | `backups:${string}`>
export type SyncHandlers = Pick<IpcHandlers, SyncChannel>

/** Sincronización y copias de seguridad (SPEC §4). */
export function createSyncHandlers(sync: SyncService, platform: Platform): SyncHandlers {
  return {
    'sync:status': () => sync.status(),
    // La carpeta se elige en el diálogo del sistema (la interfaz no envía rutas).
    'sync:pickFolder': async () => {
      const path = await platform.pickFolder({
        title: t('Carpeta para sincronizar la bóveda'),
        buttonLabel: t('Usar esta carpeta'),
      })
      if (!path) return null
      sync.configureFolder(path)
      await sync.sync()
      return sync.status()
    },
    'sync:connectDrive': async (client) => {
      await sync.configureDrive(client).catch((e: unknown) => {
        throw asGoogleError(e)
      })
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
