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
