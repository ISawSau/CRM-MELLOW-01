import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { FakeMeta } from '../unit/meta-fake'

/**
 * API de Meta y BCE falsos en un servidor local. La app apunta a ellos con
 * CRM_TEST_GRAPH_URL y CRM_TEST_ECB_URL, que solo se aceptan sin empaquetar.
 */
export async function startFakeMeta(): Promise<{
  fake: FakeMeta
  env: Record<string, string>
  close: () => void
}> {
  let fake: FakeMeta | null = null
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
          ...(body ? { body: new URLSearchParams(body) } : {}),
        })
        .then(async (r) => {
          res.writeHead(r.status, Object.fromEntries(r.headers))
          res.end(Buffer.from(await r.arrayBuffer()))
        })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  fake = new FakeMeta({}, base)
  return {
    fake,
    env: {
      CRM_TEST_GRAPH_URL: base,
      CRM_TEST_ECB_URL: `${base}/ecb`,
      CRM_TEST_META_POLL_MS: '10',
    },
    close: () => server.close(),
  }
}
