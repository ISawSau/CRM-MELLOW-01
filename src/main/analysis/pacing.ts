import { daysInMonth, pacingOf, type PacingRow } from '@shared/growth'
import type { RecordRow } from '@shared/data/records'
import type { SqliteDb } from '../db/connection'
import type { DataService } from '../data/data-service'
import { analyze } from './query'

/**
 * Ritmo de gasto del mes (fase 14, D-105): para cada cliente con presupuesto publicitario
 * mensual, lo gastado en sus cuentas de Meta desde el día 1, en la moneda del presupuesto, y
 * la proyección a fin de mes.
 */
export function pacing(db: SqliteDb, data: DataService, today: string): PacingRow[] {
  const field = data.listFields('cliente').find((f) => f.key === 'presupuesto_mensual')
  if (!field) return []
  const currency = (field.config['currency'] as string | undefined) ?? 'EUR'
  const since = `${today.slice(0, 7)}-01`
  const day = Number(today.slice(8, 10))
  const days = daysInMonth(today)
  const out: PacingRow[] = []
  for (const c of data.query('cliente') as RecordRow[]) {
    const budget = c.values[field.id]
    if (typeof budget !== 'number' || !(budget > 0)) continue
    const r = analyze(
      db,
      data,
      { since, until: today, filter: { type: 'client', id: c.id } },
      currency,
    )
    const spent = r.totals['gasto'] ?? 0
    out.push({
      clientId: c.id,
      client: c.title,
      currency,
      budget,
      spent,
      day,
      days,
      partial: r.partial,
      ...pacingOf(spent, budget, day, days),
    })
  }
  return out.sort((a, b) => b.spent / b.budget - a.spent / a.budget)
}
