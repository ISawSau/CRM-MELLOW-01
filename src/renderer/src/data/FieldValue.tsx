import { parseFieldConfig, type FieldDef, type SelectOption } from '@shared/data/fields'
import { formatValue } from '@shared/data/format-value'
import type { ComputedValue, LinkRef } from '@shared/data/records'

export const NUMERIC_TYPES = new Set(['number', 'currency', 'percent', 'rating'])

/** ¿Se alinea a la derecha? Números y fórmulas numéricas. */
export function isNumericField(f: FieldDef): boolean {
  if (NUMERIC_TYPES.has(f.type)) return true
  if (f.type === 'rollup') return true
  if (f.type === 'formula') {
    const fmt = parseFieldConfig('formula', f.config).format
    return fmt === 'number' || fmt === 'currency' || fmt === 'percent'
  }
  return false
}

export function OptionChip({ option }: { option: Pick<SelectOption, 'label' | 'color'> }) {
  return (
    <span className="chip" data-color={option.color}>
      {option.label}
    </span>
  )
}

export function Stars({ value, max }: { value: number; max: number }) {
  return (
    <span className="stars" aria-label={`${value} de ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} data-on={i < value}>
          ★
        </span>
      ))}
    </span>
  )
}

/** Valor de un campo en modo lectura (tablas, tarjetas, listas). */
export function FieldValue({ field, value }: { field: FieldDef; value: unknown }) {
  if (value === undefined || value === null) return null
  switch (field.type) {
    case 'select': {
      const o = parseFieldConfig('select', field.config).options.find((x) => x.id === value)
      return o ? <OptionChip option={o} /> : null
    }
    case 'multiselect': {
      const opts = parseFieldConfig('multiselect', field.config).options
      return (
        <span className="chips">
          {(value as string[]).map((id) => {
            const o = opts.find((x) => x.id === id)
            return o ? <OptionChip key={id} option={o} /> : null
          })}
        </span>
      )
    }
    case 'checkbox':
      return (
        <span className="checkmark" data-on={value === true} aria-label={value ? 'Sí' : 'No'}>
          {value ? '✓' : ''}
        </span>
      )
    case 'rating':
      return <Stars value={value as number} max={parseFieldConfig('rating', field.config).max} />
    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className="cell-link">
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      )
    case 'email':
      return (
        <a href={`mailto:${String(value)}`} className="cell-link">
          {String(value)}
        </a>
      )
    case 'relation':
      return (
        <span className="chips">
          {(value as LinkRef[]).map((l) => (
            <span key={l.id} className="chip chip-link">
              {l.title}
            </span>
          ))}
        </span>
      )
    case 'formula':
    case 'rollup': {
      const c = value as ComputedValue
      if ('error' in c)
        return (
          <span className="cell-error" title={c.error}>
            #ERROR
          </span>
        )
      if (
        field.type === 'formula' &&
        parseFieldConfig('formula', field.config).format === 'checkbox'
      )
        return <FieldValue field={{ ...field, type: 'checkbox' }} value={c.value === true} />
      return (
        <span className={isNumericField(field) ? 'num' : undefined}>{formatValue(field, c)}</span>
      )
    }
    default: {
      const text = formatValue(field, value)
      return <span className={isNumericField(field) ? 'num' : undefined}>{text}</span>
    }
  }
}
