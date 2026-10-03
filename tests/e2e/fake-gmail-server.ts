import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ElectronApplication } from '@playwright/test'
import { sampleGmail, type FakeGmail } from '../unit/gmail-fake'

/**
 * Google falso (token, revoke y API de Gmail) en un servidor local. La app apunta a él
 * con CRM_TEST_GOOGLE_URL, que solo se acepta sin empaquetar.
 */
export async function startFakeGmail(): Promise<{
  fake: FakeGmail
  env: Record<string, string>
  close: () => void
}> {
  let fake: FakeGmail | null = null
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v
      void fake!
        .fetch(`${fake!.base}${req.url}`, {
          method: req.method ?? 'GET',
          headers,
          ...(body ? { body } : {}),
        })
        .then(async (r) => {
          res.writeHead(r.status, Object.fromEntries(r.headers))
          res.end(Buffer.from(await r.arrayBuffer()))
        })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  fake = sampleGmail(base)
  return { fake, env: { CRM_TEST_GOOGLE_URL: base }, close: () => server.close() }
}

/** El «navegador del sistema» acepta el permiso y vuelve a la app con un código. */
export async function stubGoogleConsent(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    shell.openExternal = (async (raw: string) => {
      const u = new URL(raw)
      const redirect = u.searchParams.get('redirect_uri')
      const state = u.searchParams.get('state')
      if (redirect && state) await fetch(`${redirect}/?code=codigo&state=${state}`)
    }) as never
  })
}
