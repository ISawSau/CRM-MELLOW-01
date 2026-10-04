import { app, BrowserWindow, type Session } from 'electron'

export interface WindowOptions {
  session: Session
  preload: string
  url: string
  /** Ventana transparente (tema con transparencia «ventana», D-097). */
  transparent?: boolean
}

/**
 * Transparencia de la ventana. En Linux la ventana es transparente y el compositor decide si
 * desenfoca lo de detrás (Hyprland, KDE…). En Windows 11 se usa el material acrílico; en
 * versiones anteriores Electron lo ignora y la ventana queda opaca.
 */
function transparency(on: boolean): Electron.BrowserWindowConstructorOptions {
  if (!on) return { backgroundColor: '#0b0807' }
  if (process.platform === 'win32')
    return { backgroundColor: '#00000000', backgroundMaterial: 'acrylic' }
  return { backgroundColor: '#00000000', transparent: true }
}

export function createMainWindow({
  session,
  preload,
  url,
  transparent = false,
}: WindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'CRM Mellow',
    // Mismo fondo que el tema de serie para evitar el destello blanco al abrir.
    ...transparency(transparent),
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      session,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      // El corrector descarga diccionarios de Google y guarda datos fuera de la bóveda.
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })
  win.once('ready-to-show', () => win.show())
  void win.loadURL(url)
  return win
}
