import { z } from 'zod'
import { shiftDate } from '@shared/data/dates'
import { AppError } from '@shared/errors'
import {
  csvMappingSchema,
  normalizeHeader,
  type CsvImport,
  type CsvImportResult,
  type CsvMapping,
  type LinkedInStatus,
  type OtherPlatform,
  type PlatformAccount,
} from '@shared/platforms'
import type { SqliteDb } from '../db/connection'
import { replaceInsights } from '../meta/store'
import type { FetchLike } from '../sync/remote'
import { deleteSetting, readSetting, writeSetting, CHANGES_KEY } from '../sync/sync-service'
import type { VaultService } from '../vault/vault-service'
import { importCsv } from './csv-import'
import {
  connectLinkedIn,
  LinkedInClient,
  LinkedInError,
  liInsightRow,
  LI_API,
  type LinkedInDaily,
} from './linkedin'

/**
 * Otras plataformas (SPEC §7.4): cuentas de LinkedIn (API o CSV) y X (CSV). Comparten
 * las tablas de Meta con su propia plataforma, así que el resto de la app las trata igual.
 */

const LI_KEY = 'linkedin.config'
const MAPPINGS_KEY = 'platforms.mappings'
const HISTORY_DAYS = 365
const CHUNK_DAYS = 90
/** Se vuelven a pedir los últimos días: las conversiones se atribuyen con retraso. */
const REFRESH_DAYS = 7
const POLL_MS = 3 * 3_600_000

const liConfigSchema = z.object({
  clientId: z.string().default(''),
  clientSecret: z.string().default(''),
  accessToken: z.string().min(1),
  expiresAt: z.number(),
})
type LiConfig = z.infer<typeof liConfigSchema>

export interface PlatformsOptions {
  http?: FetchLike
  openBrowser: (url: string) => void
  apiUrl?: string
  tokenUrl?: string
  /** Puerto de la dirección de vuelta de LinkedIn (los tests usan otro). */
  port?: number
  pollMs?: number
  now?: () => Date
  onChange?: () => void
}

interface AccountRow {
  id: string
  platform: string
  name: string
  currency: string
  timezone: string
  enabled: number
  client_id: string | null
  data_from: string | null
  data_until: string | null
  last_sync_at: string | null
  last_error: string | null
  raw: string
}

export class PlatformsService {
  private phase: LinkedInStatus['phase'] = 'idle'
  private error: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<void> | null = null

  constructor(
    private readonly vault: VaultService,
    private readonly opts: PlatformsOptions,
  ) {}

  private get http(): FetchLike {
    return this.opts.http ?? fetch
  }

  private db(): SqliteDb {
    return this.vault.sqlite
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date()
  }

  private touched(): void {
    const n = readSetting(this.db(), CHANGES_KEY)
    writeSetting(this.db(), CHANGES_KEY, (typeof n === 'number' ? n : 0) + 1)
    this.opts.onChange?.()
  }

  // --- Cuentas ------------------------------------------------------------------------

  accounts(): PlatformAccount[] {
    const rows = this.db()
      .prepare(
        "SELECT * FROM ad_accounts WHERE platform IN ('linkedin', 'x') ORDER BY platform, name COLLATE NOCASE",
      )
      .all() as AccountRow[]
    return rows.map((r) => {
      let source: 'api' | 'csv' = 'csv'
      try {
        source = (JSON.parse(r.raw) as { source?: string }).source === 'api' ? 'api' : 'csv'
      } catch {
        // raw no válido: se trata como importada.
      }
      return {
        id: r.id,
        platform: r.platform as OtherPlatform,
        name: r.name,
        currency: r.currency,
        timezone: r.timezone,
        enabled: !!r.enabled,
        clientId: r.client_id,
        dataFrom: r.data_from,
        dataUntil: r.data_until,
        source,
        lastSyncAt: r.last_sync_at,
        lastError: r.last_error,
      }
    })
  }

