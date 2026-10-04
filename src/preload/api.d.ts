import type { IpcResult } from '../shared/errors'
import type { IpcChannel, IpcEvent, IpcEvents, IpcInput, IpcOutput } from '../shared/ipc'
import type { VideoInfo } from '../shared/tools'

export interface PreloadApi {
  /** Solo en la app de Android (D-101); en escritorio no existe. */
  readonly platform?: 'android'
  invoke<C extends IpcChannel>(channel: C, input?: IpcInput<C>): Promise<IpcResult<IpcOutput<C>>>
  on<E extends IpcEvent>(event: E, callback: (payload: IpcEvents[E]) => void): () => void
  openDroppedVideo(file: File): Promise<IpcResult<VideoInfo>>
}

declare global {
  interface Window {
    api: PreloadApi
  }
}
