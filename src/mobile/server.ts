import { trace } from './trace'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, isAbsolute, join, normalize, relative } from 'node:path'
import { Readable } from 'node:stream'
import { errorMessage } from '@shared/errors'
import { ipcSchemas, type IpcChannel, type IpcEvent, type IpcEvents } from '@shared/ipc'
import { decodeWire, encodeWire } from '@shared/wire'
import type { DataService } from '../main/data/data-service'
import { vaultFileResponse } from '../main/files/vault-protocol'
import { runIpc, type IpcHandlers } from '../main/ipc/run'

/**
 * Servidor local de la app de Android (D-101). Solo escucha en 127.0.0.1 y solo atiende a
 * quien trae la cookie con el secreto de esta sesión: la WebView de la app (que la recibe
 * del lado nativo antes de cargar la interfaz) y el propio lado nativo. Otras apps del
 * móvil pueden llegar al puerto, pero no tienen el secreto.
 *
 *   /                  la interfaz (archivos de out/mobile/www)
 *   /api/<canal>       una llamada al motor, como el IPC de Electron (POST, JSON con bytes)
 *   /api/events        eventos del motor a la interfaz (Server-Sent Events)
 *   /vault/file/<id>   archivos de la bóveda descifrados al vuelo (también /vault/thumb/<id>)
 *   /native/events     peticiones del motor al lado nativo (guardar, portapapeles, enlaces)
 *   /native/reply      respuesta del lado nativo a una de esas peticiones
 *   /native/lock       pantalla apagada: se sube lo pendiente y se bloquea
 *   /native/background la app pasa a segundo plano: se sube lo pendiente
 */

export const COOKIE = 'crm'
/** Subidas desde el móvil: base64 en JSON, así que se limita más que en escritorio. */
export const MAX_BODY_BYTES = 300 * 1024 * 1024
const NATIVE_TIMEOUT_MS = 10 * 60_000
const KEEPALIVE_MS = 25_000

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript; charset=utf-8',
}

/** CSP de la interfaz: como en escritorio, y los archivos de la bóveda desde el mismo origen. */
export const MOBILE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "worker-src 'self' blob:",
].join('; ')

export interface NativeRequest {
  kind: 'save' | 'clipboard' | 'open' | 'notify' | 'busy'
  [key: string]: unknown
}

export interface MobileServerOptions {
  handlers: IpcHandlers
  getData: () => DataService | null
  /** Carpeta con la interfaz compilada. */
  staticDir: string
  /** Secreto de esta sesión (lo genera el lado nativo). */
  token: string
  /** 0 = cualquiera libre (tests). */
  port: number
  /** El lado nativo avisa: pantalla apagada (`lock`) o la app pasa a segundo plano. */
  onNative: (what: 'lock' | 'background') => void
}