  private account(id: string): AccountRow {
    const a = this.db()
      .prepare("SELECT * FROM ad_accounts WHERE id = ? AND platform IN ('linkedin', 'x')")
      .get(id) as AccountRow | undefined
    if (!a) throw new AppError('INVALID_INPUT', undefined, 'Esa cuenta no existe.')
    return a
  }

  updateAccount(input: {
    id: string
    enabled?: boolean
    clientId?: string | null
  }): PlatformAccount[] {
    const a = this.account(input.id)
    if (input.clientId !== undefined) {
      if (
        input.clientId !== null &&
        !this.db()
          .prepare(
            "SELECT 1 FROM records WHERE id = ? AND entity = 'cliente' AND deleted_at IS NULL",
          )
          .get(input.clientId)
      )
        throw new AppError('INVALID_INPUT', undefined, 'Ese cliente no existe.')
      this.db()
        .prepare('UPDATE ad_accounts SET client_id = ? WHERE id = ?')
        .run(input.clientId, a.id)
    }
    if (input.enabled !== undefined)
      this.db()
        .prepare('UPDATE ad_accounts SET enabled = ? WHERE id = ?')
        .run(input.enabled ? 1 : 0, a.id)
    this.touched()
    if (input.enabled && !a.enabled && a.platform === 'linkedin')
      void this.syncLinkedIn().catch(() => {})
    return this.accounts()
  }

  /** Borra una cuenta y todos sus datos (acción explícita del usuario, con confirmación). */
  deleteAccount(id: string): PlatformAccount[] {
    const a = this.account(id)
    const db = this.db()
    db.transaction(() => {
      for (const t of ['ad_insights_daily', 'ad_actions', 'ad_objects'])
        db.prepare(`DELETE FROM ${t} WHERE account_id = ?`).run(a.id)
      db.prepare('DELETE FROM ad_accounts WHERE id = ?').run(a.id)
    })()
    this.touched()
    return this.accounts()
  }

  // --- CSV ----------------------------------------------------------------------------

  /** Firma de unas cabeceras para recordar su mapeo. */
  private signature(platform: OtherPlatform, headers: string[]): string {
    return `${platform}|${headers.map(normalizeHeader).join('|')}`
  }

  savedMapping(platform: OtherPlatform, headers: string[]): CsvMapping | null {
    const all = (readSetting(this.db(), MAPPINGS_KEY) ?? {}) as Record<string, unknown>
    const r = csvMappingSchema.safeParse(all[this.signature(platform, headers)])
    return r.success ? r.data : null
  }

  importCsv(input: CsvImport, headers: string[]): CsvImportResult {
    const result = importCsv(this.db(), input, this.now().toISOString())
    const all = (readSetting(this.db(), MAPPINGS_KEY) ?? {}) as Record<string, unknown>
    all[this.signature(input.platform, headers)] = input.mapping
    writeSetting(this.db(), MAPPINGS_KEY, all)
    this.touched()
    return result
  }

  // --- LinkedIn (API) -------------------------------------------------------------------

  private liConfig(): LiConfig | null {
    const r = liConfigSchema.safeParse(readSetting(this.db(), LI_KEY))
    return r.success ? r.data : null
  }

  linkedinStatus(): LinkedInStatus {
    let cfg: LiConfig | null = null
    let last: string | null = null
    try {
      cfg = this.liConfig()
      last =
        (
          this.db()
            .prepare(
              "SELECT MAX(last_sync_at) AS t FROM ad_accounts WHERE platform = 'linkedin' AND enabled = 1",
            )
            .get() as { t: string | null }
        ).t ?? null
    } catch {
      // Bóveda bloqueada.
    }
    const daysLeft = cfg ? Math.floor((cfg.expiresAt - this.now().getTime()) / 86_400_000) : null
    return {
      connected: cfg !== null,
      expiresAt: cfg ? new Date(cfg.expiresAt).toISOString() : null,
      daysLeft,
      phase: this.phase,
      error:
        this.error ??
        (daysLeft !== null && daysLeft < 0
          ? 'El acceso a LinkedIn ha caducado: vuelve a conectar.'
          : null),
      lastSyncAt: last,
    }
  }

