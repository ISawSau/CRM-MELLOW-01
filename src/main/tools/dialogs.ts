import { app, dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { safeFileName } from '@shared/files'
import { t } from '@shared/i18n'

/** FFmpeg: junto a la app empaquetada (extraResources) o en vendor/ en desarrollo. */
export function ffmpegPath(): string {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return app.isPackaged
    ? join(process.resourcesPath, 'ffmpeg', exe)
    : // out/main/index.js → raíz del proyecto.
      join(__dirname, '..', '..', 'vendor', 'ffmpeg', exe)
}

export async function saveFileAs(win: BrowserWindow | null, name: string): Promise<string | null> {
  const options: Electron.SaveDialogOptions = {
    title: t('Guardar el resultado'),
    defaultPath: join(app.getPath('downloads'), safeFileName(name)),
    buttonLabel: t('Guardar'),
  }
  const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return r.canceled || !r.filePath ? null : r.filePath
}
