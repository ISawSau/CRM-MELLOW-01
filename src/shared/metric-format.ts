import { formatCurrency, formatNumber } from './format'
import {
  allMetrics,
  CONFIG_COLUMNS,
  CONFIG_KEYS,
  type CustomMetric,
  type MetricDef,
} from './meta-metrics'

/** Nombres y formato de las métricas (tabla de Campañas, Análisis e informes PDF). */

/** «offsite_conversion.fb_pixel_purchase» → «Offsite conversion fb pixel purchase» */
export function actionLabel(type: string): string {
  const t = type.replace(/^offsite_conversion\.fb_pixel_/, 'píxel ').replace(/[._]/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Definición de cualquier columna numérica: métricas, propias y acciones. */
export function metricDefs(
  custom: readonly CustomMetric[],
  actionTypes: readonly string[],
): Map<string, MetricDef> {
  const map = new Map(allMetrics(custom).map((m) => [m.key, m]))
  for (const t of actionTypes) {
    const k = t.toLowerCase().replace(/[^a-z0-9_]/g, '_')
    map.set(`acc_${k}`, {
      key: `acc_${k}`,
      label: `${actionLabel(t)} (acciones)`,
      format: 'number',
      group: 'Acciones',
      higherIsBetter: true,
      decimals: 0,
    })
    map.set(`val_${k}`, {
      key: `val_${k}`,
      label: `${actionLabel(t)} (valor)`,
      format: 'currency',
      group: 'Acciones',
      higherIsBetter: true,
    })
  }
  return map
}

export function columnLabel(key: string, defs: Map<string, MetricDef>): string {
  return (
    CONFIG_COLUMNS.find((c) => c.key === key)?.label ??
    defs.get(key)?.label ??
    key.replace(/_/g, ' ')
  )
}

export const isConfigColumn = (key: string) => CONFIG_KEYS.has(key)

export function formatMetric(
  value: number | null | undefined,
  def: MetricDef | undefined,
  currency: string,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  switch (def?.format) {
    case 'currency':
      return formatCurrency(value, currency)
    case 'percent':
      return `${formatNumber(value, def.decimals ?? 2)} %`
    case 'integer':
      return formatNumber(value, 0)
    default:
      return formatNumber(value, def?.decimals ?? 2)
  }
}

/** Variación frente al periodo anterior, con el color según si subir es bueno. */
export function delta(
  now: number | null | undefined,
  before: number | null | undefined,
  def: MetricDef | undefined,
): { text: string; good: boolean | null } | null {
  if (now === null || now === undefined || before === null || before === undefined || before === 0)
    return null
  const d = (now - before) / Math.abs(before)
  const up = d >= 0
  const good = def?.higherIsBetter === undefined ? null : up === def.higherIsBetter
  return { text: `${up ? '+' : ''}${formatNumber(d * 100, 1)} %`, good }
}
