import { shiftDate } from '@shared/data/dates'
import { AppError } from '@shared/errors'
import {
  breakdownConfigSchema,
  currencyOffset,
  tableQuerySchema,
  type BaseSums,
  type BreakdownKey,
  type RangeStats,
  type TableQuery,
  type TableResult,
  type TableRow,
} from '@shared/meta'
import type { SqliteDb } from '../db/connection'
import { addDaily, clientCurrency, moneyConverter, type DailyRow } from './sums'

/**
 * Tabla tipo Ads Manager (SPEC §7.3, fase 7): una fila por campaña, conjunto o anuncio
 * con las sumas del periodo, el periodo anterior, el desglose y el alcance.
 */

interface ObjectRow {
  id: string
  name: string
  status: string | null
  effective_status: string | null
  objective: string | null
  bid_strategy: string | null
  daily_budget: number | null
  lifetime_budget: number | null
  start_time: string | null
  end_time: string | null
  updated_time: string | null
  last_edit: string | null
  raw: string
  thumb_file_id: string | null
}

const PARENT_LEVEL = { campaign: 'account', adset: 'campaign', ad: 'adset' } as const

/** «7 días tras hacer clic, 1 día tras ver» a partir de attribution_spec del conjunto. */
export function attributionText(raw: string): string | null {
  try {
    const spec = (
      JSON.parse(raw) as { attribution_spec?: { event_type?: string; window_days?: number }[] }
    ).attribution_spec
    if (!Array.isArray(spec) || spec.length === 0) return null
    const label: Record<string, string> = {
      CLICK_THROUGH: 'tras hacer clic',
      VIEW_THROUGH: 'tras ver',
      ENGAGED_VIDEO_VIEW: 'tras visualización interesada',
    }
    return spec
      .map((s) => {
        const d = s.window_days ?? 0
        return `${d} ${d === 1 ? 'día' : 'días'} ${label[s.event_type ?? ''] ?? (s.event_type ?? '').toLowerCase()}`
      })
      .join(', ')
  } catch {
    return null
  }
}

