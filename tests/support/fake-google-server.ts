import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fakeDrive } from './fake-drive'

/**
 * Google falso como servidor HTTP (D-118) para los tests de interfaz: la página de inicio
 * de sesión (que vuelve enseguida a la dirección local de la app, como tras «Continuar»),
 * el canje de códigos con PKCE y Drive v3. Se le cambia el comportamiento desde el test
 * para probar cada fallo.
 */
export interface FakeGoogle {
  url: string
  server: Server
  /** Lo que hace la página de Google: volver con el código o con «acceso denegado». */
  auth: 'ok' | 'deny'
  /** El canje: bien, cliente no válido, o cortar la conexión las próximas N veces. */
  token: 'ok' | 'invalid_client'
  dropTokenRequests: number
  /** Drive: la cuenta de siempre, otra cuenta (vacía) o la API sin activar en el proyecto. */
  drive: 'ok' | 'other-account' | 'disabled'
  /** Peticiones de canje recibidas (también las cortadas). */
  tokenRequests: number
  close(): Promise<void>
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {}
  response.headers.forEach((v, k) => (headers[k] = v))
  const body = Buffer.from(await response.arrayBuffer())
  res.writeHead(response.status, { ...headers, 'content-length': String(body.length) })
  res.end(body)
}

export function startFakeGoogle(): Promise<FakeGoogle> {
  /** Código → reto PKCE y dirección de vuelta con que se pidió. */
  const codes = new Map<string, { challenge: string; redirect: string }>()
  let base = ''
  let drives: { ok: ReturnType<typeof fakeDrive>; other: ReturnType<typeof fakeDrive> } | null =
    null
  const json = (res: ServerResponse, status: number, o: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(o))
  }

  const fake: FakeGoogle = {
    url: '',
    server: createServer((req, res) => {
      void handle(req, res).catch((e: unknown) => json(res, 500, { error: String(e) }))
    }),
    auth: 'ok',
    token: 'ok',
    dropTokenRequests: 0,
    drive: 'ok',
    tokenRequests: 0,
    close: () => new Promise((r) => fake.server.close(() => r())),
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', base)
    if (url.pathname === '/auth') {
      const redirect = url.searchParams.get('redirect_uri')!
      const state = url.searchParams.get('state')!
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(redirect))
        return json(res, 400, { error: 'redirect' })
      if (fake.auth === 'deny') {
        res.writeHead(302, { location: `${redirect}/?error=access_denied&state=${state}` })
        return void res.end()
      }
      const code = `4/${randomBytes(8).toString('hex')}`
      codes.set(code, { challenge: url.searchParams.get('code_challenge')!, redirect })
      const scope = encodeURIComponent(url.searchParams.get('scope') ?? '')
      res.writeHead(302, { location: `${redirect}/?state=${state}&code=${code}&scope=${scope}` })
      return void res.end()
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      fake.tokenRequests++
      const form = new URLSearchParams((await readBody(req)).toString())
      if (fake.dropTokenRequests > 0) {
        fake.dropTokenRequests--
        return void req.socket.destroy()
      }
      if (fake.token === 'invalid_client')
        return json(res, 401, { error: 'invalid_client', error_description: 'Unauthorized' })
      if (form.get('grant_type') === 'refresh_token')
        return json(res, 200, { access_token: 'tok', expires_in: 3600 })
      const issued = codes.get(form.get('code') ?? '')
      const verifier = form.get('code_verifier') ?? ''
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      if (!issued || issued.challenge !== challenge || issued.redirect !== form.get('redirect_uri'))
        return json(res, 400, { error: 'invalid_grant', error_description: 'Bad Request' })
      codes.delete(form.get('code')!)
      return json(res, 200, { access_token: 'tok', refresh_token: 'renovar', expires_in: 3600 })
    }
    if (
      url.pathname.startsWith('/drive/') ||
      url.pathname.startsWith('/upload/') ||
      url.pathname.startsWith('/session/')
    ) {
      if (fake.drive === 'disabled')
        return json(res, 403, {
          error: {
            code: 403,
            message: 'Google Drive API has not been used in project 123 before or it is disabled.',
            status: 'PERMISSION_DENIED',
            details: [{ reason: 'SERVICE_DISABLED' }],
          },
        })
      const drive = fake.drive === 'other-account' ? drives!.other : drives!.ok
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v
      return send(
        res,
        await drive.http(`${base}${url.pathname}${url.search}`, {
          method: req.method ?? 'GET',
          headers,
          ...(body ? { body: new Uint8Array(body) } : {}),
        }),
      )
    }
    json(res, 404, { error: 'no simulado' })
  }

  return new Promise((resolve) =>
    fake.server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`
      fake.url = base
      drives = { ok: fakeDrive(base), other: fakeDrive(base) }
      resolve(fake)
    }),
  )
}
