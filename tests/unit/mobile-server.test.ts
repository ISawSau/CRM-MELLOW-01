import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodeWire, encodeWire } from '@shared/wire'
import type { IpcHandlers } from '../../src/main/ipc/run'
import { COOKIE, startMobileServer, type MobileServer } from '../../src/mobile/server'

const TOKEN = 'a'.repeat(64)

describe('wire', () => {
  it('lleva los bytes (también Buffer) de ida y vuelta', () => {
    const value = { a: new Uint8Array([1, 2, 255]), b: Buffer.from('hola'), c: [1, 'x', null] }
    const back = decodeWire(encodeWire(value)) as Record<string, unknown>
    expect(back['a']).toEqual(new Uint8Array([1, 2, 255]))
    expect(Buffer.from(back['b'] as Uint8Array).toString()).toBe('hola')
    expect(back['c']).toEqual([1, 'x', null])
  })
})

describe('servidor local de Android', () => {
  let srv: MobileServer
  let dir: string
  let base: string
  let lastNative: string | null = null
  const headers = { Cookie: `${COOKIE}=${TOKEN}`, 'Content-Type': 'application/json' }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'crm-movil-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>CRM</title>')
    const handlers = {
      'app:info': () => ({ version: '1', platform: 'android', hostname: 'x', isPackaged: true }),
      'files:upload': ({ data }: { data: Uint8Array }) => ({ size: data.byteLength }),
    } as unknown as IpcHandlers
    srv = await startMobileServer({
      handlers,
      getData: () => null,
      staticDir: dir,
      token: TOKEN,
      port: 0,
      onNative: (what) => (lastNative = what),
    })
    base = `http://127.0.0.1:${srv.port}`
  })
  afterAll(async () => {
    await srv.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: body === undefined ? '' : encodeWire(body),
    })

  it('sin el secreto no responde nada', async () => {
    expect((await fetch(`${base}/`)).status).toBe(403)
    expect((await fetch(`${base}/`, { headers: { Cookie: `${COOKIE}=otro` } })).status).toBe(403)
    expect((await post('/api/app:info', undefined, { Cookie: 'crm=' })).status).toBe(403)
  })

  it('rechaza otro nombre de host (DNS rebinding) y otro origen', async () => {
    const status = await new Promise<number>((resolve) => {
      request(
        {
          host: '127.0.0.1',
          port: srv.port,
          path: '/',
          headers: { ...headers, Host: 'evil.test' },
        },
        (res) => resolve(res.statusCode ?? 0),
      ).end()
    })
    expect(status).toBe(421)
    expect((await post('/api/app:info', undefined, { Origin: 'https://evil.test' })).status).toBe(
      403,
    )
  })

  it('sirve la interfaz con CSP y no deja salir de su carpeta', async () => {
    const res = await fetch(`${base}/`, { headers })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect((await fetch(`${base}/..%2f..%2fetc%2fpasswd`, { headers })).status).toBe(404)
  })

  it('llama a los canales y valida la entrada', async () => {
    const info = decodeWire(await (await post('/api/app:info', undefined)).text())
    expect(info).toMatchObject({ ok: true, data: { platform: 'android' } })
    const bad = decodeWire(await (await post('/api/files:upload', { name: '' })).text())
    expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect((await post('/api/nada:deNada', undefined)).status).toBe(404)
    expect(
      (await fetch(`${base}/api/app:info`, { method: 'POST', headers: { Cookie: headers.Cookie } }))
        .status,
    ).toBe(415)
  })

  it('pasa bytes en las llamadas', async () => {
    const res = await post('/api/files:upload', { name: 'a.bin', data: new Uint8Array(1000) })
    expect(decodeWire(await res.text())).toEqual({ ok: true, data: { size: 1000 } })
  })

  it('envía los eventos a la interfaz', async () => {
    const res = await fetch(`${base}/api/events`, { headers })
    const reader = res.body!.getReader()
    await reader.read() // saludo
    srv.emit('analysis:changed', null)
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toContain('event: analysis:changed\ndata: null')
    await reader.cancel()
  })

  it('pide cosas al lado nativo y espera su respuesta', async () => {
    expect(await srv.native({ kind: 'open', url: 'https://example.com' })).toBeNull()
    const res = await fetch(`${base}/native/events`, { headers })
    const reader = res.body!.getReader()
    await reader.read()
    const answer = srv.native({ kind: 'save', path: '/x', name: 'x.csv' })
    const { value } = await reader.read()
    const line = new TextDecoder()
      .decode(value)
      .split('\n')
      .find((l) => l.startsWith('data: '))!
    const req = decodeWire(line.slice(6)) as { id: string; kind: string }
    expect(req.kind).toBe('save')
    await post('/native/reply', { id: req.id, value: 'Descargas/x.csv' })
    expect(await answer).toBe('Descargas/x.csv')
    await reader.cancel()
    await post('/native/lock', {})
    expect(lastNative).toBe('lock')
  })
})
