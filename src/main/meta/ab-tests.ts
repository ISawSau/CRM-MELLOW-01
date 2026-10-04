import { shiftDate } from '@shared/data/dates'
import { AppError } from '@shared/errors'
import { AB_METRICS, parseAdIds, type AbAd, type AbTestResult } from '@shared/growth'
import { t } from '@shared/i18n'
import type { SqliteDb } from '../db/connection'
import type { DataService } from '../data/data-service'
import { sumAds } from './creatives'

/**
 * Resultado de un test A/B (fase 14, D-108): las sumas de los anuncios de cada variante
 * entre el inicio y el fin del test (o hoy, si sigue en marcha), en la moneda indicada.
 */
export function abTestResult(
  db: SqliteDb,
  data: DataService,
  recordId: string,
  currency: string,
  today: string,
): AbTestResult {
  const record = data.get(recordId)
  if (record.entity !== 'prueba')
    throw new AppError('INVALID_INPUT', undefined, t('No es un test A/B.'))
  const fields = new Map(data.listFields('prueba').map((f) => [f.key, f.id]))
  const value = (key: string) => {
    const id = fields.get(key)
    return id ? record.values[id] : undefined
  }
  const date = (key: string) => {
    const v = value(key)
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
  }
  const end = date('fin')
  const until = end && end < today ? end : today
  const since = date('inicio') ?? shiftDate(until, -29)
  const metric = value('metrica')
  const names = db.prepare(
    `SELECT o.id, o.name, a.name AS accountName FROM ad_objects o
     JOIN ad_accounts a ON a.id = o.account_id WHERE o.id = ? AND o.level = 'ad'`,
  )
  const variant = (key: string) => {
    const ids = parseAdIds(value(key))
    const ads = ids.map(
      (id) => (names.get(id) as AbAd | undefined) ?? { id, name: id, accountName: '' },
    )
    const s = sumAds(db, ids, since, until, currency)
    return { ads, base: s.base, partial: s.partial }
  }
  const a = variant('anuncios_a')
  const b = variant('anuncios_b')
  return {
    currency,
    partial: a.partial || b.partial,
    since: since <= until ? since : until,
    until,
    metric: typeof metric === 'string' && metric in AB_METRICS ? metric : 'cpa',
    a: { ads: a.ads, base: a.base },
    b: { ads: b.ads, base: b.base },
  }
}
