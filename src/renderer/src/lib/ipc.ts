import type { IpcError } from '@shared/errors'
import type { IpcChannel, IpcEvent, IpcEvents, IpcInput, IpcOutput } from '@shared/ipc'

export class IpcCallError extends Error {
  readonly code: IpcError['code']
  readonly details: IpcError['details']

  constructor(error: IpcError) {
    super(error.message)
    this.name = 'IpcCallError'
    this.code = error.code
    this.details = error.details
  }
}

/** Llama a un canal del proceso principal; lanza IpcCallError si devuelve error. */
export async function call<C extends IpcChannel>(
  channel: C,
  ...input: IpcInput<C> extends void ? [] : [IpcInput<C>]
): Promise<IpcOutput<C>> {
  const result = await window.api.invoke(channel, input[0])
  if (!result.ok) throw new IpcCallError(result.error)
  return result.data
}

export function subscribe<E extends IpcEvent>(
  event: E,
  callback: (payload: IpcEvents[E]) => void,
): () => void {
  return window.api.on(event, callback)
}
