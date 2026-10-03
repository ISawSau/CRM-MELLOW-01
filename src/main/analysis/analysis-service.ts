import {
  alertsSchema,
  dashboardsSchema,
  DEFAULT_DASHBOARD,
  type Alert,
  type AlertEvent,
  type AnalysisQuery,
  type AnalysisResult,
  type Dashboard,
} from '@shared/analysis'
import { shiftDate, todayIn } from '@shared/data/dates'
import { AppError } from '@shared/errors'
import { computeMetrics, type MetaTableSettings } from '@shared/meta-metrics'
import type { SqliteDb } from '../db/connection'
import { CHANGES_KEY } from '../sync/sync-service'
import type { VaultService } from '../vault/vault-service'
import { analyze } from './query'
import { billingSummary } from '../billing/billing'
import type { BillingSummary } from '@shared/billing'

/**
 * Análisis (SPEC §7.13): dashboards configurables, comparativas y alertas que solo avisan
 * dentro de la app. Los dashboards y las alertas viven en los ajustes cifrados de la
 * bóveda; los avisos, en `alert_events`.
 */

const DASHBOARDS_KEY = 'analysis.dashboards'
const ALERTS_KEY = 'analysis.alerts'

export interface AnalysisServiceOptions {
  /** Moneda de visualización y métricas propias (de los ajustes de Meta). */
  currency: () => string
  tableSettings: () => MetaTableSettings
  onChange?: () => void
  now?: () => Date
}

interface EventRow {
  id: number
  alert_id: string
  since: string
  until: string
  value: number
  snapshot: string
  created_at: string
  seen_at: string | null
}

export class AnalysisService {
  constructor(
    private readonly vault: VaultService,
    private readonly opts: AnalysisServiceOptions,
  ) {}

  private get db(): SqliteDb {
    return this.vault.sqlite
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date()
  }

  private read(key: string): unknown {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return r ? JSON.parse(r.value) : undefined
  }

  private write(key: string, value: unknown): void {
    const at = this.now().toISOString()
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), at)
    const n = this.read(CHANGES_KEY)
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(CHANGES_KEY, JSON.stringify((typeof n === 'number' ? n : 0) + 1), at)
  }

  query(q: AnalysisQuery): AnalysisResult {
    return analyze(this.db, this.vault.data, q, this.opts.currency())
  }

  /** Facturación y beneficio por cliente (SPEC §7.9). */
  billing(since: string, until: string): BillingSummary {
    const today = todayIn(this.timeZone(), this.now())
    return billingSummary(this.db, this.vault.data, since, until, this.opts.currency(), today)
  }

  // --- Dashboards --------------------------------------------------------------------

  dashboards(): Dashboard[] {
    const r = dashboardsSchema.safeParse(this.read(DASHBOARDS_KEY))
    return r.success && r.data.length ? r.data : [DEFAULT_DASHBOARD]
  }

  setDashboards(list: Dashboard[]): Dashboard[] {
    const parsed = dashboardsSchema.parse(list)
    if (new Set(parsed.map((d) => d.id)).size !== parsed.length)
      throw new AppError('INVALID_INPUT', undefined, 'Hay dos dashboards con el mismo id.')
    this.write(DASHBOARDS_KEY, parsed)
    return this.dashboards()
  }

  // --- Alertas -------------------------------------------------------------------------

  alerts(): Alert[] {
    const r = alertsSchema.safeParse(this.read(ALERTS_KEY) ?? [])
    return r.success ? r.data : []
  }

  setAlerts(list: Alert[]): Alert[] {
    const parsed = alertsSchema.parse(list)
    this.write(ALERTS_KEY, parsed)
    this.evaluate()
    return this.alerts()
  }

  /** Valor de la métrica de una alerta en su ventana (días completos, sin hoy). */
  private alertValue(
    a: Alert,
    today: string,
  ): { value: number | null; since: string; until: string } {
    const until = shiftDate(today, -1)
    const since = shiftDate(until, -(a.windowDays - 1))
    const r = this.query({ since, until, filter: a.scope })
    const s = this.opts.tableSettings()
    const v = computeMetrics(r.totals, null, { custom: s.metrics, holdRate: s.holdRate })[a.metric]
    return { value: v ?? null, since, until }
  }

  /**
   * Comprueba las alertas activas. Si se cumple la condición, guarda un aviso (uno por
   * alerta y día de cierre del periodo). Devuelve los avisos nuevos.
   */
  evaluate(): number {
    if (this.vault.status().state !== 'unlocked') return 0
    const today = todayIn(this.timeZone(), this.now())
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO alert_events (alert_id, since, until, value, snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    let n = 0
    for (const a of this.alerts()) {
      if (!a.enabled) continue
      const { value, since, until } = this.alertValue(a, today)
      if (value === null) continue
      const hit = a.op === 'gt' ? value > a.threshold : value < a.threshold
      if (!hit) continue
      n += ins.run(a.id, since, until, value, JSON.stringify(a), this.now().toISOString()).changes
    }
    if (n) this.opts.onChange?.()
    return n
  }

  /** Valor actual de cada alerta (para la lista de Alertas). */
  currentValues(): Record<string, number | null> {
    const today = todayIn(this.timeZone(), this.now())
    return Object.fromEntries(this.alerts().map((a) => [a.id, this.alertValue(a, today).value]))
  }

  events(limit = 100): AlertEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM alert_events ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as EventRow[]
    return rows.map((r) => {
      const a = JSON.parse(r.snapshot) as Alert
      return {
        id: r.id,
        alertId: r.alert_id,
        name: a.name,
        metric: a.metric,
        op: a.op,
        threshold: a.threshold,
        value: r.value,
        since: r.since,
        until: r.until,
        createdAt: r.created_at,
        seen: r.seen_at !== null,
      }
    })
  }

  unseen(): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS n FROM alert_events WHERE seen_at IS NULL').get() as {
        n: number
      }
    ).n
  }

  markSeen(): void {
    this.db
      .prepare('UPDATE alert_events SET seen_at = ? WHERE seen_at IS NULL')
      .run(this.now().toISOString())
    this.opts.onChange?.()
  }

  private timeZone(): string {
    try {
      return this.vault.data.getProfile().timeZone
    } catch {
      return 'Europe/Madrid'
    }
  }
}
