import { z } from 'zod'
import { t } from '../i18n'
import { recurrenceSchema } from './recurrence'

/**
 * Tipos de campo del motor de datos (SPEC §6) y validación de sus valores.
 * Lo usan el proceso principal (que valida todo lo que llega del renderer) y la
 * interfaz (para saber qué editor mostrar).
 */

export const FIELD_TYPES = [
  'text',
  'longtext',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'checkbox',
  'select',
  'multiselect',
  'url',
  'email',
  'phone',
  'rating',
  'checklist',
  'recurrence',
  'relation',
  'formula',
  'rollup',
  'files',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Texto',
  longtext: 'Texto largo con formato',
  number: 'Número',
  currency: 'Moneda',
  percent: 'Porcentaje',
  date: 'Fecha',
  datetime: 'Fecha y hora',
  checkbox: 'Casilla',
  select: 'Selección',
  multiselect: 'Selección múltiple',
  url: 'URL',
  email: 'Email',
  phone: 'Teléfono',
  rating: 'Valoración',
  checklist: 'Lista de comprobación',
  recurrence: 'Repetición',
  relation: 'Relación',
  formula: 'Fórmula',
  rollup: 'Resumen',
  files: 'Archivos',
}

/** Tipos calculados: no se guardan, se calculan al leer. */
export const COMPUTED_TYPES: readonly FieldType[] = ['formula', 'rollup']
/** Tipos que aún no se pueden crear (llegan en una fase posterior). */
export const UNAVAILABLE_TYPES: Partial<Record<FieldType, string>> = {}

/** Colores de las opciones: nombres de token, cada tema los traduce (contraste AA). */
export const OPTION_COLORS = [
  'gris',
  'melocoton',
  'terracota',
  'vino',
  'ambar',
  'verde',
  'azul',
  'lila',
] as const
export type OptionColor = (typeof OPTION_COLORS)[number]

const id = z.string().regex(/^[a-z0-9-]{1,64}$/)
export const idSchema = id

const optionSchema = z.object({
  id,
  label: z.string().trim().min(1).max(60),
  color: z.enum(OPTION_COLORS),
  /** La opción significa «terminado» (p. ej. la etapa «Hecha» de una tarea). */
  done: z.boolean().optional(),
})
export type SelectOption = z.infer<typeof optionSchema>

const decimals = z.number().int().min(0).max(6)
const currencyCode = z.string().regex(/^[A-Z]{3}$/)

export const FORMULA_FORMATS = [
  'number',
  'currency',
  'percent',
  'text',
  'checkbox',
  'date',
] as const
export const ROLLUP_FUNCTIONS = ['count', 'sum', 'avg', 'min', 'max'] as const
export const ROLLUP_LABELS: Record<(typeof ROLLUP_FUNCTIONS)[number], string> = {
  count: 'Contar',
  sum: 'Sumar',
  avg: 'Media',
  min: 'Mínimo',
  max: 'Máximo',
}

/** Configuración de cada tipo de campo. */
export const fieldConfigSchemas = {
  text: z.object({}).strict(),
  longtext: z.object({}).strict(),
  number: z.object({ decimals: decimals.default(2) }).strict(),
  currency: z
    .object({ currency: currencyCode.default('EUR'), decimals: decimals.default(2) })
    .strict(),
  percent: z.object({ decimals: decimals.default(1) }).strict(),
  date: z.object({}).strict(),
  datetime: z.object({}).strict(),
  checkbox: z.object({}).strict(),
  select: z
    .object({
      options: z.array(optionSchema).max(200).default([]),
      /** Es un pipeline: sus opciones son las etapas de un kanban. */
      pipeline: z.boolean().optional(),
    })
    .strict(),
  multiselect: z.object({ options: z.array(optionSchema).max(200).default([]) }).strict(),
  url: z.object({}).strict(),
  email: z.object({}).strict(),
  phone: z.object({}).strict(),
  rating: z.object({ max: z.number().int().min(1).max(10).default(5) }).strict(),
  checklist: z
    .object({
      /** Elementos con los que empieza la lista en cada registro nuevo (fase 14). */
      template: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
    })
    .strict(),
  recurrence: z.object({}).strict(),
  relation: z
    .object({
      target: z.string().min(1).max(40),
      multiple: z.boolean().default(true),
      /**
       * Campo inverso: muestra desde el otro lado los vínculos de ese campo de relación
       * (p. ej. «Contactos» de un cliente es el inverso de «Cliente» de un contacto).
       */
      inverseOf: id.optional(),
    })
    .strict(),
  formula: z
    .object({
      expression: z.string().max(2000).default(''),
      format: z.enum(FORMULA_FORMATS).default('number'),
      currency: currencyCode.default('EUR'),
      decimals: decimals.default(2),
    })
    .strict(),
  rollup: z
    .object({
      relationField: id.optional(),
      targetField: id.optional(),
      fn: z.enum(ROLLUP_FUNCTIONS).default('count'),
      decimals: decimals.default(2),
    })
    .strict(),
  files: z.object({}).strict(),
} satisfies Record<FieldType, z.ZodType>

