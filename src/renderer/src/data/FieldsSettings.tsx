import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  FORMULA_FORMATS,
  OPTION_COLORS,
  ROLLUP_FUNCTIONS,
  ROLLUP_LABELS,
  UNAVAILABLE_TYPES,
  type FieldDef,
  type FieldType,
  type OptionColor,
  type SelectOption,
} from '@shared/data/fields'
import { FORMULA_FUNCTIONS } from '@shared/data/formula'
import { t } from '@shared/i18n'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { useToast } from '../ui/Toast'
import { OptionChip } from './FieldValue'
import { useEntities, useFields } from './hooks'

const COLOR_LABELS: Record<OptionColor, string> = {
  gris: 'Gris',
  melocoton: 'Melocotón',
  terracota: 'Terracota',
  vino: 'Vino',
  ambar: 'Ámbar',
  verde: 'Verde',
  azul: 'Azul',
  lila: 'Lila',
}

const FORMAT_LABELS: Record<(typeof FORMULA_FORMATS)[number], string> = {
  number: 'Número',
  currency: 'Moneda',
  percent: 'Porcentaje',
  text: 'Texto',
  checkbox: 'Sí / No',
  date: 'Fecha',
}

const NUMERIC_TARGET = new Set(['number', 'currency', 'percent', 'rating'])

