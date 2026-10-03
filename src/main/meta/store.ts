import type { SqliteDb } from '../db/connection'

/**
 * Escritura de los datos de Meta en la base de datos de la bóveda. Todo en
 * transacciones: un trozo de métricas se sustituye entero o no se toca.
 */

export type InsightLevel = 'account' | 'campaign' | 'adset' | 'ad'
export const INSIGHT_LEVELS: readonly InsightLevel[] = ['account', 'campaign', 'adset', 'ad']

export interface ActionStat {
  action_type?: string
  value?: string | number
}

/** Fila de Insights tal como la devuelve la API (los números llegan como texto). */
export type InsightRow = {
  account_id?: string
  campaign_id?: string
  adset_id?: string
  ad_id?: string
  campaign_name?: string
  adset_name?: string
  ad_name?: string
  date_start?: string
  date_stop?: string
  actions?: ActionStat[]
  action_values?: ActionStat[]
} & Record<string, unknown>

const KNOWN = new Set([
  'account_id',
  'campaign_id',
  'adset_id',
  'ad_id',
  'campaign_name',
  'adset_name',
  'ad_name',
  'date_start',
  'date_stop',
  'spend',
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'inline_link_clicks',
  'unique_inline_link_clicks',
  'inline_link_click_ctr',
  'unique_inline_link_click_ctr',
  'cpm',
  'cpc',
  'quality_ranking',
  'engagement_rate_ranking',
  'conversion_rate_ranking',
  'actions',
  'action_values',
])

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const int = (v: unknown): number | null => {
  const n = num(v)
  return n === null ? null : Math.round(n)
}
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export function actId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`
}

function entityOf(level: InsightLevel, accountId: string, r: InsightRow): string | null {
  switch (level) {
    case 'account':
      return accountId
    case 'campaign':
      return str(r.campaign_id)
    case 'adset':
      return str(r.adset_id)
    case 'ad':
      return str(r.ad_id)
  }
}

/**
 * Sustituye las métricas de una cuenta y nivel entre dos fechas (incluidas) por las
 * filas nuevas. Si Meta ya no devuelve un día (p. ej. una entidad sin entrega), ese día
 * desaparece también aquí. Devuelve el número de filas guardadas.
 */
export function replaceInsights(
  db: SqliteDb,
  accountId: string,
  level: InsightLevel,
  since: string,
  until: string,
  rows: InsightRow[],
  now: string,
): number {
  const ins = db.prepare(`INSERT OR REPLACE INTO ad_insights_daily
    (level, entity_id, date, account_id, campaign_id, adset_id, spend, impressions, reach,
     frequency, clicks, link_clicks, unique_link_clicks, link_ctr, unique_link_ctr, cpm, cpc,
     quality_ranking, engagement_ranking, conversion_ranking, actions, action_values, extra,
     fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insAction = db.prepare(`INSERT INTO ad_actions
    (level, entity_id, date, action_type, account_id, count, value) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(level, entity_id, date, action_type) DO UPDATE SET
      count = COALESCE(excluded.count, count), value = COALESCE(excluded.value, value)`)
  const insType = db.prepare(
    'INSERT OR IGNORE INTO ad_action_types (action_type, first_seen) VALUES (?, ?)',
  )
  const insName = db.prepare(`INSERT OR IGNORE INTO ad_objects
    (id, level, account_id, campaign_id, adset_id, name, raw, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, '{}', ?)`)
  let n = 0
  db.transaction(() => {
    db.prepare(
      'DELETE FROM ad_insights_daily WHERE account_id = ? AND level = ? AND date BETWEEN ? AND ?',
    ).run(accountId, level, since, until)
    db.prepare(
      'DELETE FROM ad_actions WHERE account_id = ? AND level = ? AND date BETWEEN ? AND ?',
    ).run(accountId, level, since, until)
    for (const r of rows) {
      const entity = entityOf(level, accountId, r)
      const date = str(r.date_start)
      if (!entity || !date) continue
      const extra: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r)) if (!KNOWN.has(k)) extra[k] = v
      ins.run(
        level,
        entity,
        date,
        accountId,
        str(r.campaign_id),
        str(r.adset_id),
        num(r['spend']) ?? 0,
        int(r['impressions']) ?? 0,
        int(r['reach']),
        num(r['frequency']),
        int(r['clicks']),
        int(r['inline_link_clicks']),
        int(r['unique_inline_link_clicks']),
        num(r['inline_link_click_ctr']),
        num(r['unique_inline_link_click_ctr']),
        num(r['cpm']),
        num(r['cpc']),
        str(r['quality_ranking']),
        str(r['engagement_rate_ranking']),
        str(r['conversion_rate_ranking']),
        r.actions ? JSON.stringify(r.actions) : null,
        r.action_values ? JSON.stringify(r.action_values) : null,
        Object.keys(extra).length ? JSON.stringify(extra) : null,
        now,
      )
      for (const [list, isValue] of [
        [r.actions, false],
        [r.action_values, true],
      ] as const) {
        for (const a of list ?? []) {
          const type = str(a.action_type)
          if (!type) continue
          const v = num(a.value)
          insAction.run(
            level,
            entity,
            date,
            type,
            accountId,
            isValue ? null : v,
            isValue ? v : null,
          )
          insType.run(type, now)
        }
      }
      // Nombre de entidades que ya no salen en la estructura (archivadas o borradas).
      if (level === 'campaign' && r.campaign_name)
        insName.run(entity, 'campaign', accountId, null, null, r.campaign_name, now)
      if (level === 'adset' && r.adset_name)
        insName.run(entity, 'adset', accountId, str(r.campaign_id), null, r.adset_name, now)
      if (level === 'ad' && r.ad_name)
        insName.run(entity, 'ad', accountId, str(r.campaign_id), str(r.adset_id), r.ad_name, now)
      n++
    }
  })()
  return n
}

