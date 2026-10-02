import { localDateOf, monthRange, shiftDate, startOfDayUtc } from '@shared/data/dates'
import { parseFieldConfig, type FieldDef, type RichText } from '@shared/data/fields'
import type { ComputedValue, LinkRef } from '@shared/data/records'
import { collator, norm } from '@shared/data/text'
import { OPS_BY_TYPE, VALUELESS_OPS, type Filter, type Sort } from '@shared/data/views'

/**
 * Filtros y orden del motor de datos.
 *
 * Cada filtro tiene dos implementaciones equivalentes:
 * - SQL (para campos guardados): se ejecuta en SQLite y aprovecha los índices;
 * - JavaScript (para todo, incluidos fórmulas, resúmenes y relaciones).
 * Un test comprueba que ambas dan exactamente el mismo resultado.
 */

export interface FilterContext {
  /** Hoy (AAAA-MM-DD) en la zona del usuario. */
  today: string
  timeZone: string
}

/** Expresión SQL del valor guardado de un campo (el id ya está validado). */
export function jsonPath(field: Pick<FieldDef, 'id' | 'type'>): string {
  if (!/^[a-z0-9-]+$/.test(field.id)) throw new Error('Id de campo no válido')
  const sub = field.type === 'longtext' ? '.text' : ''
  return `json_extract(data, '$."${field.id}"${sub}')`
}

const TEXTUAL = new Set(['text', 'longtext', 'url', 'email', 'phone'])
const NUMERIC = new Set(['number', 'currency', 'percent', 'rating'])

export function isValidFilter(field: FieldDef | undefined, f: Filter): field is FieldDef {
  if (!field || field.deletedAt) return false
  if (!OPS_BY_TYPE[field.type].includes(f.op)) return false
  if (VALUELESS_OPS.includes(f.op)) return true
  if (f.value === null || f.value === '') return false
  if (Array.isArray(f.value) && f.value.length === 0) return false
  return true
}

/** Intervalo de fechas locales [desde, hasta] (inclusivo) de un filtro de fecha. */
function dateBounds(f: Filter, ctx: FilterContext): [string | null, string | null] {
  const v = typeof f.value === 'string' ? f.value : null
  switch (f.op) {
    case 'eq':
      return [v, v]
    case 'before':
      return [null, v ? shiftDate(v, -1) : null]
    case 'after':
      return [v ? shiftDate(v, 1) : null, null]
    case 'between': {
      const [a, b] = Array.isArray(f.value) ? (f.value as string[]) : []
      return a && b && a <= b ? [a, b] : [b ?? null, a ?? null]
    }
    case 'today':
      return [ctx.today, ctx.today]
    case 'last_7_days':
      return [shiftDate(ctx.today, -6), ctx.today]
    case 'this_month':
      return monthRange(ctx.today)
    default:
      return [null, null]
  }
}

const DATE_RANGE_OPS = new Set([
  'eq',
  'before',
  'after',
  'between',
  'today',
  'last_7_days',
  'this_month',
])

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export interface SqlPart {
  sql: string
  params: unknown[]
}

