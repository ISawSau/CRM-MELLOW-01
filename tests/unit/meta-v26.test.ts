import { describe, expect, it } from 'vitest'
import { GraphClient, GraphError, graphErrorText } from '../../src/main/meta/graph'
import { FakeMeta, FAKE_GRAPH, GOOD_TOKEN } from './meta-fake'
import { setup } from './meta-setup'

/**
 * Graph API v26.0: «Root requests using GET /?ids=... return an error. Use per-object
 * requests or supported batching» (changelog oficial de la v26.0). Todas las lecturas
 * van a la ruta de cada objeto: /act_{id}, /act_{id}/insights, /{creative_id}…
 */

function capture() {
  const calls: { url: string; auth: string | null }[] = []
  const http = (async (input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), auth: new Headers(init.headers).get('authorization') })
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }) as typeof fetch
  return { calls, graph: new GraphClient({ token: 'token-secreto', http }) }
}

describe('Graph API v26.0: rutas de objeto, nunca «/?ids=»', () => {
  it('la cuenta y sus Insights se piden por su ruta, con el token solo en la cabecera', async () => {
    const { calls, graph } = capture()
    // El id llega de la cuenta conectada (aquí uno cualquiera con el prefijo act_).
    const account = 'act_1234567890123456'
    await graph.get(account, { fields: 'id,name,account_status,currency,timezone_name' })
    await graph.get(`${account}/insights`, {
      fields: 'campaign_name,spend,impressions,clicks',
      level: 'campaign',
      time_range: { since: '2026-09-01', until: '2026-09-30' },
      breakdowns: 'age',
    })
    const [acc, ins] = calls.map((c) => new URL(c.url))
    expect(`${acc!.origin}${acc!.pathname}`).toBe(
      'https://graph.facebook.com/v26.0/act_1234567890123456',
    )
    expect(acc!.searchParams.get('fields')).toBe('id,name,account_status,currency,timezone_name')
    expect(ins!.pathname).toBe('/v26.0/act_1234567890123456/insights')
    expect(ins!.searchParams.get('breakdowns')).toBe('age')
    expect(JSON.parse(ins!.searchParams.get('time_range')!)).toEqual({
      since: '2026-09-01',
      until: '2026-09-30',
    })
    for (const c of calls) {
      expect(c.url).not.toMatch(/[?&]ids=/)
      expect(c.url).not.toContain('token-secreto')
      expect(c.auth).toBe('Bearer token-secreto')
    }
  })

  it('el cliente no permite volver a pedir a la raíz con «ids»', () => {
    const { calls, graph } = capture()
    expect(() => graph.get('', { ids: '1,2' })).toThrow(/v26\.0/)
    expect(() => graph.get('/', {})).toThrow(/v26\.0/)
    expect(() => graph.get('123', { ids: '1,2' })).toThrow(/v26\.0/)
    expect(calls).toHaveLength(0)
  })

  it('el error de Meta llega con su texto a la interfaz', async () => {
    const fake = new FakeMeta()
    const graph = new GraphClient({
      token: GOOD_TOKEN,
      http: fake.fetch as typeof fetch,
      baseUrl: FAKE_GRAPH,
    })
    // Petición a mano a la raíz (sin el cliente) para ver qué responde la API simulada.
    const res = await fake.fetch(`${FAKE_GRAPH}/v26.0/?ids=1,2`, {
      headers: { Authorization: `Bearer ${GOOD_TOKEN}` },
    })
    const body = (await res.json()) as { error: { message: string; code: number } }
    expect(body.error).toMatchObject({
      code: 100,
      message: 'The ids query parameter is deprecated in v26.0+.',
    })
    const e = await graph.get('no-existe').catch((x: unknown) => x)
    expect(e).toBeInstanceOf(GraphError)
    expect(graphErrorText(e)).toMatch(/^Meta respondió: /)
  })

  it('sincronizar una cuenta no usa «ids»: creatividades por id, Insights y desgloses por ruta', async () => {
    const { vault, meta, fake } = await setup()
    // Un anuncio con una creatividad que ya no existe: no debe impedir las métricas.
    fake.ads.push({
      id: 'a2',
      name: 'Anuncio viejo',
      campaign_id: 'c1',
      adset_id: 's1',
      status: 'ARCHIVED',
      effective_status: 'ARCHIVED',
      creative: { id: 'cr404' },
      updated_time: '2026-09-01T10:00:00-0400',
    })
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.setBreakdowns('act_111', { campaign: ['edad', 'pais'], adset: [], ad: ['dispositivo'] })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()

    const urls = fake.urls
    expect(urls.length).toBeGreaterThan(10)
    // Ni una sola petición a la raíz ni con «ids».
    expect(urls.filter((u) => /[?&]ids=/.test(u) || /^GET \/v26\.0\/?(\?|$)/.test(u))).toEqual([])
    // Todas las de la Graph API van a la v26.0 (las demás son el BCE y las miniaturas).
    const graphUrls = urls.filter((u) => !/eurofxref|\/ecb\/|\/cdn\//.test(u))
    expect(graphUrls.every((u) => /^(GET|POST) \/v26\.0\/./.test(u))).toBe(true)
    // Creatividad por su ruta, con el tamaño de miniatura.
    expect(urls.some((u) => /^GET \/v26\.0\/cr1\?.*thumbnail_width=320/.test(u))).toBe(true)
    expect(urls.some((u) => u.startsWith('GET /v26.0/cr404?'))).toBe(true)
    // Insights de la cuenta por /act_{id}/insights, con y sin desgloses.
    const ins = urls.filter((u) => u.includes('/v26.0/act_111/insights'))
    expect(ins.length).toBeGreaterThan(0)
    expect(ins.some((u) => /breakdowns=age(&|$)/.test(u))).toBe(true)
    expect(ins.some((u) => /breakdowns=country/.test(u))).toBe(true)
    expect(ins.some((u) => /breakdowns=impression_device/.test(u))).toBe(true)

    // La cuenta tiene datos (ya no «Aún sin datos») y sin error.
    const acc = meta.listAccounts()[0]!
    expect(acc.dataFrom).not.toBeNull()
    expect(acc.lastError).toBeNull()
    // Y la respuesta de Insights se convierte en lo que muestra la tabla.
    const t = meta.table({
      accountId: 'act_111',
      since: '2026-09-24',
      until: '2026-10-02',
      level: 'campaign',
    })
    expect(t.rows.map((r) => r.name)).toEqual(['Prospecting'])
    expect(t.rows[0]!.base['gasto']).toBeGreaterThan(0)
    expect(t.rows[0]!.base['impresiones']).toBeGreaterThan(0)
    meta.dispose()
    vault.dispose()
  })
})
