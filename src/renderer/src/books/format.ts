import { t } from '@shared/i18n'
import { formatNumber } from '@shared/format'

/** «1 h 05 min», «12 min», «menos de 1 min». */
export function durationLabel(seconds: number): string {
  const total = Math.round(seconds / 60)
  if (total < 1) return t('menos de 1 min')
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return t('{m} min', { m })
  return t('{h} h {m} min', { h, m: String(m).padStart(2, '0') })
}

export function percentLabel(fraction: number): string {
  return `${formatNumber(Math.floor(fraction * 100), 0)} %`
}

/** «2026-10-03» → «03/10/2026» */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
