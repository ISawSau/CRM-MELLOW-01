import { safeFileName } from '@shared/files'
import { t } from '@shared/i18n'
import type { IpcEvent, IpcEvents } from '@shared/ipc'
import type { DecodedImage } from '@shared/tools'
import { AnalysisService } from './analysis/analysis-service'
import { AutoLock } from './auto-lock'
import type { ConfigStore } from './config'
import { GmailService } from './gmail/gmail-service'
import { GoogleLogins } from './sync/google-auth'
import { createHandlers } from './ipc/handlers'
import type { IpcHandlers } from './ipc/run'
import { MetaService } from './meta/meta-service'
import { Notifier } from './notifier'
import { UpdateService, type UpdateTarget } from './updates'
import type { Platform } from './platform'
import type { ReportFonts } from './reports/report-html'
import { ReportService } from './reports/report-service'
import { SyncService } from './sync/sync-service'
import { ToolsService } from './tools/tools-service'
import { isVaultFolder } from './vault/vault-file'
import { VaultService } from './vault/vault-service'

export interface BackendOptions {
  platform: Platform
  config: ConfigStore
  hostname: string
  /** Envía un evento a la interfaz. */
  emit: <E extends IpcEvent>(event: E, payload: IpcEvents[E]) => void
  /** Servidores falsos de Meta, BCE y Google: solo en desarrollo y tests. */
  testUrls?: {
    graph?: string | undefined
    ecb?: string | undefined
    metaPollMs?: string | undefined
    google?: string | undefined
  }
  /** Lo que solo existe en escritorio (FFmpeg, HEIC, PDF). */
  ffmpeg?: () => string
  decodeHeic?: (data: Uint8Array) => Promise<DecodedImage | null>
  print?: (html: string) => Promise<Buffer>
  fonts?: () => ReportFonts
  /**
   * API de la última versión de GitHub (D-114). Sin indicar, la oficial; null la
   * desactiva (desarrollo y tests, para no salir a internet).
   */
  releasesUrl?: string | null
  /** Cómo se actualiza esta instalación desde la app (D-120); sin él, solo se avisa. */
  updateTarget?: UpdateTarget | null
  /** Móvil: hasta qué tamaño se bajan solos los archivos de la nube (D-101). */
  maxAutoDownloadBytes?: number
}

export interface Backend {
  vault: VaultService
  sync: SyncService
  meta: MetaService
  tools: ToolsService
  gmail: GmailService
  autoLock: AutoLock
  handlers: IpcHandlers
  /** Sube lo pendiente y bloquea (bloqueo manual y por inactividad). */
  lockWithSync: () => Promise<void>
  /** Bloquea ya, sin subir (suspensión del equipo, pantalla apagada). */
  lockNow: () => void
  /** Abre la última bóveda usada, si sigue ahí. */
  openLastVault: () => void
}

/**
 * Monta los servicios del motor y sus canales. Lo comparten la app de escritorio
 * (src/main/index.ts) y la de Android (src/mobile/main.ts, D-101).
 */
