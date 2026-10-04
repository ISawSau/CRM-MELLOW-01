import { app, clipboard, dialog, Notification, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { externalUrl, type Platform } from './platform'

const CLIPBOARD_CLEAR_MS = 60_000

/** Escritorio: diálogos nativos de Electron sobre la ventana principal. */
export function electronPlatform(getWindow: () => BrowserWindow | null): Platform {
  const open = (options: Electron.OpenDialogOptions) => {
    const win = getWindow()
    return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
  }
  return {
    name: 'desktop',
    version: () => app.getVersion(),
    isPackaged: () => app.isPackaged,
    async pickFolder({ title, buttonLabel }) {
      const r = await open({ title, buttonLabel, properties: ['openDirectory', 'createDirectory'] })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    async pickFiles({ title, buttonLabel }) {
      const r = await open({ title, buttonLabel, properties: ['openFile', 'multiSelections'] })
      return r.canceled ? [] : r.filePaths
    },
    async saveAs({ title, defaultName, folder, buttonLabel, filters }) {
      const win = getWindow()
      const options: Electron.SaveDialogOptions = {
        title,
        defaultPath: join(app.getPath(folder), defaultName),
        buttonLabel,
        ...(filters ? { filters } : {}),
      }
      const r = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      return r.canceled || !r.filePath ? null : r.filePath
    },
    delivered: (path) => Promise.resolve(path),
    // Lo secreto (la clave de recuperación) se borra del portapapeles al minuto si sigue ahí.
    async writeClipboard(text, secret) {
      await clipboard.writeText(text)
      if (!secret) return
      setTimeout(() => {
        void clipboard.readText().then((current) => {
          if (current === text) clipboard.clear()
        })
      }, CLIPBOARD_CLEAR_MS).unref()
    },
    openExternal(raw) {
      const url = externalUrl(raw)
      if (url) void shell.openExternal(url)
    },
    notify(title, body) {
      if (!Notification.isSupported()) return
      const n = new Notification({ title, body, silent: false })
      n.on('click', () => {
        const win = getWindow()
        if (!win) return
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      })
      n.show()
    },
  }
}
