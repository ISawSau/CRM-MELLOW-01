import type { IpcResult } from '../shared/errors'
import type { IpcChannel, IpcEvent, IpcEvents, IpcInput, IpcOutput } from '../shared/ipc'

export interface PreloadApi {
  invoke<C extends IpcChannel>(channel: C, input?: IpcInput<C>): Promise<IpcResult<IpcOutput<C>>>
  on<E extends IpcEvent>(event: E, callback: (payload: IpcEvents[E]) => void): () => void
}

declare global {
  interface Window {
    api: PreloadApi
  }
}
