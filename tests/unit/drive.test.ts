import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { connectGoogle, refreshAccess } from '../../src/main/sync/google-auth'
import { DriveRemote, type FetchLike } from '../../src/main/sync/remote'
import { tempDir } from './helpers'

/** Google Drive v3 simulado en memoria con las llamadas que usa la app. */
function fakeDrive() {
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

    if (url.host === 'upload.fake') {
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
      return json({}, 200, { location: `https://upload.fake${path}` })
    }
    return json({ error: `no simulado: ${method} ${url}` }, 500)
  }
  return { http, files, calls }
}

describe('Google Drive (simulado según la API v3)', () => {
  it('crea su carpeta, sube, sobrescribe, lista, descarga y borra', async () => {
    const drive = fakeDrive()
    const r = new DriveRemote('CRM Mellow · abcd1234', async () => 'tok', drive.http)
    const dir = tempDir()
    const small = join(dir, 'pequeño.bin')
    writeFileSync(small, 'contenido cifrado')
    await r.put('crm.db', small)
    await r.put('files/aa.bin', small)
    expect(await r.list('')).toEqual(expect.arrayContaining(['crm.db', 'files']))
    expect(await r.list('files')).toEqual(['aa.bin'])
    await r.writeText('sync.json', '{"generation":1}')
    await r.writeText('sync.json', '{"generation":2}')
    expect(await r.readText('sync.json')).toBe('{"generation":2}')
    expect([...drive.files.values()].filter((f) => f.name === 'sync.json')).toHaveLength(1)

    // Más de 5 MB: subida reanudable en trozos.
    const big = join(dir, 'grande.bin')
    const data = randomBytes(9 * 1024 * 1024 + 7)
    writeFileSync(big, data)
    await r.put('files/bb.bin', big)
    const back = join(dir, 'vuelta.bin')
    expect(await r.get('files/bb.bin', back)).toBe(true)
    expect(readFileSync(back).equals(data)).toBe(true)
    // Sobrescribir uno grande también va por la reanudable (PATCH).
    await r.put('files/bb.bin', small)
    await r.get('files/bb.bin', back)
    expect(readFileSync(back).toString()).toBe('contenido cifrado')

    expect(await r.get('no-existe.bin', back)).toBe(false)
    expect(await r.readText('nada.json')).toBeNull()
    await r.remove('files/aa.bin')
    expect(await r.list('files')).toEqual(['bb.bin'])
    // Nombres con comillas no rompen la consulta.
    await r.writeText("backups/o'brien/x.json", '1')
    expect(await r.readText("backups/o'brien/x.json")).toBe('1')
    await expect(r.put('../fuera', small)).rejects.toThrow()
  })
})

describe('conexión con Google (OAuth para escritorio)', () => {
  it('usa bucle local, PKCE S256 y state, y canjea el código por tokens', async () => {
    let tokenBody: URLSearchParams | null = null
    const http: FetchLike = async (input, init) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') {
        tokenBody = new URLSearchParams(String(init?.body))
        return new Response(
          JSON.stringify({ access_token: 'acceso', refresh_token: 'renovar', expires_in: 3600 }),
          { status: 200 },
        )
      }
      return fetch(input, init)
    }
    let authUrl: URL | null = null
    const tokens = await connectGoogle(
      { clientId: 'cliente.apps.googleusercontent.com', clientSecret: 'secreto' },
      (u) => {
        authUrl = new URL(u)
        // El «navegador» vuelve a la dirección local con el código.
        const redirect = authUrl.searchParams.get('redirect_uri')!
        const state = authUrl.searchParams.get('state')!
        void fetch(`${redirect}/?code=codigo123&state=${state}`)
      },
      http,
    )
    expect(tokens).toMatchObject({ accessToken: 'acceso', refreshToken: 'renovar' })
    const u = authUrl!
    expect(`${u.origin}${u.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const body = tokenBody!
    expect(body.get('code')).toBe('codigo123')
    // El verificador PKCE corresponde al reto enviado.
    const challenge = createHash('sha256').update(body.get('code_verifier')!).digest('base64url')
    expect(challenge).toBe(u.searchParams.get('code_challenge'))
  })

  it('rechaza una respuesta con otro state y explica un acceso retirado', async () => {
    await expect(
      connectGoogle({ clientId: 'c', clientSecret: '' }, (u) => {
        const redirect = new URL(u).searchParams.get('redirect_uri')!
        void fetch(`${redirect}/?code=x&state=otro`)
      }),
    ).rejects.toThrow(/no válida/)
    const http: FetchLike = async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    await expect(refreshAccess({ clientId: 'c', clientSecret: '' }, 'r', http)).rejects.toThrow(
      /vuelve a conectar/,
    )
  })
})
