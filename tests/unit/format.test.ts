import { describe, expect, it } from 'vitest'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  parseNumberEs,
  WEEK_STARTS_ON,
} from '../../src/shared/format'
import { fromLocalInput, monthGrid, shiftMonth, toLocalInput } from '../../src/shared/data/dates'

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

describe('lectura de números y fechas escritos por el usuario', () => {
  it('entiende números a la española', () => {
    expect(parseNumberEs('1.234,56')).toBe(1234.56)
    expect(parseNumberEs('1234,5')).toBe(1234.5)
    expect(parseNumberEs('-3,5')).toBe(-3.5)
    expect(parseNumberEs('1.000')).toBe(1000)
    expect(parseNumberEs('1.000.000')).toBe(1_000_000)
    expect(parseNumberEs('12.5')).toBe(12.5)
    expect(parseNumberEs('1 234,56 €')).toBe(1234.56)
    expect(parseNumberEs('15 %')).toBe(15)
    expect(parseNumberEs('')).toBeNull()
    expect(parseNumberEs('abc')).toBeNull()
    expect(parseNumberEs('1,2,3')).toBeNull()
    expect(parseNumberEs('1e400')).toBeNull()
  })

  it('fecha y hora local en Madrid, ida y vuelta (también en el cambio de hora)', () => {
    expect(fromLocalInput('2026-06-15T10:00', 'Europe/Madrid')).toBe('2026-06-15T08:00:00.000Z')
    expect(fromLocalInput('2026-01-15T10:00', 'Europe/Madrid')).toBe('2026-01-15T09:00:00.000Z')
    expect(toLocalInput('2026-06-15T08:00:00.000Z', 'Europe/Madrid')).toBe('2026-06-15T10:00')
    expect(toLocalInput('2026-10-25T00:30:00.000Z', 'Europe/Madrid')).toBe('2026-10-25T02:30')
    expect(fromLocalInput('15/06/2026', 'Europe/Madrid')).toBeNull()
  })
})

describe('calendario', () => {
  it('la cuadrícula del mes empieza en lunes y cubre semanas completas', () => {
    const oct = monthGrid('2026-10') // 1/10/2026 es jueves
    expect(oct[0]).toBe('2026-09-28')
    expect(oct).toHaveLength(35)
    expect(oct.at(-1)).toBe('2026-11-01')
    const feb = monthGrid('2027-02') // 1/2/2027 es lunes, 28 días
    expect(feb[0]).toBe('2027-02-01')
    expect(feb).toHaveLength(28)
    expect(monthGrid('2026-03')).toHaveLength(42) // 1/3/2026 es domingo
  })

  it('cambia de mes y de año', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
})

describe('diferencias entre versiones', () => {
  it('marca líneas añadidas, quitadas e iguales', async () => {
    const { diffLines } = await import('../../src/shared/diff')
    expect(diffLines('Hook A\nCuerpo\nCTA', 'Hook B\nCuerpo\nCTA\nPS')).toEqual([
      { kind: 'removed', text: 'Hook A' },
      { kind: 'added', text: 'Hook B' },
      { kind: 'same', text: 'Cuerpo' },
      { kind: 'same', text: 'CTA' },
      { kind: 'added', text: 'PS' },
    ])
    expect(diffLines('igual', 'igual')).toEqual([{ kind: 'same', text: 'igual' }])
  })
})