export function createBackend(o: BackendOptions): Backend {
  const { platform, config, emit } = o
  const urls = o.testUrls ?? {}
  // Google falso de los tests: tokens y Drive. La página de inicio de sesión sigue siendo la
  // de Google (solo se abre https); el «navegador» de los tests la traduce al falso.
  const google = urls.google
    ? {
        connect: { tokenUrl: `${urls.google}/token` },
        driveUrls: { api: `${urls.google}/drive/v3`, upload: `${urls.google}/upload/drive/v3` },
      }
    : {}
  const logins = new GoogleLogins({
    ...(platform.keepRunning ? { hold: (text: string) => platform.keepRunning!(text) } : {}),
    returnUrl: platform.returnToAppUrl ?? null,
    onChange: (status) => emit('google:changed', status),
  })
  const vault: VaultService = new VaultService({
    onChange: (status) => {
      emit('vault:changed', status)
      if (status.state === 'unlocked') {
        notifier.start()
        updates.start()
        // Un poco después de abrir, cuando la interfaz ya está a la vista.
        setTimeout(() => {
          try {
            notifier.checkTasks()
          } catch {
            // Un aviso nunca debe romper la app.
          }
        }, 5_000).unref?.()
      } else {
        notifier.stop()
        updates.stop()
      }
    },
    data: { onChange: (change) => emit('data:changed', change) },
  })
  const sync = new SyncService(vault, {
    hostname: o.hostname,
    ...(o.maxAutoDownloadBytes ? { maxAutoDownloadBytes: o.maxAutoDownloadBytes } : {}),
    openBrowser: (url) => platform.openExternal(url),
    logins,
    ...google,
    onChange: (status) => emit('sync:changed', status),
  })
  const meta: MetaService = new MetaService(vault, {
    onChange: (status) => emit('meta:changed', status),
    onData: () => emit('meta:changed', meta.status()),
    onSynced: () => notifier.alerts(analysis.evaluate()),
    ...(urls.graph ? { graphUrl: urls.graph } : {}),
    ...(urls.ecb ? { ecbUrl: urls.ecb } : {}),
    ...(urls.metaPollMs ? { pollMs: Number(urls.metaPollMs) } : {}),
  })
  const analysis = new AnalysisService(vault, {
    currency: () => meta.settings().displayCurrency,
    tableSettings: () => meta.tableSettings(),
    onChange: () => emit('analysis:changed', null),
  })
  const notifier: Notifier = new Notifier(vault, platform)
  const updates: UpdateService = new UpdateService(vault, {
    current: () => platform.version(),
    onChange: () => emit('updates:changed', null),
    ...(o.releasesUrl !== undefined ? { url: o.releasesUrl } : {}),
    ...(o.updateTarget ? { target: o.updateTarget } : {}),
  })
  const saveResult = (name: string) =>
    platform.saveAs({
      title: t('Guardar el resultado'),
      defaultName: safeFileName(name),
      folder: 'downloads',
      buttonLabel: t('Guardar'),
    })
  const tools = new ToolsService(vault, {
    ffmpeg: o.ffmpeg ?? (() => ''),
    savePath: saveResult,
    onProgress: (p) => emit('tools:progress', p),
    ...(o.decodeHeic ? { decodeHeic: o.decodeHeic } : {}),
  })
  const reports = new ReportService(vault, {
    print: o.print ?? (() => Promise.reject(new Error('Sin PDF en esta plataforma'))),
    savePath: saveResult,
    fonts: o.fonts ?? (() => ({ display: null, body: null })),
    displayCurrency: () => meta.settings().displayCurrency,
    tableSettings: () => meta.tableSettings(),
    actionTypes: () => meta.actionTypes(),
    addDocument: (name, file, tipo, clientId) => tools.addDocument(name, file, tipo, clientId),
  })
  const gmail = new GmailService(vault, {
    openBrowser: (url) => platform.openExternal(url),
    logins,
    driveClient: () => sync.googleClient(),
    onChange: (s) => emit('gmail:changed', s),
    ...(urls.google
      ? {
          apiUrl: `${urls.google}/gmail/v1`,
          tokenUrl: `${urls.google}/token`,
          revokeUrl: `${urls.google}/revoke`,
        }
      : {}),
  })
  const stopServices = () => {
    autoLock.stop()
    meta.dispose()
    tools.dispose()
    gmail.dispose()
  }
  const lockWithSync = async () => {
    stopServices()
    try {
      await sync.beforeClose()
    } finally {
      sync.dispose()
      vault.lock()
    }
  }
  const autoLock = new AutoLock(vault, Date.now, () => void lockWithSync())
  const lockNow = () => {
    stopServices()
    sync.dispose()
    vault.lock()
  }
  const openLastVault = () => {
    const last = config.get().lastVaultPath
    if (!last || !isVaultFolder(last)) return
    try {
      vault.open(last)
    } catch {
      // Bóveda movida o dañada: se muestra la pantalla de bienvenida.
    }
  }
  const handlers = createHandlers({
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
  })
  return {
    vault,
    sync,
    meta,
    tools,
    gmail,
    autoLock,
    handlers,
    lockWithSync,
    lockNow,
    openLastVault,
  }
}
