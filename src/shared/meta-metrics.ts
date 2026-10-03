import { z } from 'zod'
import { FormulaError, evaluate, parseFormula, formulaReferences, type Node } from './data/formula'
import { OPTION_COLORS } from './data/fields'

/**
 * Métricas de Meta para la tabla tipo Ads Manager (SPEC §7.3, fase 7).
 *
 * Todas tienen una clave corta que sirve de columna y de nombre en las fórmulas:
 * `gasto`, `compras`, `roas`… Cualquier acción de Meta se puede usar como `acc_<tipo>`
 * (número) y `val_<tipo>` (valor), con los puntos del tipo cambiados por `_`:
 * `acc_offsite_conversion_fb_pixel_purchase`.
 *
 * Los porcentajes van ya en tanto por cien (un CTR de 1,5 % vale 1.5), como en Ads
 * Manager. Las métricas propias con formato porcentaje siguen la misma regla.
 */

export type MetricFormat = 'currency' | 'percent' | 'number' | 'integer'
export type MetricGroup =
  | 'Rendimiento'
  | 'Interacción'
  | 'Conversiones'
  | 'Vídeo'
  | 'Configuración'
  | 'Personalizadas'
  | 'Acciones'

export interface MetricDef {
  key: string
  label: string
  format: MetricFormat
  group: MetricGroup
  /** Para el formato condicional y las comparaciones: subir es bueno. */
  higherIsBetter?: boolean
  description?: string
  decimals?: number
}

/** Sumas por día que el proceso principal agrega (los importes ya convertidos). */
export const BASE_METRICS: readonly MetricDef[] = [
  { key: 'gasto', label: 'Importe gastado', format: 'currency', group: 'Rendimiento' },
  { key: 'impresiones', label: 'Impresiones', format: 'integer', group: 'Rendimiento' },
  {
    key: 'clics',
    label: 'Clics (todos)',
    format: 'integer',
    group: 'Interacción',
    higherIsBetter: true,
  },
  {
    key: 'clics_enlace',
    label: 'Clics en el enlace',
    format: 'integer',
    group: 'Interacción',
    higherIsBetter: true,
  },
  {
    key: 'compras',
    label: 'Compras',
    format: 'integer',
    group: 'Conversiones',
    higherIsBetter: true,
  },
  {
    key: 'valor_compras',
    label: 'Valor de compras',
    format: 'currency',
    group: 'Conversiones',
    higherIsBetter: true,
  },
  {
    key: 'carritos',
    label: 'Añadidos al carrito',
    format: 'integer',
    group: 'Conversiones',
    higherIsBetter: true,
  },
  {
    key: 'pagos_iniciados',
    label: 'Pagos iniciados',
    format: 'integer',
    group: 'Conversiones',
    higherIsBetter: true,
  },
  {
    key: 'resultados',
    label: 'Resultados',
    format: 'number',
    group: 'Conversiones',
    higherIsBetter: true,
    description: 'Según el objetivo de optimización de cada conjunto.',
  },
  {
    key: 'reproducciones_3s',
    label: 'Reproducciones de 3 s',
    format: 'integer',
    group: 'Vídeo',
    higherIsBetter: true,
  },
  {
    key: 'reproducciones',
    label: 'Reproducciones',
    format: 'integer',
    group: 'Vídeo',
    higherIsBetter: true,
  },
  { key: 'thruplays', label: 'ThruPlays', format: 'integer', group: 'Vídeo', higherIsBetter: true },
  {
    key: 'p25',
    label: 'Reproducciones al 25 %',
    format: 'integer',
    group: 'Vídeo',
    higherIsBetter: true,
  },
  {
    key: 'p50',
    label: 'Reproducciones al 50 %',
    format: 'integer',
    group: 'Vídeo',
    higherIsBetter: true,
  },
  {
    key: 'p75',
    label: 'Reproducciones al 75 %',
    format: 'integer',
    group: 'Vídeo',
    higherIsBetter: true,
  },
  {
    key: 'p100',
    label: 'Reproducciones al 100 %',
    format: 'integer',
    group: 'Vídeo',
    higherIsBetter: true,
  },
]

/** Claves de importes: se convierten de moneda día a día. */
export const MONEY_KEYS = new Set(['gasto', 'valor_compras'])
export const isMoneyKey = (k: string) => MONEY_KEYS.has(k) || k.startsWith('val_')

