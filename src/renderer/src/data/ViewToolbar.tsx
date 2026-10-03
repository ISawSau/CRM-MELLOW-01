import { useEffect, useRef, useState } from 'react'
import { parseFieldConfig, type FieldDef } from '@shared/data/fields'
import { parseNumberEs } from '@shared/format'
import {
  FILTER_OP_LABELS,
  OPS_BY_TYPE,
  VALUELESS_OPS,
  type Filter,
  type FilterOp,
  type Sort,
  type View,
} from '@shared/data/views'
import { Popover } from '../ui/Popover'
import { toConfigColumns, type Column } from './columns'
import { OptionChip } from './FieldValue'

type SaveConfig = (config: Partial<View['config']>) => void

const NUMERIC_FILTER = new Set(['number', 'currency', 'percent', 'rating', 'rollup'])

function isNumericFilterField(f: FieldDef): boolean {
  if (NUMERIC_FILTER.has(f.type)) return true
  if (f.type === 'formula') return parseFieldConfig('formula', f.config).format !== 'text'
  return false
}

/** Valor por defecto al cambiar de operador. */
function defaultValue(f: FieldDef, op: FilterOp): Filter['value'] {
  if (VALUELESS_OPS.includes(op)) return null
  if (op === 'between') return ['', '']
  if (f.type === 'select' || f.type === 'multiselect') return []
  return null
}

function FilterValue({
  field,
  filter,
  onChange,
}: {
  field: FieldDef
  filter: Filter
  onChange: (value: Filter['value']) => void
}) {
  const { op, value } = filter
  const [text, setText] = useState(() =>
    typeof value === 'number'
      ? String(field.type === 'percent' ? value * 100 : value).replace('.', ',')
      : typeof value === 'string'
        ? value
        : '',
  )
  if (VALUELESS_OPS.includes(op)) return null
  if (field.type === 'select' || field.type === 'multiselect') {
    const opts = parseFieldConfig(field.type, field.config).options
    const sel = new Set(Array.isArray(value) ? value : [])
    return (
      <span className="chips chips-edit">
        {opts.map((o) => (
          <button
            key={o.id}
            type="button"
            className="chip-toggle"
            aria-pressed={sel.has(o.id)}
            onClick={() => {
              const next = new Set(sel)
              if (next.has(o.id)) next.delete(o.id)
              else next.add(o.id)
              onChange(opts.filter((x) => next.has(x.id)).map((x) => x.id))
            }}
          >
            <OptionChip option={o} />
          </button>
        ))}
      </span>
    )
  }
  if (field.type === 'date' || field.type === 'datetime') {
    if (op === 'between') {
      const [a, b] = Array.isArray(value) ? value : ['', '']
      return (
        <span className="filter-range">
          <input
            className="input"
            type="date"
            aria-label="Desde"
            value={a ?? ''}
            onChange={(e) => onChange([e.target.value, b ?? ''])}
          />
          <span className="faint">y</span>
          <input
            className="input"
            type="date"
            aria-label="Hasta"
            value={b ?? ''}
            onChange={(e) => onChange([a ?? '', e.target.value])}
          />
        </span>
      )
    }
    return (
      <input
        className="input"
        type="date"
        aria-label="Fecha"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    )
  }
  const numeric = isNumericFilterField(field) && op !== 'contains'
  return (
    <input
      className={numeric ? 'input num' : 'input'}
      aria-label="Valor"
      inputMode={numeric ? 'decimal' : undefined}
      value={text}
      placeholder={numeric ? '0' : 'texto'}
      onChange={(e) => {
        setText(e.target.value)
        if (!numeric) return onChange(e.target.value || null)
        const n = parseNumberEs(e.target.value)
        onChange(n === null ? null : field.type === 'percent' ? n / 100 : n)
      }}
    />
  )
}

