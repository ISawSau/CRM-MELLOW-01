import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { AppError, errorMessage, type IpcResult } from '@shared/errors'
import { ipcSchemas, type IpcChannel, type IpcOutput, type IpcParsedInput } from '@shared/ipc'

export type IpcHandlers = {
  [C in IpcChannel]: (
    input: IpcParsedInput<C>,
    event: IpcMainInvokeEvent,
  ) => IpcOutput<C> | Promise<IpcOutput<C>>
}

/**
 * Registra todos los canales del contrato. Para cada llamada:
 *  1. comprueba que viene de nuestra ventana y de nuestra interfaz (no de otra página),
 *  2. valida la entrada con zod,
 *  3. devuelve { ok, data } o { ok: false, error } (nunca lanza al renderer).
 * Nunca se registran en consola los datos de entrada: pueden contener contraseñas.
 */
export function registerIpc(
  handlers: IpcHandlers,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
): void {
  for (const channel of Object.keys(ipcSchemas) as IpcChannel[]) {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event)) {
        return { ok: false, error: { code: 'UNKNOWN', message: errorMessage('UNKNOWN') } }
      }
      const parsed = ipcSchemas[channel].safeParse(raw)
      if (!parsed.success) {
        return {
          ok: false,
          error: { code: 'INVALID_INPUT', message: errorMessage('INVALID_INPUT') },
        }
      }
      try {
        const handler = handlers[channel] as (i: unknown, e: IpcMainInvokeEvent) => unknown
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
    })
  }
}
