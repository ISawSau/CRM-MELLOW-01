import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS } from '../shared/channels'

/**
 * Puente mínimo entre la interfaz y el proceso principal. No se expone ipcRenderer
 * ni ningún objeto de Electron: solo `invoke` sobre la lista blanca de canales y
 * suscripción a la lista blanca de eventos.
 */
const channels = new Set<string>(IPC_CHANNELS)
const events = new Set<string>(IPC_EVENTS)

const api = {
  invoke(channel: string, input?: unknown): Promise<unknown> {
    if (!channels.has(channel))
      return Promise.reject(new Error(`Canal IPC no permitido: ${channel}`))
    return ipcRenderer.invoke(channel, input)
  },
  on(event: string, callback: (payload: unknown) => void): () => void {
    if (!events.has(event)) throw new Error(`Evento IPC no permitido: ${event}`)
    const listener = (_e: IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  },
  /**
   * Abre un vídeo soltado sobre la ventana. La ruta sale del propio `File` (solo existe
   * para archivos que el usuario ha arrastrado o elegido), nunca de la interfaz.
   */
  openDroppedVideo(file: unknown): Promise<unknown> {
    if (!(file instanceof File)) return Promise.reject(new Error('No es un archivo'))
    const path = webUtils.getPathForFile(file)
    if (!path) return Promise.reject(new Error('El archivo no está en el disco'))
    return ipcRenderer.invoke('tools:openDropped', path)
  },
}

contextBridge.exposeInMainWorld('api', Object.freeze(api))
