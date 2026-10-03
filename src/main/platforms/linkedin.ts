import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { InsightRow } from '../meta/store'
import type { FetchLike } from '../sync/remote'
import { t } from '@shared/i18n'

/**
 * API de publicidad de LinkedIn en solo lectura (SPEC §7.4, D-079). Comprobado en la
 * documentación oficial (Marketing API, versión 202609):
 * - OAuth 2.0 de 3 patas con `r_ads` (cuentas y campañas) y `r_ads_reporting` (métricas);
 *   el token dura 60 días y no hay token de actualización salvo para socios.
 * - `GET /rest/adAccounts?q=search` y `GET /rest/adAccounts/{id}/adCampaigns?q=search`,
 *   con paginación por `pageSize` (máx. 1.000) y `pageToken` (`metadata.nextPageToken`).
 * - `GET /rest/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY` con las
 *   métricas en `fields` (máx. 20) y hasta 15.000 elementos por respuesta, sin paginación.
 * - Cabeceras `Linkedin-Version: AAAAMM` y `X-Restli-Protocol-Version: 2.0.0`.
 */

export const LI_API = 'https://api.linkedin.com/rest'
export const LI_AUTH = 'https://www.linkedin.com/oauth/v2/authorization'
export const LI_TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken'
export const LI_VERSION = '202609'
export const LI_SCOPES = 'r_ads r_ads_reporting'
/** Dirección de vuelta fija: LinkedIn exige registrarla tal cual en la app. */
export const LI_PORT = 53135
export const LI_REDIRECT = `http://localhost:${LI_PORT}/linkedin`
const LOGIN_TIMEOUT_MS = 5 * 60_000

export const LI_FIELDS = [
  'dateRange',
  'pivotValues',
  'costInLocalCurrency',
  'impressions',
  'clicks',
  'landingPageClicks',
  'externalWebsiteConversions',
  'conversionValueInLocalCurrency',
]

export class LinkedInError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export interface LinkedInAccount {
  id: number
  name: string
  currency: string
  status: string
  test: boolean
}

export interface LinkedInCampaign {
  id: number
  name: string
  status: string | null
  objectiveType: string | null
  costType: string | null
  dailyBudget: number | null
  totalBudget: number | null
  start: string | null
  end: string | null
}

const iso = (ms: unknown) => (typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null)
const money = (v: unknown) => {
  const n = Number((v as { amount?: string } | undefined)?.amount)
  return Number.isFinite(n) ? n : null
}

/** «2026-09-01» → «(year:2026,month:9,day:1)» (sintaxis Rest.li 2.0). */
export function liDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return `(year:${y},month:${m},day:${d})`
}

export class LinkedInClient {
  constructor(
    private readonly token: string,
    private readonly http: FetchLike = fetch,
    private readonly base = LI_API,
  ) {}

