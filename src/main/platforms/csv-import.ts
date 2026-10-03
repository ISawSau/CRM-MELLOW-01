import { AppError } from '@shared/errors'
import {
  detectTable,
  parseAmount,
  parseCsv,
  parseCsvDate,
  slugify,
  type CsvImport,
  type CsvImportResult,
} from '@shared/platforms'
import type { SqliteDb } from '../db/connection'
import { replaceInsights, type InsightRow } from '../meta/store'
import { t } from '@shared/i18n'

/**
 * Importación de los CSV de X Ads y LinkedIn Campaign Manager (SPEC §7.4, D-080). Las
 * filas van a las mismas tablas que Meta (campaña y cuenta por día), así que Análisis,
 * Facturación e Informes las incluyen sin cambios. Importar otra vez el mismo periodo
 * sustituye los datos de esas fechas: se puede repetir cada semana sin duplicar.
 */

const PREFIX = { linkedin: 'li', x: 'x' } as const

interface Sums {
  name: string
  spend: number
  impressions: number
  clicks: number
  linkClicks: number
  conversions: number
  value: number
}

function ensureAccount(db: SqliteDb, input: CsvImport, now: string): string {
  if (input.accountId) {
    const a = db.prepare('SELECT platform FROM ad_accounts WHERE id = ?').get(input.accountId) as
      { platform: string } | undefined
    if (!a || a.platform !== input.platform)
      throw new AppError('INVALID_INPUT', undefined, t('Esa cuenta no existe en esta plataforma.'))
    return input.accountId
  }
  const n = input.newAccount
  if (!n) throw new AppError('INVALID_INPUT', undefined, t('Elige una cuenta o crea una nueva.'))
  const base = `${PREFIX[input.platform]}_${slugify(n.name)}`.slice(0, 60)
  let id = base
  for (let i = 2; db.prepare('SELECT 1 FROM ad_accounts WHERE id = ?').get(id); i++)
    id = `${base.slice(0, 56)}-${i}`
  db.prepare(
    `INSERT INTO ad_accounts (id, platform, name, currency, timezone, enabled, history_done, raw, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
  ).run(id, input.platform, n.name, n.currency, n.timezone, JSON.stringify({ source: 'csv' }), now)
  return id
}

export function importCsv(db: SqliteDb, input: CsvImport, now: string): CsvImportResult {
  const rows = parseCsv(input.text)
  const { headerRow } = detectTable(rows)
  const col = input.mapping.columns
  for (const f of ['date', 'campaign', 'spend', 'impressions'] as const)
    if (col[f] === null || col[f] === undefined)
      throw new AppError('INVALID_INPUT', undefined, t('Faltan columnas obligatorias por asignar.'))
  const cell = (r: string[], f: keyof typeof col) => {
    const i = col[f]
    return i === null || i === undefined ? '' : (r[i] ?? '').trim()
  }
  const amount = (r: string[], f: keyof typeof col) =>
    parseAmount(cell(r, f), input.mapping.decimal) ?? 0

  const byKey = new Map<string, Sums & { campaignKey: string; date: string }>()
  let skipped = 0
  for (const r of rows.slice(headerRow + 1)) {
    const date = parseCsvDate(cell(r, 'date'), input.mapping.dateFormat)
    const name = cell(r, 'campaign')
    // Filas de totales o vacías: sin fecha o sin campaña.
    if (!date || !name || /^total/i.test(name)) {
      skipped++
      continue
    }
    const campaignKey = cell(r, 'campaignId') || slugify(name)
    const key = `${campaignKey}|${date}`
    const s = byKey.get(key) ?? {
      campaignKey,
      date,
      name,
      spend: 0,
      impressions: 0,
      clicks: 0,
      linkClicks: 0,
      conversions: 0,
      value: 0,
    }
    s.spend += amount(r, 'spend')
    s.impressions += amount(r, 'impressions')
    s.clicks += amount(r, 'clicks')
    s.linkClicks += amount(r, 'linkClicks')
    s.conversions += amount(r, 'conversions')
    s.value += amount(r, 'value')
    byKey.set(key, s)
  }
  if (!byKey.size)
    throw new AppError(
      'INVALID_INPUT',
      undefined,
      t('No hay filas con fecha y campaña: revisa las columnas y el formato de fecha.'),
    )

  let accountId = ''
  let result: CsvImportResult | null = null
  db.transaction(() => {
    accountId = ensureAccount(db, input, now)
    const action = input.mapping.conversionsAs === 'compras' ? 'purchase' : 'conversion'
    const toRow = (s: Sums, date: string, campaignId: string | null): InsightRow => ({
      ...(campaignId ? { campaign_id: campaignId, campaign_name: s.name } : {}),
      date_start: date,
      spend: s.spend,
      impressions: s.impressions,
      clicks: s.clicks,
      inline_link_clicks: s.linkClicks,
      ...(s.conversions ? { actions: [{ action_type: action, value: s.conversions }] } : {}),
      ...(s.value ? { action_values: [{ action_type: action, value: s.value }] } : {}),
    })
    const list = [...byKey.values()]
    const dates = list.map((s) => s.date).sort()
    const since = dates[0]!
    const until = dates.at(-1)!
    const campaignRows = list.map((s) => toRow(s, s.date, `${accountId}:${s.campaignKey}`))
    // La cuenta: suma de las campañas de cada día.
    const perDay = new Map<string, Sums>()
    for (const s of list) {
      const d = perDay.get(s.date) ?? {
        name: '',
        spend: 0,
        impressions: 0,
        clicks: 0,
        linkClicks: 0,
        conversions: 0,
        value: 0,
      }
      for (const k of [
        'spend',
        'impressions',
        'clicks',
        'linkClicks',
        'conversions',
        'value',
      ] as const)
        d[k] += s[k]
      perDay.set(s.date, d)
    }
    replaceInsights(db, accountId, 'campaign', since, until, campaignRows, now)
    replaceInsights(
      db,
      accountId,
      'account',
      since,
      until,
      [...perDay.entries()].map(([d, s]) => toRow(s, d, null)),
      now,
    )
    db.prepare(
      `UPDATE ad_accounts SET
         data_from = CASE WHEN data_from IS NULL OR data_from > ? THEN ? ELSE data_from END,
         data_until = CASE WHEN data_until IS NULL OR data_until < ? THEN ? ELSE data_until END,
         last_sync_at = ?, last_error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(since, since, until, until, now, now, accountId)
    result = {
      accountId,
      rows: list.length,
      campaigns: new Set(list.map((s) => s.campaignKey)).size,
      since,
      until,
      skipped,
    }
  })()
  return result!
}
