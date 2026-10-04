/**
 * Fase 14 (D-104 y siguientes): objetivos y ritmo de gasto por cliente, fatiga creativa,
 * registro de tests y rentabilidad. Tipos y cálculos que comparten el motor y la interfaz.
 */

/** Margen sobre el presupuesto mensual dentro del cual el ritmo se da por bueno. */
export const PACING_TOLERANCE = 0.1

export type PacingStatus = 'ok' | 'under' | 'over'

export interface PacingRow {
  clientId: string
  client: string
  /** Moneda del presupuesto (la de su campo). */
  currency: string
  budget: number
  /** Gastado este mes hasta hoy. */
  spent: number
  /** A este ritmo, lo que se habrá gastado al acabar el mes. */
  projected: number
  /** Día del mes (hoy) y días que tiene. */
  day: number
  days: number
  status: PacingStatus
  /** Falta algún tipo de cambio: el gasto puede estar incompleto. */
  partial: boolean
}

/** Proyección a fin de mes al ritmo de lo que va de mes, y si va bien, corto o pasado. */
export function pacingOf(
  spent: number,
  budget: number,
  day: number,
  days: number,
): { projected: number; status: PacingStatus } {
  const projected = day > 0 ? (spent / day) * days : 0
  const status: PacingStatus =
    projected > budget * (1 + PACING_TOLERANCE)
      ? 'over'
      : projected < budget * (1 - PACING_TOLERANCE)
        ? 'under'
        : 'ok'
  return { projected, status }
}

/** Días que tiene el mes de una fecha «aaaa-mm-dd». */
export function daysInMonth(date: string): number {
  const [y, m] = date.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