  /** Conecta con OAuth (id y secreto de la app de LinkedIn) o con un token ya generado. */
  async linkedinConnect(input: {
    clientId: string
    clientSecret: string
    token: string
  }): Promise<LinkedInStatus> {
    let cfg: LiConfig
    if (input.token) {
      // Token del generador del portal de desarrolladores: dura 60 días.
      cfg = {
        clientId: '',
        clientSecret: '',
        accessToken: input.token,
        expiresAt: this.now().getTime() + 60 * 86_400_000,
      }
    } else {
      if (!input.clientId || !input.clientSecret)
        throw new AppError(
          'INVALID_INPUT',
          undefined,
          'Escribe el id y el secreto de tu app de LinkedIn.',
        )
      try {
        const t = await connectLinkedIn(
          { clientId: input.clientId, clientSecret: input.clientSecret },
          this.opts.openBrowser,
          this.http,
          {
            ...(this.opts.tokenUrl ? { tokenUrl: this.opts.tokenUrl } : {}),
            ...(this.opts.port ? { port: this.opts.port } : {}),
          },
        )
        cfg = { clientId: input.clientId, clientSecret: input.clientSecret, ...t }
      } catch (e) {
        throw new AppError('INVALID_INPUT', undefined, e instanceof Error ? e.message : String(e))
      }
    }
    // Se comprueba el token pidiendo las cuentas.
    const client = new LinkedInClient(cfg.accessToken, this.http, this.opts.apiUrl ?? LI_API)
    let accounts
    try {
      accounts = await client.accounts()
    } catch (e) {
      throw new AppError('INVALID_INPUT', undefined, e instanceof Error ? e.message : String(e))
    }
    writeSetting(this.db(), LI_KEY, cfg)
    const now = this.now().toISOString()
    const db = this.db()
    const up = db.prepare(`INSERT INTO ad_accounts
      (id, platform, name, currency, timezone, enabled, raw, updated_at)
      VALUES (?, 'linkedin', ?, ?, 'UTC', 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, currency = excluded.currency,
        raw = excluded.raw, updated_at = excluded.updated_at`)
    db.transaction(() => {
      for (const a of accounts.filter((x) => !x.test))
        up.run(`li_${a.id}`, a.name, a.currency, JSON.stringify({ source: 'api', ...a }), now)
    })()
    this.error = null
    this.touched()
    this.start()
    return this.linkedinStatus()
  }

  linkedinDisconnect(): LinkedInStatus {
    deleteSetting(this.db(), LI_KEY)
    this.stop()
    this.error = null
    this.phase = 'idle'
    this.opts.onChange?.()
    return this.linkedinStatus()
  }

