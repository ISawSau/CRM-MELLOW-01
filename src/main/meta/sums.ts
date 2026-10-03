import { ACTION_PREFERENCE, type BaseSums } from '@shared/meta'
import { actionKey } from '@shared/meta-metrics'
import type { SqliteDb } from '../db/connection'
import { createConverter } from './fx'
import type { ActionStat } from './store'

/**
 * Suma de filas diarias de métricas en las claves de la tabla (`gasto`, `compras`,
 * `acc_<tipo>`, `val_<tipo>`…). Los importes se convierten con el tipo de cada día.
 */

export interface DailyRow {
  date: string
  spend: number
  impressions: number
  clicks: number | null
  link_clicks: number | null
  actions: string | null
  action_values: string | null
  extra?: string | null
}

const parse = <T>(s: string | null | undefined): T | null => {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

const numberOf = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pick(list: ActionStat[] | null, types: readonly string[]): number {
  if (!list) return 0
  for (const t of types) {
    const a = list.find((x) => x.action_type === t)
    if (a) return numberOf(a.value)
  }
  return 0
}

/** Resultados: [{ indicator, values: [{ value }] }] según la documentación de Insights. */
function results(v: unknown): number {
  if (!Array.isArray(v)) return 0
  let n = 0
  for (const r of v as { values?: { value?: unknown }[] }[])
    for (const x of r.values ?? []) n += numberOf(x.value)
  return n
}

export function addDaily(sums: BaseSums, r: DailyRow, money: (v: number) => number): void {
  const add = (k: string, v: number) => {
    if (v) sums[k] = (sums[k] ?? 0) + v
  }
  const actions = parse<ActionStat[]>(r.actions)
  const values = parse<ActionStat[]>(r.action_values)
  const extra = parse<Record<string, unknown>>(r.extra)
  add('gasto', money(r.spend))
  add('impresiones', r.impressions)
  add('clics', r.clicks ?? 0)
  add('clics_enlace', r.link_clicks ?? 0)
  add('compras', pick(actions, ACTION_PREFERENCE.purchases))
  add('valor_compras', money(pick(values, ACTION_PREFERENCE.purchases)))
  add('carritos', pick(actions, ACTION_PREFERENCE.addToCart))
  add('pagos_iniciados', pick(actions, ACTION_PREFERENCE.initiateCheckout))
  add('reproducciones_3s', pick(actions, ACTION_PREFERENCE.video3s))
  for (const a of actions ?? [])
    if (a.action_type) add(`acc_${actionKey(a.action_type)}`, numberOf(a.value))
  for (const a of values ?? [])
    if (a.action_type) add(`val_${actionKey(a.action_type)}`, money(numberOf(a.value)))
  if (extra) {
    const video = (k: string) =>
      Array.isArray(extra[k]) ? pick(extra[k] as ActionStat[], ['video_view']) : 0
    add('thruplays', video('video_thruplay_watched_actions'))
    add('reproducciones', video('video_play_actions'))
    add('p25', video('video_p25_watched_actions'))
    add('p50', video('video_p50_watched_actions'))
    add('p75', video('video_p75_watched_actions'))
    add('p100', video('video_p100_watched_actions'))
    add('resultados', results(extra['results']))
  }
}

/**
 * Conversión de importes para varias cuentas: devuelve una función por moneda de
 * origen y día, o null si falta algún tipo de cambio.
 */
export function moneyConverter(db: SqliteDb, to: string) {
  const fx = createConverter(db)
  return (from: string, date: string): ((v: number) => number) | null => {
    if (from === to) return (v) => v
    if (fx.convert(1, from, to, date) === null) return null
    return (v) => fx.convert(v, from, to, date)!
  }
}

/** Moneda del cliente (campo «Moneda» de su ficha) si la tiene. */
export function clientCurrency(db: SqliteDb, clientId: string | null): string | null {
  if (!clientId) return null
  const field = db
    .prepare(
      "SELECT id, config FROM field_defs WHERE entity = 'cliente' AND key = 'moneda' AND deleted_at IS NULL",
    )
    .get() as { id: string; config: string } | undefined
  const rec = db
    .prepare('SELECT data FROM records WHERE id = ? AND deleted_at IS NULL')
    .get(clientId) as { data: string } | undefined
  if (!field || !rec) return null
  const value = (JSON.parse(rec.data) as Record<string, unknown>)[field.id]
  const options = (JSON.parse(field.config) as { options?: { id: string; label: string }[] })
    .options
  const label = options
    ?.find((o) => o.id === value)
    ?.label?.trim()
    .toUpperCase()
  return label && /^[A-Z]{3}$/.test(label) ? label : null
}