export type StructureLevel = 'campaign' | 'adset' | 'ad'

/** Guarda campañas, conjuntos o anuncios (actualiza los que ya existen). */
export function upsertObjects(
  db: SqliteDb,
  level: StructureLevel,
  accountId: string,
  items: Record<string, unknown>[],
  now: string,
): void {
  const stmt = db.prepare(`INSERT INTO ad_objects
    (id, level, account_id, campaign_id, adset_id, name, status, effective_status, objective,
     bid_strategy, daily_budget, lifetime_budget, start_time, end_time, creative_id,
     updated_time, raw, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      level = excluded.level, account_id = excluded.account_id,
      campaign_id = excluded.campaign_id, adset_id = excluded.adset_id, name = excluded.name,
      status = excluded.status, effective_status = excluded.effective_status,
      objective = excluded.objective, bid_strategy = excluded.bid_strategy,
      daily_budget = excluded.daily_budget, lifetime_budget = excluded.lifetime_budget,
      start_time = excluded.start_time, end_time = excluded.end_time,
      creative_id = excluded.creative_id, updated_time = excluded.updated_time,
      raw = excluded.raw, synced_at = excluded.synced_at`)
  db.transaction(() => {
    for (const o of items) {
      const id = str(o['id'])
      if (!id) continue
      const creative = o['creative'] as { id?: string } | undefined
      stmt.run(
        id,
        level,
        accountId,
        level === 'campaign' ? null : str(o['campaign_id']),
        level === 'ad' ? str(o['adset_id']) : null,
        str(o['name']) ?? id,
        str(o['status']) ?? str(o['configured_status']),
        str(o['effective_status']),
        level === 'campaign' ? str(o['objective']) : str(o['optimization_goal']),
        str(o['bid_strategy']),
        int(o['daily_budget']),
        int(o['lifetime_budget']),
        str(o['start_time']),
        str(o['stop_time']) ?? str(o['end_time']),
        creative?.id ? String(creative.id) : null,
        str(o['updated_time']),
        JSON.stringify(o),
        now,
      )
    }
  })()
}

export function upsertCreatives(
  db: SqliteDb,
  accountId: string,
  items: Record<string, unknown>[],
  now: string,
): void {
  const stmt = db.prepare(`INSERT INTO ad_creatives
    (id, account_id, name, title, body, object_type, call_to_action, link_url, video_id,
     thumbnail_url, raw, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, title = excluded.title, body = excluded.body,
      object_type = excluded.object_type, call_to_action = excluded.call_to_action,
      link_url = excluded.link_url, video_id = excluded.video_id,
      thumbnail_url = excluded.thumbnail_url, raw = excluded.raw, synced_at = excluded.synced_at`)
  db.transaction(() => {
    for (const c of items) {
      const id = str(c['id'])
      if (!id) continue
      stmt.run(
        id,
        accountId,
        str(c['name']),
        str(c['title']),
        str(c['body']),
        str(c['object_type']),
        str(c['call_to_action_type']),
        str(c['link_url']),
        str(c['video_id']),
        str(c['thumbnail_url']) ?? str(c['image_url']),
        JSON.stringify(c),
        now,
      )
    }
  })()
}