  /** Descarga campañas y métricas diarias de las cuentas de LinkedIn activadas. */
  syncLinkedIn(): Promise<void> {
    this.running ??= this.doSync().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async doSync(): Promise<void> {
    const cfg = this.liConfig()
    if (!cfg) return
    if (cfg.expiresAt < this.now().getTime()) {
      this.error = 'El acceso a LinkedIn ha caducado: vuelve a conectar.'
      this.phase = 'error'
      this.opts.onChange?.()
      return
    }
    const client = new LinkedInClient(cfg.accessToken, this.http, this.opts.apiUrl ?? LI_API)
    const accounts = this.db()
      .prepare("SELECT * FROM ad_accounts WHERE platform = 'linkedin' AND enabled = 1")
      .all() as AccountRow[]
    this.phase = 'syncing'
    this.error = null
    this.opts.onChange?.()
    let failed: string | null = null
    for (const a of accounts) {
      try {
        await this.syncAccount(client, a)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failed = msg
        this.db().prepare('UPDATE ad_accounts SET last_error = ? WHERE id = ?').run(msg, a.id)
        if (e instanceof LinkedInError && (e.status === 401 || e.status === 429)) break
      }
    }
    this.phase = failed ? 'error' : 'idle'
    this.error = failed
    this.opts.onChange?.()
  }

  private async syncAccount(client: LinkedInClient, a: AccountRow): Promise<void> {
    const accountNum = Number(a.id.slice(3))
    const db = this.db()
    const now = this.now().toISOString()
    // Estructura: nombres, estado, objetivo y programación de las campañas.
    const campaigns = await client.campaigns(accountNum)
    const upObj = db.prepare(`INSERT INTO ad_objects
      (id, level, account_id, name, status, effective_status, objective, start_time, end_time, raw, synced_at)
      VALUES (?, 'campaign', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status,
        effective_status = excluded.effective_status, objective = excluded.objective,
        start_time = excluded.start_time, end_time = excluded.end_time, raw = excluded.raw,
        synced_at = excluded.synced_at`)
    db.transaction(() => {
      for (const c of campaigns)
        upObj.run(
          `li:${c.id}`,
          a.id,
          c.name,
          c.status,
          c.status,
          c.objectiveType,
          c.start,
          c.end,
          JSON.stringify(c),
          now,
        )
    })()
    const names = new Map(campaigns.map((c) => [c.id, c.name]))

    // Métricas: el primer día el último año; después, desde unos días antes del último.
    const today = now.slice(0, 10)
    let since = a.data_until
      ? shiftDate(a.data_until, -REFRESH_DAYS)
      : shiftDate(today, -HISTORY_DAYS)
    let first: string | null = null
    while (since <= today) {
      const until = [shiftDate(since, CHUNK_DAYS - 1), today].sort()[0]!
      const rows = await client.analytics(accountNum, since, until)
      this.store(a.id, since, until, rows, names, now)
      if (rows.length) first ??= rows.map((r) => r.date).sort()[0]!
      since = shiftDate(until, 1)
    }
    db.prepare(
      `UPDATE ad_accounts SET
         data_from = CASE WHEN ? IS NOT NULL AND (data_from IS NULL OR data_from > ?) THEN ? ELSE data_from END,
         data_until = ?, history_done = 1, last_sync_at = ?, last_error = NULL WHERE id = ?`,
    ).run(first, first, first, today, now, a.id)
  }

  private store(
    accountId: string,
    since: string,
    until: string,
    rows: LinkedInDaily[],
    names: Map<number, string>,
    now: string,
  ): void {
    const perDay = new Map<string, Omit<LinkedInDaily, 'campaignId'>>()
    for (const r of rows) {
      const d = perDay.get(r.date) ?? {
        date: r.date,
        spend: 0,
        impressions: 0,
        clicks: 0,
        landingPageClicks: 0,
        conversions: 0,
        value: 0,
      }
      for (const k of [
        'spend',
        'impressions',
        'clicks',
        'landingPageClicks',
        'conversions',
        'value',
      ] as const)
        d[k] += r[k]
      perDay.set(r.date, d)
    }
    const db = this.db()
    db.transaction(() => {
      replaceInsights(
        db,
        accountId,
        'campaign',
        since,
        until,
        rows.map((r) =>
          liInsightRow(r, {
            id: `li:${r.campaignId}`,
            name: names.get(r.campaignId) ?? `Campaña ${r.campaignId}`,
          }),
        ),
        now,
      )
      replaceInsights(
        db,
        accountId,
        'account',
        since,
        until,
        [...perDay.values()].map((d) => liInsightRow(d, null)),
        now,
      )
    })()
  }

  /** Sincroniza LinkedIn cada pocas horas mientras la bóveda está abierta. */
  start(): void {
    this.stop()
    try {
      if (!this.liConfig()) return
    } catch {
      return
    }
    void this.syncLinkedIn().catch(() => {})
    const ms = this.opts.pollMs ?? POLL_MS
    if (ms > 0) this.timer = setInterval(() => void this.syncLinkedIn().catch(() => {}), ms)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.stop()
    this.phase = 'idle'
    this.error = null
  }

  idle(): Promise<void> {
    return this.running ?? Promise.resolve()
  }
}
