import { formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent } from '../format'
import { parseFieldConfig, type FieldDef, type RichText } from './fields'
import type { ComputedValue, LinkRef } from './records'

/** Texto visible de un valor, en formato español (tablas, tarjetas, CSV). */
export function formatValue(field: Pick<FieldDef, 'type' | 'config'>, value: unknown): string {
  if (value === null || value === undefined) return ''
  switch (field.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return String(value)
    case 'longtext':
      return (value as RichText).text.trim()
    case 'number':
      return formatNumber(value as number, parseFieldConfig('number', field.config).decimals)
    case 'currency': {
      const c = parseFieldConfig('currency', field.config)
      return formatCurrency(value as number, c.currency)
    }
    case 'percent':
      return formatPercent(value as number, parseFieldConfig('percent', field.config).decimals)
    case 'date': {
      const [y, m, d] = String(value).split('-')
      return `${d}/${m}/${y}`
    }
    case 'datetime':
      return formatDateTime(new Date(String(value)))
    case 'checkbox':
      return value ? 'Sí' : 'No'
    case 'select': {
      const o = parseFieldConfig('select', field.config).options.find((x) => x.id === value)
      return o?.label ?? ''
    }
    case 'multiselect': {
      const opts = parseFieldConfig('multiselect', field.config).options
      return (value as string[])
        .map((id) => opts.find((o) => o.id === id)?.label)
        .filter(Boolean)
        .join(', ')
    }
    case 'rating':
      return `${value}/${parseFieldConfig('rating', field.config).max}`
    case 'relation':
      return (value as LinkRef[]).map((l) => l.title).join(', ')
    case 'formula':
    case 'rollup':
      return formatComputed(field, value as ComputedValue)
    case 'files':
      return ''
  }
}

export function formatComputed(field: Pick<FieldDef, 'type' | 'config'>, v: ComputedValue): string {
  if ('error' in v) return '#ERROR'
  const value = v.value
  if (value === null) return ''
  if (field.type === 'rollup') {
    const c = parseFieldConfig('rollup', field.config)
    return typeof value === 'number'
      ? formatNumber(value, c.fn === 'count' ? 0 : c.decimals)
      : String(value)
  }
  const c = parseFieldConfig('formula', field.config)
  switch (c.format) {
    case 'number':
      return typeof value === 'number' ? formatNumber(value, c.decimals) : String(value)
    case 'currency':
      return typeof value === 'number' ? formatCurrency(value, c.currency) : String(value)
    case 'percent':
      return typeof value === 'number' ? formatPercent(value, c.decimals) : String(value)
    case 'checkbox':
      return value === true || value === 1 ? 'Sí' : 'No'
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
        ? formatDate(new Date(`${value.slice(0, 10)}T12:00:00Z`))
        : String(value)
    case 'text':
      return typeof value === 'boolean' ? (value ? 'VERDADERO' : 'FALSO') : String(value)
  }
}
