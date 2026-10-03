import { describe, expect, it } from 'vitest'
import {
  describeRecurrence,
  nextOccurrence,
  recurrenceSchema,
  weekdayOf,
} from '../../src/shared/data/recurrence'

const r = (x: Record<string, unknown>) => recurrenceSchema.parse(x)

describe('repeticiones', () => {
  it('diaria y cada N días', () => {
    expect(nextOccurrence(r({ freq: 'daily' }), '2026-10-03')).toBe('2026-10-04')
    expect(nextOccurrence(r({ freq: 'daily', interval: 3 }), '2026-10-30')).toBe('2026-11-02')
    // Saltando lo ya pasado.
    expect(nextOccurrence(r({ freq: 'daily', interval: 2 }), '2026-10-01', '2026-10-06')).toBe(
      '2026-10-07',
    )
  })

  it('semanal en días concretos (lunes = 0)', () => {
    expect(weekdayOf('2026-10-05')).toBe(0) // lunes
    const lmx = r({ freq: 'weekly', weekdays: [0, 2] })
    expect(nextOccurrence(lmx, '2026-10-05')).toBe('2026-10-07') // lunes → miércoles
    expect(nextOccurrence(lmx, '2026-10-07')).toBe('2026-10-12') // miércoles → lunes
    expect(nextOccurrence(lmx, '2026-10-08')).toBe('2026-10-12') // jueves → lunes
    // Cada 2 semanas, los viernes, contando desde la semana de la fecha actual.
    const quincenal = r({ freq: 'weekly', interval: 2, weekdays: [4] })
    expect(nextOccurrence(quincenal, '2026-10-09')).toBe('2026-10-23')
    expect(nextOccurrence(quincenal, '2026-10-06')).toBe('2026-10-09')
    // Sin días: misma semana que la fecha, cada semana.
    expect(nextOccurrence(r({ freq: 'weekly' }), '2026-12-28')).toBe('2027-01-04')
  })

  it('mensual conserva el día y recorta en meses cortos', () => {
    expect(nextOccurrence(r({ freq: 'monthly' }), '2026-01-31')).toBe('2026-02-28')
    expect(nextOccurrence(r({ freq: 'monthly' }), '2026-02-28', undefined)).toBe('2026-03-28')
    expect(nextOccurrence(r({ freq: 'monthly', monthDay: 31 }), '2026-02-28')).toBe('2026-03-31')
    expect(nextOccurrence(r({ freq: 'monthly', interval: 3 }), '2026-11-15')).toBe('2027-02-15')
    expect(nextOccurrence(r({ freq: 'monthly', monthDay: 5 }), '2026-10-03', '2026-10-04')).toBe(
      '2026-11-05',
    )
  })

  it('anual, también el 29 de febrero', () => {
    expect(nextOccurrence(r({ freq: 'yearly' }), '2028-02-29')).toBe('2029-02-28')
    expect(nextOccurrence(r({ freq: 'yearly' }), '2026-10-03')).toBe('2027-10-03')
  })

  it('describe la regla en español', () => {
    expect(describeRecurrence(r({ freq: 'weekly', weekdays: [2, 0] }))).toBe(
      'Cada semana: lunes y miércoles (al completar)',
    )
    expect(
      describeRecurrence(r({ freq: 'monthly', interval: 2, monthDay: 1, mode: 'schedule' })),
    ).toBe('Cada 2 meses, el día 1 (según calendario)')
    expect(describeRecurrence(r({ freq: 'daily' }))).toBe('Cada día (al completar)')
  })

  it('rechaza reglas no válidas', () => {
    expect(recurrenceSchema.safeParse({ freq: 'hourly' }).success).toBe(false)
    expect(recurrenceSchema.safeParse({ freq: 'daily', interval: 0 }).success).toBe(false)
    expect(recurrenceSchema.safeParse({ freq: 'weekly', weekdays: [7] }).success).toBe(false)
  })
})
