import createHeicWorker from './heic-worker?nodeWorker'
import type { DecodedImage } from '@shared/tools'

/** Tiempo máximo para decodificar una foto (las de 48 Mpx tardan unos segundos). */
const TIMEOUT_MS = 60_000

/** Decodifica una foto HEIC/HEIF en un hilo de trabajo que se cierra al terminar. */
export function decodeHeic(data: Uint8Array): Promise<DecodedImage | null> {
  const worker = createHeicWorker({})
  return new Promise<DecodedImage | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), TIMEOUT_MS)
    worker.once('message', (r: { ok: boolean } & Partial<DecodedImage>) => {
      clearTimeout(timer)
      resolve(
        r.ok && r.width && r.height && r.data
          ? { width: r.width, height: r.height, data: r.data }
          : null,
      )
    })
    worker.once('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    worker.postMessage(data)
  }).finally(() => void worker.terminate())
}

/**
 * Autoprueba: el hilo arranca y carga libheif en la app instalada (dentro del asar). Con
 * bytes que no son una foto debe responder «no se puede» en lugar de fallar al cargar.
 */
export function heicWorkerLoads(): Promise<boolean> {
  const worker = createHeicWorker({})
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), TIMEOUT_MS)
    worker.once('message', (r: { ok: boolean }) => {
      clearTimeout(timer)
      resolve(r.ok === false)
    })
    worker.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    worker.postMessage(new Uint8Array([0, 1, 2, 3]))
  }).finally(() => void worker.terminate())
}
