import { describe, expect, it } from 'vitest'
import {
  computeMetrics,
  DEFAULT_HOLD_RATE,
  metaTableSettingsSchema,
} from '../../src/shared/meta-metrics'
import { createConverter, parseEcbXml, storeRates } from '../../src/main/meta/fx'
import { GraphClient, GraphError, parseUsage } from '../../src/main/meta/graph'
import {
  chunks,
  historyLimit,
  MetaService,
  monthChunks,
  shiftMonths,
} from '../../src/main/meta/meta-service'
import { dayMetrics, ECB_XML, FAKE_ECB, FAKE_GRAPH, FakeMeta, GOOD_TOKEN } from './meta-fake'
import { setup } from './meta-setup'

describe('fechas y trozos', () => {
  it('límite de 37 meses y trozos de días y de meses', () => {
    expect(shiftMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(historyLimit('2026-10-03')).toBe('2023-09-04')
    expect(chunks('2026-09-01', '2026-09-25', 10)).toEqual([
      ['2026-09-16', '2026-09-25'],
      ['2026-09-06', '2026-09-15'],
      ['2026-09-01', '2026-09-05'],
    ])
    expect(monthChunks('2026-07-15', '2026-09-03')).toEqual([
      ['2026-09-01', '2026-09-03'],
      ['2026-08-01', '2026-08-31'],
      ['2026-07-15', '2026-07-31'],
    ])
  })
})

describe('tipos de cambio del BCE', () => {
  it('lee el XML y usa el último tipo anterior en fines de semana', async () => {
    const days = parseEcbXml(ECB_XML)
    expect(days.map((d) => d.date)).toEqual(['2026-04-01', '2026-10-01', '2026-10-02'])
    const { vault } = await setup()
    storeRates(vault.sqlite, days)
    const fx = createConverter(vault.sqlite)
    expect(fx.convert(110, 'USD', 'EUR', '2026-10-01')).toBeCloseTo(100)
    // Sábado 3 y domingo 4: tipo del viernes 2.
    expect(fx.convert(125, 'USD', 'EUR', '2026-10-04')).toBeCloseTo(100)
    expect(fx.convert(100, 'EUR', 'GBP', '2026-10-01')).toBeCloseTo(84)
    expect(fx.convert(1, 'USD', 'GBP', '2026-10-02')).toBeCloseTo(0.68)
    // Antes del primer tipo guardado se usa el primero que haya.
    expect(fx.convert(100, 'USD', 'EUR', '2020-01-01')).toBeCloseTo(100)
    expect(fx.convert(100, 'ARS', 'EUR', '2026-10-01')).toBeNull()
    vault.dispose()
  })
})

describe('cliente de la Graph API', () => {
  it('lee las cabeceras de uso de Meta', () => {
    const h = new Headers({
      'x-fb-ads-insights-throttle': '{"app_id_util_pct":40,"acc_id_util_pct":80}',
      'x-business-use-case-usage':
        '{"9":[{"type":"ads_insights","call_count":10,"total_cputime":5,"total_time":3,"estimated_time_to_regain_access":2}]}',
    })
    expect(parseUsage(h)).toEqual({ pct: 80, waitSeconds: 120 })
    expect(parseUsage(new Headers())).toEqual({ pct: 0, waitSeconds: 0 })
  })

  it('reintenta con espera cuando Meta limita y frena si el uso es alto', async () => {
    const fake = new FakeMeta({ throttleFirst: 2, usagePct: 80 })
    const sleeps: number[] = []
    const g = new GraphClient({
      token: GOOD_TOKEN,
      http: fake.fetch as typeof fetch,
      baseUrl: FAKE_GRAPH,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    const rows = await g.getAll('act_111/insights', {
      level: 'account',
      time_range: { since: '2026-09-01', until: '2026-09-02' },
      time_increment: 1,
      limit: 1,
    })
    expect(rows).toHaveLength(2)
    // Dos esperas exponenciales por el error de límite y, antes de la segunda página,
    // otra porque el uso va por el 80 %.
    expect(sleeps).toHaveLength(3)
    expect(sleeps[0]).toBeGreaterThanOrEqual(6000)
    expect(sleeps[1]).toBeGreaterThanOrEqual(12000)
    expect(sleeps[2]).toBe(8000)
    // La URL de la página siguiente traía el token: se quita y va en la cabecera.
    expect(fake.requests.every((r) => !r.params.has('access_token'))).toBe(true)
  })

  it('token no válido: error de autenticación sin reintentos; el token va en la cabecera', async () => {
    const fake = new FakeMeta()
    const g = new GraphClient({
      token: 'otro-token',
      http: fake.fetch as typeof fetch,
      baseUrl: FAKE_GRAPH,
    })
    const e = await g.get('me').catch((err: unknown) => err)
    expect(e).toBeInstanceOf(GraphError)
    expect((e as GraphError).isAuth).toBe(true)
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]!.params.has('access_token')).toBe(false)
  })

  it('añade appsecret_proof si hay secreto de la app', async () => {
    const fake = new FakeMeta()
    const g = new GraphClient({
      token: GOOD_TOKEN,
      appSecret: 'secreto',
      http: fake.fetch as typeof fetch,
      baseUrl: FAKE_GRAPH,
    })
    await g.get('me')
    expect(fake.requests[0]!.params.get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('sincronización con Meta', () => {
  it('rechaza un token no válido y guarda el bueno solo en la base de datos cifrada', async () => {
    const { vault, meta } = await setup()
    await expect(meta.connect({ token: 'x'.repeat(30), appSecret: '' })).rejects.toThrow(/caducado/)
    expect(meta.status().connected).toBe(false)
    const s = await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    expect(s).toMatchObject({ connected: true, user: 'CRM lectura' })
    expect(JSON.stringify(s)).not.toContain(GOOD_TOKEN)
    const accounts = meta.listAccounts()
    expect(accounts).toEqual([
      expect.objectContaining({
        id: 'act_111',
        name: 'Tienda Demo',
        currency: 'USD',
        timezone: 'America/New_York',
        business: 'Mi BM',
        enabled: false,
      }),
    ])
    expect(JSON.stringify(accounts)).not.toContain(GOOD_TOKEN)
    meta.dispose()
    vault.dispose()
  })

  it('activa una cuenta: estructura, 30 días, histórico asíncrono y miniaturas', async () => {
    const { vault, meta, fake } = await setup()
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    const cliente = vault.data.create('cliente', {
      [vault.data.listFields('cliente').find((f) => f.key === 'nombre')!.id]: 'Acme',
    })
    meta.updateAccount({ id: 'act_111', enabled: true, clientId: cliente.id })
    await meta.idle()

    const db = vault.sqlite
    // Estructura.
    const objects = db.prepare('SELECT id, level, name FROM ad_objects ORDER BY id').all()
    expect(objects).toEqual([
      { id: 'a1', level: 'ad', name: 'Vídeo UGC' },
      { id: 'c1', level: 'campaign', name: 'Prospecting' },
      { id: 's1', level: 'adset', name: 'Broad ES' },
    ])
    const creative = db.prepare('SELECT * FROM ad_creatives').get() as { thumb_file_id: string }
    expect(creative.thumb_file_id).toMatch(/^[a-f0-9]{64}$/)
    expect(vault.data.files.read(creative.thumb_file_id).subarray(1, 4).toString()).toBe('PNG')

    // Primero los últimos 30 días en la zona de la cuenta (Nueva York: 3 de octubre).
    const sync = fake.insightCalls().filter((c) => c.method === 'GET')
    expect(sync[0]).toMatchObject({ level: 'account', until: '2026-10-03', since: '2026-09-24' })
    expect(sync.at(-1)).toMatchObject({ level: 'ad', since: '2026-09-04' })

    // Después el histórico desde la creación de la cuenta (10 de mayo), en trozos de 12 meses
    // por cuenta, 3 por campaña y conjunto y 1 por anuncio: los más recientes primero.
    const asyncCalls = fake.insightCalls().filter((c) => c.method === 'POST')
    expect(asyncCalls[0]).toMatchObject({
      level: 'account',
      since: '2026-05-10',
      until: '2026-09-03',
    })
    expect(asyncCalls.at(-1)).toMatchObject({
      level: 'ad',
      since: '2026-05-10',
      until: '2026-05-31',
    })
    expect(asyncCalls).toHaveLength(1 + 2 + 2 + 5)

    const [a] = meta.listAccounts()
    expect(a).toMatchObject({
      enabled: true,
      clientId: cliente.id,
      dataFrom: '2026-05-10',
      dataUntil: '2026-10-03',
      historyDone: true,
      history: null,
      lastError: null,
    })
    expect(meta.accountsForClient(cliente.id)).toHaveLength(1)

    // Métricas diarias por nivel, acciones normalizadas y catálogo de tipos.
    const days = db
      .prepare("SELECT COUNT(*) AS n FROM ad_insights_daily WHERE level = 'ad'")
      .get() as { n: number }
    expect(days.n).toBe(147) // 10 de mayo a 3 de octubre
    const day = db
      .prepare("SELECT * FROM ad_insights_daily WHERE level = 'ad' AND date = '2026-09-15'")
      .get() as { spend: number; quality_ranking: string; extra: string }
    expect(day.spend).toBe(Number(dayMetrics('a1', '2026-09-15').spend))
    expect(day.quality_ranking).toBe('AVERAGE')
    expect(JSON.parse(day.extra)).toHaveProperty('video_thruplay_watched_actions')
    const purchase = db
      .prepare(
        "SELECT count, value FROM ad_actions WHERE level = 'ad' AND date = '2026-09-15' AND action_type = 'omni_purchase'",
      )
      .get()
    expect(purchase).toEqual({
      count: dayMetrics('a1', '2026-09-15').purchases,
      value: Number(dayMetrics('a1', '2026-09-15').purchaseValue),
    })
    const types = db.prepare('SELECT action_type FROM ad_action_types ORDER BY 1').all()
    expect(types.map((t) => (t as { action_type: string }).action_type)).toEqual([
      'link_click',
      'omni_purchase',
      'purchase',
      'video_view',
    ])

    // Solo lectura: todo GET salvo crear informes de Insights.
    for (const r of fake.requests)
      if (r.method !== 'GET') expect(r).toMatchObject({ method: 'POST', path: 'act_111/insights' })
    meta.dispose()
    vault.dispose()
  })

  it('cada hora vuelve a bajar la ventana de atribución y rellena el hueco', async () => {
    const { vault, meta, fake, setNow } = await setup()
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()
    fake.requests = []
    // Tres días después (la app estuvo cerrada).
    setNow('2026-10-06T15:00:00Z')
    await meta.syncNow()
    const calls = fake.insightCalls()
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
    expect(calls[0]).toMatchObject({ since: '2026-09-27', until: '2026-10-06' })
    expect(meta.listAccounts()[0]!.dataUntil).toBe('2026-10-06')

    // Ventana configurable (hasta 28 días).
    meta.setSettings({ ...meta.settings(), attributionDays: 2 })
    fake.requests = []
    await meta.syncNow()
    expect(fake.insightCalls()[0]).toMatchObject({ since: '2026-10-05', until: '2026-10-06' })
    meta.dispose()
    vault.dispose()
  })

  it('si la versión de la API rechaza un campo opcional, sigue sin él', async () => {
    const { vault, meta, fake } = await setup(new FakeMeta({ rejectFields: ['results'] }))
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()
    expect(meta.listAccounts()[0]).toMatchObject({ historyDone: true, lastError: null })
    const last = fake.insightCalls().at(-1)!
    expect(last).toBeDefined()
    const fields = fake.requests.at(-1)!.params.get('fields') ?? ''
    expect(fields).not.toMatch(/\bresults\b/)
    meta.dispose()
    vault.dispose()
  })

  it('los trozos del histórico que fallan se reintentan y luego se pueden repetir', async () => {
    const fake = new FakeMeta({ failReports: true })
    const { vault, meta } = await setup(fake)
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()
    const [a] = meta.listAccounts()
    // Los 20 trozos fallan tras 3 intentos.
    expect(a).toMatchObject({ historyDone: true, dataFrom: '2026-09-04' })
    const failed = vault.sqlite
      .prepare("SELECT COUNT(*) AS n FROM ad_jobs WHERE status = 'failed'")
      .get() as { n: number }
    expect(failed.n).toBe(10)

    fake.set({ failReports: false })
    meta.retryHistory('act_111')
    await meta.idle()
    expect(meta.listAccounts()[0]).toMatchObject({ historyDone: true, dataFrom: '2026-05-10' })
    meta.dispose()
    vault.dispose()
  })

  it('al abrir de nuevo sigue esperando el informe que ya estaba pedido', async () => {
    const { vault, meta, fake } = await setup()
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()
    // Simula un cierre a mitad: un trozo con su informe ya pedido a Meta.
    const g = new GraphClient({
      token: GOOD_TOKEN,
      http: fake.fetch as typeof fetch,
      baseUrl: FAKE_GRAPH,
    })
    const report = await g.createInsightsReport('act_111', {
      level: 'account',
      time_range: { since: '2026-05-10', until: '2026-05-31' },
      time_increment: 1,
    })
    const db = vault.sqlite
    db.prepare(
      "UPDATE ad_jobs SET status = 'running', report_run_id = ?, started_at = ? WHERE level = 'account' AND since = '2026-05-10'",
    ).run(report, '2026-10-03T14:00:00.000Z')
    db.prepare(
      "UPDATE ad_insights_daily SET spend = 0 WHERE level = 'account' AND date < '2026-06-01'",
    ).run()
    db.prepare('UPDATE ad_accounts SET history_done = 0').run()
    fake.requests = []
    const again = new MetaService(vault, {
      http: fake.fetch as typeof fetch,
      graphUrl: FAKE_GRAPH,
      ecbUrl: FAKE_ECB,
      now: () => new Date('2026-10-03T15:30:00Z'),
      sleep: async () => {},
      pollMs: 0,
    })
    await again.syncNow()
    const posted = fake.requests.filter((r) => r.method === 'POST')
    expect(posted).toHaveLength(0)
    expect(fake.requests.some((r) => r.path === `${report}/insights`)).toBe(true)
    const day = db
      .prepare(
        "SELECT spend FROM ad_insights_daily WHERE level = 'account' AND date = '2026-05-20'",
      )
      .get() as { spend: number }
    expect(day.spend).toBe(Number(dayMetrics('act_111', '2026-05-20').spend))
    again.dispose()
    meta.dispose()
    vault.dispose()
  })

  it('tabla del periodo convertida a euros con el tipo de cada día', async () => {
    const { vault, meta } = await setup()
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()
    const q = {
      accountId: 'act_111',
      level: 'campaign' as const,
      since: '2026-10-01',
      until: '2026-10-02',
    }
    const r = meta.table(q)
    expect(r).toMatchObject({ currency: 'EUR', accountCurrency: 'USD', unconverted: false })
    const s1 = Number(dayMetrics('c1', '2026-10-01').spend) / 1.1
    const s2 = Number(dayMetrics('c1', '2026-10-02').spend) / 1.25
    expect(r.rows).toHaveLength(1)
    const row = r.rows[0]!
    expect(row.name).toBe('Prospecting')
    expect(row.base['gasto']).toBeCloseTo(s1 + s2)
    expect(row.dailyBudget).toBeCloseTo(50 / 1.25) // 5000 céntimos de USD
    const compras =
      dayMetrics('c1', '2026-10-01').purchases + dayMetrics('c1', '2026-10-02').purchases
    expect(r.totals['compras']).toBe(compras)
    // Cualquier acción, por su tipo: purchase y omni_purchase traen lo mismo.
    expect(r.totals['acc_purchase']).toBe(compras)
    expect(r.totals['thruplays']).toBe(200)
    const m = computeMetrics(r.totals, null)
    expect(m['roas']).toBeCloseTo(r.totals['valor_compras']! / r.totals['gasto']!)
    // Hold rate por defecto (estándar): ThruPlays (15 s) / reproducciones de 3 s.
    expect(m['hold_rate']).toBeCloseTo((200 / r.totals['reproducciones_3s']!) * 100)
    // Quien tenía el de antes (ThruPlays / impresiones) sin cambiar pasa al estándar.
    expect(
      metaTableSettingsSchema.parse({ holdRate: 'thruplays / impresiones * 100' }).holdRate,
    ).toBe(DEFAULT_HOLD_RATE)
    // Periodo anterior de la misma duración (29 y 30 de septiembre).
    expect(r.previous['impresiones']).toBeGreaterThan(0)
    expect(row.previous).toBeNull()
    expect(meta.table({ ...q, compare: true }).rows[0]!.previous!['impresiones']).toBe(
      r.previous['impresiones'],
    )

    // Hijos de una campaña.
    const ads = meta.table({ ...q, level: 'ad', parentId: 'c1' })
    expect(ads.rows.map((x) => x.name)).toEqual(['Vídeo UGC'])
    expect(ads.rows[0]!.thumbFileId).toMatch(/^[a-f0-9]{64}$/)
    expect(ads.rows[0]!.rankings.quality).toBe('AVERAGE')

    // Configuración del conjunto: atribución y última edición del historial de actividad.
    const sets = meta.table({ ...q, level: 'adset' })
    expect(sets.rows[0]).toMatchObject({
      attribution: '7 días tras hacer clic',
      lastEdit: '2026-10-01T09:00:00.000Z',
      lastEditExact: true,
    })
    // Un cambio de estado no cuenta como edición significativa.
    expect(ads.rows[0]!.lastEditExact).toBe(false)

    // Moneda sin tipo del BCE: se muestra en la de la cuenta.
    meta.setSettings({ ...meta.settings(), displayCurrency: 'ARS' })
    expect(meta.table(q)).toMatchObject({ currency: 'USD', unconverted: true })
    meta.dispose()
    vault.dispose()
  })

  it('las miniaturas de Meta no se borran al limpiar archivos sin usar', async () => {
    const { vault, meta, setNow } = await setup()
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()
    setNow('2026-10-10T15:00:00Z')
    expect(vault.data.gcFiles()).toBe(0)
    meta.dispose()
    vault.dispose()
  })

  it('al bloquear se detiene y desconectar olvida el token', async () => {
    const { vault, meta } = await setup()
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    const s = meta.disconnect()
    expect(s.connected).toBe(false)
    const row = vault.sqlite.prepare("SELECT 1 FROM settings WHERE key = 'meta.config'").get()
    expect(row).toBeUndefined()
    vault.lock()
    expect(meta.status()).toMatchObject({ connected: false, phase: 'idle' })
    meta.dispose()
    vault.dispose()
  })
})
