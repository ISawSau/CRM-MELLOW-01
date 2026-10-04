import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { errorMessage, type IpcResult } from '@shared/errors'
import { ipcSchemas, type IpcChannel } from '@shared/ipc'
import { runIpc, type IpcHandlers } from './run'

export type { IpcHandlers } from './run'

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
    ipcMain.handle(channel, (event, raw: unknown): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event)) {
        return Promise.resolve({
          ok: false,
          error: { code: 'UNKNOWN', message: errorMessage('UNKNOWN') },
        })
      }
      return runIpc(handlers, channel, raw, event)
    })
  }
}
