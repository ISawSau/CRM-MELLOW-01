import { app } from 'electron'
import { join } from 'node:path'

/** FFmpeg: junto a la app empaquetada (extraResources) o en vendor/ en desarrollo. */
export function ffmpegPath(): string {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return app.isPackaged
    ? join(process.resourcesPath, 'ffmpeg', exe)
    : // out/main/index.js → raíz del proyecto.
      join(__dirname, '..', '..', 'vendor', 'ffmpeg', exe)
}