export interface AccountRow {
  id: string
  name: string
  currency: string
  timezone: string
  status: number | null
  business: string | null
  enabled: number
  client_id: string | null
  data_from: string | null
  data_until: string | null
  history_done: number
  last_sync_at: string | null
  last_error: string | null
  breakdowns: string | null
  activity_at: string | null
  raw: string
}

export function upsertAccounts(db: SqliteDb, items: Record<string, unknown>[], now: string): void {
  const stmt = db.prepare(`INSERT INTO ad_accounts
    (id, platform, name, currency, timezone, status, business, raw, updated_at)
    VALUES (?, 'meta', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, currency = excluded.currency, timezone = excluded.timezone,
      status = excluded.status, business = excluded.business, raw = excluded.raw,
      updated_at = excluded.updated_at`)
  db.transaction(() => {
    for (const a of items) {
      const id = str(a['id'])
      if (!id) continue
      const business = a['business'] as { name?: string } | undefined
      stmt.run(
        actId(id),
        str(a['name']) ?? id,
        str(a['currency']) ?? 'EUR',
        str(a['timezone_name']) ?? 'Europe/Madrid',
        int(a['account_status']),
        business?.name ?? null,
        JSON.stringify(a),
        now,
      )
    }
  })()
}

export function getAccount(db: SqliteDb, id: string): AccountRow | undefined {
  return db.prepare('SELECT * FROM ad_accounts WHERE id = ?').get(id) as AccountRow | undefined
}

/** Valor del desglose de una fila («25-34», «instagram · feed»…). */
export function breakdownValue(r: Record<string, unknown>, api: readonly string[]): string | null {
  const parts = api.map((k) => r[k]).filter((v): v is string => typeof v === 'string' && v !== '')
  return parts.length === api.length ? parts.join(' · ') : null
}

/** Sustituye las métricas desglosadas de una cuenta, nivel y desglose entre dos fechas. */
export function replaceBreakdowns(
  db: SqliteDb,
  accountId: string,
  level: InsightLevel,
  breakdown: string,
  api: readonly string[],
  since: string,
  until: string,
  rows: InsightRow[],
  now: string,
): number {
  const ins = db.prepare(`INSERT OR REPLACE INTO ad_breakdowns
    (level, entity_id, date, breakdown, value, account_id, spend, impressions, clicks, link_clicks,
     actions, action_values, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  let n = 0
  db.transaction(() => {
    db.prepare(
      'DELETE FROM ad_breakdowns WHERE account_id = ? AND level = ? AND breakdown = ? AND date BETWEEN ? AND ?',
    ).run(accountId, level, breakdown, since, until)
    for (const r of rows) {
      const entity = entityOf(level, accountId, r)
      const date = str(r.date_start)
      const value = breakdownValue(r, api)
      if (!entity || !date || !value) continue
      ins.run(
        level,
        entity,
        date,
        breakdown,
        value,
        accountId,
        num(r['spend']) ?? 0,
        int(r['impressions']) ?? 0,
        int(r['clicks']),
        int(r['inline_link_clicks']),
        r.actions ? JSON.stringify(r.actions) : null,
        r.action_values ? JSON.stringify(r.action_values) : null,
        now,
      )
      n++
    }
  })()
  return n
}

/** Guarda alcance, frecuencia y únicos de un periodo para cada entidad. */
export function storeRangeStats(
  db: SqliteDb,
  accountId: string,
  level: InsightLevel,
  since: string,
  until: string,
  rows: InsightRow[],
  now: string,
): void {
  const ins = db.prepare(`INSERT OR REPLACE INTO ad_range_stats
    (level, entity_id, since, until, account_id, reach, frequency, unique_link_clicks,
     unique_link_ctr, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  db.transaction(() => {
    for (const r of rows) {
      const entity = entityOf(level, accountId, r)
      if (!entity) continue
      ins.run(
        level,
        entity,
        since,
        until,
        accountId,
        int(r['reach']),
        num(r['frequency']),
        int(r['unique_inline_link_clicks']),
        num(r['unique_inline_link_click_ctr']),
        now,
      )
    }
  })()
}
