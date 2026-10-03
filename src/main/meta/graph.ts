import { createHmac } from 'node:crypto'
import { META_API_VERSION } from '@shared/meta'
import type { FetchLike } from '../sync/remote'
import { t } from '@shared/i18n'

/**
 * Cliente de la Graph API de Meta, **solo lectura** (SPEC §7.3, D-054).
 *
 * No hay un método genérico para escribir: solo GET y la creación de informes
 * asíncronos de Insights (POST /act_…/insights), que genera un informe y no toca
 * campañas, conjuntos ni anuncios.
 *
 * Límites (documentación «Rate Limiting» y «Insights API Error Codes»): se leen las
 * cabeceras X-FB-Ads-Insights-Throttle, X-Ad-Account-Usage y X-Business-Use-Case-Usage;
 * si el uso pasa del 75 % se frena, y ante los errores de límite se reintenta con
 * espera exponencial.
 */

export const GRAPH_URL = 'https://graph.facebook.com'

export class GraphError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly status: number,
  ) {
    super(message)
    this.name = 'GraphError'
  }

  /** Token caducado, revocado o sin permisos: no tiene sentido reintentar. */
  get isAuth(): boolean {
    return this.code === 190 || this.code === 102 || this.code === 10 || this.code === 200
  }

  /** Límite de uso alcanzado: reintentar más tarde. */
  get isThrottle(): boolean {
    return (
      this.code === 4 ||
      this.code === 17 ||
      this.code === 32 ||
      this.code === 613 ||
      (this.code !== null && this.code >= 80000 && this.code <= 80014)
    )
  }

  /**
   * Petición demasiado grande («Please reduce the amount of data you're asking for»):
   * repetirla igual no sirve; hay que pedir menos días o un informe asíncrono.
   */
  get isTooMuchData(): boolean {
    return (
      (this.code === 1 && /reduce the amount of data/i.test(this.message)) ||
      this.subcode === 1487534
    )
  }

  /** Error transitorio de Meta (tiempo agotado, intermitente, 5xx). */
  get isTransient(): boolean {
    if (this.isTooMuchData) return false
    return (
      this.status >= 500 ||
      this.code === 1 ||
      this.code === 2 ||
      (this.code === 100 && this.subcode === 1504018)
    )
  }
}

/** Mensaje para la interfaz, en el idioma activo. */
export function graphErrorText(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.code === 190) return t('El token de Meta ha caducado o se ha revocado: pega uno nuevo.')
    if (e.isAuth) return t('El token no tiene permiso para leer esta cuenta (hace falta ads_read).')
    if (e.isThrottle) return t('Meta ha limitado las consultas por exceso de uso: se reintentará.')
    return t('Meta respondió: {message}', { message: e.message })
  }
  if (e instanceof Error && e.name === 'AbortError') return t('Meta no respondió a tiempo.')
  return t('No se pudo conectar con Meta. Comprueba la conexión a internet.')
}

export interface Usage {
  /** Uso más alto de todos los indicadores (0–100). */
  pct: number
  /** Segundos de espera que sugiere Meta, si los da. */
  waitSeconds: number
}

