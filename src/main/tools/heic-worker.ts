import { parentPort } from 'node:worker_threads'
import decode from 'heic-decode'

/**
 * Decodifica una foto HEIC/HEIF (la de los iPhone) con libheif compilado a WebAssembly, en un
 * hilo aparte para no bloquear la app. Devuelve los píxeles RGBA; la interfaz hace el resto.
 */
parentPort?.on('message', (buffer: Uint8Array) => {
  decode({ buffer })
    .then(({ width, height, data }) => {
      const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      parentPort?.postMessage({ ok: true, width, height, data: pixels }, [
        pixels.buffer as ArrayBuffer,
      ])
    })
    .catch(() => parentPort?.postMessage({ ok: false }))
})