  private async get(path: string): Promise<Record<string, unknown>> {
    let res: Response
    try {
      res = await this.http(`${this.base}${path}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Linkedin-Version': LI_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      })
    } catch {
      throw new LinkedInError(t('Sin conexión con LinkedIn.'), 0)
    }
    if (res.ok) return (await res.json()) as Record<string, unknown>
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    const msg =
      res.status === 401
        ? t('LinkedIn ha rechazado el token (caducado o retirado): vuelve a conectar.')
        : res.status === 403
          ? t('LinkedIn no da acceso: la app necesita la API de publicidad aprobada y tu usuario un rol en la cuenta.')
          : res.status === 429
            ? t('LinkedIn pide esperar (límite de datos en 5 minutos). Se reintentará más tarde.')
            : t('LinkedIn ha respondido con un error ({status}){detail}.', {
                status: res.status,
                detail: body.message ? `: ${body.message}` : '',
              })
    throw new LinkedInError(msg, res.status)
  }

  /** Todas las páginas de una búsqueda con `pageToken`. */
  private async search(path: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = []
    let token: string | null = null
    for (let i = 0; i < 50; i++) {
      const page = await this.get(
        `${path}${path.includes('?') ? '&' : '?'}pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`,
      )
      out.push(...((page['elements'] as Record<string, unknown>[] | undefined) ?? []))
      token = ((page['metadata'] as { nextPageToken?: string } | undefined)?.nextPageToken ??
        null) as string | null
      if (!token) break
    }
    return out
  }

  async accounts(): Promise<LinkedInAccount[]> {
    const list = await this.search('/adAccounts?q=search')
    return list.map((a) => ({
      id: Number(a['id']),
      name: String(a['name'] ?? a['id']),
      currency: String(a['currency'] ?? 'USD'),
      status: String(a['status'] ?? 'ACTIVE'),
      test: a['test'] === true,
    }))
  }

  async campaigns(accountId: number): Promise<LinkedInCampaign[]> {
    const list = await this.search(`/adAccounts/${accountId}/adCampaigns?q=search`)
    return list.map((c) => {
      const run = c['runSchedule'] as { start?: number; end?: number } | undefined
      return {
        id: Number(c['id']),
        name: String(c['name'] ?? c['id']),
        status: typeof c['status'] === 'string' ? c['status'] : null,
        objectiveType: typeof c['objectiveType'] === 'string' ? c['objectiveType'] : null,
        costType: typeof c['costType'] === 'string' ? c['costType'] : null,
        dailyBudget: money(c['dailyBudget']),
        totalBudget: money(c['totalBudget']),
        start: iso(run?.start),
        end: iso(run?.end),
      }
    })
  }

  /** Métricas diarias por campaña de una cuenta entre dos fechas (incluidas, UTC). */
  async analytics(accountId: number, since: string, until: string): Promise<LinkedInDaily[]> {
    const urn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`)
    const json = await this.get(
      `/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY` +
        `&dateRange=(start:${liDate(since)},end:${liDate(until)})` +
        `&accounts=List(${urn})&fields=${LI_FIELDS.join(',')}`,
    )
    const out: LinkedInDaily[] = []
    for (const e of (json['elements'] as Record<string, unknown>[] | undefined) ?? []) {
      const start = (e['dateRange'] as { start?: { year: number; month: number; day: number } })
        ?.start
      const pivot = (e['pivotValues'] as string[] | undefined)?.[0] ?? ''
      const id = /sponsoredCampaign:(\d+)$/.exec(pivot)?.[1]
      if (!start || !id) continue
      const pad = (n: number) => String(n).padStart(2, '0')
      const n = (k: string) => {
        const v = Number(e[k])
        return Number.isFinite(v) ? v : 0
      }
      out.push({
        campaignId: Number(id),
        date: `${start.year}-${pad(start.month)}-${pad(start.day)}`,
        spend: n('costInLocalCurrency'),
        impressions: n('impressions'),
        clicks: n('clicks'),
        landingPageClicks: n('landingPageClicks'),
        conversions: n('externalWebsiteConversions'),
        value: n('conversionValueInLocalCurrency'),
      })
    }
    return out
  }
}

export interface LinkedInDaily {
  campaignId: number
  date: string
  spend: number
  impressions: number
  clicks: number
  landingPageClicks: number
  conversions: number
  value: number
}

/** Fila diaria de LinkedIn → fila de métricas de la app (conversiones como compras). */
export function liInsightRow(
  d: Omit<LinkedInDaily, 'campaignId'>,
  campaign: { id: string; name: string } | null,
): InsightRow {
  return {
    ...(campaign ? { campaign_id: campaign.id, campaign_name: campaign.name } : {}),
    date_start: d.date,
    spend: d.spend,
    impressions: d.impressions,
    clicks: d.clicks,
    inline_link_clicks: d.landingPageClicks,
    ...(d.conversions ? { actions: [{ action_type: 'purchase', value: d.conversions }] } : {}),
    ...(d.value ? { action_values: [{ action_type: 'purchase', value: d.value }] } : {}),
  }
}

/**
 * Inicio de sesión con LinkedIn: abre el navegador y espera el código en
 * http://localhost:53135/linkedin (dirección registrada en la app de LinkedIn), con
 * `state` contra CSRF. Devuelve el token de acceso y su caducidad.
 */
export async function connectLinkedIn(
  client: { clientId: string; clientSecret: string },
  openBrowser: (url: string) => void,
  http: FetchLike = fetch,
  opts: { tokenUrl?: string; port?: number } = {},
): Promise<{ accessToken: string; expiresAt: number }> {
  const state = randomBytes(16).toString('base64url')
  const port = opts.port ?? LI_PORT
  const redirect = `http://localhost:${port}/linkedin`
  const servers: Server[] = []
  const close = () => servers.forEach((s) => s.close())
  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      close()
      reject(new Error(t('Se agotó el tiempo para conectar con LinkedIn.')))
    }, LOGIN_TIMEOUT_MS)
    const handler = (
      req: import('node:http').IncomingMessage,
      res: import('node:http').ServerResponse,
    ) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/linkedin') {
        res.writeHead(404).end()
        return
      }
      const got = url.searchParams.get('code')
      const ok = got && url.searchParams.get('state') === state
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><title>CRM Mellow</title><body style="font-family:sans-serif;background:#0d0908;color:#fdf6ee;display:grid;place-items:center;height:100vh;margin:0"><p>${ok ? t('Conectado con LinkedIn. Ya puedes volver a CRM Mellow.') : t('No se ha conectado. Vuelve a CRM Mellow e inténtalo de nuevo.')}</p></body>`,
      )
      clearTimeout(timer)
      close()
      if (ok) resolve(got)
      else
        reject(
          new Error(
            url.searchParams.get('error') === 'user_cancelled_authorize'
              ? t('Has cancelado la conexión.')
              : t('Respuesta de LinkedIn no válida.'),
          ),
        )
    }
    // «localhost» puede resolverse a IPv4 o a IPv6: se escucha en las dos (solo en local).
    let listening = 0
    let failed = 0
    for (const host of ['127.0.0.1', '::1']) {
      const s = createServer(handler)
      servers.push(s)
      s.on('error', () => {
        failed++
        if (failed === 2) {
          clearTimeout(timer)
          reject(
            new Error(t('El puerto {port} está ocupado: cierra lo que lo use e inténtalo otra vez.', { port })),
          )
        }
      })
      s.listen(port, host, () => {
        if (++listening === 1) {
          const params = new URLSearchParams({
            response_type: 'code',
            client_id: client.clientId,
            redirect_uri: redirect,
            state,
            scope: LI_SCOPES,
          })
          openBrowser(`${LI_AUTH}?${params}`)
        }
      })
    }
  })
  const res = await http(opts.tokenUrl ?? LI_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirect,
    }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string
    expires_in?: number
    error_description?: string
  }
  if (!res.ok || !json.access_token)
    throw new Error(json.error_description ?? t('LinkedIn no ha dado acceso.'))
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 60 * 86_400) * 1000,
  }
}
