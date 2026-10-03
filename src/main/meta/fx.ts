import type { SqliteDb } from '../db/connection'
import type { FetchLike } from '../sync/remote'

/**
 * Tipos de cambio de referencia del BCE (SPEC §7.3, D-056), gratis y sin clave:
 * https://www.ecb.europa.eu/stats/eurofxref/ (XML diario, últimos 90 días e
 * histórico completo). Se publican hacia las 16:00 CET los días hábiles; los días
 * sin publicación (fines de semana y festivos TARGET) usan el último tipo anterior.
 * Se guardan en la bóveda, así que una fecha antigua siempre usa su tipo histórico.
 */

export const ECB_BASE = 'https://www.ecb.europa.eu/stats/eurofxref'
/** Años de histórico que se guardan (de sobra para los 37 meses de Meta). */
const KEEP_YEARS = 5

export interface DayRates {
  date: string
  rates: Record<string, number>
}

/** Lee el XML del BCE: <Cube time='AAAA-MM-DD'><Cube currency='USD' rate='1.1'/>… */
export function parseEcbXml(xml: string): DayRates[] {
  const out: DayRates[] = []
  const day = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g
  const rate = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g
  for (const m of xml.matchAll(day)) {
    const rates: Record<string, number> = {}
    for (const r of m[2]!.matchAll(rate)) {
      const v = Number(r[2])
      if (Number.isFinite(v) && v > 0) rates[r[1]!] = v
    }
    if (Object.keys(rates).length) out.push({ date: m[1]!, rates })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export function latestRateDate(db: SqliteDb): string | null {
  const r = db.prepare('SELECT MAX(date) AS d FROM fx_rates').get() as { d: string | null }
  return r.d
}

export function storeRates(db: SqliteDb, days: DayRates[], from?: string): number {
  const ins = db.prepare(
    'INSERT INTO fx_rates (date, currency, rate) VALUES (?, ?, ?) ON CONFLICT(date, currency) DO UPDATE SET rate = excluded.rate',
  )
  let n = 0
  db.transaction(() => {
    for (const d of days) {
      if (from && d.date < from) continue
      for (const [c, v] of Object.entries(d.rates)) {
        ins.run(d.date, c, v)
        n++
      }
    }
  })()
  return n
}

/**
 * Descarga lo que falte: el histórico completo la primera vez (o tras más de 80 días
 * sin actualizar) y los últimos 90 días si no. Devuelve el número de tipos guardados.
 */
export async function updateRates(
  db: SqliteDb,
  today: string,
  http: FetchLike = fetch,
  base = ECB_BASE,
): Promise<number> {
  const latest = latestRateDate(db)
  if (latest && latest >= shiftIso(today, -1)) return 0
  const full = !latest || latest < shiftIso(today, -80)
  const res = await http(`${base}/${full ? 'eurofxref-hist.xml' : 'eurofxref-hist-90d.xml'}`, {
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`El BCE respondió ${res.status}`)
  const days = parseEcbXml(await res.text())
  if (!days.length) throw new Error('El archivo del BCE no trae tipos de cambio')
  return storeRates(db, days, `${Number(today.slice(0, 4)) - KEEP_YEARS}${today.slice(4)}`)
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Conversor con caché: `convert(importe, de, a, fecha)`. Devuelve null si falta el tipo
 * de alguna de las dos monedas (no es del BCE o aún no hay tipos guardados).
 */
export function createConverter(db: SqliteDb) {
  const before = db.prepare(
    'SELECT rate FROM fx_rates WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1',
  )
  const after = db.prepare(
    'SELECT rate FROM fx_rates WHERE currency = ? AND date > ? ORDER BY date ASC LIMIT 1',
  )
  const cache = new Map<string, number | null>()
  const rate = (currency: string, date: string): number | null => {
    if (currency === 'EUR') return 1
    const key = `${currency}|${date}`
    if (cache.has(key)) return cache.get(key)!
    const r = (before.get(currency, date) ?? after.get(currency, date)) as
      { rate: number } | undefined
    const v = r?.rate ?? null
    cache.set(key, v)
    return v
  }
  return {
    rate,
    convert(amount: number, from: string, to: string, date: string): number | null {
      if (from === to) return amount
      const a = rate(from, date)
      const b = rate(to, date)
      if (a === null || b === null) return null
      return (amount / a) * b
    },
  }
}
