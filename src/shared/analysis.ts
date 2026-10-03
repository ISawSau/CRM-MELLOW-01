import { z } from 'zod'
import { shiftDate } from './data/dates'
import type { BaseSums } from './meta'

/**
 * Análisis (SPEC §7.13, fase 8): dashboards, comparativas y alertas sobre las métricas
 * de Meta. Tipos compartidos por el proceso principal y la interfaz.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const id = z.string().min(1).max(64)
/** Cuenta de Meta («act_…») o de otra plataforma («li_…», «x_…», fase 11). */
const actId = z.string().regex(/^(act_\d{1,30}|(li|x)_[a-z0-9-]{1,60})$/)

// --- Periodos ---------------------------------------------------------------------------

export const RANGE_PRESETS = [
  'today',
  'yesterday',
  '7d',
  '14d',
  '30d',
  '90d',
  'month',
  'lastMonth',
] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  '7d': 'Últimos 7 días',
  '14d': 'Últimos 14 días',
  '30d': 'Últimos 30 días',
  '90d': 'Últimos 90 días',
  month: 'Este mes',
  lastMonth: 'Mes pasado',
}

/** Fechas del periodo. Los «últimos N días» no incluyen hoy (como Ads Manager). */
export function rangeFor(preset: RangePreset, today: string): { since: string; until: string } {
  const yesterday = shiftDate(today, -1)
  switch (preset) {
    case 'today':
      return { since: today, until: today }
    case 'yesterday':
      return { since: yesterday, until: yesterday }
    case '7d':
      return { since: shiftDate(today, -7), until: yesterday }
    case '14d':
      return { since: shiftDate(today, -14), until: yesterday }
    case '30d':
      return { since: shiftDate(today, -30), until: yesterday }
    case '90d':
      return { since: shiftDate(today, -90), until: yesterday }
    case 'month':
      return { since: `${today.slice(0, 7)}-01`, until: today }
    case 'lastMonth': {
      const end = shiftDate(`${today.slice(0, 7)}-01`, -1)
      return { since: `${end.slice(0, 7)}-01`, until: end }
    }
  }
}

/** Mismo periodo del año anterior (29 de febrero → 28). */
export function yearBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate()
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

export function daysBetween(since: string, until: string): number {
  return Math.round((Date.parse(until) - Date.parse(since)) / 86_400_000) + 1
}

// --- Consultas --------------------------------------------------------------------------

/** Qué datos entran: todo, un cliente, una cuenta, una campaña, una creatividad o una etiqueta. */
export const analysisFilterSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('client'), id }),
  z.object({ type: z.literal('account'), id: actId }),
  z.object({ type: z.literal('campaign'), id: z.string().min(1).max(40) }),
  z.object({ type: z.literal('creative'), id }),
  z.object({ type: z.literal('tag'), fieldId: id, optionId: z.string().min(1).max(64) }),
])
export type AnalysisFilter = z.infer<typeof analysisFilterSchema>

export const DIMENSIONS = [
  'dia',
  'semana',
  'mes',
  'cuenta',
  'cliente',
  'campana',
  'creatividad',
  'etiqueta',
] as const
export type Dimension = (typeof DIMENSIONS)[number]
export const TIME_DIMENSIONS: readonly Dimension[] = ['dia', 'semana', 'mes']

export const DIMENSION_LABELS: Record<Dimension, string> = {
  dia: 'Día',
  semana: 'Semana',
  mes: 'Mes',
  cuenta: 'Cuenta publicitaria',
  cliente: 'Cliente',
  campana: 'Campaña',
  creatividad: 'Creatividad',
  etiqueta: 'Etiqueta de creatividad',
}

export const COMPARE_MODES = ['none', 'previous', 'year'] as const
export type CompareMode = (typeof COMPARE_MODES)[number]

export const analysisQuerySchema = z.object({
  since: isoDate,
  until: isoDate,
  filter: analysisFilterSchema.default({ type: 'all' }),
  groupBy: z.enum(DIMENSIONS).nullable().default(null),
  /** Campo de las creatividades para agrupar por etiqueta. */
  tagFieldId: id.nullable().default(null),
  compare: z.enum(COMPARE_MODES).default('none'),
  /** Grupos que se muestran; el resto se suma en «Otros». */
  limit: z.number().int().min(1).max(50).default(8),
})
export type AnalysisQuery = z.input<typeof analysisQuerySchema>

export interface AnalysisGroup {
  key: string
  label: string
  base: BaseSums
}

