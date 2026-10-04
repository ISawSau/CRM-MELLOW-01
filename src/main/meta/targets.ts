import type { TableTarget } from '@shared/meta'
import type { SqliteDb } from '../db/connection'
import { createConverter } from './fx'

/**
 * Objetivos de un cliente (fase 14, D-104): CPA o ROAS objetivo, ROAS de equilibrio y
 * presupuesto publicitario mensual, leídos de los campos de su ficha por su clave.
 */
export interface ClientTargets {
  cpa: number | null
  /** Sobre qué se mide el CPA: compras o resultados de la campaña. */
  cpaOn: 'compras' | 'resultados'
  roas: number | null
  breakEvenRoas: number | null
  monthlyBudget: number | null
  /** Moneda en la que están el CPA y el presupuesto (la de su campo). */
  currency: string
}

const KEYS = [
  'cpa_objetivo',
  'cpa_medida',
  'roas_objetivo',
  'roas_equilibrio',
  'presupuesto_mensual',
] as const

export function clientTargets(db: SqliteDb, clientId: string | null): ClientTargets | null {
  if (!clientId) return null
  const rec = db
    .prepare("SELECT data FROM records WHERE id = ? AND entity = 'cliente' AND deleted_at IS NULL")
    .get(clientId) as { data: string } | undefined
  if (!rec) return null
  const data = JSON.parse(rec.data) as Record<string, unknown>
  const fields = db
    .prepare(
      `SELECT id, key, config FROM field_defs
       WHERE entity = 'cliente' AND deleted_at IS NULL AND key IN (${KEYS.map(() => '?').join(',')})`,
    )
    .all(...KEYS) as { id: string; key: string; config: string | null }[]
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const num = (key: string) => {
    const f = byKey.get(key)
    const v = f ? data[f.id] : undefined
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
  }
  const config = (key: string) =>
    JSON.parse(byKey.get(key)?.config ?? '{}') as { currency?: string; options?: { id: string }[] }
  const medida = byKey.get('cpa_medida')
  return {
    cpa: num('cpa_objetivo'),
    cpaOn: medida && data[medida.id] === 'resultados' ? 'resultados' : 'compras',
    roas: num('roas_objetivo'),
    breakEvenRoas: num('roas_equilibrio'),
    monthlyBudget: num('presupuesto_mensual'),
    currency: config('cpa_objetivo').currency ?? 'EUR',
  }
}

/**
 * Objetivo con el que colorear la tabla de Campañas: el CPA (en la moneda de la tabla) o, si
 * el cliente no tiene CPA, su ROAS objetivo. Null si no hay objetivo o falta el tipo de cambio.
 */
export function tableTarget(
  db: SqliteDb,
  clientId: string | null,
  currency: string,
  date: string,
): TableTarget | null {
  const t = clientTargets(db, clientId)
  if (!t) return null
  if (t.cpa !== null) {
    const value =
      t.currency === currency
        ? t.cpa
        : createConverter(db).convert(t.cpa, t.currency, currency, date)
    if (value === null) return null
    return { metric: t.cpaOn === 'resultados' ? 'coste_resultado' : 'cpa', value }
  }
  if (t.roas !== null) return { metric: 'roas', value: t.roas }
  return null
}
