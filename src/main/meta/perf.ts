import { shiftDate } from '@shared/data/dates'
import {
  ACTION_PREFERENCE,
  currencyOffset,
  emptyMetrics,
  perfQuerySchema,
  type PerfMetrics,
  type PerfQuery,
  type PerfResult,
  type PerfRow,
} from '@shared/meta'
import { AppError } from '@shared/errors'
import type { SqliteDb } from '../db/connection'
import { createConverter } from './fx'
import type { ActionStat } from './store'

/**
 * Resumen de un periodo para la tabla de Meta (fase 6; la tabla completa tipo Ads
 * Manager llega en la fase 7). Los importes se convierten día a día con el tipo de
 * cambio de cada fecha.
 */

interface DailyRow {
  entity_id: string
  date: string
  spend: number
  impressions: number
  clicks: number | null
  link_clicks: number | null
  actions: string | null
  action_values: string | null
  extra: string | null
}

function pick(list: ActionStat[] | null, types: readonly string[]): number {
  if (!list) return 0
  for (const t of types) {
    const a = list.find((x) => x.action_type === t)
    if (a) {
      const n = Number(a.value)
      return Number.isFinite(n) ? n : 0
    }
  }
  return 0
}

const parse = <T>(s: string | null): T | null => {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

function addDay(m: PerfMetrics, r: DailyRow, money: (v: number) => number): void {
  const actions = parse<ActionStat[]>(r.actions)
  const values = parse<ActionStat[]>(r.action_values)
  const extra = parse<Record<string, unknown>>(r.extra)
  m.spend += money(r.spend)
  m.impressions += r.impressions
  m.clicks += r.clicks ?? 0
  m.linkClicks += r.link_clicks ?? 0
  m.purchases += pick(actions, ACTION_PREFERENCE.purchases)
  m.purchaseValue += money(pick(values, ACTION_PREFERENCE.purchases))
  m.addToCart += pick(actions, ACTION_PREFERENCE.addToCart)
  m.initiateCheckout += pick(actions, ACTION_PREFERENCE.initiateCheckout)
  m.video3s += pick(actions, ACTION_PREFERENCE.video3s)
  const thru = extra?.['video_thruplay_watched_actions']
  if (Array.isArray(thru)) m.thruplays += pick(thru as ActionStat[], ['video_view'])
}

export function performance(db: SqliteDb, input: PerfQuery, displayCurrency: string): PerfResult {
  const q = perfQuerySchema.parse(input)
  const account = db.prepare('SELECT currency FROM ad_accounts WHERE id = ?').get(q.accountId) as
    { currency: string } | undefined
  if (!account)
    throw new AppError('INVALID_INPUT', undefined, 'No existe esa cuenta o ese cliente.')
  const fx = createConverter(db)

  const load = (since: string, until: string) => {
    const params: unknown[] = [q.accountId, q.level, since, until]
    let where = ''
    if (q.parentId) {
      where = ' AND (campaign_id = ? OR adset_id = ?)'
      params.push(q.parentId, q.parentId)
    }
    return db
      .prepare(
        `SELECT entity_id, date, spend, impressions, clicks, link_clicks, actions, action_values, extra
         FROM ad_insights_daily WHERE account_id = ? AND level = ? AND date BETWEEN ? AND ?${where}`,
      )
      .all(...params) as DailyRow[]
  }

  const rows = load(q.since, q.until)
  const days = Math.round((Date.parse(q.until) - Date.parse(q.since)) / 86_400_000) + 1
  const prevRows = load(shiftDate(q.since, -days), shiftDate(q.since, -1))

  // Si falta algún tipo de cambio, todo se muestra en la moneda de la cuenta.
  let currency = displayCurrency
  let unconverted = false
  if (account.currency !== displayCurrency) {
    const dates = new Set([...rows, ...prevRows].map((r) => r.date))
    for (const d of dates) {
      if (fx.convert(1, account.currency, displayCurrency, d) === null) {
        currency = account.currency
        unconverted = true
        break
      }
    }
  }
  const moneyFor = (date: string) => (v: number) =>
    currency === account.currency ? v : fx.convert(v, account.currency, currency, date)!

  const byEntity = new Map<string, PerfMetrics>()
  const totals = emptyMetrics()
  for (const r of rows) {
    let m = byEntity.get(r.entity_id)
    if (!m) byEntity.set(r.entity_id, (m = emptyMetrics()))
    const money = moneyFor(r.date)
    addDay(m, r, money)
    addDay(totals, r, money)
  }
  const previous = emptyMetrics()
  for (const r of prevRows) addDay(previous, r, moneyFor(r.date))

  // Entidades: las que tienen datos en el periodo y las activas aunque no gasten.
  const objParams: unknown[] = [q.accountId, q.level]
  let objWhere = ''
  if (q.parentId) {
    objWhere = ' AND (o.campaign_id = ? OR o.adset_id = ?)'
    objParams.push(q.parentId, q.parentId)
  }
  const objects = db
    .prepare(
      `SELECT o.id, o.name, o.status, o.effective_status, o.objective, o.daily_budget,
              o.lifetime_budget, c.thumb_file_id
       FROM ad_objects o LEFT JOIN ad_creatives c ON c.id = o.creative_id
       WHERE o.account_id = ? AND o.level = ?${objWhere}`,
    )
    .all(...objParams) as {
    id: string
    name: string
    status: string | null
    effective_status: string | null
    objective: string | null
    daily_budget: number | null
    lifetime_budget: number | null
    thumb_file_id: string | null
  }[]
  const offset = currencyOffset(account.currency)
  const today = rows.reduce((max, r) => (r.date > max ? r.date : max), q.until)
  const budget = (v: number | null) => (v === null ? null : moneyFor(today)(v / offset))
  const out: PerfRow[] = []
  const seen = new Set<string>()
  for (const o of objects) {
    const m = byEntity.get(o.id)
    if (!m && o.effective_status !== 'ACTIVE') continue
    seen.add(o.id)
    out.push({
      id: o.id,
      name: o.name,
      status: o.status,
      effectiveStatus: o.effective_status,
      objective: o.objective,
      dailyBudget: budget(o.daily_budget),
      lifetimeBudget: budget(o.lifetime_budget),
      thumbFileId: o.thumb_file_id,
      ...(m ?? emptyMetrics()),
    })
  }
  for (const [id, m] of byEntity) {
    if (seen.has(id)) continue
    out.push({
      id,
      name: id,
      status: null,
      effectiveStatus: null,
      objective: null,
      dailyBudget: null,
      lifetimeBudget: null,
      thumbFileId: null,
      ...m,
    })
  }
  out.sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name))
  return { currency, accountCurrency: account.currency, unconverted, rows: out, totals, previous }
}
