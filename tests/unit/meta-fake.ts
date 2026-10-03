/**
 * API de Meta falsa para los tests: responde como la Graph API (v26.0) con datos
 * deterministas y registra cada petición. Nunca sale a internet.
 */

export const FAKE_GRAPH = 'https://graph.test'
export const FAKE_ECB = 'https://ecb.test'
export const GOOD_TOKEN = 'EAAtokendepruebasolo-lectura-1234567890'

export interface FakeRequest {
  method: string
  path: string
  params: URLSearchParams
  auth: string | null
}

type Json = Record<string, unknown>

export interface FakeOptions {
  /** Campos de Insights que la «versión» falsa rechaza con un error 100. */
  rejectFields?: string[]
  /** Las N primeras peticiones de Insights devuelven un error de límite. */
  throttleFirst?: number
  /** Los informes asíncronos fallan siempre. */
  failReports?: boolean
  /** Cabecera de uso en cada respuesta (porcentaje). */
  usagePct?: number
  /**
   * Cuenta pesada: las peticiones síncronas de Insights de ese nivel con más días que los
   * indicados responden «Please reduce the amount of data you're asking for».
   */
  maxSyncDays?: { level: string; days: number }
  /** Las creatividades pedidas una a una devuelven siempre el error de límite (17). */
  throttleCreatives?: boolean
  /** Las peticiones síncronas de Insights de ese nivel fallan (los informes asíncronos no). */
  failSyncLevel?: string
}

/** Métricas de un día para una entidad: dependen de la fecha y del id. */
export function dayMetrics(entity: string, date: string) {
  const day = Number(date.slice(8, 10))
  const seed = entity.length + day
  return {
    spend: (10 + (seed % 7)).toFixed(2),
    impressions: String(1000 + seed * 10),
    clicks: String(20 + (seed % 5)),
    inline_link_clicks: String(10 + (seed % 3)),
    purchases: 1 + (seed % 2),
    purchaseValue: (50 + seed).toFixed(2),
  }
}

