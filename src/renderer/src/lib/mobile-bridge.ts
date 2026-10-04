import { errorMessage, type IpcResult } from '@shared/errors'
import { IPC_EVENTS } from '@shared/channels'
import { decodeWire, encodeWire } from '@shared/wire'
import type { PreloadApi } from '../../../preload/api'

/**
 * En Android no hay preload de Electron: la interfaz habla con el motor por el servidor local
 * de la app (src/mobile/server.ts, D-101). La cookie con el secreto de la sesión la pone el
 * lado nativo antes de cargar la página, así que aquí basta con pedir al mismo origen.
 */
export function installMobileBridge(): void {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  let source: EventSource | null = null
  const connect = () => {
    if (source) return
    source = new EventSource('/api/events')
    for (const name of IPC_EVENTS) {
      source.addEventListener(name, (e) => {
        const payload = decodeWire((e as MessageEvent<string>).data)
        for (const cb of listeners.get(name) ?? []) cb(payload)
      })
    }
  }
  const fail = (): IpcResult<never> => ({
    ok: false,
    error: { code: 'UNKNOWN', message: errorMessage('UNKNOWN') },
  })
  const api = {
    platform: 'android',
    async invoke(channel: string, input?: unknown) {
      try {
        const res = await fetch(`/api/${channel}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: input === undefined ? '' : encodeWire(input),
        })
        return res.ok ? decodeWire(await res.text()) : fail()
      } catch {
        return fail()
      }
    },
    on(event: string, callback: (payload: unknown) => void) {
      connect()
      let set = listeners.get(event)
      if (!set) listeners.set(event, (set = new Set()))
      set.add(callback)
      return () => set.delete(callback)
    },
    openDroppedVideo: () => Promise.resolve(fail()),
  }
  Object.defineProperty(window, 'api', { value: Object.freeze(api) as unknown as PreloadApi })
}