/** Traducción a SQL; null si el filtro solo se puede evaluar en JavaScript. */
export function filterToSql(field: FieldDef, f: Filter, ctx: FilterContext): SqlPart | null {
  if (['formula', 'rollup', 'relation', 'files'].includes(field.type)) return null
  const p = jsonPath(field)
  const val = f.value
  if (f.op === 'empty') {
    if (field.type === 'multiselect')
      return { sql: `(${p} IS NULL OR json_array_length(${p}) = 0)`, params: [] }
    return { sql: `(${p} IS NULL OR ${p} = '')`, params: [] }
  }
  if (f.op === 'not_empty') {
    if (field.type === 'multiselect') return { sql: `json_array_length(${p}) > 0`, params: [] }
    return { sql: `(${p} IS NOT NULL AND ${p} <> '')`, params: [] }
  }

  if (TEXTUAL.has(field.type)) {
    const s = String(val)
    switch (f.op) {
      case 'contains':
        return {
          sql: `crm_norm(${p}) LIKE '%' || ? || '%' ESCAPE '\\'`,
          params: [escapeLike(norm(s))],
        }
      case 'not_contains':
        return {
          sql: `(${p} IS NULL OR crm_norm(${p}) NOT LIKE '%' || ? || '%' ESCAPE '\\')`,
          params: [escapeLike(norm(s))],
        }
      case 'eq':
        return { sql: `crm_norm(${p}) = ?`, params: [norm(s)] }
      case 'neq':
        return { sql: `(${p} IS NULL OR crm_norm(${p}) <> ?)`, params: [norm(s)] }
    }
    return null
  }

  if (NUMERIC.has(field.type)) {
    const n = Number(val)
    if (!Number.isFinite(n)) return null
    const ops: Record<string, string> = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' }
    if (f.op === 'neq') return { sql: `(${p} IS NULL OR ${p} <> ?)`, params: [n] }
    const op = ops[f.op]
    return op ? { sql: `${p} ${op} ?`, params: [n] } : null
  }

  if ((field.type === 'date' || field.type === 'datetime') && DATE_RANGE_OPS.has(f.op)) {
    const [from, to] = dateBounds(f, ctx)
    const parts: string[] = []
    const params: unknown[] = []
    const add = (cond: string, param: unknown) => {
      parts.push(cond)
      params.push(param)
    }
    if (field.type === 'date') {
      if (from) add(`${p} >= ?`, from)
      if (to) add(`${p} <= ?`, to)
    } else {
      if (from) add(`${p} >= ?`, startOfDayUtc(from, ctx.timeZone))
      if (to) add(`${p} < ?`, startOfDayUtc(shiftDate(to, 1), ctx.timeZone))
    }
    if (parts.length === 0) return null
    return { sql: `(${p} IS NOT NULL AND ${parts.join(' AND ')})`, params }
  }

  if (field.type === 'checkbox') {
    if (f.op === 'is_true') return { sql: `${p} = 1`, params: [] }
    if (f.op === 'is_false') return { sql: `(${p} IS NULL OR ${p} = 0)`, params: [] }
    return null
  }

  if (field.type === 'select' && Array.isArray(val)) {
    const marks = val.map(() => '?').join(', ')
    if (f.op === 'any_of') return { sql: `${p} IN (${marks})`, params: [...val] }
    if (f.op === 'none_of')
      return { sql: `(${p} IS NULL OR ${p} NOT IN (${marks}))`, params: [...val] }
    return null
  }

  if (field.type === 'multiselect' && Array.isArray(val)) {
    const marks = val.map(() => '?').join(', ')
    const each = `json_each(data, '$."${field.id}"')`
    if (f.op === 'any_of')
      return { sql: `EXISTS (SELECT 1 FROM ${each} WHERE value IN (${marks}))`, params: [...val] }
    if (f.op === 'none_of')
      return {
        sql: `NOT EXISTS (SELECT 1 FROM ${each} WHERE value IN (${marks}))`,
        params: [...val],
      }
    if (f.op === 'has_all') {
      const distinct = [...new Set(val)]
      return {
        sql: `(SELECT COUNT(DISTINCT value) FROM ${each} WHERE value IN (${distinct.map(() => '?').join(', ')})) = ?`,
        params: [...distinct, distinct.length],
      }
    }
  }
  return null
}

// --- Evaluación en JavaScript ---------------------------------------------------

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

/** Valor escalar con el que se filtra (texto plano, valor de fórmula…). */
function scalar(field: FieldDef, v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (field.type === 'longtext') return (v as RichText).text
  if (field.type === 'formula' || field.type === 'rollup') {
    const c = v as ComputedValue
    return 'value' in c ? c.value : null
  }
  return v
}

