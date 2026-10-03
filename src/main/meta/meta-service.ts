import { z } from 'zod'
import { AppError } from '@shared/errors'
import { shiftDate, todayIn } from '@shared/data/dates'
import {
  BREAKDOWNS,
  META_HISTORY_MONTHS,
  PERF_LEVELS,
  breakdownConfigSchema,
  metaSettingsSchema,
  rangeFetchSchema,
  type AdAccountInfo,
  type AdSearchHit,
  type BreakdownConfig,
  type BreakdownKey,
  type CreativeLinkInfo,
  type CreativePerfResult,
  type MetaSettings,
  type MetaStatus,
  type TableQuery,
  type TableResult,
  type TagPerfResult,
} from '@shared/meta'
import { metaTableSettingsSchema, type MetaTableSettings } from '@shared/meta-metrics'
import type { SqliteDb } from '../db/connection'
import type { FetchLike } from '../sync/remote'
import { CHANGES_KEY } from '../sync/sync-service'
import type { VaultService } from '../vault/vault-service'
import { updateRates } from './fx'
import { GraphClient, GraphError, graphErrorText } from './graph'
import { autoLink, creativePerf, linksFor, searchAds, setLink, tagPerf } from './creatives'
import { table } from './table'
import {
  INSIGHT_LEVELS,
  getAccount,
  replaceBreakdowns,
  replaceInsights,
  storeRangeStats,
  upsertAccounts,
  upsertCreatives,
  upsertObjects,
  type AccountRow,
  type InsightLevel,
  type InsightRow,
} from './store'

/**
 * Sincronización con Meta en solo lectura (SPEC §7.3, D-054…D-058).
 *
 * - Con la app abierta y la bóveda desbloqueada, cada hora por defecto.
 * - Cada vez: estructura (campañas, conjuntos, anuncios, creatividades) y métricas
 *   diarias desde el último día descargado menos la ventana de atribución hasta hoy
 *   (en la zona horaria de la cuenta), así que rellena cualquier hueco.
 * - Al activar una cuenta: los últimos 30 días enseguida y después el histórico hasta
 *   el límite de Meta (37 meses) con informes asíncronos por meses, guardados en
 *   `ad_jobs` para seguir donde se quedó si se cierra la app.
 */

const CONFIG_KEY = 'meta.config'
const SETTINGS_KEY = 'meta.settings'
const TABLE_KEY = 'meta.table'
/** Días que se descargan al activar una cuenta, antes del histórico. */
const FIRST_DAYS = 30
/** Días por petición síncrona de Insights. */
const CHUNK_DAYS = 10
/** Los informes asíncronos caducan a los 30 días: a partir de 25 se piden de nuevo. */
const REPORT_TTL_MS = 25 * 86_400_000
const MAX_JOB_ATTEMPTS = 3
const THUMB_MAX_BYTES = 5 * 1024 * 1024

const configSchema = z.object({
  token: z.string().min(1),
  appSecret: z.string().default(''),
  user: z.string().nullable().default(null),
})
type MetaConfig = z.infer<typeof configSchema>

const ACCOUNT_FIELDS = 'id,name,currency,timezone_name,account_status,business,created_time'
const CAMPAIGN_FIELDS =
  'id,name,status,configured_status,effective_status,objective,bid_strategy,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,buying_type,updated_time'
const ADSET_FIELDS =
  'id,name,campaign_id,status,configured_status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,budget_remaining,start_time,end_time,attribution_spec,destination_type,updated_time'
const AD_FIELDS =
  'id,name,campaign_id,adset_id,status,configured_status,effective_status,creative,created_time,updated_time'
const CREATIVE_FIELDS =
  'id,name,title,body,thumbnail_url,image_url,video_id,object_type,call_to_action_type,link_url'

/** Campos de Insights que siempre se piden. */
const CORE_FIELDS = [
  'account_id',
  'date_start',
  'date_stop',
  'spend',
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'inline_link_clicks',
  'inline_link_click_ctr',
  'cpm',
  'cpc',
  'actions',
  'action_values',
]
/**
 * Campos que se piden si Meta los acepta: si una versión de la API rechaza alguno,
 * se quita y se sigue sin él (D-055).
 */
const OPTIONAL_FIELDS = [
  'unique_inline_link_clicks',
  'unique_inline_link_click_ctr',
  'purchase_roas',
  'video_play_actions',
  'video_thruplay_watched_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p100_watched_actions',
  'video_30_sec_watched_actions',
  'results',
  'cost_per_result',
  'attribution_setting',
]
const AD_ONLY_FIELDS = ['quality_ranking', 'engagement_rate_ranking', 'conversion_rate_ranking']
/** Campos de las filas desglosadas (sumables). */
const BREAKDOWN_FIELDS = [
  'account_id',
  'date_start',
  'spend',
  'impressions',
  'clicks',
  'inline_link_clicks',
  'actions',
  'action_values',
]
/** Campos no sumables del periodo completo. */
const RANGE_FIELDS = ['reach', 'frequency']
const RANGE_OPTIONAL = ['unique_inline_link_clicks', 'unique_inline_link_click_ctr']
/**
 * Tipos del historial de actividad que cuentan como «edición significativa»
 * (presupuesto, puja, segmentación, optimización, creatividad, calendario).
 */