/** Del periodo completo, no sumables: se piden a Meta para cada periodo. */
export const RANGE_METRICS: readonly MetricDef[] = [
  {
    key: 'alcance',
    label: 'Alcance',
    format: 'integer',
    group: 'Rendimiento',
    higherIsBetter: true,
  },
  { key: 'frecuencia', label: 'Frecuencia', format: 'number', group: 'Rendimiento' },
  {
    key: 'clics_enlace_unicos',
    label: 'Clics únicos en el enlace',
    format: 'integer',
    group: 'Interacción',
    higherIsBetter: true,
  },
  {
    key: 'ctr_enlace_unico',
    label: 'CTR único de enlace',
    format: 'percent',
    group: 'Interacción',
    higherIsBetter: true,
  },
]
export const RANGE_KEYS = new Set(RANGE_METRICS.map((m) => m.key))

/** Calculadas a partir de las anteriores. */
export const DERIVED_METRICS: readonly MetricDef[] = [
  {
    key: 'cpm',
    label: 'CPM',
    format: 'currency',
    group: 'Rendimiento',
    higherIsBetter: false,
    description: 'Coste por mil impresiones.',
  },
  {
    key: 'cpc',
    label: 'CPC (enlace)',
    format: 'currency',
    group: 'Interacción',
    higherIsBetter: false,
    description: 'Coste por clic en el enlace.',
  },
  {
    key: 'ctr',
    label: 'CTR (todos)',
    format: 'percent',
    group: 'Interacción',
    higherIsBetter: true,
  },
  {
    key: 'ctr_enlace',
    label: 'CTR de enlace',
    format: 'percent',
    group: 'Interacción',
    higherIsBetter: true,
  },
  {
    key: 'roas',
    label: 'ROAS de compra',
    format: 'number',
    group: 'Conversiones',
    higherIsBetter: true,
  },
  {
    key: 'ticket_medio',
    label: 'Ticket medio (AOV)',
    format: 'currency',
    group: 'Conversiones',
    higherIsBetter: true,
    description: 'Valor de compras / compras.',
  },
  {
    key: 'cpa',
    label: 'Coste por compra',
    format: 'currency',
    group: 'Conversiones',
    higherIsBetter: false,
  },
  {
    key: 'coste_resultado',
    label: 'Coste por resultado',
    format: 'currency',
    group: 'Conversiones',
    higherIsBetter: false,
  },
  {
    key: 'coste_carrito',
    label: 'Coste por añadido al carrito',
    format: 'currency',
    group: 'Conversiones',
    higherIsBetter: false,
  },
  {
    key: 'conversion_carrito',
    label: 'Carritos que compran',
    format: 'percent',
    group: 'Conversiones',
    higherIsBetter: true,
    description: 'Compras / añadidos al carrito.',
  },
  {
    key: 'hook_rate',
    label: 'Hook rate',
    format: 'percent',
    group: 'Vídeo',
    higherIsBetter: true,
    description: 'Reproducciones de 3 s / impresiones.',
  },
  {
    key: 'hold_rate',
    label: 'Hold rate',
    format: 'percent',
    group: 'Vídeo',
    higherIsBetter: true,
    description: 'Fórmula configurable en Ajustes.',
  },
]

/** Columnas de configuración y estado (no numéricas). */
export const CONFIG_COLUMNS: readonly { key: string; label: string; levels?: string[] }[] = [
  { key: 'entrega', label: 'Entrega' },
  { key: 'presupuesto', label: 'Presupuesto' },
  { key: 'puja', label: 'Estrategia de puja' },
  { key: 'objetivo', label: 'Objetivo' },
  { key: 'atribucion', label: 'Configuración de atribución', levels: ['adset'] },
  { key: 'inicio', label: 'Inicio' },
  { key: 'fin', label: 'Fin' },
  { key: 'ultima_edicion', label: 'Última edición significativa' },
  { key: 'calidad', label: 'Clasificación de calidad', levels: ['ad'] },
  { key: 'interaccion', label: 'Clasificación de interacción', levels: ['ad'] },
  { key: 'conversion', label: 'Clasificación de conversión', levels: ['ad'] },
  { key: 'creatividad', label: 'Creatividad vinculada', levels: ['ad'] },
]
export const CONFIG_KEYS = new Set(CONFIG_COLUMNS.map((c) => c.key))