export function matchesFilter(
  field: FieldDef,
  raw: unknown,
  f: Filter,
  ctx: FilterContext,
): boolean {
  const v = scalar(field, raw)
  const val = f.value
  if (f.op === 'empty') return isEmptyValue(v)
  if (f.op === 'not_empty') return !isEmptyValue(v)

  const textual = TEXTUAL.has(field.type) || (field.type === 'formula' && typeof v === 'string')
  if (textual && ['contains', 'not_contains', 'eq', 'neq'].includes(f.op)) {
    const s = norm(String(val))
    const t = v === null ? null : norm(String(v))
    switch (f.op) {
      case 'contains':
        return t !== null && t.includes(s)
      case 'not_contains':
        return t === null || !t.includes(s)
      case 'eq':
        return t === s
      case 'neq':
        return t === null || t !== s
    }
  }

  if (NUMERIC.has(field.type) || field.type === 'formula' || field.type === 'rollup') {
    const n = Number(val)
    if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(f.op)) {
      if (f.op === 'neq') return v === null || typeof v !== 'number' || v !== n
      if (typeof v !== 'number') return false
      switch (f.op) {
        case 'eq':
          return v === n
        case 'gt':
          return v > n
        case 'gte':
          return v >= n
        case 'lt':
          return v < n
        case 'lte':
          return v <= n
      }
    }
    if (f.op === 'contains') return v !== null && norm(String(v)).includes(norm(String(val)))
  }

  if ((field.type === 'date' || field.type === 'datetime') && DATE_RANGE_OPS.has(f.op)) {
    if (typeof v !== 'string') return false
    const local = field.type === 'date' ? v : localDateOf(v, ctx.timeZone)
    const [from, to] = dateBounds(f, ctx)
    return (from === null || local >= from) && (to === null || local <= to)
  }

  if (field.type === 'checkbox') return f.op === 'is_true' ? v === true : v !== true

  if (field.type === 'select' && Array.isArray(val)) {
    const inList = typeof v === 'string' && val.includes(v)
    return f.op === 'any_of' ? inList : !inList
  }

  if (field.type === 'multiselect' && Array.isArray(val)) {
    const have = new Set(Array.isArray(v) ? (v as string[]) : [])
    if (f.op === 'any_of') return val.some((x) => have.has(x))
    if (f.op === 'none_of') return !val.some((x) => have.has(x))
    if (f.op === 'has_all') return val.every((x) => have.has(x))
  }
  return false
}

// --- Orden ------------------------------------------------------------------

type Sortable = { values: Record<string, unknown>; createdAt: string; updatedAt: string }

function sortKey(field: FieldDef, raw: unknown): string | number | boolean | null {
  const v = scalar(field, raw)
  if (isEmptyValue(v)) return null
  switch (field.type) {
    case 'select': {
      const i = parseFieldConfig('select', field.config).options.findIndex((o) => o.id === v)
      return i < 0 ? null : i
    }
    case 'multiselect': {
      const opts = parseFieldConfig('multiselect', field.config).options
      const idx = (v as string[])
        .map((id) => opts.findIndex((o) => o.id === id))
        .filter((i) => i >= 0)
      return idx.length ? Math.min(...idx) : null
    }
    case 'relation':
      return (raw as LinkRef[])[0]?.title ?? null
    default:
      return typeof v === 'object' ? JSON.stringify(v) : (v as string | number | boolean)
  }
}

function compareKeys(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return a ? 1 : -1
  return collator.compare(String(a), String(b))
}

/** Ordena en JavaScript con el colator español. Los vacíos siempre al final. */
export function sortRows<T extends Sortable>(
  rows: T[],
  sorts: Sort[],
  fields: Map<string, FieldDef>,
): T[] {
  const active = sorts.filter(
    (s) => s.fieldId === 'createdAt' || s.fieldId === 'updatedAt' || fields.has(s.fieldId),
  )
  const effective: Sort[] = active.length ? active : [{ fieldId: 'createdAt', dir: 'desc' }]
  return [...rows].sort((x, y) => {
    for (const s of effective) {
      let c: number
      if (s.fieldId === 'createdAt' || s.fieldId === 'updatedAt') {
        c = x[s.fieldId].localeCompare(y[s.fieldId])
        if (s.dir === 'desc') c = -c
      } else {
        const field = fields.get(s.fieldId)!
        const a = sortKey(field, x.values[s.fieldId])
        const b = sortKey(field, y.values[s.fieldId])
        c = compareKeys(a, b)
        // Los vacíos van al final también en orden descendente.
        if (s.dir === 'desc' && a !== null && b !== null) c = -c
      }
      if (c !== 0) return c
    }
    return 0
  })
}
