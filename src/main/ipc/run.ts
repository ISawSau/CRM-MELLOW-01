import type { IpcMainInvokeEvent } from 'electron'
import { AppError, errorMessage, type IpcResult } from '@shared/errors'
import { ipcSchemas, type IpcChannel, type IpcOutput, type IpcParsedInput } from '@shared/ipc'

export type IpcHandlers = {
  [C in IpcChannel]: (
    input: IpcParsedInput<C>,
    event?: IpcMainInvokeEvent,
  ) => IpcOutput<C> | Promise<IpcOutput<C>>
}

/**
 * Una llamada al motor: valida la entrada con zod y devuelve { ok, data } o
 * { ok: false, error } (nunca lanza). La usan el IPC de Electron y el servidor local de
 * Android (D-101).
 */
export async function runIpc(
  handlers: IpcHandlers,
  channel: IpcChannel,
  raw: unknown,
  event?: IpcMainInvokeEvent,
): Promise<IpcResult<unknown>> {
  const parsed = ipcSchemas[channel].safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: errorMessage('INVALID_INPUT') },
    }
  }
  try {
    const handler = handlers[channel] as (i: unknown, e?: IpcMainInvokeEvent) => unknown
    return { ok: true, data: await handler(parsed.data, event) }
  } catch (e) {
    if (e instanceof AppError) {
      return {
        ok: false,
        error: {
          code: e.code,
          message: e.message,
          ...(e.details ? { details: e.details } : {}),
        },
      }
    }
    console.error(`[ipc] ${channel}:`, e instanceof Error ? e.message : 'error desconocido')
    return { ok: false, error: { code: 'UNKNOWN', message: errorMessage('UNKNOWN') } }
  }
}
