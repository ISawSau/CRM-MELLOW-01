import {
  analysisQuerySchema,
  daysBetween,
  TIME_DIMENSIONS,
  yearBefore,
  type AnalysisGroup,
  type AnalysisQuery,
  type AnalysisResult,
  type Dimension,
} from '@shared/analysis'
import { shiftDate } from '@shared/data/dates'
import type { RecordRow } from '@shared/data/records'
import type { BaseSums } from '@shared/meta'
import type { SqliteDb } from '../db/connection'
import type { DataService } from '../data/data-service'
import { addDaily, moneyConverter, type DailyRow } from '../meta/sums'

/**
 * Motor de los dashboards, comparativas y alertas (SPEC §7.13). Suma las métricas
 * diarias de Meta de las cuentas activadas según un filtro, agrupadas por tiempo o por
 * dimensión, convertidas a una moneda con el tipo de cada día.
 *
 * Las fechas son las de la zona horaria de cada cuenta (como en Ads Manager).
 */

const OTHERS = '__otros__'
const NONE = '__sin__'
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']

type Row = DailyRow & { entity_id: string; account_id: string; currency: string }

interface Account {
  id: string
  name: string
  currency: string
  client_id: string | null
}

/** Lunes de la semana de una fecha (la semana empieza en lunes). */
export function weekStart(iso: string): string {
  const day = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
  return shiftDate(iso, -day)
}

const dd = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

function bucket(dim: Dimension, date: string): string {
  if (dim === 'semana') return weekStart(date)
  if (dim === 'mes') return date.slice(0, 7)
  return date
}

