import { z } from 'zod'
import { idSchema, type FieldType } from './fields'

/** Filtros, orden y vistas guardadas (SPEC §6). */

export const FILTER_OPS = [
  'contains',
  'not_contains',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'before',
  'after',
  'between',
  'today',
  'before_today',
  'next_7_days',
  'last_7_days',
  'this_month',
  'is_true',
  'is_false',
  'any_of',
  'none_of',
  'has_all',
  'empty',
  'not_empty',
] as const
export type FilterOp = (typeof FILTER_OPS)[number]

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  contains: 'contiene',
  not_contains: 'no contiene',
  eq: 'es',
  neq: 'no es',
  gt: 'mayor que',
  gte: 'mayor o igual que',
  lt: 'menor que',
  lte: 'menor o igual que',
  before: 'antes de',
  after: 'después de',
  between: 'entre',
  today: 'es hoy',
  before_today: 'antes de hoy',
  next_7_days: 'próximos 7 días',
  last_7_days: 'últimos 7 días',
  this_month: 'este mes',
  is_true: 'está marcada',
  is_false: 'no está marcada',
  any_of: 'es alguna de',
  none_of: 'no es ninguna de',
  has_all: 'tiene todas',
  empty: 'está vacío',
  not_empty: 'no está vacío',
}

/** Operadores que admite cada tipo de campo. */
export const OPS_BY_TYPE: Record<FieldType, readonly FilterOp[]> = {
  text: ['contains', 'not_contains', 'eq', 'neq', 'empty', 'not_empty'],
  longtext: ['contains', 'not_contains', 'empty', 'not_empty'],
  url: ['contains', 'not_contains', 'eq', 'empty', 'not_empty'],
  email: ['contains', 'not_contains', 'eq', 'empty', 'not_empty'],
  phone: ['contains', 'eq', 'empty', 'not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'],
  currency: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'],
  percent: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'],
  rating: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'],
  checklist: ['empty', 'not_empty'],
  recurrence: ['empty', 'not_empty'],
  date: [
    'eq',
    'before',
    'after',
    'between',
    'today',
    'before_today',
    'next_7_days',
    'last_7_days',
    'this_month',
    'empty',
    'not_empty',
  ],
  datetime: [
    'before',
    'after',
    'between',
    'today',
    'before_today',
    'next_7_days',
    'last_7_days',
    'this_month',
    'empty',
    'not_empty',
  ],
  checkbox: ['is_true', 'is_false'],
  select: ['any_of', 'none_of', 'empty', 'not_empty'],
  multiselect: ['any_of', 'has_all', 'none_of', 'empty', 'not_empty'],
  relation: ['empty', 'not_empty'],
  formula: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'empty', 'not_empty'],
  rollup: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'],
  files: ['empty', 'not_empty'],
}

/** Operadores que no necesitan valor. */
export const VALUELESS_OPS: readonly FilterOp[] = [
  'today',
  'before_today',
  'next_7_days',
  'last_7_days',
  'this_month',
  'is_true',
  'is_false',
  'empty',
  'not_empty',
]

const filterValue = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(200)).max(200),
  z.tuple([z.string().max(40), z.string().max(40)]),
  z.null(),
])

export const filterSchema = z.object({
  fieldId: idSchema,
  op: z.enum(FILTER_OPS),
  value: filterValue.default(null),
})
export type Filter = z.infer<typeof filterSchema>

export const sortSchema = z.object({
  /** Un id de campo o los campos fijos `createdAt` / `updatedAt`. */
  fieldId: z.union([idSchema, z.literal('createdAt'), z.literal('updatedAt')]),
  dir: z.enum(['asc', 'desc']),
})
export type Sort = z.infer<typeof sortSchema>

export const VIEW_KINDS = ['table', 'list', 'kanban', 'calendar', 'gallery'] as const
export type ViewKind = (typeof VIEW_KINDS)[number]
export const VIEW_KIND_LABELS: Record<ViewKind, string> = {
  table: 'Tabla',
  list: 'Lista',
  kanban: 'Kanban',
  calendar: 'Calendario',
  gallery: 'Galería',
}

export const viewConfigSchema = z.object({
  filters: z.array(filterSchema).max(50).default([]),
  /** Cómo se combinan los filtros. */
  match: z.enum(['all', 'any']).default('all'),
  sorts: z.array(sortSchema).max(5).default([]),
  /** Columnas de la tabla en orden, con su ancho. Las no listadas se añaden al final. */
  columns: z
    .array(
      z.object({
        fieldId: idSchema,
        width: z.number().int().min(60).max(1200),
        visible: z.boolean(),
      }),
    )
    .max(300)
    .default([]),
  /** Campo de selección que agrupa el kanban (y la lista, si se quiere). */
  groupBy: idSchema.nullable().default(null),
  /** Campo de fecha del calendario. */
  dateField: idSchema.nullable().default(null),
  /** Campos que se ven en tarjetas (kanban, galería) y filas de la lista. */
  cardFields: z.array(idSchema).max(10).default([]),
})
export type ViewConfig = z.infer<typeof viewConfigSchema>

export interface View {
  id: string
  entity: string
  name: string
  kind: ViewKind
  config: ViewConfig
  position: number
}