function optionId(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${base || 'opcion'}-${Math.random().toString(36).slice(2, 7)}`
}

function errorText(e: unknown): string {
  return e instanceof IpcCallError ? e.message : t('No se pudo guardar.')
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: SelectOption[]
  onChange: (o: SelectOption[]) => void
}) {
  const [label, setLabel] = useState('')
  const set = (i: number, patch: Partial<SelectOption>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= options.length) return
    const next = [...options]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
  }
  const add = () => {
    const l = label.trim()
    if (!l) return
    onChange([
      ...options,
      { id: optionId(l), label: l, color: OPTION_COLORS[options.length % OPTION_COLORS.length]! },
    ])
    setLabel('')
  }
  return (
    <div className="field">
      <label>{t('Opciones')}</label>
      <ul className="options-edit">
        {options.map((o, i) => (
          <li key={o.id} className="option-row">
            <OptionChip option={o} />
            <input
              className="input"
              aria-label={t('Nombre de la opción')}
              value={o.label}
              maxLength={60}
              onChange={(e) => set(i, { label: e.target.value })}
            />
            <select
              className="input"
              aria-label={t('Color')}
              value={o.color}
              onChange={(e) => set(i, { color: e.target.value as OptionColor })}
            >
              {OPTION_COLORS.map((c) => (
                <option key={c} value={c}>
                  {t(COLOR_LABELS[c])}
                </option>
              ))}
            </select>
            <label
              className="check option-done"
              title={t('Cuenta como terminada (p. ej. «Hecha»)')}
            >
              <input
                type="checkbox"
                checked={o.done === true}
                onChange={(e) => set(i, { done: e.target.checked || undefined })}
              />
              <span>{t('Fin')}</span>
            </label>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('Subir')}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('Bajar')}
              disabled={i === options.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('Quitar {title}', { title: o.label })}
              onClick={() => onChange(options.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="option-add">
        <input
          className="input"
          placeholder={t('Nueva opción')}
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="btn" onClick={add} disabled={!label.trim()}>
          {t('Añadir')}
        </button>
      </div>
      <p className="hint">
        {t(
          'Quitar una opción deja vacíos los registros que la tenían. «Fin» marca las opciones que significan terminado: no cuentan como pendientes y completan las tareas que se repiten.',
        )}
      </p>
    </div>
  )
}

function FormulaEditor({
  entity,
  field,
  config,
  onChange,
  fields,
}: {
  entity: string
  field: FieldDef | null
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  fields: FieldDef[]
}) {
  const expression = String(config['expression'] ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      void call('data:formulaProblem', {
        entity,
        expression,
        ...(field ? { fieldId: field.id } : {}),
      })
        .then(setProblem)
        .catch(() => setProblem(null))
    }, 250)
    return () => clearTimeout(timer)
  }, [entity, expression, field])
  const others = fields.filter((f) => f.id !== field?.id)
  return (
    <>
      <div className="field">
        <label htmlFor="formula-expr">{t('Fórmula')}</label>
        <textarea
          id="formula-expr"
          className="input textarea mono"
          rows={3}
          maxLength={2000}
          spellCheck={false}
          value={expression}
          placeholder="SI(gasto > 0; valor / gasto; 0)"
          onChange={(e) => onChange({ ...config, expression: e.target.value })}
        />
        {problem ? (
          <p className="hint hint-error" role="alert">
            {problem}
          </p>
        ) : (
          <p className="hint">
            {t('Argumentos separados por «;», decimales con punto (1.21), «&» une textos.')}
          </p>
        )}
      </div>
      <div className="field">
        <label>{t('Campos')}</label>
        <div className="chips">
          {others.map((f) => (
            <button
              key={f.id}
              type="button"
              className="chip chip-code"
              title={f.label}
              onClick={() => onChange({ ...config, expression: `${expression}${f.key}` })}
            >
              {f.key}
            </button>
          ))}
        </div>
        <p className="hint">{t('Funciones: {list}.', { list: FORMULA_FUNCTIONS.join(', ') })}</p>
      </div>
      <div className="field">
        <label htmlFor="formula-format">{t('Resultado')}</label>
        <select
          id="formula-format"
          className="input"
          value={String(config['format'] ?? 'number')}
          onChange={(e) => onChange({ ...config, format: e.target.value })}
        >
          {FORMULA_FORMATS.map((f) => (
            <option key={f} value={f}>
              {t(FORMAT_LABELS[f])}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}

function RollupEditor({
  config,
  onChange,
  fields,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  fields: FieldDef[]
}) {
  const relations = fields.filter((f) => f.type === 'relation')
  const relId = (config['relationField'] as string | undefined) ?? ''
  const rel = relations.find((r) => r.id === relId)
  const target = (rel?.config['target'] as string | undefined) ?? null
  const targetFields = useQuery({
    queryKey: ['data', 'fields', target, false],
    queryFn: () => call('data:fields', { entity: target!, includeDeleted: false }),
    enabled: target !== null,
  })
  const fn = String(config['fn'] ?? 'count')
  if (relations.length === 0)
    return (
      <p className="hint">
        {t('Crea antes un campo de relación: el resumen se calcula sobre él.')}
      </p>
    )
  return (
    <>
      <div className="field">
        <label htmlFor="rollup-rel">{t('Relación')}</label>
        <select
          id="rollup-rel"
          className="input"
          value={relId}
          onChange={(e) =>
            onChange({
              ...config,
              relationField: e.target.value || undefined,
              targetField: undefined,
            })
          }
        >
          <option value="">—</option>
          {relations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rollup-fn">{t('Cálculo')}</label>
        <select
          id="rollup-fn"
          className="input"
          value={fn}
          onChange={(e) => onChange({ ...config, fn: e.target.value })}
        >
          {ROLLUP_FUNCTIONS.map((f) => (
            <option key={f} value={f}>
              {t(ROLLUP_LABELS[f])}
            </option>
          ))}
        </select>
      </div>
      {fn !== 'count' && (
        <div className="field">
          <label htmlFor="rollup-target">{t('Campo que se resume')}</label>
          <select
            id="rollup-target"
            className="input"
            value={(config['targetField'] as string | undefined) ?? ''}
            onChange={(e) => onChange({ ...config, targetField: e.target.value || undefined })}
          >
            <option value="">—</option>
            {(targetFields.data ?? [])
              .filter((f) => NUMERIC_TARGET.has(f.type))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
          </select>
        </div>
      )}
    </>
  )
}

/** Diálogo para crear o editar un campo. */
export function FieldDialog({
  entity,
  field,
  fields,
  onClose,
}: {
  entity: string
  field: FieldDef | null
  fields: FieldDef[]
  onClose: () => void
}) {
  const entities = useEntities()
  const [label, setLabel] = useState(field?.label ?? '')
  const [type, setType] = useState<FieldType>(field?.type ?? 'text')
  const [key, setKey] = useState(field?.key ?? '')
  const [required, setRequired] = useState(field?.required ?? false)
  const [config, setConfig] = useState<Record<string, unknown>>(field?.config ?? {})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [inverse, setInverse] = useState(true)
  const [inverseLabel, setInverseLabel] = useState(
    () => entities.data?.find((e) => e.id === entity)?.label ?? '',
  )
  const qc = useQueryClient()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const changeType = (ft: FieldType) => {
    setType(ft)
    setConfig(
      ft === 'relation'
        ? { target: entity, multiple: true }
        : ft === 'formula'
          ? { expression: '', format: 'number' }
          : ft === 'rollup'
            ? { fn: 'count' }
            : {},
    )
  }

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      if (field) {
        await call('data:updateField', {
          id: field.id,
          label,
          config,
          ...(field.system ? {} : { key, required }),
        })
      } else {
        const created = await call('data:createField', { entity, label, type, config })
        if (type === 'relation' && inverse && inverseLabel.trim())
          await call('data:createInverseField', { fieldId: created.id, label: inverseLabel.trim() })
      }
      await qc.invalidateQueries({ queryKey: ['data'] })
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const num = (name: string, fallback: number) => Number(config[name] ?? fallback)
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="field-dialog-t"
        data-testid="field-dialog"
      >
        <h2 id="field-dialog-t">
          {field ? t('Editar «{field}»', { field: field.label }) : t('Nuevo campo')}
        </h2>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="field">
            <label htmlFor="field-label">{t('Nombre')}</label>
            <input
              id="field-label"
              className="input"
              autoFocus
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          {!field && (
            <div className="field">
              <label htmlFor="field-type">{t('Tipo')}</label>
              <select
                id="field-type"
                className="input"
                value={type}
                onChange={(e) => changeType(e.target.value as FieldType)}
              >
                {FIELD_TYPES.map((ft) => (
                  <option key={ft} value={ft} disabled={!!UNAVAILABLE_TYPES[ft]}>
                    {t(FIELD_TYPE_LABELS[ft])}
                    {UNAVAILABLE_TYPES[ft] ? ` (${t('fase 4')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {field && !field.system && (
            <div className="field">
              <label htmlFor="field-key">{t('Clave para fórmulas')}</label>
              <input
                id="field-key"
                className="input mono"
                maxLength={40}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <p className="hint">
                {t('Minúsculas, números y «_». Si la cambias, revisa las fórmulas que la usan.')}
              </p>
            </div>
          )}

          {(type === 'number' || type === 'percent' || type === 'currency') && (
            <div className="field-row">
              {type === 'currency' && (
                <div className="field">
                  <label htmlFor="field-cur">{t('Moneda')}</label>
                  <select
                    id="field-cur"
                    className="input"
                    value={String(config['currency'] ?? 'EUR')}
                    onChange={(e) => setConfig({ ...config, currency: e.target.value })}
                  >
                    {['EUR', 'USD', 'GBP', 'CHF', 'MXN'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="field-dec">{t('Decimales')}</label>
                <select
                  id="field-dec"
                  className="input"
                  value={num('decimals', type === 'percent' ? 1 : 2)}
                  onChange={(e) => setConfig({ ...config, decimals: Number(e.target.value) })}
                >
                  {[0, 1, 2, 3, 4].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {type === 'rating' && (
            <div className="field">
              <label htmlFor="field-max">{t('Máximo')}</label>
              <select
                id="field-max"
                className="input"
                value={num('max', 5)}
                onChange={(e) => setConfig({ ...config, max: Number(e.target.value) })}
              >
                {[3, 4, 5, 6, 7, 8, 9, 10].map((d) => (
                  <option key={d} value={d}>
                    {t('{n} estrellas', { n: d })}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(type === 'select' || type === 'multiselect') && (
            <OptionsEditor
              options={(config['options'] as SelectOption[] | undefined) ?? []}
              onChange={(options) => setConfig({ ...config, options })}
            />
          )}
          {type === 'relation' && (
            <>
              <div className="field">
                <label htmlFor="field-target">{t('Enlaza con')}</label>
                <select
                  id="field-target"
                  className="input"
                  disabled={!!field}
                  value={String(config['target'] ?? entity)}
                  onChange={(e) => setConfig({ ...config, target: e.target.value })}
                >
                  {(entities.data ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={config['multiple'] !== false}
                  onChange={(e) => setConfig({ ...config, multiple: e.target.checked })}
                />
                <span>{t('Permitir varios registros')}</span>
              </label>
              {!field && (
                <>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={inverse}
                      onChange={(e) => setInverse(e.target.checked)}
                    />
                    <span>
                      {t('Mostrarlo también en {target}', {
                        target:
                          entities.data?.find((e) => e.id === config['target'])?.label ??
                          t('el otro lado'),
                      })}
                    </span>
                  </label>
                  {inverse && (
                    <div className="field">
                      <label htmlFor="field-inverse">{t('Nombre del campo en el otro lado')}</label>
                      <input
                        id="field-inverse"
                        className="input"
                        maxLength={120}
                        value={inverseLabel}
                        onChange={(e) => setInverseLabel(e.target.value)}
                      />
                    </div>
                  )}
                </>
              )}
              {!!config['inverseOf'] && (
                <p className="hint">
                  {t('Muestra desde este lado los vínculos de otra relación.')}
                </p>
              )}
            </>
          )}
          {type === 'formula' && (
            <FormulaEditor
              entity={entity}
              field={field}
              config={config}
              onChange={setConfig}
              fields={fields}
            />
          )}
          {type === 'rollup' && (
            <RollupEditor config={config} onChange={setConfig} fields={fields} />
          )}
          {field &&
            !field.system &&
            !['formula', 'rollup', 'relation', 'checkbox'].includes(type) && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                />
                <span>{t('Obligatorio (no puede quedar vacío)')}</span>
              </label>
            )}
          {error && <Alert>{error}</Alert>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving || !label.trim()}>
              {field ? t('Guardar') : t('Crear campo')}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              {t('Cancelar')}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

/**
 * Campos de una sección (sus ajustes, fase 12 y arreglos): añadir, editar, ordenar, ocultar
 * y eliminar. Eliminar un campo no borra sus datos: se puede restaurar.
 */
export function FieldsEditor({ entity }: { entity: string }) {
  const fields = useFields(entity, true)
  const toast = useToast()
  const [editing, setEditing] = useState<FieldDef | 'new' | null>(null)

  const all = fields.data ?? []
  const active = all.filter((f) => !f.deletedAt)
  const deleted = all.filter((f) => f.deletedAt)
  const run = (p: Promise<unknown>) =>
    void p.catch((e: unknown) => toast.show(errorText(e), 'error'))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= active.length) return
    const ids = active.map((f) => f.id)
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    run(call('data:reorderFields', { entity, ids }))
  }

  return (
    <div className="fields-editor" data-testid="fields-settings">
      <ul className="fields-list">
        {active.map((f, i) => (
          <li key={f.id} className="fields-row" data-testid="field-row">
            <span className="fields-label">
              {f.label}
              {!f.visible && <span className="faint"> · {t('oculto')}</span>}
            </span>
            <span className="faint">{t(FIELD_TYPE_LABELS[f.type])}</span>
            <span className="faint">{f.system ? t('de serie') : ''}</span>
            <span className="fields-actions">
              <button
                type="button"
                className="icon-btn"
                aria-label={t('Subir {field}', { field: f.label })}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={t('Bajar {field}', { field: f.label })}
                disabled={i === active.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button type="button" className="btn" onClick={() => setEditing(f)}>
                {t('Editar')}
              </button>
              {!f.system && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => run(call('data:deleteField', { id: f.id }))}
                >
                  {t('Eliminar')}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setEditing('new')}
          data-testid="add-field"
        >
          + {t('Añadir campo')}
        </button>
      </div>
      {deleted.length > 0 && (
        <div className="field">
          <label>{t('Eliminados')}</label>
          <ul className="fields-list">
            {deleted.map((f) => (
              <li key={f.id} className="fields-row">
                <span className="fields-label faint">{f.label}</span>
                <span className="faint">{t(FIELD_TYPE_LABELS[f.type])}</span>
                <span className="fields-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => run(call('data:restoreField', { id: f.id }))}
                  >
                    {t('Restaurar')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && (
        <FieldDialog
          entity={entity}
          field={editing === 'new' ? null : editing}
          fields={active}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/** Ajustes → Datos: días que se guarda la papelera. */
export function DataSettings() {
  const toast = useToast()
  const trash = useQuery({ queryKey: ['data', 'trash'], queryFn: () => call('data:trashList', {}) })
  const days = trash.data?.days ?? 30
  return (
    <section className="settings-block">
      <div>
        <h2>{t('Datos')}</h2>
        <p className="desc">
          {t('Lo que va a la papelera se puede restaurar durante este tiempo.')}
        </p>
      </div>
      <div className="settings-body">
        <div className="field">
          <label htmlFor="trash-days">{t('Vaciar la papelera tras')}</label>
          <select
            id="trash-days"
            className="input"
            value={days}
            onChange={(e) =>
              void call('data:setTrashDays', { days: Number(e.target.value) }).catch(
                (err: unknown) => toast.show(errorText(err), 'error'),
              )
            }
          >
            {[...new Set([7, 14, 30, 60, 90, 180, 365, days])]
              .sort((a, b) => a - b)
              .map((d) => (
                <option key={d} value={d}>
                  {t('{n} días', { n: d })}
                </option>
              ))}
          </select>
        </div>
      </div>
    </section>
  )
}
