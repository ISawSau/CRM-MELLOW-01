import { z } from 'zod'
import { formatCurrency, formatNumber } from './format'
import { t } from './i18n'

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

// --- Tests A/B (D-108) -------------------------------------------------------------------

/** Opción del campo «Métrica que decide» → métrica y si es mejor más baja. */
export const AB_METRICS: Record<string, { key: string; lowerIsBetter: boolean }> = {
  cpa: { key: 'cpa', lowerIsBetter: true },
  'coste-resultado': { key: 'coste_resultado', lowerIsBetter: true },
  roas: { key: 'roas', lowerIsBetter: false },
  'ctr-enlace': { key: 'ctr_enlace', lowerIsBetter: false },
  'hook-rate': { key: 'hook_rate', lowerIsBetter: false },
  cpm: { key: 'cpm', lowerIsBetter: true },
}

export interface AbAd {
  id: string
  name: string
  accountName: string
}

export interface AbVariant {
  ads: AbAd[]
  base: Record<string, number>
}

export interface AbTestResult {
  currency: string
  /** Falta algún tipo de cambio: los importes pueden estar incompletos. */
  partial: boolean
  since: string
  until: string
  /** Opción elegida en «Métrica que decide» (por defecto, cpa). */
  metric: string
  a: AbVariant
  b: AbVariant
}

export interface AbVerdict {
  winner: 'a' | 'b' | null
  /** Cuánto mejor es B que A en la métrica (0,2 = un 20 % mejor; negativo, peor). */
  lift: number | null
  /** La diferencia es estadísticamente clara (|z| ≥ 1,96, un 95 %). */
  significant: boolean
  z: number | null
}

/**
 * Quién gana un test A/B. La significación se calcula con un contraste de proporciones (CTR
 * del enlace, hook rate) o de tasas de Poisson (conversiones o impresiones por euro gastado,
 * para CPA, coste por resultado, ROAS y CPM). Sin una diferencia clara no hay ganador.
 */
export function abVerdict(
  metric: string,
  a: Record<string, number | null>,
  b: Record<string, number | null>,
  baseA: Record<string, number>,
  baseB: Record<string, number>,
): AbVerdict {
  const m = AB_METRICS[metric] ?? AB_METRICS['cpa']!
  const va = a[m.key]
  const vb = b[m.key]
  if (va === null || va === undefined || vb === null || vb === undefined || va === 0)
    return { winner: null, lift: null, significant: false, z: null }
  const lift = m.lowerIsBetter ? va / vb - 1 : vb / va - 1
  const z = zScore(m.key, baseA, baseB)
  const significant = z !== null && Math.abs(z) >= 1.96
  const winner = significant && lift !== 0 ? (lift > 0 ? 'b' : 'a') : null
  return { winner, lift, significant, z }
}

function zScore(key: string, a: Record<string, number>, b: Record<string, number>): number | null {
  const get = (s: Record<string, number>, k: string) => s[k] ?? 0
  // Proporciones: éxitos sobre impresiones.
  const prop = (success: string) => {
    const na = get(a, 'impresiones')
    const nb = get(b, 'impresiones')
    if (na <= 0 || nb <= 0) return null
    const pa = get(a, success) / na
    const pb = get(b, success) / nb
    const p = (get(a, success) + get(b, success)) / (na + nb)
    const se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb))
    return se > 0 ? (pb - pa) / se : null
  }
  // Tasas de Poisson: sucesos por euro gastado.
  const rate = (events: string) => {
    const ea = get(a, events)
    const eb = get(b, events)
    const sa = get(a, 'gasto')
    const sb = get(b, 'gasto')
    if (sa <= 0 || sb <= 0 || ea + eb === 0) return null
    const se = Math.sqrt(ea / (sa * sa) + eb / (sb * sb))
    return se > 0 ? (eb / sb - ea / sa) / se : null
  }
  switch (key) {
    case 'ctr_enlace':
      return prop('clics_enlace')
    case 'hook_rate':
      return prop('reproducciones_3s')
    case 'cpa':
    case 'roas':
      return rate('compras')
    case 'coste_resultado':
      return rate('resultados')
    case 'cpm':
      return rate('impresiones')
  }
  return null
}

