import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { AppError, ERROR_MESSAGES, type IpcResult } from '@shared/errors'
import type { VideoInfo } from '@shared/tools'
import type { ToolsService } from '../tools/tools-service'

/**
 * Vídeo soltado sobre la ventana. Este canal no está en la lista blanca del preload:
 * solo lo usa la función del preload que saca la ruta de un `File` real con
 * `webUtils.getPathForFile`, así que la interfaz no puede pedir rutas arbitrarias.
 */
export const DROP_CHANNEL = 'tools:openDropped'

export function registerDropHandler(
  tools: ToolsService,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
): void {
  ipcMain.handle(DROP_CHANNEL, async (event, raw: unknown): Promise<IpcResult<VideoInfo>> => {
    const fail = (code: 'UNKNOWN' | 'INVALID_INPUT') => ({
      ok: false as const,
      error: { code, message: ERROR_MESSAGES[code] },
    })
    if (!isTrustedSender(event)) return fail('UNKNOWN')
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096)
      return fail('INVALID_INPUT')
    try {
      return { ok: true, data: await tools.openVideo(raw) }
    } catch (e) {
      if (e instanceof AppError) return { ok: false, error: { code: e.code, message: e.message } }
      return fail('UNKNOWN')
    }
  })
}