/** Interpreta las cabeceras de consumo de Meta. */
export function parseUsage(headers: Headers): Usage {
  let pct = 0
  let waitSeconds = 0
  const json = (name: string): unknown => {
    const v = headers.get(name)
    if (!v) return null
    try {
      return JSON.parse(v)
    } catch {
      return null
    }
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const insights = json('x-fb-ads-insights-throttle') as Record<string, unknown> | null
  if (insights)
    pct = Math.max(pct, num(insights['app_id_util_pct']), num(insights['acc_id_util_pct']))
  const account = json('x-ad-account-usage') as Record<string, unknown> | null
  if (account) {
    pct = Math.max(pct, num(account['acc_id_util_pct']))
    waitSeconds = Math.max(waitSeconds, num(account['reset_time_duration']))
  }
  for (const name of ['x-business-use-case-usage', 'x-business-use-case']) {
    const buc = json(name) as Record<string, unknown> | null
    if (!buc) continue
    for (const list of Object.values(buc)) {
      if (!Array.isArray(list)) continue
      for (const u of list as Record<string, unknown>[]) {
        pct = Math.max(pct, num(u['call_count']), num(u['total_cputime']), num(u['total_time']))
        // Viene en minutos.
        waitSeconds = Math.max(waitSeconds, num(u['estimated_time_to_regain_access']) * 60)
      }
    }
  }
  const app = json('x-app-usage') as Record<string, unknown> | null
  if (app)
    pct = Math.max(pct, num(app['call_count']), num(app['total_cputime']), num(app['total_time']))
  return { pct, waitSeconds }
}

export interface GraphOptions {
  token: string
  appSecret?: string
  http?: FetchLike
  baseUrl?: string
  sleep?: (ms: number) => Promise<void>
  /** Reintentos ante errores transitorios. */
  retries?: number
  /**
   * Reintentos ante los límites de uso. Con el acceso de desarrollo Meta bloquea 5 minutos
   * al llegar al tope (60 consultas cada 5 minutos), así que se espera en vez de rendirse.
   */
  throttleRetries?: number
  /** Aviso de espera por los límites de Meta (ms; 0 al terminar la espera). */
  onWait?: (ms: number) => void
  timeoutMs?: number
}

type Params = Record<string, string | number | boolean | object>

export interface Page<T> {
  data: T[]
  paging?: { next?: string; cursors?: { after?: string } }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class GraphClient {
  private readonly base: string
  private readonly http: FetchLike
  private readonly sleep: (ms: number) => Promise<void>
  private readonly proof: string | null
  /** Último uso visto: sirve para frenar antes de llegar al límite. */
  lastUsage: Usage = { pct: 0, waitSeconds: 0 }

  constructor(private readonly opts: GraphOptions) {
    this.base = `${(opts.baseUrl ?? GRAPH_URL).replace(/\/$/, '')}/${META_API_VERSION}`
    this.http = opts.http ?? fetch
    this.sleep = opts.sleep ?? defaultSleep
    this.proof = opts.appSecret
      ? createHmac('sha256', opts.appSecret).update(opts.token).digest('hex')
      : null
  }

  private url(path: string, params: Params): string {
    const clean = path.replace(/^\//, '')
    // Desde la v26.0 Meta rechaza las peticiones a la raíz («GET /?ids=…»): hay que pedir
    // cada objeto por su ruta (changelog de la Graph API v26.0).
    if (!clean || 'ids' in params)
      throw new Error('Meta no admite peticiones a la raíz con «ids» desde la v26.0')
    const u = new URL(`${this.base}/${clean}`)
    for (const [k, v] of Object.entries(params))
      u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    if (this.proof) u.searchParams.set('appsecret_proof', this.proof)
    return u.toString()
  }

  /** Acepta solo URLs de paginación del mismo servidor y versión. */
  private checkNext(next: string): string {
    const u = new URL(next)
    const base = new URL(this.base)
    if (u.origin !== base.origin) throw new Error('Paginación de Meta no válida')
    // La URL de Meta ya lleva el token; se quita para enviarlo solo en la cabecera.
    u.searchParams.delete('access_token')
    if (this.proof) u.searchParams.set('appsecret_proof', this.proof)
    return u.toString()
  }

  private async request<T>(
    method: 'GET' | 'POST',
    url: string,
    body?: URLSearchParams,
  ): Promise<T> {
    const retries = this.opts.retries ?? 5
    const throttleRetries = this.opts.throttleRetries ?? 12
    let throttled = 0
    for (let attempt = 0; ; attempt++) {
      // Frenar antes de llegar al límite.
      if (this.lastUsage.pct >= 95) await this.wait(Math.max(60, this.lastUsage.waitSeconds) * 1000)
      else if (this.lastUsage.pct >= 75) await this.sleep(Math.round(this.lastUsage.pct * 100))
      let res: Response
      try {
        res = await this.http(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.opts.token}`,
            ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          ...(body ? { body } : {}),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
        })
      } catch (e) {
        if (attempt >= retries) throw e
        await this.sleep(backoff(attempt))
        continue
      }
      this.lastUsage = parseUsage(res.headers)
      const json = (await res.json().catch(() => null)) as
        (T & { error?: { message?: string; code?: number; error_subcode?: number } }) | null
      if (res.ok && json && !json.error) return json
      const err = json?.error
      const e = new GraphError(
        err?.message ?? `HTTP ${res.status}`,
        err?.code ?? null,
        err?.error_subcode ?? null,
        res.status,
      )
      if (e.isThrottle && throttled < throttleRetries) {
        // Lo que pida Meta o, si no lo dice, espera exponencial (máximo 5 minutos).
        await this.wait(
          Math.max(backoff(Math.min(throttled + 2, 7)), this.lastUsage.waitSeconds * 1000),
        )
        throttled++
        continue
      }
      if (e.isTransient && attempt < retries) {
        await this.sleep(backoff(attempt))
        continue
      }
      throw e
    }
  }

  /** Espera por los límites de Meta, avisando para que la interfaz lo muestre. */
  private async wait(ms: number): Promise<void> {
    this.opts.onWait?.(ms)
    try {
      await this.sleep(ms)
    } finally {
      this.opts.onWait?.(0)
    }
  }

  get<T>(path: string, params: Params = {}): Promise<T> {
    return this.request<T>('GET', this.url(path, params))
  }

  /** Recorre todas las páginas de un listado. */
  async getAll<T>(path: string, params: Params = {}, onPage?: (n: number) => void): Promise<T[]> {
    const out: T[] = []
    let page = await this.get<Page<T>>(path, params)
    for (;;) {
      out.push(...page.data)
      onPage?.(out.length)
      const next = page.paging?.next
      if (!next || page.data.length === 0) return out
      page = await this.request<Page<T>>('GET', this.checkNext(next))
    }
  }

  /** El mismo cliente, con otro número de reintentos ante los límites de uso. */
  withThrottleRetries(n: number): GraphClient {
    const c = new GraphClient({ ...this.opts, throttleRetries: n })
    c.lastUsage = this.lastUsage
    return c
  }

  /** Recorre las páginas de un listado mientras `onPage` devuelva true. */
  async eachPage<T>(path: string, params: Params, onPage: (items: T[]) => boolean): Promise<void> {
    let page = await this.get<Page<T>>(path, params)
    for (;;) {
      if (!onPage(page.data)) return
      const next = page.paging?.next
      if (!next || page.data.length === 0) return
      page = await this.request<Page<T>>('GET', this.checkNext(next))
    }
  }

  /** Crea un informe asíncrono de Insights y devuelve su id (report_run_id). */
  async createInsightsReport(accountId: string, params: Params): Promise<string> {
    if (!/^act_\d+$/.test(accountId)) throw new Error('Cuenta publicitaria no válida')
    const body = new URLSearchParams()
    for (const [k, v] of Object.entries(params))
      body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    if (this.proof) body.set('appsecret_proof', this.proof)
    const r = await this.request<{ report_run_id?: string }>(
      'POST',
      `${this.base}/${accountId}/insights`,
      body,
    )
    if (!r.report_run_id) throw new GraphError('Meta no devolvió el informe', null, null, 200)
    return r.report_run_id
  }
}

/** Espera exponencial con algo de azar: 2 s, 4 s, 8 s… (máximo 5 minutos). */
export function backoff(attempt: number): number {
  const base = Math.min(300_000, 2000 * 2 ** attempt)
  return Math.round(base * (0.75 + Math.random() * 0.5))
}