export const DEFAULT_HOLD_RATE = 'thruplays / impresiones * 100'

/** «offsite_conversion.fb_pixel_purchase» → «offsite_conversion_fb_pixel_purchase» */
export function actionKey(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

const metricKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Solo minúsculas, números y _ (empieza por letra).')

export const customMetricSchema = z.object({
  key: metricKey,
  label: z.string().trim().min(1).max(60),
  expression: z.string().trim().min(1).max(2000),
  format: z.enum(['currency', 'percent', 'number', 'integer']),
  decimals: z.number().int().min(0).max(4).default(2),
})
export type CustomMetric = z.infer<typeof customMetricSchema>

export const conditionalRuleSchema = z.object({
  column: metricKey,
  op: z.enum(['gt', 'lt', 'between']),
  a: z.number(),
  b: z.number().optional(),
  color: z.enum(OPTION_COLORS),
})
export type ConditionalRule = z.infer<typeof conditionalRuleSchema>

export const presetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  columns: z.array(metricKey).min(1).max(60),
  rules: z.array(conditionalRuleSchema).max(50).default([]),
})
export type ColumnPreset = z.infer<typeof presetSchema>

export const BUILT_IN_PRESETS: readonly ColumnPreset[] = [
  {
    id: 'rendimiento',
    name: 'Rendimiento',
    columns: [
      'entrega',
      'presupuesto',
      'gasto',
      'impresiones',
      'clics_enlace',
      'ctr_enlace',
      'cpc',
      'cpm',
      'compras',
      'valor_compras',
      'roas',
      'cpa',
    ],
    rules: [],
  },
  {
    id: 'ecom',
    name: 'Ecom rendimiento',
    columns: [
      'entrega',
      'gasto',
      'compras',
      'valor_compras',
      'roas',
      'ticket_medio',
      'cpa',
      'carritos',
      'coste_carrito',
      'pagos_iniciados',
      'ctr_enlace',
      'cpm',
    ],
    rules: [],
  },
  {
    id: 'creatividades',
    name: 'Creatividades',
    columns: [
      'entrega',
      'creatividad',
      'gasto',
      'impresiones',
      'hook_rate',
      'hold_rate',
      'thruplays',
      'ctr_enlace',
      'cpc',
      'roas',
      'calidad',
      'interaccion',
      'conversion',
    ],
    rules: [],
  },
  {
    id: 'entrega',
    name: 'Entrega y configuración',
    columns: [
      'entrega',
      'presupuesto',
      'puja',
      'objetivo',
      'atribucion',
      'inicio',
      'fin',
      'ultima_edicion',
      'gasto',
      'alcance',
      'frecuencia',
      'resultados',
      'coste_resultado',
    ],
    rules: [],
  },
]

export const metaTableSettingsSchema = z.object({
  presets: z.array(presetSchema).max(50).default([]),
  metrics: z.array(customMetricSchema).max(100).default([]),
  holdRate: z.string().trim().min(1).max(2000).default(DEFAULT_HOLD_RATE),
  /** Vínculo automático entre anuncios y creatividades (SPEC §7.8). */
  naming: z
    .object({
      /** El nombre del anuncio contiene el código de la creatividad. */
      byCode: z.boolean().default(true),
      /** Convención de nombres, p. ej. «{cliente}_{angulo}_{formato}_v{version}». */
      pattern: z.string().trim().max(200).default(''),
    })
    .default({ byCode: true, pattern: '' }),
})
export type MetaTableSettings = z.infer<typeof metaTableSettingsSchema>

/** Todas las métricas conocidas (sin las de acciones). */
export function allMetrics(custom: readonly CustomMetric[] = []): MetricDef[] {
  return [
    ...BASE_METRICS,
    ...RANGE_METRICS,
    ...DERIVED_METRICS,
    ...custom.map((c) => ({
      key: c.key,
      label: c.label,
      format: c.format,
      group: 'Personalizadas' as const,
      decimals: c.decimals,
    })),
  ]
}

export type MetricValues = Record<string, number | null>

const div = (a: number | null | undefined, b: number | null | undefined, k = 1) =>
  a === null || a === undefined || !b ? null : (a * k) / b

/**
 * Calcula todas las métricas de una fila a partir de sus sumas (y, si los hay, de los
 * datos del periodo). Las acciones que la fila no tiene valen 0. Una fórmula que
 * falla (división entre cero, campo inexistente) deja la métrica vacía.
 */
