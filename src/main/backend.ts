import { safeFileName } from '@shared/files'
import { t } from '@shared/i18n'
import type { IpcEvent, IpcEvents } from '@shared/ipc'
import type { DecodedImage } from '@shared/tools'
import { AnalysisService } from './analysis/analysis-service'
import { AutoLock } from './auto-lock'
import type { ConfigStore } from './config'
import { GmailService } from './gmail/gmail-service'
import { createHandlers } from './ipc/handlers'
import type { IpcHandlers } from './ipc/register'
import { MetaService } from './meta/meta-service'
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
  const vault = new VaultService({
    onChange: (status) => emit('vault:changed', status),
    data: { onChange: (change) => emit('data:changed', change) },
  })
  const sync = new SyncService(vault, {
    hostname: o.hostname,
    openBrowser: (url) => platform.openExternal(url),
    onChange: (status) => emit('sync:changed', status),
  })
  const meta: MetaService = new MetaService(vault, {
    onChange: (status) => emit('meta:changed', status),
    onData: () => emit('meta:changed', meta.status()),
    onSynced: () => analysis.evaluate(),
    ...(urls.graph ? { graphUrl: urls.graph } : {}),
    ...(urls.ecb ? { ecbUrl: urls.ecb } : {}),
    ...(urls.metaPollMs ? { pollMs: Number(urls.metaPollMs) } : {}),
  })
  const analysis = new AnalysisService(vault, {
    currency: () => meta.settings().displayCurrency,
    tableSettings: () => meta.tableSettings(),
    onChange: () => emit('analysis:changed', null),
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
    lockWithSync,
    platform,
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