export function FilterMenu({
  view,
  fields,
  onSave,
}: {
  view: View
  fields: FieldDef[]
  onSave: SaveConfig
}) {
  const filterable = fields
  const [draft, setDraft] = useState(view.config.filters)
  const [match, setMatch] = useState(view.config.match)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!timer.current) {
      setDraft(view.config.filters)
      setMatch(view.config.match)
    }
  }, [view.config.filters, view.config.match])

  const save = (filters: Filter[], m = match) => {
    setDraft(filters)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      onSave({ filters, match: m })
    }, 300)
  }
  const byId = new Map(filterable.map((f) => [f.id, f]))
  const count = view.config.filters.length

  return (
    <Popover
      label="Filtrar"
      testId="filter-button"
      className={count ? 'btn btn-on' : 'btn'}
      button={<>Filtrar{count ? ` · ${count}` : ''}</>}
    >
      {() => (
        <div className="menu menu-wide" data-testid="filter-menu">
          {draft.length > 1 && (
            <label className="menu-row">
              <span className="muted">Mostrar los que cumplan</span>
              <select
                className="input"
                value={match}
                onChange={(e) => {
                  const m = e.target.value as 'all' | 'any'
                  setMatch(m)
                  save(draft, m)
                }}
              >
                <option value="all">todas las condiciones</option>
                <option value="any">alguna condición</option>
              </select>
            </label>
          )}
          {draft.length === 0 && <p className="faint menu-empty">Sin filtros: se ve todo.</p>}
          {draft.map((flt, i) => {
            const f = byId.get(flt.fieldId)
            if (!f) return null
            const update = (patch: Partial<Filter>) =>
              save(draft.map((x, j) => (j === i ? { ...x, ...patch } : x)))
            return (
              <div key={i} className="filter-row" data-testid="filter-row">
                <select
                  className="input"
                  aria-label="Campo"
                  value={f.id}
                  onChange={(e) => {
                    const nf = byId.get(e.target.value)!
                    const op = OPS_BY_TYPE[nf.type][0]!
                    update({ fieldId: nf.id, op, value: defaultValue(nf, op) })
                  }}
                >
                  {filterable.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  aria-label="Condición"
                  value={flt.op}
                  onChange={(e) => {
                    const op = e.target.value as FilterOp
                    update({ op, value: defaultValue(f, op) })
                  }}
                >
                  {OPS_BY_TYPE[f.type].map((op) => (
                    <option key={op} value={op}>
                      {FILTER_OP_LABELS[op]}
                    </option>
                  ))}
                </select>
                <FilterValue
                  key={`${f.id}:${flt.op}`}
                  field={f}
                  filter={flt}
                  onChange={(value) => update({ value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Quitar filtro"
                  onClick={() => save(draft.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            )
          })}
          <div className="menu-foot">
            <button
              type="button"
              className="btn"
              disabled={filterable.length === 0}
              onClick={() => {
                const f = filterable[0]!
                const op = OPS_BY_TYPE[f.type][0]!
                save([...draft, { fieldId: f.id, op, value: defaultValue(f, op) }])
              }}
            >
              + Añadir filtro
            </button>
            {draft.length > 0 && (
              <button type="button" className="btn-link" onClick={() => save([])}>
                Quitar todos
              </button>
            )}
          </div>
        </div>
      )}
    </Popover>
  )
}

const FIXED_SORTS = [
  { id: 'createdAt', label: 'Fecha de creación' },
  { id: 'updatedAt', label: 'Última modificación' },
] as const

export function SortMenu({
  view,
  fields,
  onSave,
}: {
  view: View
  fields: FieldDef[]
  onSave: SaveConfig
}) {
  const sorts = view.config.sorts
  const sortable = fields.filter((f) => f.type !== 'files' && f.type !== 'longtext')
  const set = (next: Sort[]) => onSave({ sorts: next })
  return (
    <Popover
      label="Ordenar"
      testId="sort-button"
      className={sorts.length ? 'btn btn-on' : 'btn'}
      button={<>Ordenar{sorts.length ? ` · ${sorts.length}` : ''}</>}
    >
      {() => (
        <div className="menu menu-wide">
          {sorts.length === 0 && (
            <p className="faint menu-empty">Sin orden: primero lo más reciente.</p>
          )}
          {sorts.map((s, i) => (
            <div key={i} className="filter-row">
              <select
                className="input"
                aria-label="Ordenar por"
                value={s.fieldId}
                onChange={(e) =>
                  set(sorts.map((x, j) => (j === i ? { ...x, fieldId: e.target.value } : x)))
                }
              >
                {sortable.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
                {FIXED_SORTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                className="input"
                aria-label="Dirección"
                value={s.dir}
                onChange={(e) =>
                  set(
                    sorts.map((x, j) =>
                      j === i ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x,
                    ),
                  )
                }
              >
                <option value="asc">ascendente (A → Z, 0 → 9)</option>
                <option value="desc">descendente (Z → A, 9 → 0)</option>
              </select>
              <button
                type="button"
                className="icon-btn"
                aria-label="Quitar orden"
                onClick={() => set(sorts.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          {sorts.length < 5 && (
            <div className="menu-foot">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  set([...sorts, { fieldId: sortable[0]?.id ?? 'createdAt', dir: 'asc' }])
                }
              >
                + Añadir orden
              </button>
            </div>
          )}
        </div>
      )}
    </Popover>
  )
}

export function ColumnsMenu({
  columns,
  titleId,
  onSave,
}: {
  columns: Column[]
  titleId: string | null
  onSave: SaveConfig
}) {
  const save = (next: Column[]) => onSave({ columns: toConfigColumns(next) })
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 1 || j >= columns.length) return
    const next = [...columns]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    save(next)
  }
  return (
    <Popover label="Columnas" testId="columns-button" button="Columnas">
      {() => (
        <ul className="menu">
          {columns.map((c, i) => (
            <li key={c.field.id} className="menu-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={c.visible}
                  disabled={c.field.id === titleId}
                  onChange={() =>
                    save(columns.map((x, j) => (j === i ? { ...x, visible: !x.visible } : x)))
                  }
                />
                <span>{c.field.label}</span>
              </label>
              {c.field.id !== titleId && (
                <span className="menu-move">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Mover ${c.field.label} a la izquierda`}
                    disabled={i <= 1}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Mover ${c.field.label} a la derecha`}
                    disabled={i >= columns.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Popover>
  )
}

export function FieldPicker({
  label,
  value,
  fields,
  onChange,
  testId,
}: {
  label: string
  value: string | null
  fields: FieldDef[]
  onChange: (id: string | null) => void
  testId?: string
}) {
  return (
    <label className="inline-field">
      <span className="faint">{label}</span>
      <select
        className="input"
        value={value ?? ''}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">—</option>
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function CardFieldsMenu({
  view,
  fields,
  onSave,
}: {
  view: View
  fields: FieldDef[]
  onSave: SaveConfig
}) {
  const sel = new Set(view.config.cardFields)
  const options = fields.filter((f) => f.type !== 'longtext' && f.type !== 'files')
  return (
    <Popover label="Campos visibles en las tarjetas" button="Campos visibles">
      {() => (
        <ul className="menu">
          {options.map((f) => (
            <li key={f.id} className="menu-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={sel.has(f.id)}
                  disabled={!sel.has(f.id) && sel.size >= 10}
                  onChange={() => {
                    const next = new Set(sel)
                    if (next.has(f.id)) next.delete(f.id)
                    else next.add(f.id)
                    onSave({ cardFields: options.filter((x) => next.has(x.id)).map((x) => x.id) })
                  }}
                />
                <span>{f.label}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  )
}
