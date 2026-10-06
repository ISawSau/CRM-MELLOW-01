import { hostname } from 'node:os'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AppError } from '@shared/errors'
import { safeFileName } from '@shared/files'
import { getLocale, setLocale, t } from '@shared/i18n'
import type { AutoLock } from '../auto-lock'
import type { Platform } from '../platform'
import type { IpcEvent, IpcEvents } from '@shared/ipc'
import { CloneJob, type CloneJobOptions } from '../sync/clone'
import type { GoogleLogins } from '../sync/google-auth'
import type { ConfigStore } from '../config'
import type { VaultService } from '../vault/vault-service'
import type { SyncService } from '../sync/sync-service'
import type { MetaService } from '../meta/meta-service'
import type { AnalysisService } from '../analysis/analysis-service'
import type { ToolsService } from '../tools/tools-service'
import type { ReportService } from '../reports/report-service'
import type { GmailService } from '../gmail/gmail-service'
import { createGmailHandlers } from './gmail-handlers'
import { createAnalysisHandlers } from './analysis-handlers'
import { createDataHandlers } from './data-handlers'
import type { UpdateService } from '../updates'
import { createMetaHandlers } from './meta-handlers'
import { createSyncHandlers } from './sync-handlers'
import { createToolsHandlers } from './tools-handlers'
import type { IpcHandlers } from './run'

export interface HandlerDeps {
  vault: VaultService
  config: ConfigStore
  autoLock: AutoLock
  sync: SyncService
  meta: MetaService
  analysis: AnalysisService
  tools: ToolsService
  reports: ReportService
  gmail: GmailService
  updates: UpdateService
  /** Sube lo pendiente y bloquea (bloqueo manual y automático). */
  lockWithSync: () => Promise<void>
  platform: Platform
  /** Inicio de sesión con Google en curso (D-118). */
  logins: GoogleLogins
  /** Direcciones de Google (tests). */
  google: Pick<CloneJobOptions, 'connect' | 'driveUrls'>
  emit: <E extends IpcEvent>(event: E, payload: IpcEvents[E]) => void
}

/** La sincronización al desbloquear no debe dejar la pantalla esperando eternamente. */
const UNLOCK_SYNC_TIMEOUT_MS = 30_000

