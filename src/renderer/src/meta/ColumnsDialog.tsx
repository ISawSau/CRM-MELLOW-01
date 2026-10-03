import { useState } from 'react'
import { OPTION_COLORS, type OptionColor } from '@shared/data/fields'
import { parseNumberEs, formatNumber } from '@shared/format'
import { t } from '@shared/i18n'
import {
  CONFIG_COLUMNS,
  type ColumnPreset,
  type ConditionalRule,
  type MetricDef,
} from '@shared/meta-metrics'
import { norm } from '@shared/data/text'
import { columnLabel, isConfigColumn } from './metrics'

const COLOR_LABELS: Record<OptionColor, string> = {
  gris: 'Gris',
  melocoton: 'Melocotón',
  terracota: 'Terracota',
  vino: 'Rojo vino',
  ambar: 'Ámbar',
  verde: 'Verde',
  azul: 'Azul',
  lila: 'Lila',
}

const OPS: Record<ConditionalRule['op'], string> = {
  gt: 'mayor que',
  lt: 'menor que',
  between: 'entre',
}

function NumberInput({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (n: number) => void
  label: string
}) {
  const [text, setText] = useState(formatNumber(value))
  return (
    <input
      className="input num rule-number"
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = parseNumberEs(e.target.value)
        if (n !== null) onChange(n)
      }}
    />
  )
}

/** Editar las columnas y el formato condicional de un preset de la tabla. */
export function ColumnsDialog({
  preset,
  builtIn,
  defs,
  onSave,
  onDelete,
  onClose,
}: {
  preset: ColumnPreset
  builtIn: boolean
  defs: Map<string, MetricDef>
  onSave: (p: ColumnPreset, asNew: boolean) => void
  onDelete: (() => void) | null
  onClose: () => void
}) {
  const [name, setName] = useState(
    builtIn ? t('{name} (copia)', { name: t(preset.name) }) : preset.name,
  )
  const [columns, setColumns] = useState(preset.columns)
  const [rules, setRules] = useState<ConditionalRule[]>(preset.rules)
  const [search, setSearch] = useState('')

  const move = (i: number, d: -1 | 1) => {
    const next = [...columns]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    setColumns(next)
  }
  const available = [
    ...CONFIG_COLUMNS.map((c) => ({
      key: c.key,
      label: columnLabel(c.key, defs),
      group: 'Configuración',
    })),
    ...[...defs.values()].map((d) => ({
      key: d.key,
      label: columnLabel(d.key, defs),
      group: d.group as string,
    })),
  ].filter(
    (c) =>
      !columns.includes(c.key) &&
      (!search.trim() || norm(`${c.label} ${c.key}`).includes(norm(search.trim()))),
  )
  const groups = [...new Set(available.map((a) => a.group))]
  const numeric = columns.filter((c) => !isConfigColumn(c))
  const save = (asNew: boolean) =>
    onSave(
      {
        id: preset.id,
        name: name.trim() || t('Sin nombre'),
        columns,
        rules: rules.filter((r) => columns.includes(r.column)),
      },
      asNew,
    )

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div
        className="dialog dialog-wide dialog-columns"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cols-t"
        data-testid="columns-dialog"
      >
        <h2 id="cols-t">{t('Columnas')}</h2>
        <div className="field">
          <label htmlFor="preset-name">{t('Nombre del preset')}</label>
          <input
            id="preset-name"
            className="input"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="columns-editor">
          <div>
            <h3 className="panel-subtitle">{t('Elegidas')}</h3>
            <ol className="column-list" data-testid="chosen-columns">
              {columns.map((c, i) => (
                <li key={c}>
                  <span className="column-name">{columnLabel(c, defs)}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('Subir {column}', { column: columnLabel(c, defs) })}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('Bajar {column}', { column: columnLabel(c, defs) })}
                    disabled={i === columns.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('Quitar {column}', { column: columnLabel(c, defs) })}
                    disabled={columns.length === 1}
                    onClick={() => setColumns(columns.filter((x) => x !== c))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="panel-subtitle">{t('Añadir')}</h3>
            <input
              className="input"
              placeholder={t('Buscar métrica o acción…')}
              aria-label={t('Buscar columna')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="column-catalog">
              {groups.map((g) => (
                <div key={g}>
                  <h4 className="eyebrow">{t(g)}</h4>
                  <ul>
                    {available
                      .filter((a) => a.group === g)
                      .map((a) => (
                        <li key={a.key}>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => columns.length < 60 && setColumns([...columns, a.key])}
                          >
                            + {a.label}
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
              {available.length === 0 && <p className="faint">{t('Nada que añadir.')}</p>}
            </div>
          </div>
        </div>

        <h3 className="panel-subtitle">{t('Formato condicional')}</h3>
        <ul className="rule-list" data-testid="rules">
          {rules.map((r, i) => {
            const set = (patch: Partial<ConditionalRule>) =>
              setRules(rules.map((x, j) => (j === i ? { ...x, ...patch } : x)))
            return (
              <li key={i} className="rule-item">
                <select
                  className="input"
                  aria-label={t('Columna de la regla')}
                  value={r.column}
                  onChange={(e) => set({ column: e.target.value })}
                >
                  {numeric.map((c) => (
                    <option key={c} value={c}>
                      {columnLabel(c, defs)}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  aria-label={t('Condición')}
                  value={r.op}
                  onChange={(e) => set({ op: e.target.value as ConditionalRule['op'] })}
                >
                  {Object.entries(OPS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {t(l)}
                    </option>
                  ))}
                </select>
                <NumberInput value={r.a} label={t('Valor')} onChange={(a) => set({ a })} />
                {r.op === 'between' && (
                  <>
                    <span className="faint">{t('y')}</span>
                    <NumberInput
                      value={r.b ?? r.a}
                      label={t('Segundo valor')}
                      onChange={(b) => set({ b })}
                    />
                  </>
                )}
                <select
                  className="input"
                  aria-label={t('Color')}
                  value={r.color}
                  onChange={(e) => set({ color: e.target.value as OptionColor })}
                >
                  {OPTION_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {t(COLOR_LABELS[c])}
                    </option>
                  ))}
                </select>
                <span className="rule-swatch" data-color={r.color} aria-hidden="true" />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('Quitar regla')}
                  onClick={() => setRules(rules.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
        <div className="form-actions">
          <button
            type="button"
            className="btn"
            disabled={numeric.length === 0 || rules.length >= 50}
            onClick={() =>
              setRules([...rules, { column: numeric[0]!, op: 'gt', a: 0, color: 'verde' }])
            }
          >
            {t('+ Regla')}
          </button>
        </div>
        <p className="hint">
          {t(
            'Colorea la celda si cumple la condición. Los porcentajes van en tanto por cien (2 = 2 %).',
          )}
        </p>

        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancelar')}
          </button>
          {onDelete && (
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              {t('Borrar preset')}
            </button>
          )}
          <button type="button" className="btn" onClick={() => save(true)}>
            {t('Guardar como preset nuevo')}
          </button>
          {!builtIn && (
            <button type="button" className="btn btn-primary" onClick={() => save(false)}>
              {t('Guardar')}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
