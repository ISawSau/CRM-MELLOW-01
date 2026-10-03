/**
 * API de publicidad de LinkedIn simulada (versión 202609) con las llamadas que usa la
 * app: búsqueda de cuentas y campañas con pageToken y adAnalytics por campaña y día.
 */

export const FAKE_LI = 'https://linkedin.test/rest'
export const LI_TOKEN_OK = 'token-linkedin'

export class FakeLinkedIn {
  readonly calls: string[] = []
  constructor(readonly base = FAKE_LI) {}

  /** Gasto de una campaña un día (determinista). */
  static day(campaign: number, date: string) {
    const d = Number(date.slice(8, 10))
    return {
      cost: (campaign === 11 ? 20 : 5) + d / 10,
      impressions: 1000 + d * 10,
      clicks: 20 + d,
      lp: 10 + d,
      conv: d % 3,
      value: (d % 3) * 50,
    }
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const raw = String(input)
    const url = new URL(raw)
    this.calls.push(raw.replace(this.base, ''))
    const json = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
    const h = new Headers(init.headers)
    if (h.get('authorization') !== `Bearer ${LI_TOKEN_OK}`)
      return json({ status: 401, message: 'Invalid access token' }, 401)
    if (h.get('linkedin-version') !== '202609' || h.get('x-restli-protocol-version') !== '2.0.0')
      return json({ status: 400, message: 'Missing version headers' }, 400)

    const path = url.pathname.replace(new URL(this.base).pathname, '')
    if (path === '/adAccounts' && url.searchParams.get('q') === 'search') {
      // Dos páginas para probar el pageToken.
      if (!url.searchParams.get('pageToken'))
        return json({
          elements: [{ id: 501, name: 'Acme B2B', currency: 'USD', status: 'ACTIVE', test: false }],
          metadata: { nextPageToken: 'p2' },
        })
      return json({
        elements: [
          { id: 502, name: 'Pruebas', currency: 'EUR', status: 'ACTIVE', test: true },
          { id: 503, name: 'Acme Europa', currency: 'EUR', status: 'ACTIVE', test: false },
        ],
        metadata: {},
      })
    }
    const camp = /^\/adAccounts\/(\d+)\/adCampaigns$/.exec(path)
    if (camp)
      return json({
        elements:
          camp[1] === '501'
            ? [
                {
                  id: 11,
                  name: 'Leads directivos',
                  status: 'ACTIVE',
                  objectiveType: 'LEAD_GENERATION',
                  costType: 'CPC',
                  dailyBudget: { amount: '50', currencyCode: 'USD' },
                  runSchedule: { start: Date.parse('2026-01-01') },
                },
                { id: 12, name: 'Marca', status: 'PAUSED', objectiveType: 'BRAND_AWARENESS' },
              ]
            : [],
        metadata: {},
      })
    if (path === '/adAnalytics') {
      // dateRange=(start:(year:Y,month:M,day:D),end:(...)) en sintaxis Rest.li.
      const m =
        /dateRange=\(start:\(year:(\d+),month:(\d+),day:(\d+)\),end:\(year:(\d+),month:(\d+),day:(\d+)\)\)/.exec(
          raw,
        )
      const acc = /accounts=List\(urn%3Ali%3AsponsoredAccount%3A(\d+)\)/.exec(raw)
      if (!m || !acc || !raw.includes('pivot=CAMPAIGN') || !raw.includes('timeGranularity=DAILY'))
        return json({ status: 400, message: 'bad request' }, 400)
      const iso = (y: string, mo: string, d: string) =>
        `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
      const since = iso(m[1]!, m[2]!, m[3]!)
      const until = iso(m[4]!, m[5]!, m[6]!)
      const elements: unknown[] = []
      if (acc[1] === '501')
        for (let t = Date.parse(since); t <= Date.parse(until); t += 86_400_000) {
          const date = new Date(t).toISOString().slice(0, 10)
          // Solo hay actividad desde septiembre de 2026.
          if (date < '2026-09-01') continue
          for (const c of [11, 12]) {
            const v = FakeLinkedIn.day(c, date)
            const [y, mo, d] = date.split('-').map(Number)
            elements.push({
              dateRange: {
                start: { year: y, month: mo, day: d },
                end: { year: y, month: mo, day: d },
              },
              pivotValues: [`urn:li:sponsoredCampaign:${c}`],
              costInLocalCurrency: String(v.cost),
              impressions: v.impressions,
              clicks: v.clicks,
              landingPageClicks: v.lp,
              externalWebsiteConversions: v.conv,
              conversionValueInLocalCurrency: String(v.value),
            })
          }
        }
      return json({ elements, paging: { count: 10, start: 0, links: [] } })
    }
    return json({ status: 404 }, 404)
  }
}
