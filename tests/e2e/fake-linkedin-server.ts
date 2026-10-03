import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { FakeLinkedIn } from '../unit/linkedin-fake'
import { ECB_XML } from '../unit/meta-fake'

/**
 * API de publicidad de LinkedIn y BCE falsos en un servidor local. La app apunta a ellos
 * con CRM_TEST_LINKEDIN_URL y CRM_TEST_ECB_URL, que solo se aceptan sin empaquetar.
 */
export async function startFakeLinkedIn(activeFrom: string): Promise<{
  fake: FakeLinkedIn
  env: Record<string, string>
  close: () => void
}> {
  let fake: FakeLinkedIn | null = null
  const server: Server = createServer((req, res) => {
    if (req.url?.startsWith('/ecb')) {
      res.writeHead(200, { 'Content-Type': 'application/xml' })
      res.end(ECB_XML)
      return
    }
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v
    const origin = new URL(fake!.base).origin
    void fake!
      .fetch(`${origin}${req.url}`, { method: req.method ?? 'GET', headers })
      .then(async (r) => {
        res.writeHead(r.status, Object.fromEntries(r.headers))
        res.end(Buffer.from(await r.arrayBuffer()))
      })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  fake = new FakeLinkedIn(`${base}/rest`, activeFrom)
  return {
    fake,
    env: { CRM_TEST_LINKEDIN_URL: `${base}/rest`, CRM_TEST_ECB_URL: `${base}/ecb` },
    close: () => server.close(),
  }
}