export function table(db: SqliteDb, input: TableQuery, displayCurrency: string): TableResult {
  const q = tableQuerySchema.parse(input)
  const account = db
    .prepare('SELECT currency, client_id, breakdowns FROM ad_accounts WHERE id = ?')
    .get(q.accountId) as
    { currency: string; client_id: string | null; breakdowns: string | null } | undefined
  if (!account) throw new AppError('INVALID_INPUT', undefined, 'No existe esa cuenta.')
  const target = clientCurrency(db, account.client_id) ?? displayCurrency
  const conv = moneyConverter(db, target)

  const where = q.parentId ? ' AND (campaign_id = ? OR adset_id = ?)' : ''
  const params = (since: string, until: string) => [
    q.accountId,
    q.level,
    since,
    until,
    ...(q.parentId ? [q.parentId, q.parentId] : []),
  ]
  const load = (since: string, until: string) =>
    db
      .prepare(
        `SELECT entity_id, date, spend, impressions, clicks, link_clicks, actions, action_values, extra,
                quality_ranking, engagement_ranking, conversion_ranking
         FROM ad_insights_daily WHERE account_id = ? AND level = ? AND date BETWEEN ? AND ?${where}
         ORDER BY date`,
      )
      .all(...params(since, until)) as (DailyRow & {
      entity_id: string
      quality_ranking: string | null
      engagement_ranking: string | null
      conversion_ranking: string | null
    })[]

  const days = Math.round((Date.parse(q.until) - Date.parse(q.since)) / 86_400_000) + 1
  const prevSince = shiftDate(q.since, -days)
  const prevUntil = shiftDate(q.since, -1)
  const rows = load(q.since, q.until)
  const prevRows = load(prevSince, prevUntil)

  // Si falta algún tipo de cambio, todo en la moneda de la cuenta.
  let currency = target
  let unconverted = false
  if (account.currency !== target) {
    for (const d of new Set([...rows, ...prevRows].map((r) => r.date)))
      if (!conv(account.currency, d)) {
        currency = account.currency
        unconverted = true
        break
      }
  }
  const money = (date: string) =>
    currency === account.currency ? (v: number) => v : conv(account.currency, date)!

  const byEntity = new Map<string, BaseSums>()
  const rankings = new Map<string, TableRow['rankings']>()
  const totals: BaseSums = {}
  for (const r of rows) {
    let s = byEntity.get(r.entity_id)
    if (!s) byEntity.set(r.entity_id, (s = {}))
    addDaily(s, r, money(r.date))
    addDaily(totals, r, money(r.date))
    // La clasificación más reciente del periodo.
    if (r.quality_ranking || r.engagement_ranking || r.conversion_ranking)
      rankings.set(r.entity_id, {
        quality: r.quality_ranking,
        engagement: r.engagement_ranking,
        conversion: r.conversion_ranking,
      })
  }
  const previous: BaseSums = {}
  const prevByEntity = new Map<string, BaseSums>()
  for (const r of prevRows) {
    addDaily(previous, r, money(r.date))
    if (q.compare) {
      let s = prevByEntity.get(r.entity_id)
      if (!s) prevByEntity.set(r.entity_id, (s = {}))
      addDaily(s, r, money(r.date))
    }
  }

  // Alcance y frecuencia del periodo (pedidos a Meta, en caché).
  const rangeRows = db
    .prepare(
      `SELECT level, entity_id, reach, frequency, unique_link_clicks, unique_link_ctr FROM ad_range_stats
       WHERE account_id = ? AND since = ? AND until = ?`,
    )
    .all(q.accountId, q.since, q.until) as {
    level: string
    entity_id: string
    reach: number | null
    frequency: number | null
    unique_link_clicks: number | null
    unique_link_ctr: number | null
  }[]
  const toRange = (r: (typeof rangeRows)[number]): RangeStats => ({
    alcance: r.reach,
    frecuencia: r.frequency,
    clics_enlace_unicos: r.unique_link_clicks,
    ctr_enlace_unico: r.unique_link_ctr,
  })
  const rangeOf = new Map(
    rangeRows.filter((r) => r.level === q.level).map((r) => [r.entity_id, toRange(r)]),
  )
  const parentLevel = PARENT_LEVEL[q.level]
  const parentEntity = q.parentId ?? q.accountId
  const parentRange = rangeRows.find((r) => r.level === parentLevel && r.entity_id === parentEntity)

  // Desglose.
  const bdConfig = breakdownConfigSchema.parse(
    account.breakdowns ? JSON.parse(account.breakdowns) : {},
  )
  const enabled: BreakdownKey[] = bdConfig[q.level]
  const breakdownOf = new Map<string, Map<string, BaseSums>>()
  if (q.breakdown && enabled.includes(q.breakdown)) {
    const bd = db
      .prepare(
        `SELECT b.entity_id, b.value, b.date, b.spend, b.impressions, b.clicks, b.link_clicks,
                b.actions, b.action_values
         FROM ad_breakdowns b
         WHERE b.account_id = ? AND b.level = ? AND b.breakdown = ? AND b.date BETWEEN ? AND ?`,
      )
      .all(q.accountId, q.level, q.breakdown, q.since, q.until) as (DailyRow & {
      entity_id: string
      value: string
    })[]
    for (const r of bd) {
      let m = breakdownOf.get(r.entity_id)
      if (!m) breakdownOf.set(r.entity_id, (m = new Map()))
      let s = m.get(r.value)
      if (!s) m.set(r.value, (s = {}))
      addDaily(s, r, money(r.date))
    }
  }

  // Creatividades vinculadas (anuncios).
  const creativesOf = new Map<string, { id: string; title: string }[]>()
  if (q.level === 'ad') {
    const titleField = db
      .prepare("SELECT id FROM field_defs WHERE entity = 'creatividad' AND key = 'nombre'")
      .get() as { id: string } | undefined
    const links = db
      .prepare(
        `SELECT l.ad_id, r.id, r.data FROM creative_links l
         JOIN records r ON r.id = l.record_id AND r.deleted_at IS NULL
         JOIN ad_objects o ON o.id = l.ad_id AND o.account_id = ?`,
      )
      .all(q.accountId) as { ad_id: string; id: string; data: string }[]
    for (const l of links) {
      const title = titleField
        ? String((JSON.parse(l.data) as Record<string, unknown>)[titleField.id] ?? '')
        : ''
      const list = creativesOf.get(l.ad_id) ?? []
      list.push({ id: l.id, title: title || 'Sin nombre' })
      creativesOf.set(l.ad_id, list)
    }
  }

  const objWhere = q.parentId ? ' AND (o.campaign_id = ? OR o.adset_id = ?)' : ''
  const objects = db
    .prepare(
      `SELECT o.id, o.name, o.status, o.effective_status, o.objective, o.bid_strategy,
              o.daily_budget, o.lifetime_budget, o.start_time, o.end_time, o.updated_time,
              o.last_edit, o.raw, c.thumb_file_id
       FROM ad_objects o LEFT JOIN ad_creatives c ON c.id = o.creative_id
       WHERE o.account_id = ? AND o.level = ?${objWhere}`,
    )
    .all(q.accountId, q.level, ...(q.parentId ? [q.parentId, q.parentId] : [])) as ObjectRow[]

  const offset = currencyOffset(account.currency)
  const lastDate = rows.at(-1)?.date ?? q.until
  const budget = (v: number | null) => (v === null ? null : money(lastDate)(v / offset))
  const out: TableRow[] = []
  const seen = new Set<string>()
  const make = (id: string, o: ObjectRow | null, base: BaseSums | undefined): TableRow => {
    const bd = breakdownOf.get(id)
    return {
      id,
      name: o?.name ?? id,
      status: o?.status ?? null,
      effectiveStatus: o?.effective_status ?? null,
      objective: o?.objective ?? null,
      bidStrategy: o?.bid_strategy ?? null,
      dailyBudget: o ? budget(o.daily_budget) : null,
      lifetimeBudget: o ? budget(o.lifetime_budget) : null,
      startTime: o?.start_time ?? null,
      endTime: o?.end_time ?? null,
      lastEdit: o?.last_edit ?? o?.updated_time ?? null,
      lastEditExact: !!o?.last_edit,
      attribution: o && q.level === 'adset' ? attributionText(o.raw) : null,
      rankings: rankings.get(id) ?? { quality: null, engagement: null, conversion: null },
      thumbFileId: o?.thumb_file_id ?? null,
      creatives: creativesOf.get(id) ?? [],
      base: base ?? {},
      range: rangeOf.get(id) ?? null,
      previous: q.compare ? (prevByEntity.get(id) ?? {}) : null,
      breakdown: bd
        ? [...bd.entries()]
            .map(([value, b]) => ({ value, base: b }))
            .sort((a, b) => (b.base['gasto'] ?? 0) - (a.base['gasto'] ?? 0))
        : null,
    }
  }
  for (const o of objects) {
    const base = byEntity.get(o.id)
    if (!base && o.effective_status !== 'ACTIVE') continue
    seen.add(o.id)
    out.push(make(o.id, o, base))
  }
  for (const [id, base] of byEntity) if (!seen.has(id)) out.push(make(id, null, base))
  out.sort(
    (a, b) => (b.base['gasto'] ?? 0) - (a.base['gasto'] ?? 0) || a.name.localeCompare(b.name),
  )

  return {
    currency,
    accountCurrency: account.currency,
    unconverted,
    rows: out,
    totals,
    totalsRange: parentRange ? toRange(parentRange) : null,
    previous,
    rangeMissing: rows.length > 0 && rangeRows.length === 0,
    breakdowns: enabled,
  }
}