function eachDay(since: string, until: string): string[] {
  const out: string[] = []
  const d = new Date(`${since}T00:00:00Z`)
  while (d.toISOString().slice(0, 10) <= until) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export class FakeMeta {
  requests: FakeRequest[] = []
  private reports = new Map<string, { params: URLSearchParams; polls: number }>()
  private nextReport = 1
  private throttled = 0

  account = {
    id: 'act_111',
    account_id: '111',
    name: 'Tienda Demo',
    currency: 'USD',
    timezone_name: 'America/New_York',
    account_status: 1,
    business: { id: '9', name: 'Mi BM' },
    created_time: '2026-05-10T12:00:00-0400',
  }
  campaigns: Json[] = [
    {
      id: 'c1',
      name: 'Prospecting',
      status: 'ACTIVE',
      effective_status: 'ACTIVE',
      objective: 'OUTCOME_SALES',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      daily_budget: '5000',
      start_time: '2026-05-11T00:00:00-0400',
      updated_time: '2026-09-01T10:00:00-0400',
    },
  ]
  adsets: Json[] = [
    {
      id: 's1',
      name: 'Broad ES',
      campaign_id: 'c1',
      status: 'ACTIVE',
      effective_status: 'ACTIVE',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }],
      updated_time: '2026-09-01T10:00:00-0400',
    },
  ]
  ads: Json[] = [
    {
      id: 'a1',
      name: 'Vídeo UGC',
      campaign_id: 'c1',
      adset_id: 's1',
      status: 'ACTIVE',
      effective_status: 'ACTIVE',
      creative: { id: 'cr1' },
      updated_time: '2026-09-01T10:00:00-0400',
    },
  ]
  creatives: Record<string, Json> = {
    cr1: {
      id: 'cr1',
      name: 'UGC 1',
      title: 'Oferta',
      body: 'Compra ya',
      thumbnail_url: '',
      object_type: 'VIDEO',
      video_id: '777',
    },
  }

  constructor(
    private readonly opts: FakeOptions = {},
    /** Dirección con la que se generan las URL de paginación y miniaturas. */
    readonly base = FAKE_GRAPH,
  ) {
    this.creatives['cr1']!['thumbnail_url'] = `${base}/cdn/cr1.png`
  }

  set(opts: FakeOptions): void {
    Object.assign(this.opts, opts)
  }

  /** Peticiones de Insights (síncronas y asíncronas) con sus fechas. */
  insightCalls(): { method: string; level: string; since: string; until: string }[] {
    return this.requests
      .filter((r) => r.path.endsWith('/insights') && r.params.get('time_range'))
      .map((r) => {
        const tr = JSON.parse(r.params.get('time_range')!) as { since: string; until: string }
        return { method: r.method, level: r.params.get('level')!, ...tr }
      })
  }

  /** Filas del periodo completo (sin time_increment): alcance y frecuencia. */
  private rangeRows(level: string, node: string, since: string, until: string): Json[] {
    const all = this.rows(level, since, until)
    const groups = new Map<string, Json[]>()
    for (const r of all) {
      const id = String(r['ad_id'] ?? r['adset_id'] ?? r['campaign_id'] ?? 'act')
      if (node !== this.account.id && r['campaign_id'] !== node && r['adset_id'] !== node) continue
      groups.set(id, [...(groups.get(id) ?? []), r])
    }
    return [...groups.values()].map((rs) => {
      const impressions = rs.reduce((n, r) => n + Number(r['impressions']), 0)
      const reach = Math.round(impressions / 2.5)
      const { date_start: _d, date_stop: _s, ...first } = rs[0]!
      void _d
      void _s
      return {
        ...first,
        date_start: since,
        date_stop: until,
        impressions: String(impressions),
        reach: String(reach),
        frequency: (impressions / reach).toFixed(4),
        unique_inline_link_clicks: '42',
        unique_inline_link_click_ctr: '1.5',
      }
    })
  }

  private breakdownRows(level: string, since: string, until: string, breakdowns: string): Json[] {
    const values: Record<string, string[][]> = {
      age: [['18-24'], ['25-34']],
      publisher_platform: [['facebook'], ['instagram']],
      'publisher_platform,platform_position': [
        ['facebook', 'feed'],
        ['instagram', 'story'],
      ],
    }
    const keys = breakdowns.split(',')
    const out: Json[] = []
    for (const r of this.rows(level, since, until)) {
      for (const [i, v] of (values[breakdowns] ?? [['x']]).entries()) {
        const share = i === 0 ? 0.4 : 0.6
        const row: Json = {
          ...r,
          spend: (Number(r['spend']) * share).toFixed(2),
          impressions: String(Math.round(Number(r['impressions']) * share)),
        }
        keys.forEach((k, j) => (row[k] = v[j]))
        out.push(row)
      }
    }
    return out
  }

  activities: Json[] = [
    { event_type: 'update_ad_set_budget', event_time: '2026-10-01T09:00:00+0000', object_id: 's1' },
    { event_type: 'update_ad_run_status', event_time: '2026-10-02T09:00:00+0000', object_id: 'a1' },
  ]

  private rows(level: string, since: string, until: string): Json[] {
    const entities =
      level === 'account'
        ? [{ id: this.account.id }]
        : level === 'campaign'
          ? this.campaigns
          : level === 'adset'
            ? this.adsets
            : this.ads
    // La cuenta empezó a gastar el día en que se creó.
    const start = '2026-05-10'
    const out: Json[] = []
    for (const date of eachDay(since < start ? start : since, until)) {
      for (const e of entities) {
        const m = dayMetrics(String(e['id']), date)
        const row: Json = {
          account_id: this.account.account_id,
          date_start: date,
          date_stop: date,
          spend: m.spend,
          impressions: m.impressions,
          clicks: m.clicks,
          inline_link_clicks: m.inline_link_clicks,
          actions: [
            { action_type: 'link_click', value: m.inline_link_clicks },
            { action_type: 'omni_purchase', value: String(m.purchases) },
            { action_type: 'purchase', value: String(m.purchases) },
            { action_type: 'video_view', value: '300' },
          ],
          action_values: [{ action_type: 'omni_purchase', value: m.purchaseValue }],
          video_thruplay_watched_actions: [{ action_type: 'video_view', value: '100' }],
        }
        if (level !== 'account') row['campaign_id'] = e['campaign_id'] ?? e['id']
        if (level === 'campaign') row['campaign_name'] = e['name']
        if (level === 'adset' || level === 'ad') row['adset_id'] = e['adset_id'] ?? e['id']
        if (level === 'adset') row['adset_name'] = e['name']
        if (level === 'ad') {
          row['ad_id'] = e['id']
          row['ad_name'] = e['name']
          row['quality_ranking'] = 'AVERAGE'
        }
        out.push(row)
      }
    }
    return out
  }

  private page(path: string, all: Json[], params: URLSearchParams): Json {
    const limit = Number(params.get('limit') ?? 25)
    const after = Number(params.get('after') ?? 0)
    const data = all.slice(after, after + limit)
    const res: Json = { data }
    if (after + limit < all.length) {
      const next = new URLSearchParams(params)
      next.set('after', String(after + limit))
      next.set('access_token', 'token-en-la-url')
      res['paging'] = { next: `${this.base}/v26.0/${path}?${next}` }
    }
    return res
  }

  private error(status: number, code: number, message: string, subcode?: number): Response {
    return new Response(JSON.stringify({ error: { message, code, error_subcode: subcode } }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  private checkFields(params: URLSearchParams): Response | null {
    const fields = (params.get('fields') ?? '').split(',')
    for (const f of this.opts.rejectFields ?? [])
      if (fields.includes(f))
        return this.error(400, 100, `(#100) ${f} is not valid for fields param.`)
    return null
  }

  /** URL de cada petición («GET /v26.0/act_111/insights?…»), sin cabeceras. */
  readonly urls: string[] = []

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    )
    const method = init.method ?? 'GET'
    this.urls.push(`${method} ${url.pathname}${url.search}`)
    const headers = new Headers(init.headers)
    const params = new URLSearchParams(url.search)
    if (init.body instanceof URLSearchParams) for (const [k, v] of init.body) params.set(k, v)

    if (url.origin === FAKE_ECB || url.pathname.startsWith('/ecb/'))
      return new Response(ECB_XML, { status: 200 })
    if (url.pathname.startsWith('/cdn/'))
      return new Response(PNG_1PX, { headers: { 'content-type': 'image/png' } })

    const path = url.pathname.replace(/^\/v26\.0\/?/, '')
    this.requests.push({ method, path, params, auth: headers.get('authorization') })
    const usage = this.opts.usagePct
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        headers: {
          'content-type': 'application/json',
          ...(usage !== undefined
            ? {
                'x-fb-ads-insights-throttle': JSON.stringify({
                  app_id_util_pct: usage,
                  acc_id_util_pct: 1,
                  ads_api_access_tier: 'development_access',
                }),
              }
            : {}),
        },
      })

    if (headers.get('authorization') !== `Bearer ${GOOD_TOKEN}`)
      return this.error(400, 190, 'Invalid OAuth access token - Cannot parse access token')
    if (params.has('access_token')) return this.error(400, 100, 'token en la URL')

    if (method === 'POST') {
      if (path !== `${this.account.id}/insights`)
        return this.error(400, 3, 'Escritura no permitida')
      const bad = this.checkFields(params)
      if (bad) return bad
      const id = `rep${this.nextReport++}`
      this.reports.set(id, { params, polls: 0 })
      return json({ report_run_id: id })
    }

    if (path === 'me') return json({ id: '55', name: 'CRM lectura' })
    if (path === 'me/adaccounts') return json(this.page(path, [this.account], params))
    if (path === `${this.account.id}/campaigns`)
      return json(this.page(path, this.campaigns, params))
    if (path === `${this.account.id}/adsets`) return json(this.page(path, this.adsets, params))
    if (path === `${this.account.id}/ads`) return json(this.page(path, this.ads, params))
    // Como la Graph API v26.0: «Root requests using GET /?ids=... return an error».
    if (path === '' || params.has('ids'))
      return this.error(400, 100, 'The ids query parameter is deprecated in v26.0+.')
    // Listado de creatividades de la cuenta (por páginas, con el tamaño de miniatura).
    if (path === `${this.account.id}/adcreatives`) {
      if (params.get('thumbnail_width') !== '320') return this.error(400, 100, 'sin tamaño')
      const fields = (params.get('fields') ?? 'id').split(',')
      const all = Object.values(this.creatives).map((c) =>
        Object.fromEntries(fields.filter((f) => f in c).map((f) => [f, c[f]])),
      )
      return json(this.page(path, all, params))
    }
    // Una creatividad por su ruta (GET /{id}).
    if (this.creatives[path] || /^cr\d+$/.test(path)) {
      if (this.opts.throttleCreatives)
        return this.error(400, 17, 'User request limit reached', 2446079)
      if (!this.creatives[path]) return this.error(400, 100, 'Unsupported get request.', 33)
      if (params.get('thumbnail_width') !== '320') return this.error(400, 100, 'sin tamaño')
      const fields = (params.get('fields') ?? 'id').split(',')
      const c = this.creatives[path]!
      return json(Object.fromEntries(fields.filter((f) => f in c).map((f) => [f, c[f]])))
    }
    if (path === `${this.account.id}/activities`)
      return json(this.page(path, this.activities, params))
    const node = /^(act_111|c1|s1)\/insights$/.exec(path)?.[1]
    if (node) {
      if (this.throttled < (this.opts.throttleFirst ?? 0)) {
        this.throttled++
        return this.error(400, 4, 'Too many calls', 1504022)
      }
      const bad = this.checkFields(params)
      if (bad) return bad
      const tr = JSON.parse(params.get('time_range')!) as { since: string; until: string }
      const level =
        params.get('level') ?? (node === 'c1' ? 'campaign' : node === 's1' ? 'adset' : 'account')
      if (this.opts.failSyncLevel === level)
        return this.error(500, 2, 'Service temporarily unavailable')
      const max = this.opts.maxSyncDays
      if (max && max.level === level && eachDay(tr.since, tr.until).length > max.days)
        return this.error(
          500,
          1,
          "Please reduce the amount of data you're asking for, then retry your request",
          99,
        )
      if (!params.get('time_increment'))
        return json(this.page(path, this.rangeRows(level, node, tr.since, tr.until), params))
      const bd = params.get('breakdowns')
      if (bd)
        return json(this.page(path, this.breakdownRows(level, tr.since, tr.until, bd), params))
      return json(this.page(path, this.rows(level, tr.since, tr.until), params))
    }
    const rep = /^(rep\d+)(\/insights)?$/.exec(path)
    if (rep) {
      const r = this.reports.get(rep[1]!)
      if (!r) return this.error(404, 100, 'Unknown report')
      if (!rep[2]) {
        r.polls++
        if (this.opts.failReports) return json({ id: rep[1], async_status: 'Job Failed' })
        return json({
          id: rep[1],
          async_status: r.polls > 1 ? 'Job Completed' : 'Job Running',
          async_percent_completion: r.polls > 1 ? 100 : 40,
        })
      }
      const tr = JSON.parse(r.params.get('time_range')!) as { since: string; until: string }
      const bd = r.params.get('breakdowns')
      const level = r.params.get('level')!
      return json(
        this.page(
          path,
          bd
            ? this.breakdownRows(level, tr.since, tr.until, bd)
            : this.rows(level, tr.since, tr.until),
          params,
        ),
      )
    }
    return this.error(404, 100, `Ruta desconocida ${path}`)
  }
}

/** PNG de 1×1 píxel (miniatura de la creatividad). */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** Tipos del BCE: USD a 1,10 entre semana; sin publicación los fines de semana. */
export const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-10-02'>
      <Cube currency='USD' rate='1.2500'/>
      <Cube currency='GBP' rate='0.85'/>
    </Cube>
    <Cube time='2026-10-01'>
      <Cube currency='USD' rate='1.1000'/>
      <Cube currency='GBP' rate='0.84'/>
    </Cube>
    <Cube time='2026-04-01'>
      <Cube currency='USD' rate='1.0000'/>
      <Cube currency='GBP' rate='0.80'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`