export function computeMetrics(
  base: Readonly<Record<string, number>>,
  /** Datos del periodo completo (alcance, frecuencia…), si los hay. */
  range: object | null,
  opts: {
    custom?: readonly CustomMetric[]
    holdRate?: string
    actionTypes?: readonly string[]
  } = {},
): MetricValues {
  const v: MetricValues = {}
  for (const m of BASE_METRICS) v[m.key] = base[m.key] ?? 0
  for (const t of opts.actionTypes ?? []) {
    const k = actionKey(t)
    v[`acc_${k}`] = 0
    v[`val_${k}`] = 0
  }
  for (const [k, n] of Object.entries(base)) v[k] = n
  const r = range as Record<string, number | null | undefined> | null
  for (const m of RANGE_METRICS) v[m.key] = r?.[m.key] ?? null
  v['cpm'] = div(v['gasto'], v['impresiones'], 1000)
  v['cpc'] = div(v['gasto'], v['clics_enlace'])
  v['ctr'] = div(v['clics'], v['impresiones'], 100)
  v['ctr_enlace'] = div(v['clics_enlace'], v['impresiones'], 100)
  v['roas'] = div(v['valor_compras'], v['gasto'])
  v['ticket_medio'] = div(v['valor_compras'], v['compras'])
  v['cpa'] = div(v['gasto'], v['compras'])
  v['coste_resultado'] = div(v['gasto'], v['resultados'])
  v['coste_carrito'] = div(v['gasto'], v['carritos'])
  v['conversion_carrito'] = div(v['compras'], v['carritos'], 100)
  v['hook_rate'] = div(v['reproducciones_3s'], v['impresiones'], 100)
  v['hold_rate'] = formulaNumber(opts.holdRate ?? DEFAULT_HOLD_RATE, v)
  for (const c of opts.custom ?? []) v[c.key] = formulaNumber(c.expression, v)
  return v
}

const parsed = new Map<string, Node | null>()
function parseCached(src: string): Node | null {
  if (!parsed.has(src)) {
    try {
      parsed.set(src, parseFormula(src))
    } catch {
      parsed.set(src, null)
    }
    if (parsed.size > 500) parsed.delete(parsed.keys().next().value!)
  }
  return parsed.get(src)!
}

function formulaNumber(src: string, values: MetricValues): number | null {
  const node = parseCached(src)
  if (!node) return null
  try {
    const r = evaluate(node, { fields: new Map(Object.entries(values)), today: '' })
    return typeof r === 'number' && Number.isFinite(r) ? r : null
  } catch {
    return null
  }
}

/**
 * Comprueba una métrica propia: que la fórmula se entiende y solo usa métricas que
 * existen (las propias anteriores incluidas). Devuelve el problema o null.
 */
export function metricProblem(expression: string, known: ReadonlySet<string>): string | null {
  let node: Node
  try {
    node = parseFormula(expression)
  } catch (e) {
    return e instanceof FormulaError ? e.message : 'La fórmula no es válida.'
  }
  for (const ref of formulaReferences(node)) {
    if (!known.has(ref) && !/^(acc|val)_[a-z0-9_]+$/.test(ref))
      return `No existe ninguna métrica «${ref}».`
  }
  return null
}

/** Claves que puede usar una fórmula nueva (antes de las propias que la siguen). */
export function knownKeys(custom: readonly CustomMetric[], upTo = custom.length): Set<string> {
  return new Set([
    ...BASE_METRICS.map((m) => m.key),
    ...RANGE_METRICS.map((m) => m.key),
    ...DERIVED_METRICS.map((m) => m.key),
    ...custom.slice(0, upTo).map((c) => c.key),
  ])
}

/** Color del formato condicional para un valor (la primera regla que se cumple). */
export function ruleColor(
  rules: readonly ConditionalRule[],
  column: string,
  value: number | null,
): string | null {
  if (value === null) return null
  for (const r of rules) {
    if (r.column !== column) continue
    if (r.op === 'gt' && value > r.a) return r.color
    if (r.op === 'lt' && value < r.a) return r.color
    if (
      r.op === 'between' &&
      r.b !== undefined &&
      value >= Math.min(r.a, r.b) &&
      value <= Math.max(r.a, r.b)
    )
      return r.color
  }
  return null
}
