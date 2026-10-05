import { app, BrowserWindow, Menu, powerMonitor, session, type IpcMainInvokeEvent } from 'electron'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { ConfigStore } from './config'
import { getLocale, intlLocale, setLocale } from '@shared/i18n'
import { registerDropHandler } from './ipc/drop-handler'
import { registerIpc } from './ipc/register'
import { runSelfTest } from './self-test'
import {
  APP_ORIGIN,
  hardenSession,
  disableSpellcheckOnEverySession,
  hardenWebContents,
  isAppUrl,
  refuseDebugSwitches,
  registerAppProtocol,
  registerPrivilegedScheme,
} from './security'
import { registerVaultProtocol } from './files/vault-protocol'
import { ffmpegPath } from './tools/dialogs'
import { createBackend } from './backend'
import { electronPlatform } from './electron-platform'
import { reportFonts } from './reports/fonts'
import { htmlToPdf } from './reports/print'
import { decodeHeic } from './tools/heic'
import { createMainWindow } from './window'

// En desarrollo electron-vite sirve la interfaz desde Vite; empaquetada, desde app://crm.
const devServerUrl = (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) || undefined

if (refuseDebugSwitches()) {
  console.error('La app no se puede arrancar con opciones de depuración remota.')
  app.exit(1)
}

// Idioma de la interfaz (español de España o inglés británico): formatos de Intl y
// controles nativos de fecha. Se lee de la configuración mínima antes de arrancar Chromium.
// En Linux Chromium ignora --lang y toma el idioma de las variables de entorno.
const config = new ConfigStore(app.getPath('userData'))
setLocale(config.get().locale)
if (process.platform === 'linux')
  process.env['LANGUAGE'] = getLocale() === 'en' ? 'en_GB:en' : 'es_ES:es'
app.commandLine.appendSwitch('lang', intlLocale())

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

  // Servidores falsos de Meta, del BCE y de Google: solo en desarrollo y tests, nunca empaquetada.
  const testUrl = (name: string) => (!app.isPackaged && process.env[name]) || undefined
  const platform = electronPlatform(() => mainWindow)
  const backend = createBackend({
    platform,
    config,
    hostname: hostname(),
    emit: (event, payload) => mainWindow?.webContents.send(event, payload),
    testUrls: {
      graph: testUrl('CRM_TEST_GRAPH_URL'),
      ecb: testUrl('CRM_TEST_ECB_URL'),
      metaPollMs: testUrl('CRM_TEST_META_POLL_MS'),
      google: testUrl('CRM_TEST_GOOGLE_URL'),
    },
    // La app instalada consulta GitHub; sin empaquetar, solo un servidor falso de los tests.
    ...(app.isPackaged ? {} : { releasesUrl: testUrl('CRM_TEST_RELEASES_URL') ?? null }),
    ffmpeg: ffmpegPath,
    decodeHeic,
    print: htmlToPdf,
    fonts: () => reportFonts(join(__dirname, '..')),
  })
  const { vault, sync, meta, tools } = backend

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

    backend.openLastVault()

    const isTrustedSender = (event: IpcMainInvokeEvent) =>
      mainWindow !== null &&
      event.sender === mainWindow.webContents &&
      isAppUrl(event.senderFrame?.url ?? '', devServerUrl)

    registerIpc(backend.handlers, isTrustedSender)
    registerDropHandler(tools, isTrustedSender)

    // Bloqueo al suspender o bloquear la sesión del sistema.
    // Al suspender no hay tiempo para subir: se sube en la próxima sincronización.
    powerMonitor.on('suspend', backend.lockNow)
    powerMonitor.on('lock-screen', backend.lockNow)

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
    tools.dispose()
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
    transparent: config.get().windowTransparent,
  })
}
