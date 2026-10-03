import { z } from 'zod'

/**
 * Repeticiones de tareas (SPEC §7.6): diaria, semanal en días concretos, mensual,
 * anual, cada N periodos. Cálculo propio sobre fechas de calendario (AAAA-MM-DD),
 * sin horas ni zonas: «el lunes» es el lunes en la zona del usuario.
 *
 * Modos:
 * - `completion`: la siguiente se crea al completar la actual, contando desde ese día.
 * - `schedule`: la siguiente sigue el calendario, se complete o no la actual.
 */

export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number]

export const recurrenceSchema = z
  .object({
    freq: z.enum(RECURRENCE_FREQS),
    interval: z.number().int().min(1).max(365).default(1),
    /** Días de la semana (0 = lunes … 6 = domingo), solo para `weekly`. */
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    /** Día del mes (1–31), solo para `monthly`; si falta, el de la fecha actual. */
    monthDay: z.number().int().min(1).max(31).nullable().default(null),
    mode: z.enum(['completion', 'schedule']).default('completion'),
  })
  .strict()
export type Recurrence = z.infer<typeof recurrenceSchema>

const WEEKDAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
export const WEEKDAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function parse(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d))
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, n: number): string {
  const d = parse(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return fmt(d)
}

/** 0 = lunes … 6 = domingo. */
export function weekdayOf(iso: string): number {
  return (parse(iso).getUTCDay() + 6) % 7
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
}

function addMonths(iso: string, n: number, day: number): string {
  const d = parse(iso)
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n
  const y = Math.floor(total / 12)
  const m0 = total % 12
  return fmt(new Date(Date.UTC(y, m0, Math.min(day, daysInMonth(y, m0)))))
}

/** Lunes de la semana de una fecha. */
function weekStart(iso: string): string {
  return addDays(iso, -weekdayOf(iso))
}

function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000)
}

/** Siguiente fecha de la regla estrictamente posterior a `from`. */
function stepOnce(r: Recurrence, from: string, anchorDay: number): string {
  switch (r.freq) {
    case 'daily':
      return addDays(from, r.interval)
    case 'weekly': {
      const days = [...new Set(r.weekdays)].sort()
      if (days.length === 0) return addDays(from, 7 * r.interval)
      const base = weekStart(from)
      for (let i = 1; i <= 7 * r.interval + 7; i++) {
        const d = addDays(from, i)
        const weeks = daysBetween(base, weekStart(d)) / 7
        if (weeks % r.interval === 0 && days.includes(weekdayOf(d))) return d
      }
      return addDays(from, 7 * r.interval)
    }
    case 'monthly':
      return addMonths(from, r.interval, r.monthDay ?? anchorDay)
    case 'yearly':
      return addMonths(from, 12 * r.interval, anchorDay)
  }
}

/**
 * Próxima fecha de la regla después de `from` que no sea anterior a `notBefore`.
 * `from` es la fecha de la tarea actual (o hoy si no tiene); el día del mes de
 * `from` se conserva en las repeticiones mensuales y anuales (31 → 30 → 28…).
 */
export function nextOccurrence(r: Recurrence, from: string, notBefore?: string): string {
  const anchorDay = parse(from).getUTCDate()
  let d = stepOnce(r, from, anchorDay)
  // Límite de seguridad: nunca más de 5000 pasos (p. ej. diaria tras años sin abrir).
  for (let i = 0; notBefore && d < notBefore && i < 5000; i++) d = stepOnce(r, d, anchorDay)
  return d
}

function list(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

/** «Cada semana: lunes y miércoles» */
export function describeRecurrence(r: Recurrence): string {
  const n = r.interval
  const every = (one: string, many: string) => (n === 1 ? `Cada ${one}` : `Cada ${n} ${many}`)
  let base: string
  switch (r.freq) {
    case 'daily':
      base = n === 1 ? 'Cada día' : `Cada ${n} días`
      break
    case 'weekly': {
      base = every('semana', 'semanas')
      const days = [...new Set(r.weekdays)].sort()
      if (days.length) base += `: ${list(days.map((d) => WEEKDAY_NAMES[d]!))}`
      break
    }
    case 'monthly':
      base = every('mes', 'meses')
      if (r.monthDay) base += `, el día ${r.monthDay}`
      break
    case 'yearly':
      base = every('año', 'años')
      break
  }
  return r.mode === 'schedule' ? `${base} (según calendario)` : `${base} (al completar)`
}
