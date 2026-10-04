import type { Session } from 'electron'
import { isPreviewImage, isVideo } from '@shared/files'
import type { DataService } from '../data/data-service'
import { isFileId } from './file-store'

/**
 * `vault://file/<id>` y `vault://thumb/<id>`: la interfaz ve los archivos de la bóveda
 * descifrados al vuelo, sin escribir nunca nada en claro en el disco. Admite
 * peticiones por rangos (avanzar en un vídeo). Solo responde con la bóveda abierta.
 */
export const VAULT_SCHEME = 'vault'

/** Tipos que se sirven tal cual; el resto como binario (nunca se interpretan). */
function servedType(mime: string): string {
  if (isPreviewImage(mime) || isVideo(mime) || mime.startsWith('audio/')) return mime
  return 'application/octet-stream'
}

export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid'
  let start: number
  let end: number
  if (m[1] === '') {
    // Sufijo: los últimos N bytes.
    const n = Number(m[2])
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size)
    return 'invalid'
  return { start, end }
}

/**
 * Respuesta con un archivo de la bóveda descifrado al vuelo. La usan el protocolo
 * `vault://` del escritorio y el servidor local de Android (`/vault/file/<id>`, D-101).
 */
export function vaultFileResponse(
  data: DataService | null,
  kind: 'files' | 'thumbs' | null,
  id: string,
  rangeHeader: string | null,
  extraHeaders: Record<string, string> = {},
): Response {
  const notFound = () => new Response('No encontrado', { status: 404 })
  if (!data || !kind || !isFileId(id)) return notFound()
  const info = data.fileInfo(id)
  if (!info || !data.files.exists(id, kind)) return notFound()

  const size = data.files.size(id, kind)
  const headers: Record<string, string> = {
    'Content-Type': kind === 'thumbs' ? 'image/jpeg' : servedType(info.mime),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    ...extraHeaders,
  }
  const range = parseRange(rangeHeader, size)
  if (range === 'invalid')
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` },
    })
  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  const chunks = size === 0 ? null : data.files.readRange(id, start, end, kind)
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        const next = chunks?.next()
        if (!next || next.done) controller.close()
        else controller.enqueue(new Uint8Array(next.value))
      } catch (e) {
        controller.error(e)
      }
    },
    cancel() {
      chunks?.return(undefined)
    },
  })
  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1)
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  return new Response(body, { status: range ? 206 : 200, headers })
}

export function registerVaultProtocol(
  ses: Session,
  getData: () => DataService | null,
  allowedOrigin: string,
): void {
  ses.protocol.handle(VAULT_SCHEME, (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('No encontrado', { status: 404 })
    }
    const kind = url.host === 'thumb' ? 'thumbs' : url.host === 'file' ? 'files' : null
    return vaultFileResponse(
      getData(),
      kind,
      url.pathname.replace(/^\//, ''),
      request.headers.get('range'),
      {
        'Access-Control-Allow-Origin': allowedOrigin,
      },
    )
  })
}
