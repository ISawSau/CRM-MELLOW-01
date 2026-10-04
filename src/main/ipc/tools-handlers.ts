import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { AppError, ERROR_MESSAGES, type IpcResult } from '@shared/errors'
import type { VideoInfo } from '@shared/tools'
import type { ReportService } from '../reports/report-service'
import type { ToolsService } from '../tools/tools-service'
import type { IpcHandlers } from './register'

type ToolsChannel = Extract<keyof IpcHandlers, `tools:${string}` | `reports:${string}`>
export type ToolsHandlers = Pick<IpcHandlers, ToolsChannel>

/** Herramientas de archivos (SPEC §7.11) e informes en PDF (SPEC §7.10). */
export function createToolsHandlers(tools: ToolsService, reports: ReportService): ToolsHandlers {
  return {
    'reports:templates': () => reports.templates(),
    'reports:setTemplates': ({ templates }) => reports.setTemplates(templates),
    'reports:generate': (input) => reports.generate(input),
    'tools:status': () => tools.status(),
    'tools:save': (input) => tools.saveResult(input),
    'tools:convertVideo': (job) => tools.convertVideo(job),
    'tools:cancel': ({ token }) => tools.cancel(token),
    'tools:decodeHeic': ({ data }) => tools.decodeHeic(data),
  }
}

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
