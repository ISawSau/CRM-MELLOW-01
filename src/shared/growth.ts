import { z } from 'zod'

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

// --- Fatiga creativa (D-106) ------------------------------------------------------------

/** Días recientes que se comparan con los anteriores (sin contar hoy). */
export const FATIGUE_RECENT_DAYS = 3
export const FATIGUE_BASE_DAYS = 7

export interface FatigueWindow {
  impressions: number
  linkClicks: number
  spend: number
  purchases: number
  /** Resultados de la campaña (para los que no venden: clientes potenciales…). */
  results: number
  /** Suma del alcance diario (para la frecuencia media diaria). */
  dailyReach: number
}

export interface FatigueSignal {
  /** CTR del enlace: caída respecto a los días anteriores (0,3 = un 30 % menos). */
  ctrDrop: number
  /** Frecuencia media diaria: subida (0,25 = un 25 % más). Null si no hay alcance. */
  frequencyRise: number | null
  /** Coste por conversión: subida. Null si en algún periodo no hay conversiones. */
  costRise: number | null
  ctrRecent: number
  ctrBase: number
}

/**
 * Señal de fatiga de un anuncio: el CTR del enlace cae al menos un 25 % y, además, sube la
 * frecuencia (un 20 %) o el coste por conversión (un 25 %). Con pocas impresiones no se juzga.
 */
export function fatigueOf(recent: FatigueWindow, base: FatigueWindow): FatigueSignal | null {
  if (recent.impressions < 1000 || base.impressions < 3000) return null
  const ctrRecent = recent.linkClicks / recent.impressions
  const ctrBase = base.linkClicks / base.impressions
  if (ctrBase <= 0) return null
  const ctrDrop = 1 - ctrRecent / ctrBase
  const freq = (w: FatigueWindow) => (w.dailyReach > 0 ? w.impressions / w.dailyReach : null)
  const fr = freq(recent)
  const fb = freq(base)
  const frequencyRise = fr !== null && fb !== null && fb > 0 ? fr / fb - 1 : null
  // Coste por compra si hay compras en los dos periodos; si no, por resultado.
  const key = recent.purchases > 0 && base.purchases > 0 ? 'purchases' : 'results'
  const cost = (w: FatigueWindow) => (w[key] > 0 ? w.spend / w[key] : null)
  const cr = cost(recent)
  const cb = cost(base)
  const costRise = cr !== null && cb !== null && cb > 0 ? cr / cb - 1 : null
  const tired =
    ctrDrop >= 0.25 &&
    ((frequencyRise !== null && frequencyRise >= 0.2) || (costRise !== null && costRise >= 0.25))
  return tired ? { ctrDrop, frequencyRise, costRise, ctrRecent, ctrBase } : null
}

// --- Avisos del sistema (D-107) ---------------------------------------------------------

export const notifySettingsSchema = z.object({
  /** Avisos nuevos de Campañas (alertas y fatiga) tras sincronizar con Meta. */
  alerts: z.boolean().default(true),
  /** Una vez al día: tareas para hoy o atrasadas. */
  tasks: z.boolean().default(true),
})
export type NotifySettings = z.infer<typeof notifySettingsSchema>