const SIGNIFICANT_EVENTS = new Set([
  'create_campaign_group',
  'update_campaign_budget',
  'update_campaign_schedule',
  'update_campaign_group_spend_cap',
  'update_campaign_budget_optimization_toggling_status',
  'update_campaign_conversion_goal',
  'update_campaign_delivery_type',
  'update_campaign_budget_split',
  'create_ad_set',
  'update_ad_set_bidding',
  'update_ad_set_bid_strategy',
  'update_ad_set_budget',
  'update_ad_set_duration',
  'update_ad_set_optimization_goal',
  'update_ad_set_target_spec',
  'update_ad_set_bid_adjustments',
  'update_ad_set_spend_cap',
  'update_ad_set_min_spend_target',
  'update_ad_set_cost_bidding_mode',
  'create_ad',
  'update_ad_creative',
  'edit_and_update_ad_creative',
  'update_ad_bid_info',
  'update_ad_bid_type',
  'update_ad_targets_spec',
])
const LEVEL_FIELDS: Record<InsightLevel, string[]> = {
  account: [],
  campaign: ['campaign_id', 'campaign_name'],
  adset: ['campaign_id', 'adset_id', 'adset_name'],
  ad: ['campaign_id', 'adset_id', 'ad_id', 'ad_name'],
}

export interface MetaServiceOptions {
  onChange?: (s: MetaStatus) => void
  /** Han llegado datos nuevos (para refrescar la interfaz). */
  onData?: () => void
  /** Ha terminado una sincronización (para comprobar las alertas). */
  onSynced?: () => void
  http?: FetchLike
  /** Servidor de la Graph API (solo para pruebas). */
  graphUrl?: string
  /** Servidor del BCE (solo para pruebas). */
  ecbUrl?: string
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  /** Espera entre consultas del estado de un informe asíncrono. */
  pollMs?: number
}

interface JobRow {
  id: number
  account_id: string
  level: InsightLevel
  breakdown: BreakdownKey | null
  since: string
  until: string
  status: string
  report_run_id: string | null
  started_at: string | null
  attempts: number
}

/** Fecha de la cuenta (AAAA-MM-DD) desplazada `n` meses, sin pasarse de fin de mes. */
export function shiftMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, last))
  return target.toISOString().slice(0, 10)
}

/** Primer día que Meta deja pedir: hace 37 meses (más un día de margen). */
export function historyLimit(today: string): string {
  return shiftDate(shiftMonths(today, -META_HISTORY_MONTHS), 1)
}

/** Divide [since, until] en trozos de `days` días, del más reciente al más antiguo. */
export function chunks(since: string, until: string, days: number): [string, string][] {
  const out: [string, string][] = []
  let end = until
  while (end >= since) {
    const start = shiftDate(end, -(days - 1))
    out.push([start < since ? since : start, end])
    end = shiftDate(start, -1)
  }
  return out
}

/** Meses naturales entre dos fechas, del más reciente al más antiguo. */
export function monthChunks(since: string, until: string): [string, string][] {
  const out: [string, string][] = []
  let end = until
  while (end >= since) {
    const first = `${end.slice(0, 7)}-01`
    out.push([first < since ? since : first, end])
    end = shiftDate(first, -1)
  }
  return out
}

export class MetaService {
  private phase: MetaStatus['phase'] = 'idle'
  private error: string | null = null
  private progress: MetaStatus['progress'] = null
  private running: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  /** Cambia al bloquear: una sincronización en curso de antes se detiene. */
  private epoch = 0
  private rejected = new Set<string>()
  private lastDataPing = 0

  constructor(
    private readonly vault: VaultService,
    private readonly opts: MetaServiceOptions = {},
  ) {}

  // --- Estado y ajustes ----------------------------------------------------------

  private get db(): SqliteDb {
    return this.vault.sqlite
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date()
  }

  private get unlocked(): boolean {
    return this.vault.status().state === 'unlocked'
  }

  private read(key: string): unknown {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return r ? JSON.parse(r.value) : undefined
  }