function bucketLabel(dim: Dimension, key: string): string {
  if (dim === 'mes') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`
  if (dim === 'semana') return `Semana del ${dd(key)}`
  return dd(key)
}

/** Todos los grupos de tiempo del periodo, en orden (también los vacíos). */
function buckets(dim: Dimension, since: string, until: string): string[] {
  const out: string[] = []
  for (let d = since; d <= until; d = shiftDate(d, 1)) {
    const b = bucket(dim, d)
    if (out.at(-1) !== b) out.push(b)
  }
  return out
}

export function analyze(
  db: SqliteDb,
  data: DataService,
  input: AnalysisQuery,
  currency: string,
): AnalysisResult {
  const q = analysisQuerySchema.parse(input)
  const conv = moneyConverter(db, currency)
  const f = q.filter

  // Cuentas activadas dentro del filtro.
  let accounts = db
    .prepare('SELECT id, name, currency, client_id FROM ad_accounts WHERE enabled = 1')
    .all() as Account[]
  if (f.type === 'client') accounts = accounts.filter((a) => a.client_id === f.id)
  if (f.type === 'account') accounts = accounts.filter((a) => a.id === f.id)
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const accountIds = accounts.map((a) => a.id)

  const dim = q.groupBy
  const byTime = dim !== null && TIME_DIMENSIONS.includes(dim)
  const needsAds =
    f.type === 'creative' || f.type === 'tag' || dim === 'creatividad' || dim === 'etiqueta'
  const level = needsAds
    ? 'ad'
    : f.type === 'campaign' || dim === 'campana'
      ? 'campaign'
      : 'account'

  // Creatividades y sus vínculos (solo si hacen falta).
  const creativesOfAd = new Map<string, string[]>()
  const creativeTitle = new Map<string, string>()
  const optionsOf = new Map<string, string[]>()
  const optionLabel = new Map<string, string>()
  if (needsAds) {
    for (const l of db
      .prepare("SELECT record_id, ad_id FROM creative_links WHERE source != 'off'")
      .all() as { record_id: string; ad_id: string }[])
      creativesOfAd.set(l.ad_id, [...(creativesOfAd.get(l.ad_id) ?? []), l.record_id])
    const records = data.query('creatividad') as RecordRow[]
    for (const r of records) creativeTitle.set(r.id, r.title)
    const fieldId = f.type === 'tag' ? f.fieldId : q.tagFieldId
    const field = fieldId ? data.listFields('creatividad').find((x) => x.id === fieldId) : null
    if (field) {
      for (const o of (field.config['options'] as { id: string; label: string }[]) ?? [])
        optionLabel.set(o.id, o.label)
      for (const r of records) {
        const v = r.values[field.id]
        optionsOf.set(r.id, Array.isArray(v) ? (v as string[]) : v ? [v as string] : [])
      }
    }
  }

  const load = (since: string, until: string): Row[] => {
    if (!accountIds.length) return []
    const marks = accountIds.map(() => '?').join(',')
    const extra = f.type === 'campaign' ? ' AND d.entity_id = ?' : ''
    return db
      .prepare(
        `SELECT d.entity_id, d.account_id, d.date, d.spend, d.impressions, d.clicks, d.link_clicks,
                d.actions, d.action_values, d.extra, a.currency
         FROM ad_insights_daily d JOIN ad_accounts a ON a.id = d.account_id
         WHERE d.level = ? AND d.account_id IN (${marks}) AND d.date BETWEEN ? AND ?${extra}`,
      )
      .all(level, ...accountIds, since, until, ...(f.type === 'campaign' ? [f.id] : [])) as Row[]
  }

  /** Creatividades de un anuncio que pasan el filtro. */
  const creativesFor = (adId: string): string[] => {
    const list = creativesOfAd.get(adId) ?? []
    if (f.type === 'creative') return list.filter((c) => c === f.id)
    if (f.type === 'tag') return list.filter((c) => optionsOf.get(c)?.includes(f.optionId))
    return list
  }

  /** Claves de grupo de una fila (una creatividad con dos etiquetas suma en las dos). */
  const keysOf = (r: Row): string[] => {
    if (needsAds) {
      const creatives = creativesFor(r.entity_id)
      if ((f.type === 'creative' || f.type === 'tag') && creatives.length === 0) return []
      if (dim === 'creatividad') return creatives.length ? creatives : [NONE]
      if (dim === 'etiqueta') {
        const tags = [...new Set(creatives.flatMap((c) => optionsOf.get(c) ?? []))]
        return tags.length ? tags : [NONE]
      }
    }
    if (dim === null) return ['total']
    if (byTime) return [bucket(dim, r.date)]
    if (dim === 'cuenta') return [r.account_id]
    if (dim === 'cliente') return [accountById.get(r.account_id)?.client_id ?? NONE]
    if (dim === 'campana') return [r.entity_id]
    return ['total']
  }

  let partial = false
  const aggregate = (rows: Row[]) => {
    const groups = new Map<string, BaseSums>()
    const totals: BaseSums = {}
    for (const r of rows) {
      const keys = keysOf(r)
      if (!keys.length) continue
      const money = conv(r.currency, r.date)
      if (!money) {
        partial = true
        continue
      }
      // En los totales, cada fila cuenta una vez aunque esté en dos grupos.
      addDaily(totals, r, money)
      for (const k of keys) {
        let s = groups.get(k)
        if (!s) groups.set(k, (s = {}))
        addDaily(s, r, money)
      }
    }
    return { groups, totals }
  }

  // Periodo de comparación.
  let compareSince: string | null = null
  let compareUntil: string | null = null
  if (q.compare === 'previous') {
    compareUntil = shiftDate(q.since, -1)
    compareSince = shiftDate(q.since, -daysBetween(q.since, q.until))
  } else if (q.compare === 'year') {
    compareSince = yearBefore(q.since)
    compareUntil = yearBefore(q.until)
  }

  const now = aggregate(load(q.since, q.until))
  const before = compareSince && compareUntil ? aggregate(load(compareSince, compareUntil)) : null

  // Nombres de los grupos.
  const clientTitle = new Map<string, string>()
  if (dim === 'cliente')
    for (const c of data.query('cliente') as RecordRow[]) clientTitle.set(c.id, c.title)
  const campaignName = (id: string) =>
    (db.prepare('SELECT name FROM ad_objects WHERE id = ?').get(id) as { name: string } | undefined)
      ?.name ?? id
  const label = (key: string): string => {
    if (key === OTHERS) return 'Otros'
    if (key === NONE)
      return dim === 'cliente'
        ? 'Sin cliente'
        : dim === 'creatividad'
          ? 'Sin creatividad vinculada'
          : 'Sin etiqueta'
    if (dim && byTime) return bucketLabel(dim, key)
    if (dim === 'cuenta') return accountById.get(key)?.name ?? key
    if (dim === 'cliente') return clientTitle.get(key) ?? 'Cliente borrado'
    if (dim === 'campana') return campaignName(key)
    if (dim === 'creatividad') return creativeTitle.get(key) ?? 'Creatividad borrada'
    if (dim === 'etiqueta') return optionLabel.get(key) ?? key
    return 'Total'
  }

  let groups: AnalysisGroup[]
  let compareGroups: AnalysisGroup[] | null = null
  if (dim && byTime) {
    groups = buckets(dim, q.since, q.until).map((k) => ({
      key: k,
      label: label(k),
      base: now.groups.get(k) ?? {},
    }))
    if (before && compareSince && compareUntil)
      compareGroups = buckets(dim, compareSince, compareUntil).map((k) => ({
        key: k,
        label: label(k),
        base: before.groups.get(k) ?? {},
      }))
  } else {
    const sorted = [...now.groups.entries()].sort(
      (a, b) => (b[1]['gasto'] ?? 0) - (a[1]['gasto'] ?? 0),
    )
    const shown = sorted.slice(0, q.limit)
    const rest = sorted.slice(q.limit)
    groups = shown.map(([k, base]) => ({ key: k, label: label(k), base }))
    if (rest.length) {
      const others: BaseSums = {}
      for (const [, b] of rest)
        for (const [k, v] of Object.entries(b)) others[k] = (others[k] ?? 0) + v
      groups.push({ key: OTHERS, label: 'Otros', base: others })
    }
    if (before)
      compareGroups = groups.map((g) => ({
        key: g.key,
        label: g.label,
        base: g.key === OTHERS ? {} : (before.groups.get(g.key) ?? {}),
      }))
  }

  return {
    currency,
    partial,
    since: q.since,
    until: q.until,
    compareSince,
    compareUntil,
    totals: now.totals,
    compareTotals: before?.totals ?? null,
    groups,
    compareGroups,
  }
}
