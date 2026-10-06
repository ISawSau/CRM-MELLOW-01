import type { FetchLike } from '../../src/main/sync/remote'

/**
 * Google simulado para los tests (D-118): Drive v3 en memoria con las llamadas que usa la
 * app y, en `fake-google-server.ts`, un servidor HTTP con inicio de sesión y tokens.
 */

/** Google Drive v3 simulado en memoria con las llamadas que usa la app. */
export function fakeDrive(uploadOrigin = 'https://upload.fake') {
  const FOLDER = 'application/vnd.google-apps.folder'
  type F = { id: string; name: string; parents: string[]; mimeType: string; data: Buffer }
  const files = new Map<string, F>()
  const sessions = new Map<
    string,
    { target: string | null; meta: { name: string; parents: string[] }; data: Buffer[] }
  >()
  let n = 0
  const id = () => `id${++n}`
  const calls: string[] = []

  const http: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = (init.method ?? 'GET').toUpperCase()
    calls.push(`${method} ${url.pathname}`)
    const auth = new Headers(init.headers).get('authorization')
    const body = init.body ? Buffer.from(init.body as Uint8Array | string) : Buffer.alloc(0)
    const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(o), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      })

    if (url.origin === uploadOrigin && url.pathname.startsWith('/session/')) {
      const s = sessions.get(url.pathname)!
      s.data.push(body)
      const [, , total] = /bytes (\d+)-(\d+)\/(\d+)/
        .exec(new Headers(init.headers).get('content-range')!)!
        .slice(1)
      const got = s.data.reduce((a, b) => a + b.length, 0)
      if (got < Number(total)) return new Response(null, { status: 308 })
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
      return json({ id: s.target ?? `id${n}` })
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
      return json({ files: list.map((f) => ({ id: f.id, name: f.name })) })
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
      return f ? new Response(new Uint8Array(f.data)) : json({}, 404)
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
  return { http, files, calls }
}