/** «123,456» → ids de anuncio (sin repetir ni vacíos). */
export function parseAdIds(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^[\w-]{1,40}$/.test(s)),
    ),
  ]
}

// --- Resumen semanal en texto (D-109) ---------------------------------------------------

/** «2026-10-04» → fecha corta en el formato del idioma (04/10/2026). */
function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export interface WeeklySummaryInput {
  client: string
  since: string
  until: string
  currency: string
  /** Métricas de la semana y de la anterior (ya calculadas). */
  now: Record<string, number | null>
  prev: Record<string, number | null> | null
  targetCpa: number | null
  targetRoas: number | null
  campaigns: { name: string; values: Record<string, number | null> }[]
  pacing: PacingRow | null
}

/**
 * Resumen de la semana de un cliente en texto plano, listo para pegar en un correo o en
 * WhatsApp: inversión, resultados frente a la semana anterior, objetivo, campañas que más
 * gastan y ritmo del mes.
 */
export function weeklySummaryText(i: WeeklySummaryInput): string {
  const money = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : formatCurrency(v, i.currency)
  const num = (v: number | null | undefined, d = 0) =>
    v === null || v === undefined ? '—' : formatNumber(v, d)
  const change = (k: string) => {
    const a = i.now[k]
    const b = i.prev?.[k]
    if (a === null || a === undefined || b === null || b === undefined || b === 0) return ''
    const pct = Math.round((a / b - 1) * 100)
    return ` (${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)} % ${t('frente a la semana anterior')})`
  }
  const lines = [
    t('Resumen semanal · {client} ({since} – {until})', {
      client: i.client,
      since: formatIsoDate(i.since),
      until: formatIsoDate(i.until),
    }),
    '',
    `• ${t('Inversión')}: ${money(i.now['gasto'])}${change('gasto')}`,
  ]
  if ((i.now['compras'] ?? 0) > 0 || (i.prev?.['compras'] ?? 0) > 0) {
    lines.push(`• ${t('Compras')}: ${num(i.now['compras'])}${change('compras')}`)
    lines.push(
      `• ${t('CPA')}: ${money(i.now['cpa'])}${change('cpa')}` +
        (i.targetCpa ? ` · ${t('objetivo')} ${money(i.targetCpa)}` : ''),
    )
    lines.push(
      `• ${t('ROAS')}: ${num(i.now['roas'], 2)}${change('roas')}` +
        (i.targetRoas ? ` · ${t('objetivo')} ${num(i.targetRoas, 2)}` : ''),
    )
  } else if ((i.now['resultados'] ?? 0) > 0) {
    lines.push(`• ${t('Resultados')}: ${num(i.now['resultados'])}${change('resultados')}`)
    lines.push(
      `• ${t('Coste por resultado')}: ${money(i.now['coste_resultado'])}${change('coste_resultado')}` +
        (i.targetCpa ? ` · ${t('objetivo')} ${money(i.targetCpa)}` : ''),
    )
  }
  const ctr = i.now['ctr_enlace']
  lines.push(
    `• ${t('CTR del enlace')}: ${ctr === null || ctr === undefined ? '—' : `${formatNumber(ctr, 2)} %`}${change('ctr_enlace')}`,
  )
  if (i.campaigns.length) {
    lines.push('', t('Campañas con más inversión:'))
    for (const c of i.campaigns)
      lines.push(
        `• ${c.name}: ${money(c.values['gasto'])}` +
          ((c.values['compras'] ?? 0) > 0
            ? ` · ${t('CPA')} ${money(c.values['cpa'])} · ${t('ROAS')} ${num(c.values['roas'], 2)}`
            : ''),
      )
  }
  if (i.pacing) {
    const p = i.pacing
    lines.push(
      '',
      t('Ritmo del mes: {spent} de {budget}; a este ritmo, {projected} a fin de mes.', {
        spent: formatCurrency(p.spent, p.currency),
        budget: formatCurrency(p.budget, p.currency),
        projected: formatCurrency(p.projected, p.currency),
      }),
    )
  }
  return lines.join('\n')
}