  private write(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), this.now().toISOString())
  }

  /** Cambio del usuario: cuenta para la sincronización entre equipos. */
  private touched(): void {
    const n = this.read(CHANGES_KEY)
    this.write(CHANGES_KEY, (typeof n === 'number' ? n : 0) + 1)
  }

  private config(): MetaConfig | null {
    const r = configSchema.safeParse(this.read(CONFIG_KEY))
    return r.success ? r.data : null
  }

  settings(): MetaSettings {
    const r = metaSettingsSchema.safeParse(this.read(SETTINGS_KEY) ?? {})
    return r.success ? r.data : metaSettingsSchema.parse({})
  }

  setSettings(s: MetaSettings): MetaStatus {
    const before = this.settings()
    this.write(SETTINGS_KEY, metaSettingsSchema.parse(s))
    this.touched()
    if (before.intervalMinutes !== s.intervalMinutes && this.timer) this.schedule()
    return this.emit()
  }

  status(): MetaStatus {
    if (!this.unlocked)
      return {
        connected: false,
        user: null,
        phase: 'idle',
        error: null,
        progress: null,
        lastSyncAt: null,
        settings: metaSettingsSchema.parse({}),
      }
    const cfg = this.config()
    const last = this.db
      .prepare(
        "SELECT MAX(last_sync_at) AS t FROM ad_accounts WHERE enabled = 1 AND platform = 'meta'",
      )
      .get() as { t: string | null }
    return {
      connected: cfg !== null,
      user: cfg?.user ?? null,
      phase: this.phase,
      error: this.error,
      progress: this.progress,
      lastSyncAt: last.t,
      settings: this.settings(),
    }
  }

  private emit(): MetaStatus {
    const s = this.status()
    this.opts.onChange?.(s)
    return s
  }

  private dataChanged(force = false): void {
    const t = Date.now()
    if (!force && t - this.lastDataPing < 2000) return
    this.lastDataPing = t
    this.opts.onData?.()
  }

  private client(cfg: { token: string; appSecret: string }): GraphClient {
    return new GraphClient({
      token: cfg.token,
      appSecret: cfg.appSecret || undefined,
      ...(this.opts.http ? { http: this.opts.http } : {}),
      ...(this.opts.graphUrl ? { baseUrl: this.opts.graphUrl } : {}),
      ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
    })
  }

  // --- Conexión ------------------------------------------------------------------

  /** Comprueba el token, lo guarda cifrado y lista las cuentas a las que da acceso. */
  async connect(input: { token: string; appSecret: string }): Promise<MetaStatus> {
    const graph = this.client(input)
    let user: string
    let accounts: Record<string, unknown>[]
    try {
      const me = await graph.get<{ id: string; name?: string }>('me', { fields: 'id,name' })
      user = me.name ?? me.id
      accounts = await graph.getAll<Record<string, unknown>>('me/adaccounts', {
        fields: ACCOUNT_FIELDS,
        limit: 200,
      })
    } catch (e) {
      throw new AppError('UNKNOWN', undefined, graphErrorText(e))
    }
    this.write(CONFIG_KEY, { token: input.token, appSecret: input.appSecret, user })
    upsertAccounts(this.db, accounts, this.now().toISOString())
    this.touched()
    this.error = null
    this.phase = 'idle'
    return this.emit()
  }

  /** Olvida el token. Los datos descargados se quedan (se pueden seguir viendo). */
  disconnect(): MetaStatus {
    this.epoch++
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(CONFIG_KEY)
    this.touched()
    this.phase = 'idle'
    this.error = null
    this.progress = null
    return this.emit()
  }

  async refreshAccounts(): Promise<AdAccountInfo[]> {
    const cfg = this.config()
    if (!cfg) throw new AppError('UNKNOWN', undefined, 'Conecta primero con Meta.')
    try {
      const accounts = await this.client(cfg).getAll<Record<string, unknown>>('me/adaccounts', {
        fields: ACCOUNT_FIELDS,
        limit: 200,
      })
      upsertAccounts(this.db, accounts, this.now().toISOString())
    } catch (e) {
      throw new AppError('UNKNOWN', undefined, graphErrorText(e))
    }
    return this.listAccounts()
  }

  listAccounts(): AdAccountInfo[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM ad_accounts WHERE platform = 'meta' ORDER BY enabled DESC, name COLLATE NOCASE",
      )
      .all() as AccountRow[]
    const jobs = this.db
      .prepare(
        `SELECT account_id, SUM(status = 'done') AS done, SUM(status = 'failed') AS failed,
                COUNT(*) AS total FROM ad_jobs GROUP BY account_id`,
      )
      .all() as { account_id: string; done: number; failed: number; total: number }[]
    const byAccount = new Map(jobs.map((j) => [j.account_id, j]))
    return rows.map((r) => {
      const j = byAccount.get(r.id)
      return {
        id: r.id,
        name: r.name,
        currency: r.currency,
        timezone: r.timezone,
        status: r.status,
        business: r.business,
        enabled: !!r.enabled,
        clientId: r.client_id,
        dataFrom: r.data_from,
        dataUntil: r.data_until,
        historyDone: !!r.history_done,
        history: j && !r.history_done ? { done: j.done, total: j.total, failed: j.failed } : null,
        lastSyncAt: r.last_sync_at,
        lastError: r.last_error,
        breakdowns: breakdownConfigSchema.parse(r.breakdowns ? JSON.parse(r.breakdowns) : {}),
      }
    })
  }

  /** Cuentas asignadas a un cliente (para su ficha). */
  accountsForClient(clientId: string): AdAccountInfo[] {
    return this.listAccounts().filter((a) => a.clientId === clientId)
  }

  updateAccount(input: {
    id: string
    enabled?: boolean
    clientId?: string | null
  }): AdAccountInfo[] {
    const a = getAccount(this.db, input.id)
    if (!a) throw new AppError('INVALID_INPUT', undefined, 'No existe esa cuenta o ese cliente.')
    if (input.clientId !== undefined) {
      if (input.clientId !== null) {
        const ok = this.db
          .prepare(
            "SELECT 1 FROM records WHERE id = ? AND entity = 'cliente' AND deleted_at IS NULL",
          )
          .get(input.clientId)
        if (!ok)
          throw new AppError('INVALID_INPUT', undefined, 'No existe esa cuenta o ese cliente.')
      }
      this.db.prepare('UPDATE ad_accounts SET client_id = ? WHERE id = ?').run(input.clientId, a.id)
    }
    if (input.enabled !== undefined) {
      this.db
        .prepare('UPDATE ad_accounts SET enabled = ? WHERE id = ?')
        .run(input.enabled ? 1 : 0, a.id)
    }
    this.touched()
    const list = this.listAccounts()
    this.emit()
    // Al activar una cuenta se empieza a descargar enseguida.
    if (input.enabled && !a.enabled) void this.syncNow().catch(() => {})
    return list
  }

  /** Vuelve a intentar los trozos del histórico que fallaron. */
  retryHistory(accountId: string): void {
    this.db
      .prepare(
        "UPDATE ad_jobs SET status = 'pending', attempts = 0, error = NULL, report_run_id = NULL WHERE account_id = ? AND status = 'failed'",
      )
      .run(accountId)
    this.db.prepare('UPDATE ad_accounts SET history_done = 0 WHERE id = ?').run(accountId)
    void this.syncNow().catch(() => {})
  }

  table(q: TableQuery): TableResult {
    return table(this.db, q, this.settings().displayCurrency)
  }

  tableSettings(): MetaTableSettings {
    const r = metaTableSettingsSchema.safeParse(this.read(TABLE_KEY) ?? {})
    return r.success ? r.data : metaTableSettingsSchema.parse({})
  }

  setTableSettings(s: MetaTableSettings): MetaTableSettings {
    const before = this.tableSettings()
    const next = metaTableSettingsSchema.parse(s)
    this.write(TABLE_KEY, next)
    this.touched()
    if (JSON.stringify(before.naming) !== JSON.stringify(next.naming)) this.runAutoLink()
    this.emit()
    return next
  }

  /** Tipos de acción vistos (para las métricas propias). */
  actionTypes(): string[] {
    return (
      this.db.prepare('SELECT action_type FROM ad_action_types ORDER BY action_type').all() as {
        action_type: string
      }[]
    ).map((r) => r.action_type)
  }

  // --- Creatividades ---------------------------------------------------------------

  searchAds(text: string): AdSearchHit[] {
    return searchAds(this.db, text)
  }

  creativeLinks(recordId: string): CreativeLinkInfo[] {
    return linksFor(this.db, recordId)
  }

  setCreativeLink(recordId: string, adId: string, linked: boolean): CreativeLinkInfo[] {
    setLink(this.db, recordId, adId, linked, this.now().toISOString())
    this.touched()
    this.dataChanged(true)
    return linksFor(this.db, recordId)
  }

  creativePerf(recordId: string, since: string, until: string): CreativePerfResult {
    return creativePerf(this.db, recordId, since, until, this.settings().displayCurrency)
  }

  tagPerf(fieldId: string, since: string, until: string, clientId: string | null): TagPerfResult {
    return tagPerf(
      this.db,
      this.vault.data,
      fieldId,
      since,
      until,
      this.settings().displayCurrency,
      clientId,
    )
  }

  /** Vincula anuncios y creatividades por código o convención. Devuelve los nuevos. */
  runAutoLink(): number {
    const n = autoLink(
      this.db,
      this.vault.data,
      this.tableSettings().naming,
      this.now().toISOString(),
    )
    if (n) this.dataChanged(true)
    return n
  }

  // --- Desgloses y periodo ---------------------------------------------------------

  /**
   * Activa o desactiva desgloses por nivel. Los nuevos se descargan para todo lo que ya
   * hay (informes asíncronos por meses) y, después, en cada sincronización.
   */
  setBreakdowns(accountId: string, config: BreakdownConfig): AdAccountInfo[] {
    const a = getAccount(this.db, accountId)
    if (!a) throw new AppError('INVALID_INPUT', undefined, 'No existe esa cuenta.')
    const before = breakdownConfigSchema.parse(a.breakdowns ? JSON.parse(a.breakdowns) : {})
    const next = breakdownConfigSchema.parse(config)
    this.db
      .prepare('UPDATE ad_accounts SET breakdowns = ? WHERE id = ?')
      .run(JSON.stringify(next), accountId)
    const ins = this.db.prepare(
      "INSERT INTO ad_jobs (account_id, level, breakdown, since, until, status) VALUES (?, ?, ?, ?, ?, 'pending')",
    )
    let added = 0
    this.db.transaction(() => {
      for (const level of PERF_LEVELS) {
        for (const key of before[level].filter((k) => !next[level].includes(k))) {
          this.db
            .prepare('DELETE FROM ad_jobs WHERE account_id = ? AND level = ? AND breakdown = ?')
            .run(accountId, level, key)
          this.db
            .prepare(
              'DELETE FROM ad_breakdowns WHERE account_id = ? AND level = ? AND breakdown = ?',
            )
            .run(accountId, level, key)
        }
        if (!a.data_from || !a.data_until) continue
        for (const key of next[level].filter((k) => !before[level].includes(k)))
          for (const [s, u] of monthChunks(a.data_from, a.data_until)) {
            ins.run(accountId, level, key, s, u)
            added++
          }
      }
    })()
    if (added)
      this.db.prepare('UPDATE ad_accounts SET history_done = 0 WHERE id = ?').run(accountId)
    this.touched()
    const list = this.listAccounts()
    this.emit()
    if (added) void this.syncNow().catch(() => {})
    return list
  }

  /** Pide a Meta alcance, frecuencia y únicos del periodo (no se pueden sumar por días). */
  async fetchRange(input: {
    accountId: string
    level: (typeof PERF_LEVELS)[number]
    parentId?: string | null
    since: string
    until: string
  }): Promise<void> {
    const q = rangeFetchSchema.parse(input)
    const cfg = this.config()
    if (!cfg) throw new AppError('UNKNOWN', undefined, 'Conecta primero con Meta.')
    const graph = this.client(cfg)
    const node = q.parentId ?? q.accountId
    const parentLevel: InsightLevel = q.parentId
      ? q.level === 'adset'
        ? 'campaign'
        : 'adset'
      : 'account'
    const now = this.now().toISOString()
    try {
      for (const [level, params] of [
        [q.level, { level: q.level }],
        [parentLevel, {}],
      ] as const) {
        for (;;) {
          try {
            const rows = await graph.getAll<InsightRow>(`${node}/insights`, {
              ...params,
              fields: [
                ...LEVEL_FIELDS[level],
                ...RANGE_FIELDS,
                ...RANGE_OPTIONAL.filter((f) => !this.rejected.has(f)),
              ].join(','),
              time_range: { since: q.since, until: q.until },
              limit: 500,
            })
            storeRangeStats(this.db, q.accountId, level, q.since, q.until, rows, now)
            break
          } catch (e) {
            if (!this.dropRejected(e, RANGE_OPTIONAL)) throw e
          }
        }
      }
    } catch (e) {
      throw new AppError('UNKNOWN', undefined, graphErrorText(e))
    }
    this.dataChanged(true)
  }

  // --- Programación ----------------------------------------------------------------

  /** Al desbloquear: sincroniza (rellena el hueco) y programa las siguientes. */
  start(): void {
    if (!this.unlocked) return
    this.schedule()
    if (this.config()) void this.syncNow().catch(() => {})
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer)
    const minutes = this.settings().intervalMinutes
    this.timer = setInterval(() => {
      if (this.unlocked && this.config()) void this.syncNow().catch(() => {})
    }, minutes * 60_000)
    this.timer.unref?.()
  }

  /** Al bloquear o cerrar: para el temporizador y la sincronización en curso. */
  dispose(): void {
    this.epoch++
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.phase = 'idle'
    this.progress = null
    this.error = null
  }

  /** Espera a que termine la sincronización en curso (para pruebas y al cerrar). */
  async idle(): Promise<void> {
    while (this.running) await this.running
  }

  syncNow(): Promise<void> {
    if (this.running) return this.running
    const epoch = this.epoch
    this.running = this.run(epoch).finally(() => {
      this.running = null
    })
    return this.running
  }

  private alive(epoch: number): boolean {
    return epoch === this.epoch && this.unlocked
  }

  private async run(epoch: number): Promise<void> {
    const cfg = this.config()
    if (!cfg) return
    const graph = this.client(cfg)
    this.phase = 'syncing'
    this.error = null
    this.emit()
    try {
      await this.syncRates().catch(() => {
        // Sin tipos de cambio se sigue: los importes se ven en la moneda de la cuenta.
      })
      const accounts = (
        this.db
          .prepare("SELECT * FROM ad_accounts WHERE enabled = 1 AND platform = 'meta'")
          .all() as AccountRow[]
      ).sort((a, b) => a.name.localeCompare(b.name))
      for (const [i, a] of accounts.entries()) {
        if (!this.alive(epoch)) return
        this.progress = { label: `Sincronizando ${a.name}`, done: i, total: accounts.length }
        this.emit()
        try {
          await this.syncAccount(graph, a, epoch)
          if (!this.alive(epoch)) return
          this.db
            .prepare('UPDATE ad_accounts SET last_sync_at = ?, last_error = NULL WHERE id = ?')
            .run(this.now().toISOString(), a.id)
        } catch (e) {
          if (!this.alive(epoch)) return
          this.db
            .prepare('UPDATE ad_accounts SET last_error = ? WHERE id = ?')
            .run(graphErrorText(e), a.id)
          if (e instanceof GraphError && e.code === 190) throw e
        }
        this.dataChanged(true)
      }
      for (const a of accounts) {
        if (!this.alive(epoch)) return
        await this.runHistory(graph, a.id, epoch)
      }
      if (!this.alive(epoch)) return
      this.phase = 'idle'
    } catch (e) {
      if (!this.alive(epoch)) return
      this.phase = 'error'
      this.error = graphErrorText(e)
    } finally {
      if (this.alive(epoch)) {
        this.progress = null
        this.emit()
        this.dataChanged(true)
        try {
          this.opts.onSynced?.()
        } catch {
          // Las alertas se comprueban de nuevo en la próxima sincronización.
        }
      }
    }
  }

  private async syncRates(): Promise<void> {
    const currencies = new Set(
      (
        this.db.prepare('SELECT DISTINCT currency FROM ad_accounts WHERE enabled = 1').all() as {
          currency: string
        }[]
      ).map((r) => r.currency),
    )
    currencies.add(this.settings().displayCurrency)
    if (currencies.size === 1 && currencies.has('EUR')) return
    await updateRates(
      this.db,
      todayIn('Europe/Madrid', this.now()),
      this.opts.http ?? fetch,
      this.opts.ecbUrl,
    )
  }

  // --- Una cuenta ----------------------------------------------------------------

  private async syncAccount(graph: GraphClient, a: AccountRow, epoch: number): Promise<void> {
    await this.syncStructure(graph, a, epoch)
    if (!this.alive(epoch)) return
    const today = todayIn(a.timezone, this.now())
    const days = this.settings().attributionDays
    const first = !a.data_until
    const breakdowns = breakdownConfigSchema.parse(a.breakdowns ? JSON.parse(a.breakdowns) : {})
    const since = first
      ? shiftDate(today, -(FIRST_DAYS - 1))
      : shiftDate(a.data_until! < today ? a.data_until! : today, -(days - 1))
    for (const [from, to] of chunks(since, today, CHUNK_DAYS)) {
      for (const level of INSIGHT_LEVELS) {
        if (!this.alive(epoch)) return
        const rows = await this.insights(graph, a.id, level, from, to)
        if (!this.alive(epoch)) return
        replaceInsights(this.db, a.id, level, from, to, rows, this.now().toISOString())
      }
      for (const level of PERF_LEVELS)
        for (const key of breakdowns[level]) {
          if (!this.alive(epoch)) return
          const rows = await this.insights(graph, a.id, level, from, to, key)
          if (!this.alive(epoch)) return
          replaceBreakdowns(
            this.db,
            a.id,
            level,
            key,
            BREAKDOWNS[key].api,
            from,
            to,
            rows,
            this.now().toISOString(),
          )
        }
      this.dataChanged()
    }
    const fresh = getAccount(this.db, a.id)!
    const dataFrom = fresh.data_from && fresh.data_from < since ? fresh.data_from : since
    this.db
      .prepare('UPDATE ad_accounts SET data_from = ?, data_until = ? WHERE id = ?')
      .run(dataFrom, today, a.id)
    if (first) this.planHistory(a, since, today)
  }

  private async syncStructure(graph: GraphClient, a: AccountRow, epoch: number): Promise<void> {
    const now = () => this.now().toISOString()
    const campaigns = await graph.getAll<Record<string, unknown>>(`${a.id}/campaigns`, {
      fields: CAMPAIGN_FIELDS,
      limit: 500,
    })
    if (!this.alive(epoch)) return
    upsertObjects(this.db, 'campaign', a.id, campaigns, now())
    const adsets = await graph.getAll<Record<string, unknown>>(`${a.id}/adsets`, {
      fields: ADSET_FIELDS,
      limit: 500,
    })
    if (!this.alive(epoch)) return
    upsertObjects(this.db, 'adset', a.id, adsets, now())
    const ads = await graph.getAll<Record<string, unknown>>(`${a.id}/ads`, {
      fields: AD_FIELDS,
      limit: 500,
    })
    if (!this.alive(epoch)) return
    upsertObjects(this.db, 'ad', a.id, ads, now())

    // Creatividades nuevas (las que ya están no cambian: Meta crea otra al editarlas).
    const ids = [
      ...new Set(
        ads
          .map((ad) => (ad['creative'] as { id?: string } | undefined)?.id)
          .filter((id): id is string => !!id),
      ),
    ]
    const known = new Set(
      (
        this.db.prepare('SELECT id FROM ad_creatives WHERE account_id = ?').all(a.id) as {
          id: string
        }[]
      ).map((r) => r.id),
    )
    // Cada creatividad por su ruta (GET /{id}): la v26.0 ya no admite «GET /?ids=…».
    const missing = ids.filter((id) => !known.has(id) && /^\w{1,40}$/.test(id))
    const got: Record<string, unknown>[] = []
    for (const id of missing) {
      if (!this.alive(epoch)) return
      try {
        got.push(
          await graph.get<Record<string, unknown>>(id, {
            fields: CREATIVE_FIELDS,
            thumbnail_width: 320,
            thumbnail_height: 320,
          }),
        )
      } catch (e) {
        // Una creatividad borrada o sin acceso (código 100) no impide leer las demás ni
        // las métricas; los límites, el token y los fallos de red sí se propagan.
        if (e instanceof GraphError && e.code === 100) continue
        throw e
      }
    }
    if (got.length) upsertCreatives(this.db, a.id, got, now())
    await this.downloadThumbs(a.id, epoch)
    if (!this.alive(epoch)) return
    await this.syncActivities(graph, a).catch(() => {
      // Sin historial de actividad se usa la fecha de última actualización.
    })
    if (!this.alive(epoch)) return
    try {
      this.runAutoLink()
    } catch {
      // El vínculo automático se reintenta en la próxima sincronización.
    }
  }

  /** Última edición significativa de cada objeto según el historial de actividad. */
  private async syncActivities(graph: GraphClient, a: AccountRow): Promise<void> {
    const fresh = getAccount(this.db, a.id)!
    const from = fresh.activity_at
      ? Date.parse(fresh.activity_at)
      : this.now().getTime() - 7 * 86_400_000
    const params = { fields: 'event_type,event_time,object_id', limit: 500 }
    let items: { event_type?: string; event_time?: string; object_id?: string }[]
    try {
      items = await graph.getAll(`${a.id}/activities`, {
        ...params,
        since: Math.floor(from / 1000),
      })
    } catch (e) {
      // Si esta versión no acepta «since», se leen los 7 días que da por defecto.
      if (!(e instanceof GraphError) || e.code !== 100) throw e
      items = await graph.getAll(`${a.id}/activities`, params)
    }
    const upd = this.db.prepare(
      'UPDATE ad_objects SET last_edit = ? WHERE id = ? AND (last_edit IS NULL OR last_edit < ?)',
    )
    this.db.transaction(() => {
      for (const it of items) {
        if (!it.object_id || !it.event_time || !SIGNIFICANT_EVENTS.has(it.event_type ?? ''))
          continue
        const t = new Date(it.event_time)
        if (Number.isNaN(t.getTime())) continue
        upd.run(t.toISOString(), String(it.object_id), t.toISOString())
      }
    })()
    this.db
      .prepare('UPDATE ad_accounts SET activity_at = ? WHERE id = ?')
      .run(this.now().toISOString(), a.id)
  }

  /** Descarga y guarda cifradas las miniaturas que falten (las URL de Meta caducan). */
  private async downloadThumbs(accountId: string, epoch: number): Promise<void> {
    const rows = this.db
      .prepare(
        'SELECT id, thumbnail_url FROM ad_creatives WHERE account_id = ? AND thumb_file_id IS NULL AND thumbnail_url IS NOT NULL LIMIT 200',
      )
      .all(accountId) as { id: string; thumbnail_url: string }[]
    const http = this.opts.http ?? fetch
    for (const r of rows) {
      if (!this.alive(epoch)) return
      try {
        const url = new URL(r.thumbnail_url)
        if (url.protocol !== 'https:' && !this.opts.graphUrl) continue
        const res = await http(url, { signal: AbortSignal.timeout(30_000) })
        const type = res.headers.get('content-type') ?? ''
        if (!res.ok || !type.startsWith('image/')) continue
        const buf = new Uint8Array(await res.arrayBuffer())
        if (buf.length === 0 || buf.length > THUMB_MAX_BYTES) continue
        if (!this.alive(epoch)) return
        const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
        const ref = this.vault.data.importBuffer(`creatividad-${r.id}.${ext}`, buf)
        this.db.prepare('UPDATE ad_creatives SET thumb_file_id = ? WHERE id = ?').run(ref.id, r.id)
      } catch {
        // Miniatura no disponible: se reintenta en la próxima sincronización.
      }
    }
  }

  private fields(level: InsightLevel): string {
    const list = [
      ...CORE_FIELDS,
      ...LEVEL_FIELDS[level],
      ...OPTIONAL_FIELDS,
      ...(level === 'ad' ? AD_ONLY_FIELDS : []),
    ]
    return list.filter((f) => !this.rejected.has(f)).join(',')
  }

  private insightParams(
    level: InsightLevel,
    since: string,
    until: string,
    breakdown: BreakdownKey | null = null,
  ) {
    return {
      level,
      fields: breakdown
        ? [...BREAKDOWN_FIELDS, ...LEVEL_FIELDS[level]].join(',')
        : this.fields(level),
      ...(breakdown ? { breakdowns: BREAKDOWNS[breakdown].api.join(',') } : {}),
      time_range: { since, until },
      time_increment: 1,
      // Mismos resultados que Ads Manager: la atribución configurada en cada conjunto.
      use_unified_attribution_setting: true,
      limit: 500,
    }
  }

  /**
   * Si Meta rechaza un campo opcional (cambia entre versiones), se quita y se repite.
   * Devuelve true si ha quitado alguno.
   */
  private dropRejected(e: unknown, optional = [...OPTIONAL_FIELDS, ...AD_ONLY_FIELDS]): boolean {
    if (!(e instanceof GraphError) || e.code !== 100) return false
    const bad = optional.filter(
      (f) => !this.rejected.has(f) && new RegExp(`\\b${f}\\b`).test(e.message),
    )
    for (const f of bad) this.rejected.add(f)
    return bad.length > 0
  }

  private async insights(
    graph: GraphClient,
    accountId: string,
    level: InsightLevel,
    since: string,
    until: string,
    breakdown: BreakdownKey | null = null,
  ): Promise<InsightRow[]> {
    for (;;) {
      try {
        return await graph.getAll<InsightRow>(
          `${accountId}/insights`,
          this.insightParams(level, since, until, breakdown),
        )
      } catch (e) {
        if (!this.dropRejected(e)) throw e
      }
    }
  }

  // --- Histórico -------------------------------------------------------------------

  /** Crea los trozos del histórico: meses desde antes de `from` hasta el límite. */
  private planHistory(a: AccountRow, from: string, today: string): void {
    let limit = historyLimit(today)
    try {
      const created = (JSON.parse(a.raw) as { created_time?: string }).created_time
      if (created) {
        const day = created.slice(0, 10)
        if (day > limit) limit = day
      }
    } catch {
      // Sin fecha de creación: se usa el límite de Meta.
    }
    const end = shiftDate(from, -1)
    const ins = this.db.prepare(
      "INSERT INTO ad_jobs (account_id, level, since, until, status) VALUES (?, ?, ?, ?, 'pending')",
    )
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM ad_jobs WHERE account_id = ? AND breakdown IS NULL').run(a.id)
      for (const [s, u] of end >= limit ? monthChunks(limit, end) : [])
        for (const level of INSIGHT_LEVELS) ins.run(a.id, level, s, u)
    })()
    const pending = this.db
      .prepare('SELECT COUNT(*) AS n FROM ad_jobs WHERE account_id = ?')
      .get(a.id) as { n: number }
    this.db
      .prepare('UPDATE ad_accounts SET history_done = ? WHERE id = ?')
      .run(pending.n === 0 ? 1 : 0, a.id)
  }

  private async runHistory(graph: GraphClient, accountId: string, epoch: number): Promise<void> {
    const account = getAccount(this.db, accountId)
    if (!account || account.history_done) return
    const total = (
      this.db.prepare('SELECT COUNT(*) AS n FROM ad_jobs WHERE account_id = ?').get(accountId) as {
        n: number
      }
    ).n
    for (;;) {
      if (!this.alive(epoch)) return
      const job = this.db
        .prepare(
          "SELECT * FROM ad_jobs WHERE account_id = ? AND status IN ('pending', 'running') ORDER BY since DESC, id ASC LIMIT 1",
        )
        .get(accountId) as JobRow | undefined
      if (!job) break
      const done = (
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM ad_jobs WHERE account_id = ? AND status IN ('done', 'failed')",
          )
          .get(accountId) as { n: number }
      ).n
      this.progress = { label: `Histórico de ${account.name}`, done, total }
      this.emit()
      try {
        const rows = await this.runJob(graph, job, epoch)
        if (rows === null) return
        const now = this.now().toISOString()
        if (job.breakdown)
          replaceBreakdowns(
            this.db,
            accountId,
            job.level,
            job.breakdown,
            BREAKDOWNS[job.breakdown].api,
            job.since,
            job.until,
            rows,
            now,
          )
        else replaceInsights(this.db, accountId, job.level, job.since, job.until, rows, now)
        this.db.prepare("UPDATE ad_jobs SET status = 'done', error = NULL WHERE id = ?").run(job.id)
        const a = getAccount(this.db, accountId)!
        if (!job.breakdown && (!a.data_from || job.since < a.data_from))
          this.db
            .prepare('UPDATE ad_accounts SET data_from = ? WHERE id = ?')
            .run(job.since, accountId)
        this.dataChanged()
      } catch (e) {
        if (!this.alive(epoch)) return
        if (e instanceof GraphError && (e.isAuth || e.isThrottle)) throw e
        const attempts = job.attempts + 1
        this.db
          .prepare(
            'UPDATE ad_jobs SET status = ?, attempts = ?, error = ?, report_run_id = NULL WHERE id = ?',
          )
          .run(
            attempts >= MAX_JOB_ATTEMPTS ? 'failed' : 'pending',
            attempts,
            graphErrorText(e),
            job.id,
          )
      }
    }
    this.db.prepare('UPDATE ad_accounts SET history_done = 1 WHERE id = ?').run(accountId)
  }

  /** Ejecuta un trozo con un informe asíncrono. Null si se ha cancelado. */
  private async runJob(
    graph: GraphClient,
    job: JobRow,
    epoch: number,
  ): Promise<InsightRow[] | null> {
    let reportId = job.report_run_id
    const fresh =
      reportId &&
      job.started_at &&
      this.now().getTime() - Date.parse(job.started_at) < REPORT_TTL_MS
    if (!fresh) {
      for (;;) {
        try {
          reportId = await graph.createInsightsReport(
            job.account_id,
            this.insightParams(job.level, job.since, job.until, job.breakdown),
          )
          break
        } catch (e) {
          if (!this.dropRejected(e)) throw e
        }
      }
      this.db
        .prepare(
          "UPDATE ad_jobs SET status = 'running', report_run_id = ?, started_at = ? WHERE id = ?",
        )
        .run(reportId, this.now().toISOString(), job.id)
    }
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
    const poll = this.opts.pollMs ?? 5000
    for (let i = 0; ; i++) {
      if (!this.alive(epoch)) return null
      const s = await graph.get<{ async_status?: string; async_percent_completion?: number }>(
        reportId!,
        { fields: 'async_status,async_percent_completion' },
      )
      if (s.async_status === 'Job Completed') break
      if (s.async_status === 'Job Failed' || s.async_status === 'Job Skipped')
        throw new GraphError(
          `El informe de Meta no se completó (${s.async_status})`,
          null,
          null,
          200,
        )
      await sleep(Math.min(poll * (1 + Math.floor(i / 6)), 30_000))
    }
    if (!this.alive(epoch)) return null
    return graph.getAll<InsightRow>(`${reportId!}/insights`, { limit: 500 })
  }
}