export interface MobileServer {
  server: Server
  port: number
  emit<E extends IpcEvent>(event: E, payload: IpcEvents[E]): void
  /** Petición al lado nativo; responde lo que devuelva (o null si no hay nadie escuchando). */
  native(request: NativeRequest): Promise<unknown>
  /** El lado nativo escucha (la app de Android está en marcha). */
  nativeConnected(): boolean
  close(): Promise<void>
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

async function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const CHANNELS = new Set<string>(Object.keys(ipcSchemas))

export function startMobileServer(o: MobileServerOptions): Promise<MobileServer> {
  const root = normalize(o.staticDir)
  const uiClients = new Set<ServerResponse>()
  const nativeClients = new Set<ServerResponse>()
  const pending = new Map<string, (value: unknown) => void>()
  let port = o.port

  const send = (res: ServerResponse, status: number, body: string, type: string) => {
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(body)
  }
  const notFound = (res: ServerResponse) => send(res, 404, 'No encontrado', 'text/plain')

  const openStream = (res: ServerResponse, clients: Set<ServerResponse>) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    })
    res.write(': hola\n\n')
    clients.add(res)
    const ping = setInterval(() => res.write(': ping\n\n'), KEEPALIVE_MS)
    res.on('close', () => {
      clearInterval(ping)
      clients.delete(res)
    })
  }
  const broadcast = (clients: Set<ServerResponse>, event: string, payload: unknown) => {
    const data = encodeWire(payload)
    for (const res of clients) res.write(`event: ${event}\ndata: ${data}\n\n`)
  }

  const serveStatic = async (pathname: string, res: ServerResponse) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      return notFound(res)
    }
    const file = normalize(join(root, decoded === '/' ? 'index.html' : decoded))
    const rel = relative(root, file)
    if (rel.startsWith('..') || isAbsolute(rel)) return notFound(res)
    let body: Buffer
    try {
      body = await readFile(file)
    } catch {
      return notFound(res)
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Security-Policy': MOBILE_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
    })
    res.end(body)
  }

  const serveVault = async (req: IncomingMessage, res: ServerResponse, path: string) => {
    const m = /^\/vault\/(file|thumb)\/([^/]+)$/.exec(path)
    if (!m) return notFound(res)
    const response = vaultFileResponse(
      o.getData(),
      m[1] === 'thumb' ? 'thumbs' : 'files',
      m[2]!,
      req.headers.range ?? null,
    )
    const headers: Record<string, string> = {}
    response.headers.forEach((v, k) => (headers[k] = v))
    res.writeHead(response.status, headers)
    if (!response.body) return void res.end()
    const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
    res.on('close', () => body.destroy())
    body.pipe(res)
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    // Solo nuestra dirección (contra el «DNS rebinding») y solo con el secreto de la sesión.
    if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 421, '', 'text/plain')
    const secret = cookieValue(req.headers.cookie, COOKIE)
    if (!secret || !sameSecret(secret, o.token)) return send(res, 403, '', 'text/plain')
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    const path = url.pathname
    const origin = req.headers.origin
    if (origin !== undefined && origin !== `http://127.0.0.1:${port}`)
      return send(res, 403, '', 'text/plain')

    if (req.method === 'GET') {
      if (path === '/api/events') {
        // Señal de que la interfaz ha cargado y habla con el motor (la mira la prueba del CI).
        if (uiClients.size === 0) trace('interfaz conectada')
        return openStream(res, uiClients)
      }
      if (path === '/native/events') return openStream(res, nativeClients)
      if (path.startsWith('/vault/')) return serveVault(req, res, path)
      if (path.startsWith('/api/') || path.startsWith('/native/')) return notFound(res)
      // La WebView pide el icono por su cuenta; la app no tiene (el icono es el del sistema).
      if (path === '/favicon.ico') return send(res, 204, '', 'image/x-icon')
      return serveStatic(path, res)
    }
    if (req.method !== 'POST') return send(res, 405, '', 'text/plain')
    if (!(req.headers['content-type'] ?? '').startsWith('application/json'))
      return send(res, 415, '', 'text/plain')

    if (path === '/native/lock' || path === '/native/background') {
      o.onNative(path === '/native/lock' ? 'lock' : 'background')
      return send(res, 200, '{}', 'application/json')
    }
    if (path === '/native/reply') {
      const body = await readBody(req, 1024 * 1024)
      const parsed = body ? (decodeWire(body) as { id?: unknown; value?: unknown }) : null
      const done = typeof parsed?.id === 'string' ? pending.get(parsed.id) : undefined
      if (done) done(parsed?.value ?? null)
      return send(res, 200, '{}', 'application/json')
    }
    const m = /^\/api\/([a-zA-Z]+:[a-zA-Z]+)$/.exec(path)
    if (!m || !CHANNELS.has(m[1]!)) return notFound(res)
    const body = await readBody(req, MAX_BODY_BYTES)
    if (body === null) {
      return send(
        res,
        200,
        encodeWire({
          ok: false,
          error: { code: 'INVALID_INPUT', message: errorMessage('INVALID_INPUT') },
        }),
        'application/json',
      )
    }
    let input: unknown
    try {
      input = body === '' ? undefined : decodeWire(body)
    } catch {
      input = Symbol('no válido')
    }
    const result = await runIpc(o.handlers, m[1] as IpcChannel, input)
    send(res, 200, encodeWire(result), 'application/json')
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, '', 'text/plain')
      else res.end()
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(o.port, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      resolve({
        server,
        port,
        emit: (event, payload) => broadcast(uiClients, event, payload),
        native(request) {
          if (nativeClients.size === 0) return Promise.resolve(null)
          const id = randomUUID()
          return new Promise((done) => {
            const timer = setTimeout(() => {
              pending.delete(id)
              done(null)
            }, NATIVE_TIMEOUT_MS)
            pending.set(id, (value) => {
              clearTimeout(timer)
              pending.delete(id)
              done(value)
            })
            broadcast(nativeClients, 'request', { id, ...request })
          })
        },
        nativeConnected: () => nativeClients.size > 0,
        close: () =>
          new Promise((r) => {
            for (const c of [...uiClients, ...nativeClients]) c.end()
            server.close(() => r())
          }),
      })
    })
  })
}