export type FieldConfig<T extends FieldType = FieldType> = z.output<(typeof fieldConfigSchemas)[T]>

export function parseFieldConfig<T extends FieldType>(type: T, raw: unknown): FieldConfig<T> {
  return fieldConfigSchemas[type].parse(raw ?? {}) as FieldConfig<T>
}

export interface FieldDef {
  id: string
  entity: string
  key: string
  label: string
  type: FieldType
  config: Record<string, unknown>
  position: number
  visible: boolean
  required: boolean
  system: boolean
  deletedAt: string | null
}

// --- Valores -------------------------------------------------------------------

/** Documento de Tiptap (JSON de ProseMirror) más su texto plano para buscar. */
export const richTextSchema = z.object({
  doc: z.record(z.string(), z.unknown()),
  text: z.string().max(200_000),
})
export type RichText = z.infer<typeof richTextSchema>

/** Archivo adjunto: el contenido está cifrado en la bóveda; aquí, su referencia. */
export const fileRefSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().min(1).max(255),
    size: z.number().int().min(0),
    mime: z.string().max(100),
  })
  .strict()
export type FileRef = z.infer<typeof fileRefSchema>

/** Lista de comprobación: elementos con texto y marcados o no. */
export const checklistSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-z0-9-]{1,64}$/),
        text: z.string().max(500),
        done: z.boolean(),
      })
      .strict(),
  )
  .max(200)
export type ChecklistItem = z.infer<typeof checklistSchema>[number]

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const isoDateTime = z.iso.datetime({ offset: false })

/** Esquema del valor guardado de un campo (null = vacío). */
export function valueSchema(field: Pick<FieldDef, 'type' | 'config'>): z.ZodType {
  const finite = z.number().finite()
  switch (field.type) {
    case 'text':
      return z.string().max(10_000)
    case 'longtext':
      return richTextSchema
    case 'number':
    case 'currency':
    case 'percent':
      return finite
    case 'date':
      return isoDate
    case 'datetime':
      return isoDateTime
    case 'checkbox':
      return z.boolean()
    case 'select': {
      const ids = parseFieldConfig('select', field.config).options.map((o) => o.id)
      return z.string().refine((v) => ids.includes(v), 'Opción desconocida')
    }
    case 'multiselect': {
      const ids = parseFieldConfig('multiselect', field.config).options.map((o) => o.id)
      return z
        .array(z.string())
        .max(200)
        .refine((vs) => vs.every((v) => ids.includes(v)), 'Opción desconocida')
        .transform((vs) => [...new Set(vs)])
    }
    case 'url':
      return z
        .string()
        .max(2000)
        .refine((v) => {
          try {
            const u = new URL(v)
            return u.protocol === 'https:' || u.protocol === 'http:'
          } catch {
            return false
          }
        }, 'URL no válida')
    case 'email':
      return z.email().max(320)
    case 'phone':
      return z
        .string()
        .max(40)
        .regex(/^[+0-9 ().-]{3,40}$/, 'Teléfono no válido')
    case 'rating': {
      const max = parseFieldConfig('rating', field.config).max
      return z.number().int().min(0).max(max)
    }
    case 'checklist':
      return checklistSchema
    case 'recurrence':
      return recurrenceSchema
    case 'files':
      return z.array(fileRefSchema).max(100)
    // Relaciones (tabla links) y calculados no se guardan en `data`.
    case 'relation':
    case 'formula':
    case 'rollup':
      return z.never()
  }
}

/** Valida y normaliza un valor; null o '' significan vacío. */
export function parseValue(
  field: Pick<FieldDef, 'type' | 'config' | 'label'>,
  raw: unknown,
): unknown {
  if (raw === null || raw === undefined || raw === '') return null
  if (Array.isArray(raw) && raw.length === 0) return null
  const r = valueSchema(field).safeParse(raw)
  if (!r.success) {
    throw new Error(
      t('Valor no válido para «{label}»: {message}', {
        label: t(field.label),
        message: t(r.error.issues[0]?.message ?? ''),
      }),
    )
  }
  return r.data
}

/** Clave para fórmulas a partir de una etiqueta: «Valor de compra» → valor_de_compra. */
export function slugifyKey(label: string): string {
  const s = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return /^[a-z]/.test(s) ? s : `campo_${s || 'nuevo'}`.slice(0, 40)
}

export const fieldKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Clave no válida')
