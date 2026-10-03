import { app, BrowserWindow, Menu, powerMonitor, session, type IpcMainInvokeEvent } from 'electron'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { AutoLock } from './auto-lock'
import { ConfigStore } from './config'
import { createHandlers } from './ipc/handlers'
import { registerIpc } from './ipc/register'
import { runSelfTest } from './self-test'
import {
  APP_ORIGIN,
  hardenSession,
  disableSpellcheckOnEverySession,
  hardenWebContents,
  isAppUrl,
  openExternalSafely,
  refuseDebugSwitches,
  registerAppProtocol,
  registerPrivilegedScheme,
} from './security'
import { registerVaultProtocol } from './files/vault-protocol'
import { SyncService } from './sync/sync-service'
import { MetaService } from './meta/meta-service'
import { AnalysisService } from './analysis/analysis-service'
import { isVaultFolder } from './vault/vault-file'
import { VaultService } from './vault/vault-service'
import { createMainWindow } from './window'

// En desarrollo electron-vite sirve la interfaz desde Vite; empaquetada, desde app://crm.
const devServerUrl = (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) || undefined

if (refuseDebugSwitches()) {
  console.error('La app no se puede arrancar con opciones de depuración remota.')
  app.exit(1)
}

// Interfaz en español de España (formatos de Intl y controles nativos de fecha).
// En Linux Chromium ignora --lang y toma el idioma de las variables de entorno.
if (process.platform === 'linux') process.env['LANGUAGE'] = 'es_ES:es'
app.commandLine.appendSwitch('lang', 'es-ES')

// Fuerza el sandbox de Chromium en todos los renderers.
app.enableSandbox()
registerPrivilegedScheme()
disableSpellcheckOnEverySession()

if (process.argv.includes('--autoprueba')) {
  // Autoprueba de la instalación: sin ventana, sin tocar la configuración.
  void app.whenReady().then(async () => {
    const ok = await runSelfTest()
    app.exit(ok ? 0 : 1)
  })
} else if (!app.requestSingleInstanceLock()) {
  // Una sola instancia: abrir la app dos veces enfoca la ventana existente.
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  const vault = new VaultService({
    onChange: (status) => mainWindow?.webContents.send('vault:changed', status),
    data: { onChange: (change) => mainWindow?.webContents.send('data:changed', change) },
  })
  const sync = new SyncService(vault, {
    hostname: hostname(),
    openBrowser: openExternalSafely,
    onChange: (status) => mainWindow?.webContents.send('sync:changed', status),
  })
  // Servidores falsos de Meta y del BCE: solo en desarrollo y tests, nunca empaquetada.
  const testUrl = (name: string) => (!app.isPackaged && process.env[name]) || undefined
  const graphUrl = testUrl('CRM_TEST_GRAPH_URL')
  const ecbUrl = testUrl('CRM_TEST_ECB_URL')
  const pollMs = testUrl('CRM_TEST_META_POLL_MS')
  const meta = new MetaService(vault, {
    onChange: (status) => mainWindow?.webContents.send('meta:changed', status),
    onData: () => mainWindow?.webContents.send('meta:changed', meta.status()),
    onSynced: () => analysis.evaluate(),
    ...(graphUrl ? { graphUrl } : {}),
    ...(ecbUrl ? { ecbUrl } : {}),
    ...(pollMs ? { pollMs: Number(pollMs) } : {}),
  })
  const analysis = new AnalysisService(vault, {
    currency: () => meta.settings().displayCurrency,
    tableSettings: () => meta.tableSettings(),
    onChange: () => mainWindow?.webContents.send('analysis:changed', null),
  })
  /** Bloqueo con subida previa de lo pendiente (manual o por inactividad). */
  const lockWithSync = async () => {
    autoLock.stop()
    meta.dispose()
    try {
      await sync.beforeClose()
    } finally {
      sync.dispose()
      vault.lock()
    }
  }
  const autoLock = new AutoLock(vault, Date.now, () => void lockWithSync())

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  hardenWebContents(devServerUrl)

  void app.whenReady().then(() => {
    if (app.isPackaged) Menu.setApplicationMenu(null)

    // La sesión por defecto no la usa ninguna ventana, pero Chromium la crea igual y
    // descarga diccionarios del corrector desde Google: se desactiva y se aísla.
    hardenSession(session.defaultSession)

    // Sesión solo en memoria: Chromium no guarda caché, cookies ni almacenamiento
    // local en disco, así que la interfaz no deja datos fuera de la bóveda.
    const ses = session.fromPartition('crm', { cache: false })
    hardenSession(ses, devServerUrl)
    registerAppProtocol(ses, join(__dirname, '../renderer'))
    registerVaultProtocol(
      ses,
      () => {
        try {
          return vault.data
        } catch {
          return null
        }
      },
      devServerUrl ? new URL(devServerUrl).origin : APP_ORIGIN,
    )

    const config = new ConfigStore(app.getPath('userData'))
    const last = config.get().lastVaultPath
    if (last && isVaultFolder(last)) {
      try {
        vault.open(last)
      } catch {
        // Bóveda movida o dañada: se muestra la pantalla de bienvenida.
      }
    }

    const isTrustedSender = (event: IpcMainInvokeEvent) =>
      mainWindow !== null &&
      event.sender === mainWindow.webContents &&
      isAppUrl(event.senderFrame?.url ?? '', devServerUrl)

    registerIpc(
      createHandlers({
        vault,
        config,
        autoLock,
        sync,
        meta,
        analysis,
        lockWithSync,
        getWindow: () => mainWindow,
      }),
      isTrustedSender,
    )

    // Bloqueo al suspender o bloquear la sesión del sistema.
    // Al suspender no hay tiempo para subir: se sube en la próxima sincronización.
    const lockNow = () => {
      autoLock.stop()
      meta.dispose()
      sync.dispose()
      vault.lock()
    }
    powerMonitor.on('suspend', lockNow)
    powerMonitor.on('lock-screen', lockNow)

    mainWindow = createWindowFor(ses)
    mainWindow.on('closed', () => {
      mainWindow = null
    })
  })

  // Al salir: checkpoint del WAL, cierre de crm.db y borrado del .lock.
  // Al salir: se sube lo pendiente (como mucho un minuto) y se cierra la bóveda.
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    meta.dispose()
    if (vault.status().state === 'unlocked' && sync.status().pending && sync.status().kind) {
      event.preventDefault()
      quitting = true
      void sync.beforeClose().finally(() => {
        sync.dispose()
        vault.dispose()
        app.quit()
      })
      return
    }
    sync.dispose()
    vault.dispose()
  })
  app.on('window-all-closed', () => app.quit())
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      vault.dispose()
      app.exit(0)
    })
  }
}

function createWindowFor(ses: Electron.Session): BrowserWindow {
  return createMainWindow({
    session: ses,
    preload: join(__dirname, '../preload/index.js'),
    url: devServerUrl ?? `${APP_ORIGIN}/index.html`,
  })
}