export function createHandlers({
  vault,
  config,
  autoLock,
  sync,
  meta,
  analysis,
  tools,
  reports,
  gmail,
  updates,
  lockWithSync,
  platform,
  logins,
  google,
  emit,
}: HandlerDeps): IpcHandlers {
  // Tras traer la versión de la nube, Meta rellena el hueco desde la última vez.
  const syncAfterUnlock = () =>
    Promise.race([
      sync.afterUnlock(),
      new Promise<void>((r) => setTimeout(r, UNLOCK_SYNC_TIMEOUT_MS)),
    ])
      .catch(() => {})
      .finally(() => {
        meta.start()
      })
  /**
   * Rutas que el renderer puede usar: solo las elegidas en el selector nativo y la
   * última bóveda. Así una interfaz comprometida no puede crear ni abrir carpetas
   * arbitrarias del disco.
   */
  const allowedPaths = new Set<string>()
  const allow = (p: string) => allowedPaths.add(resolve(p))
  const lastPath = config.get().lastVaultPath
  // La transparencia de la ventana se decide al crearla: lo que valía al arrancar.
  const windowTransparentAtStart = config.get().windowTransparent
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

  // «Traer desde Google Drive» (D-118): al terminar, la bóveda queda abierta y bloqueada.
  const clone = new CloneJob({
    openBrowser: (url) => platform.openExternal(url),
    logins,
    ...google,
    ...(platform.keepRunning ? { hold: (text: string) => platform.keepRunning!(text) } : {}),
    opened: (path) => {
      allow(path)
      vault.open(path)
      remember()
    },
    onChange: (status) => emit('vault:cloneChanged', status),
  })

  return {
    'app:info': () => ({
      version: platform.version(),
      platform: platform.name === 'android' ? 'android' : process.platform,
      hostname: hostname(),
      isPackaged: platform.isPackaged(),
    }),

    'app:activity': () => autoLock.touch(),

    // Aviso de versión nueva (D-114).
    'updates:status': () => updates.status(),
    'updates:settings': () => vault.data.getUpdateSettings(),
    'updates:setSettings': (s) => {
      const saved = vault.data.setUpdateSettings(s)
      void updates.check()
      return saved
    },
    'updates:dismiss': ({ version }) => {
      vault.data.setUpdateSettings({ ...vault.data.getUpdateSettings(), dismissed: version })
      return updates.status()
    },

    'vault:status': () => vault.status(),

    'vault:pickFolder': async ({ purpose }) => {
      const picked = await platform.pickFolder({
        title:
          purpose === 'create'
            ? t('Elige dónde crear la bóveda')
            : t('Elige la carpeta de la bóveda'),
        buttonLabel: purpose === 'create' ? t('Crear aquí') : t('Abrir bóveda'),
      })
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
      meta.start()
      return result
    },

    'vault:open': ({ path }) => {
      requireAllowed(path)
      const status = vault.open(path)
      remember()
      return status
    },

    'vault:cloneStart': ({ parentPath, clientId, clientSecret }) => {
      requireAllowed(parentPath)
      return clone.start({ clientId, clientSecret }, parentPath)
    },
    'vault:cloneStatus': () => clone.status(),
    'vault:cloneCancel': () => clone.cancel(),
    'google:login': () => logins.status(),
    'google:paste': ({ url }) => logins.paste(url),
    'google:cancel': () => logins.cancel(),

    'vault:unlock': async ({ password, force }) => {
      await vault.unlock(password, force)
      autoLock.start()
      await syncAfterUnlock()
      return vault.status()
    },

    'vault:recover': async ({ recoveryKey, newPassword, force }) => {
      await vault.recover(recoveryKey, newPassword, force)
      autoLock.start()
      await syncAfterUnlock()
      return vault.status()
    },

    'vault:lock': async () => {
      await lockWithSync()
      return vault.status()
    },

    'vault:close': async () => {
      autoLock.stop()
      meta.dispose()
      tools.dispose()
      gmail.dispose()
      await sync.beforeClose()
      config.setLastVaultPath(null)
      return vault.close()
    },

    'vault:changePassword': ({ currentPassword, newPassword }) =>
      vault.changePassword(currentPassword, newPassword),

    'vault:rotateKey': ({ password }) => vault.rotateKey(password),

    'settings:setAutoLock': ({ minutes }) => vault.setAutoLockMinutes(minutes),

    'settings:setAppearance': (appearance) => vault.setAppearance(appearance),
    'settings:setThemes': ({ themes }) => vault.setThemes(themes),

    // Idioma: se guarda en la configuración mínima (se elige antes de abrir la bóveda) y la
    // interfaz se recarga; el proceso principal lo usa en sus mensajes al momento.
    'app:locale': () => getLocale(),
    'app:setLocale': ({ locale }) => {
      config.setLocale(locale)
      setLocale(locale)
    },
    'app:lockAnimation': () => config.get().lockAnimation,
    // El tema pide (o deja de pedir) ventana transparente: vale para la próxima vez que se abra.
    'app:windowTransparent': ({ value }) => {
      config.setWindowTransparent(value)
      return { active: windowTransparentAtStart }
    },
    'app:setLockAnimation': ({ value }) => config.setLockAnimation(value),

    // Exportar un tema es una acción explícita: el archivo va donde elija el usuario.
    'settings:exportTheme': async ({ name, json }) => {
      const path = await platform.saveAs({
        title: t('Exportar tema'),
        defaultName: safeFileName(`${name}.json`),
        folder: 'documents',
        buttonLabel: t('Exportar'),
        filters: [{ name: t('Tema (JSON)'), extensions: ['json'] }],
      })
      if (!path) return false
      writeFileSync(path, json, 'utf8')
      return (await platform.delivered(path)) !== null
    },

    'clipboard:writeText': ({ text }) => platform.writeClipboard(text, false),

    // La clave de recuperación se borra del portapapeles al minuto si sigue ahí.
    'clipboard:writeSecret': ({ text }) => platform.writeClipboard(text, true),

    ...createDataHandlers(vault, platform),
    ...createSyncHandlers(sync, platform),
    ...createMetaHandlers(meta),
    ...createAnalysisHandlers(analysis),
    ...createToolsHandlers(tools, reports),
    ...createGmailHandlers(gmail, vault),
  }
}