export interface AnalysisResult {
  currency: string
  /** Hay importes sin tipo de cambio que se han dejado fuera. */
  partial: boolean
  since: string
  until: string
  compareSince: string | null
  compareUntil: string | null
  totals: BaseSums
  compareTotals: BaseSums | null
  groups: AnalysisGroup[]
  /** En las series temporales, los grupos del periodo de comparación (mismo orden). */
  compareGroups: AnalysisGroup[] | null
}

// --- Dashboards -------------------------------------------------------------------------

export const WIDGET_TYPES = ['kpi', 'line', 'bar', 'table', 'ranking'] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]
export const WIDGET_LABELS: Record<WidgetType, string> = {
  kpi: 'Cifra (KPI)',
  line: 'Evolución (líneas)',
  bar: 'Comparación (barras)',
  table: 'Tabla',
  ranking: 'Ranking',
}

const metricKey = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)

export const widgetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  type: z.enum(WIDGET_TYPES),
  title: z.string().trim().max(80).default(''),
  metric: metricKey,
  /** Columnas de las tablas. */
  metrics: z.array(metricKey).max(12).default([]),
  groupBy: z.enum(DIMENSIONS).nullable().default(null),
  tagFieldId: id.nullable().default(null),
  range: z.enum(RANGE_PRESETS).default('30d'),
  compare: z.boolean().default(false),
  size: z.enum(['s', 'm', 'l']).default('m'),
})
export type Widget = z.infer<typeof widgetSchema>

export const dashboardSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  /** Dashboard de un cliente (sus cuentas) o global (null). */
  clientId: id.nullable().default(null),
  widgets: z.array(widgetSchema).max(40).default([]),
})
export type Dashboard = z.infer<typeof dashboardSchema>
export const dashboardsSchema = z.array(dashboardSchema).max(50)

export const DEFAULT_DASHBOARD: Dashboard = {
  id: 'general',
  name: 'General',
  clientId: null,
  widgets: [
    {
      id: 'w1',
      type: 'kpi',
      title: '',
      metric: 'gasto',
      metrics: [],
      groupBy: null,
      tagFieldId: null,
      range: '30d',
      compare: true,
      size: 's',
    },
    {
      id: 'w2',
      type: 'kpi',
      title: '',
      metric: 'valor_compras',
      metrics: [],
      groupBy: null,
      tagFieldId: null,
      range: '30d',
      compare: true,
      size: 's',
    },
    {
      id: 'w3',
      type: 'kpi',
      title: '',
      metric: 'roas',
      metrics: [],
      groupBy: null,
      tagFieldId: null,
      range: '30d',
      compare: true,
      size: 's',
    },
    {
      id: 'w4',
      type: 'kpi',
      title: '',
      metric: 'cpa',
      metrics: [],
      groupBy: null,
      tagFieldId: null,
      range: '30d',
      compare: true,
      size: 's',
    },
    {
      id: 'w5',
      type: 'line',
      title: '',
      metric: 'gasto',
      metrics: [],
      groupBy: 'dia',
      tagFieldId: null,
      range: '30d',
      compare: true,
      size: 'l',
    },
    {
      id: 'w6',
      type: 'bar',
      title: '',
      metric: 'gasto',
      metrics: [],
      groupBy: 'cliente',
      tagFieldId: null,
      range: '30d',
      compare: false,
      size: 'm',
    },
    {
      id: 'w7',
      type: 'ranking',
      title: '',
      metric: 'roas',
      metrics: [],
      groupBy: 'campana',
      tagFieldId: null,
      range: '30d',
      compare: false,
      size: 'm',
    },
    {
      id: 'w8',
      type: 'table',
      title: '',
      metric: 'gasto',
      metrics: ['gasto', 'compras', 'valor_compras', 'roas', 'cpa', 'ctr_enlace'],
      groupBy: 'cuenta',
      tagFieldId: null,
      range: '30d',
      compare: false,
      size: 'l',
    },
  ],
}

// --- Alertas ----------------------------------------------------------------------------

export const alertSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(80),
  scope: analysisFilterSchema,
  metric: metricKey,
  op: z.enum(['gt', 'lt']),
  threshold: z.number(),
  /** Días completos (sin contar hoy) sobre los que se calcula la métrica. */
  windowDays: z.number().int().min(1).max(30),
  enabled: z.boolean().default(true),
})
export type Alert = z.infer<typeof alertSchema>
export const alertsSchema = z.array(alertSchema).max(100)

export interface AlertEvent {
  id: number
  alertId: string
  name: string
  metric: string
  op: 'gt' | 'lt'
  threshold: number
  value: number
  since: string
  until: string
  createdAt: string
  seen: boolean
}
