/**
 * Formato regional de España para toda la app.
 *
 * Ojo: en CLDR, `es-ES` no agrupa los miles en números de 4 cifras (daría "1234,56").
 * La regla del proyecto es "1.234,56", así que se fuerza `useGrouping: 'always'`.
 */

export const LOCALE = 'es-ES'
export const DEFAULT_TIME_ZONE = 'Europe/Madrid'
/** 1 = lunes (convención de date-fns). */
export const WEEK_STARTS_ON = 1 as const

const numberFormats = new Map<string, Intl.NumberFormat>()
function nf(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = numberFormats.get(key)
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { useGrouping: 'always', ...options })
    numberFormats.set(key, f)
  }
  return f
}

/** 1234.5 → "1.234,5" (con `decimals` fija el número de decimales). */
export function formatNumber(value: number, decimals?: number): string {
  const opts: Intl.NumberFormatOptions =
    decimals === undefined
      ? { maximumFractionDigits: 2 }
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
  return nf(`n:${decimals ?? 'auto'}`, opts).format(value)
}

/** 1234.56, 'EUR' → "1.234,56 €" */
export function formatCurrency(value: number, currency = 'EUR'): string {
  return nf(`c:${currency}`, { style: 'currency', currency }).format(value)
}

/** 0.1234 → "12,34 %" */
export function formatPercent(ratio: number, decimals = 2): string {
  return nf(`p:${decimals}`, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(ratio)
}

const dateFormats = new Map<string, Intl.DateTimeFormat>()
function df(timeZone: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}:${withTime}`
  let f = dateFormats.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
    })
    dateFormats.set(key, f)
  }
  return f
}

/** → "02/10/2026" */
export function formatDate(date: Date | number, timeZone = DEFAULT_TIME_ZONE): string {
  return df(timeZone, false).format(date)
}

/** → "02/10/2026 19:05" */
export function formatDateTime(date: Date | number, timeZone = DEFAULT_TIME_ZONE): string {
  return df(timeZone, true).format(date).replace(',', '')
}
