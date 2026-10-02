import { app, BrowserWindow, type Session } from 'electron'

export interface WindowOptions {
  session: Session
  preload: string
  url: string
}

export function createMainWindow({ session, preload, url }: WindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'CRM Mellow',
    // Mismo fondo que el tema oscuro para evitar el destello blanco al abrir.
    backgroundColor: '#0d0908',
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
