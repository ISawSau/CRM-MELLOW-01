import { TZDate } from '@date-fns/tz'
import { addDays, endOfMonth, format, startOfMonth } from 'date-fns'

/**
 * Fechas «de calendario» (AAAA-MM-DD) en la zona horaria del usuario. Los campos
 * de fecha se guardan así, sin hora ni zona; los de fecha y hora, en UTC (ISO).
 */

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return format(new TZDate(now, timeZone), 'yyyy-MM-dd')
}

export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return format(addDays(new Date(y, m - 1, d), days), 'yyyy-MM-dd')
}

export function monthRange(iso: string): [string, string] {
  const [y, m] = iso.split('-').map(Number) as [number, number]
  const first = new Date(y, m - 1, 1)
  return [format(startOfMonth(first), 'yyyy-MM-dd'), format(endOfMonth(first), 'yyyy-MM-dd')]
}

/** Instante UTC (ISO) del inicio del día `iso` en la zona dada. */
export function startOfDayUtc(iso: string, timeZone: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(new TZDate(y, m - 1, d, 0, 0, 0, timeZone).getTime()).toISOString()
}

/** Fecha local (AAAA-MM-DD) de un instante UTC en la zona dada. */
export function localDateOf(isoUtc: string, timeZone: string): string {
  return format(new TZDate(new Date(isoUtc), timeZone), 'yyyy-MM-dd')
}

/** Valor para <input type="datetime-local"> (AAAA-MM-DDTHH:mm) de un instante UTC. */
export function toLocalInput(isoUtc: string, timeZone: string): string {
  return format(new TZDate(new Date(isoUtc), timeZone), "yyyy-MM-dd'T'HH:mm")
}

/** Instante UTC (ISO) de una fecha y hora local (AAAA-MM-DDTHH:mm) en la zona dada. */
export function fromLocalInput(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number]
  return new Date(new TZDate(y, mo - 1, d, h, mi, 0, timeZone).getTime()).toISOString()
}

/** Días (AAAA-MM-DD) de la cuadrícula de un mes (AAAA-MM), en semanas de lunes a domingo. */
export function monthGrid(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const weekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7 // 0 = lunes
  const start = shiftDate(`${month}-01`, -weekday)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = Math.ceil((weekday + daysInMonth) / 7) * 7
  return Array.from({ length: cells }, (_, i) => shiftDate(start, i))
}

/** Mes (AAAA-MM) desplazado n meses. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
