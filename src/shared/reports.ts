import { z } from 'zod'

/**
 * Informes para clientes en PDF (SPEC §7.10, fase 9). Una plantilla es una lista de
 * bloques; al generar se eligen cliente, periodo, moneda y comentarios.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const metricKey = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)
const blockId = z.string().regex(/^[a-z0-9-]{1,40}$/)
const title = z.string().trim().max(120).default('')

/** Dimensiones por las que se puede desglosar un bloque. */
export const REPORT_GROUPS = ['campana', 'creatividad', 'cuenta', 'semana', 'mes'] as const
export type ReportGroup = (typeof REPORT_GROUPS)[number]

export const reportBlockSchema = z.discriminatedUnion('kind', [
  z.object({ id: blockId, kind: z.literal('portada') }),
  z.object({
    id: blockId,
    kind: z.literal('kpis'),
    title,
    metrics: z.array(metricKey).min(1).max(8),
    /** Variación frente al periodo anterior. */
    compare: z.boolean().default(true),
  }),
  z.object({
    id: blockId,
    kind: z.literal('linea'),
    title,
    metric: metricKey,
    compare: z.boolean().default(true),
  }),
  z.object({
    id: blockId,
    kind: z.literal('barras'),
    title,
    metric: metricKey,
    groupBy: z.enum(REPORT_GROUPS),
    limit: z.number().int().min(2).max(15).default(8),
  }),
  z.object({
    id: blockId,
    kind: z.literal('tabla'),
    title,
    metrics: z.array(metricKey).min(1).max(8),
    groupBy: z.enum(REPORT_GROUPS),
    limit: z.number().int().min(1).max(30).default(10),
  }),
  z.object({
    id: blockId,
    kind: z.literal('comparativa'),
    title,
    metrics: z.array(metricKey).min(1).max(12),
    compare: z.enum(['previous', 'year']).default('previous'),
  }),
  z.object({ id: blockId, kind: z.literal('texto'), title, text: z.string().max(5000) }),
  /** Los comentarios que se escriben al generar el informe. */
  z.object({ id: blockId, kind: z.literal('comentarios'), title }),
])
export type ReportBlock = z.infer<typeof reportBlockSchema>
export type ReportBlockKind = ReportBlock['kind']

export const BLOCK_LABELS: Record<ReportBlockKind, string> = {
  portada: 'Portada',
  kpis: 'Cifras clave',
  linea: 'Evolución diaria',
  barras: 'Barras por grupo',
  tabla: 'Tabla',
  comparativa: 'Comparativa de periodos',
  texto: 'Texto fijo',
  comentarios: 'Comentarios del periodo',
}

export const GROUP_LABELS: Record<ReportGroup, string> = {
  campana: 'Campaña',
  creatividad: 'Creatividad',
  cuenta: 'Cuenta publicitaria',
  semana: 'Semana',
  mes: 'Mes',
}

export const reportTemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(80),
  blocks: z.array(reportBlockSchema).min(1).max(30),
})
export type ReportTemplate = z.infer<typeof reportTemplateSchema>
export const reportTemplatesSchema = z.array(reportTemplateSchema).min(1).max(30)

export const DEFAULT_TEMPLATE: ReportTemplate = {
  id: 'mensual',
  name: 'Informe mensual',
  blocks: [
    { id: 'portada', kind: 'portada' },
    {
      id: 'kpis',
      kind: 'kpis',
      title: 'Resumen',
      metrics: ['gasto', 'impresiones', 'ctr', 'compras', 'cpa', 'roas'],
      compare: true,
    },
    { id: 'gasto', kind: 'linea', title: 'Inversión diaria', metric: 'gasto', compare: true },
    {
      id: 'campanas',
      kind: 'barras',
      title: 'Compras por campaña',
      metric: 'compras',
      groupBy: 'campana',
      limit: 8,
    },
    {
      id: 'tabla',
      kind: 'tabla',
      title: 'Campañas',
      metrics: ['gasto', 'impresiones', 'clics_enlace', 'compras', 'cpa', 'roas'],
      groupBy: 'campana',
      limit: 10,
    },
    {
      id: 'comparativa',
      kind: 'comparativa',
      title: 'Frente al periodo anterior',
      metrics: ['gasto', 'impresiones', 'cpm', 'ctr', 'compras', 'cpa', 'roas'],
      compare: 'previous',
    },
    { id: 'comentarios', kind: 'comentarios', title: 'Comentarios' },
  ],
}

export const reportGenerateSchema = z.object({
  templateId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  clientId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .nullable(),
  since: isoDate,
  until: isoDate,
  /** Moneda del informe; por defecto, la del cliente o la de visualización. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .default(null),
  comments: z.string().max(10_000).default(''),
  /** Además de guardarlo en la bóveda, exportarlo a una carpeta. */
  export: z.boolean().default(false),
})
export type ReportGenerate = z.input<typeof reportGenerateSchema>

export interface ReportResult {
  recordId: string
  fileId: string
  name: string
  /** El PDF, para la vista previa. */
  data: Uint8Array
  exportedTo: string | null
}
