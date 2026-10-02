import { describe, expect, it } from 'vitest'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  WEEK_STARTS_ON,
} from '../../src/shared/format'

// Intl usa espacios especiales (U+00A0, U+202F); se normalizan para comparar.
const n = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

describe('formato español', () => {
  it('agrupa miles con punto también en números de 4 cifras', () => {
    expect(formatNumber(1234.56)).toBe('1.234,56')
    expect(formatNumber(1234567.891, 2)).toBe('1.234.567,89')
    expect(formatNumber(999)).toBe('999')
  })

  it('moneda', () => {
    expect(n(formatCurrency(1234.56))).toBe('1.234,56 €')
    expect(n(formatCurrency(1234.5, 'USD'))).toBe('1.234,50 US$')
  })

  it('porcentaje', () => {
    expect(n(formatPercent(0.1234))).toBe('12,34 %')
  })

  it('fecha dd/mm/aaaa en Europe/Madrid', () => {
    // 23:30 UTC del 1 de octubre ya es 2 de octubre en Madrid (UTC+2).
    expect(formatDate(new Date('2026-10-01T23:30:00Z'))).toBe('02/10/2026')
    expect(formatDateTime(new Date('2026-10-01T23:30:00Z'))).toBe('02/10/2026 01:30')
  })

  it('la semana empieza en lunes', () => {
    expect(WEEK_STARTS_ON).toBe(1)
  })
})
