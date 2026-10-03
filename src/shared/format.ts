import { getLocale, intlLocale } from './i18n'

/**
 * Formato regional: España (1.234,56) o, con la interfaz en inglés, británico (1,234.56).
 * Las fechas son dd/mm/aaaa en los dos y la semana empieza en lunes (D-090).
 *
 * Ojo: en CLDR, `es-ES` no agrupa los miles en números de 4 cifras (daría "1234,56").
 * La regla del proyecto es "1.234,56", así que se fuerza `useGrouping: 'always'`.
 */

/** Etiqueta de Intl del idioma actual («es-ES» o «en-GB»). */
export function currentLocale(): string {
  return intlLocale()
}
export const DEFAULT_TIME_ZONE = 'Europe/Madrid'
/** 1 = lunes (convención de date-fns). */
export const WEEK_STARTS_ON = 1 as const

const numberFormats = new Map<string, Intl.NumberFormat>()
function nf(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = `${getLocale()}|${key}`
  let f = numberFormats.get(k)
  if (!f) {
    f = new Intl.NumberFormat(currentLocale(), { useGrouping: 'always', ...options })
    numberFormats.set(k, f)
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
  const key = `${getLocale()}|${timeZone}:${withTime}`
  let f = dateFormats.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(currentLocale(), {
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

/**
 * Lee un número escrito a la española: "1.234,56", "1234,56", "-3,5", "1.000".
 * También acepta el punto decimal ("12.5") cuando no puede ser separador de miles.
 * Devuelve null si el texto no es un número.
 */
export function parseNumberEs(raw: string): number | null {
  // En inglés (1,234.56) se intercambian los separadores y se lee igual.
  if (getLocale() === 'en') raw = raw.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.'))
  let s = raw.trim().replace(/[\s\u00a0\u20ac%]/g, '')
  if (s === '') return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
