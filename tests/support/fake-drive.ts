import type { FetchLike } from '../../src/main/sync/remote'

/**
 * Google simulado para los tests (D-118): Drive v3 en memoria con las llamadas que usa la
 * app y, en `fake-google-server.ts`, un servidor HTTP con inicio de sesión y tokens.
 */

/**
 * Fallo provocado en la próxima llamada que encaje (D-124): sin red, Drive que no responde,
 * una respuesta que se pierde tras llegar la petición, una descarga cortada a medias o un
 * código de error de Google.
 */
export interface DriveFault {
  when: (method: string, url: URL) => boolean
  kind: 'network' | 'hang' | 'lost' | 'cut' | number
  /** Cuántas veces (1 si no se dice). */
  times?: number
}

/** Google Drive v3 simulado en memoria con las llamadas que usa la app. */
export function fakeDrive(uploadOrigin = 'https://upload.fake') {
  const FOLDER = 'application/vnd.google-apps.folder'
  type F = { id: string; name: string; parents: string[]; mimeType: string; data: Buffer }
  const files = new Map<string, F>()
  const sessions = new Map<
    string,
    {
      target: string | null
      meta: { name: string; parents: string[] }
      data: Buffer[]
      done?: string
    }
  >()
  let n = 0
  const id = () => `id${++n}`
  const calls: string[] = []
  const faults: DriveFault[] = []

  const http: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = (init.method ?? 'GET').toUpperCase()
    const i = faults.findIndex((f) => f.when(method, url))
    const fault = i >= 0 ? faults[i]! : null
    if (fault && (fault.times = (fault.times ?? 1) - 1) <= 0) faults.splice(i, 1)
    if (fault?.kind === 'network') {
      calls.push(`${method} ${url.pathname} ✗`)
      throw new TypeError('fetch failed')
    }
    if (fault?.kind === 'hang') {
      calls.push(`${method} ${url.pathname} …`)
      return new Promise<Response>((_, reject) => {
        const signal = init.signal
        signal?.addEventListener('abort', () =>
          reject(signal.reason ?? new DOMException('aborted', 'AbortError')),
        )
      })
    }
    if (typeof fault?.kind === 'number') {
      calls.push(`${method} ${url.pathname} ${fault.kind}`)
      return new Response(JSON.stringify({ error: { errors: [{ reason: 'backendError' }] } }), {
        status: fault.kind,
      })
    }
    const res = await handle(url, method, init)
    if (fault?.kind === 'lost') throw new TypeError('fetch failed')
    if (fault?.kind === 'cut' && res.body) {
      // La mitad del cuerpo y luego la conexión se cae.
      const data = Buffer.from(await res.arrayBuffer())
      const half = data.subarray(0, Math.floor(data.length / 2))
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(half))
            setTimeout(() => c.error(new TypeError('terminated')), 5)
          },
        }),
        { status: res.status, headers: res.headers },
      )
    }
    return res
  }

  const handle = async (url: URL, method: string, init: RequestInit): Promise<Response> => {
    calls.push(`${method} ${url.pathname}`)
    const auth = new Headers(init.headers).get('authorization')
    const body = init.body ? Buffer.from(init.body as Uint8Array | string) : Buffer.alloc(0)
    const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(o), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      })

    if (url.origin === uploadOrigin && url.pathname.startsWith('/session/')) {
      const s = sessions.get(url.pathname)
      if (!s) return json({ error: 'sesión caducada' }, 404)
      const range = new Headers(init.headers).get('content-range')!
      const received = () => s.data.reduce((a, b) => a + b.length, 0)
      const incomplete = () => {
        const got = received()
        return new Response(null, {
          status: 308,
          headers: got > 0 ? { range: `bytes=0-${got - 1}` } : {},
        })
      }
      const status = /^bytes \*\/(\d+)$/.exec(range)
      if (status) {
        if (s.done) return json({ id: s.done })
        return incomplete()
      }
      const [start, , total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(range)!.slice(1).map(Number)
      const got = received()
      // Como Drive: lo que ya tenía no se vuelve a guardar; un hueco es un error.
      if (start! > got) return json({ error: 'hueco en la subida' }, 400)
      s.data.push(body.subarray(got - start!))
      if (received() < total!) return incomplete()
      const data = Buffer.concat(s.data)
      if (s.target) files.get(s.target)!.data = data
      else
        files.set(id(), {
          id: `id${n}`,
          name: s.meta.name,
          parents: s.meta.parents,
          mimeType: 'application/octet-stream',
          data,
        })
      s.done = s.target ?? `id${n}`
      return json({ id: s.done })
    }
    if (auth !== 'Bearer tok') return json({ error: 'unauthorized' }, 401)

    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q')!
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'")
      const parent = /'([^']+)' in parents/.exec(q)?.[1]
      const wantFolder = q.includes(`mimeType = '${FOLDER}'`)
      const noFolder = q.includes(`mimeType != '${FOLDER}'`)
      const list = [...files.values()].filter(
        (f) =>
          (name === undefined || f.name === name) &&
          (parent === undefined || f.parents.includes(parent === 'root' ? 'root' : parent)) &&
          (!wantFolder || f.mimeType === FOLDER) &&
          (!noFolder || f.mimeType !== FOLDER),
      )
      // Como Drive: `size` como texto y solo en los archivos (no en las carpetas).
      return json({
        files: list.map((f) => ({
          id: f.id,
          name: f.name,
          ...(f.mimeType === FOLDER ? {} : { size: String(f.data.length) }),
        })),
      })
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(body.toString()) as {
        name: string
        mimeType: string
        parents: string[]
      }
      const f = {
        id: id(),
        name: meta.name,
        parents: meta.parents.length ? meta.parents : ['root'],
        mimeType: meta.mimeType,
        data: Buffer.alloc(0),
      }
      files.set(f.id, f)
      return json({ id: f.id })
    }
    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)
    if (fileMatch && method === 'GET' && url.searchParams.get('alt') === 'media') {
      const f = files.get(fileMatch[1]!)
      if (!f) return json({}, 404)
      const from = /^bytes=(\d+)-$/.exec(new Headers(init.headers).get('range') ?? '')
      if (from)
        return new Response(new Uint8Array(f.data.subarray(Number(from[1]))), {
          status: 206,
          headers: { 'content-length': String(f.data.length - Number(from[1])) },
        })
      return new Response(new Uint8Array(f.data), {
        headers: { 'content-length': String(f.data.length) },
      })
    }
    if (fileMatch && method === 'DELETE') {
      files.delete(fileMatch[1]!)
      return new Response(null, { status: 204 })
    }
    const type = url.searchParams.get('uploadType')
    const up = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(url.pathname)
    if (up && type === 'media' && method === 'PATCH') {
      files.get(up[1]!)!.data = body
      return json({ id: up[1] })
    }
    if (up && type === 'multipart' && method === 'POST') {
      const ct = new Headers(init.headers).get('content-type')!
      const boundary = /boundary=(.+)$/.exec(ct)![1]!
      const parts = body.toString('latin1').split(`--${boundary}`)
      const meta = JSON.parse(parts[1]!.split('\r\n\r\n')[1]!.trim()) as {
        name: string
        parents: string[]
      }
      const raw = parts[2]!.slice(parts[2]!.indexOf('\r\n\r\n') + 4, -2)
      const f = {
        id: id(),
        name: meta.name,
        parents: meta.parents,
        mimeType: 'application/octet-stream',
        data: Buffer.from(raw, 'latin1'),
      }
      files.set(f.id, f)
      return json({ id: f.id })
    }
    if (up && type === 'resumable') {
      const meta = JSON.parse(body.toString() || '{}') as { name: string; parents: string[] }
      const path = `/session/${++n}`
      sessions.set(path, { target: up[1] ?? null, meta, data: [] })
      return json({}, 200, { location: `${uploadOrigin}${path}` })
    }
    return json({ error: `no simulado: ${method} ${url}` }, 500)
  }
  return { http, files, calls, faults, sessions }
}
