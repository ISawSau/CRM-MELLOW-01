import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { fromLocalInput, toLocalInput } from '@shared/data/dates'
import { parseFieldConfig, type ChecklistItem, type FieldDef } from '@shared/data/fields'
import {
  RECURRENCE_FREQS,
  recurrenceSchema,
  weekdayShort,
  type Recurrence,
  type RecurrenceFreq,
} from '@shared/data/recurrence'
import type { LinkRef } from '@shared/data/records'
import { norm } from '@shared/data/text'
import { parseNumberEs } from '@shared/format'
import { getLocale, t, tn } from '@shared/i18n'
import { call } from '../lib/ipc'
import { FieldValue, OptionChip } from './FieldValue'
import { FilesEditor } from './files'
import { useNav, useTimeZone } from './nav'
import { useToast } from '../ui/Toast'

/**
 * Editor de un campo guardado. `onCommit` recibe el valor ya en su forma guardada
 * (número, AAAA-MM-DD, id de opción…) o null para vaciar.
 * Texto y números se confirman al salir del campo o con Intro; Escape descarta.
 */
export interface EditorProps {
  field: FieldDef
  value: unknown
  onCommit: (value: unknown) => void
  autoFocus?: boolean
  /** En la tabla: tras confirmar o cancelar, se sale del modo edición. */
  onDone?: () => void
  id?: string
}

function TextLike({
  field,
  value,
  onCommit,
  autoFocus,
  onDone,
  id,
}: EditorProps & { value: string }) {
  const [draft, setDraft] = useState(value)
  // Si el valor cambia desde fuera (deshacer, otra vista), se recarga el borrador.
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setDraft(value)
  }
  const cancelled = useRef(false)
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (draft !== value) onCommit(draft.trim() === '' ? null : draft.trim())
    onDone?.()
  }
  const type = field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'
  return (
    <input
      id={id}
      className="input"
      type={type}
      value={draft}
      autoFocus={autoFocus}
      placeholder={field.type === 'url' ? 'https://…' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.stopPropagation()
          cancelled.current = true
          setDraft(value)
          onDone?.()
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function NumberLike({ field, value, onCommit, autoFocus, onDone, id }: EditorProps) {
  const isPct = field.type === 'percent'
  const shown = useMemo(() => {
    if (typeof value !== 'number') return ''
    const n = isPct ? Math.round(value * 1e10) / 1e8 : value
    // Sin separador de miles para que sea cómodo de editar, con coma decimal (punto en inglés).
    return getLocale() === 'en' ? String(n) : String(n).replace('.', ',')
  }, [value, isPct])
  const [draft, setDraft] = useState(shown)
  const [prev, setPrev] = useState(shown)
  if (prev !== shown) {
    setPrev(shown)
    setDraft(shown)
  }
  const [invalid, setInvalid] = useState(false)
  const cancelled = useRef(false)
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (draft === shown) return onDone?.()
    if (draft.trim() === '') {
      onCommit(null)
      return onDone?.()
    }
    const n = parseNumberEs(draft)
    if (n === null || (field.type === 'rating' && !Number.isInteger(n))) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onCommit(isPct ? Math.round(n * 1e8) / 1e10 : n)
    onDone?.()
  }
  return (
    <input
      id={id}
      className="input num"
      inputMode="decimal"
      value={draft}
      autoFocus={autoFocus}
      aria-invalid={invalid}
      title={invalid ? t('Escribe un número, por ejemplo 1.234,56') : undefined}
      onChange={(e) => {
        setDraft(e.target.value)
        setInvalid(false)
      }}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.stopPropagation()
          cancelled.current = true
          setDraft(shown)
          setInvalid(false)
          onDone?.()
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function RatingEditor({ field, value, onCommit }: EditorProps) {
  const max = parseFieldConfig('rating', field.config).max
  const v = typeof value === 'number' ? value : 0
  return (
    <span className="stars stars-edit" role="radiogroup" aria-label={field.label}>
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={v === i + 1}
          aria-label={t('{n} de {max}', { n: i + 1, max })}
          data-on={i < v}
          onClick={() => onCommit(v === i + 1 ? null : i + 1)}
        >
          ★
        </button>
      ))}
    </span>
  )
}

function RelationEditor({ field, value, onCommit }: EditorProps) {
  const cfg = parseFieldConfig('relation', field.config)
  const nav = useNav()
  const toast = useToast()
  const linked = (value as LinkRef[] | undefined) ?? []
  const [q, setQ] = useState('')
  const [options, setOptions] = useState<LinkRef[]>([])
  useEffect(() => {
    let alive = true
    void call('data:query', { entity: cfg.target }).then((rows) => {
      if (alive) setOptions(rows.map((r) => ({ id: r.id, title: r.title })))
    })
    return () => {
      alive = false
    }
  }, [cfg.target])
  const ids = new Set(linked.map((l) => l.id))
  const matches = options
    .filter((o) => !ids.has(o.id) && norm(o.title).includes(norm(q)))
    .slice(0, 8)
  const exact = options.some((o) => norm(o.title) === norm(q.trim()))
  // En una relación de un solo registro, elegir otro lo sustituye.
  const set = (next: LinkRef[]) => onCommit(next.map((l) => l.id))
  const pick = (m: LinkRef) => {
    set(cfg.multiple ? [...linked, m] : [m])
    setQ('')
  }
  const createAndLink = async () => {
    const title = q.trim()
    if (!title) return
    try {
      const r = await call('data:create', { entity: cfg.target, title })
      pick({ id: r.id, title: r.title })
    } catch {
      toast.show(t('No se pudo crear el registro.'), 'error')
    }
  }
  return (
    <div className="relation-edit">
      {linked.length > 0 && (
        <span className="chips">
          {linked.map((l) => (
            <span key={l.id} className="chip chip-link">
              <button
                type="button"
                className="chip-open"
                aria-label={t('Abrir {title}', { title: l.title })}
                title={t('Abrir {title}', { title: l.title })}
                onClick={() => nav.openRecord(cfg.target, l.id)}
              >
                {l.title}
              </button>
              <button
                type="button"
                className="chip-x"
                aria-label={t('Quitar {title}', { title: l.title })}
                onClick={() => set(linked.filter((x) => x.id !== l.id))}
              >
                ×
              </button>
            </span>
          ))}
        </span>
      )}
      <input
        className="input"
        placeholder={
          cfg.multiple || linked.length === 0 ? t('Buscar o crear para enlazar…') : t('Cambiar…')
        }
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={t('Enlazar en {field}', { field: field.label })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (matches[0]) pick(matches[0])
            else void createAndLink()
          }
          if (e.key === 'Escape' && q) {
            e.stopPropagation()
            setQ('')
          }
        }}
      />
      {q && (
        <ul className="menu-list">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="menu-item" onClick={() => pick(m)}>
                {m.title}
              </button>
            </li>
          ))}
          {!exact && q.trim() && (
            <li>
              <button
                type="button"
                className="menu-item menu-create"
                onClick={() => void createAndLink()}
              >
                + {t('Crear «{name}»', { name: q.trim() })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function newItemId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function ChecklistEditor({ field, value, onCommit }: EditorProps) {
  const items = (value as ChecklistItem[] | undefined) ?? []
  const [text, setText] = useState('')
  const save = (next: ChecklistItem[]) => onCommit(next.length ? next : null)
  const template = parseFieldConfig('checklist', field.config).template ?? []
  const add = () => {
    const s = text.trim()
    if (!s) return
    save([...items, { id: newItemId(), text: s, done: false }])
    setText('')
  }
  return (
    <div className="checklist-edit" role="group" aria-label={field.label}>
      {items.map((it, i) => (
        <div key={it.id} className="checklist-item" data-done={it.done}>
          <input
            type="checkbox"
            className="checkbox"
            checked={it.done}
            aria-label={t('Hecho: {text}', { text: it.text })}
            onChange={() => save(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
          />
          <ItemText
            value={it.text}
            onCommit={(s) =>
              save(
                s.trim()
                  ? items.map((x, j) => (j === i ? { ...x, text: s.trim() } : x))
                  : items.filter((_, j) => j !== i),
              )
            }
          />
          <button
            type="button"
            className="icon-btn"
            aria-label={t('Quitar {title}', { title: it.text })}
            onClick={() => save(items.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      {items.length === 0 && template.length > 0 && (
        <button
          type="button"
          className="btn"
          onClick={() => save(template.map((s) => ({ id: newItemId(), text: t(s), done: false })))}
        >
          {tn(
            template.length,
            'Usar la plantilla ({n} elemento)',
            'Usar la plantilla ({n} elementos)',
          )}
        </button>
      )}
      <input
        className="input"
        placeholder={t('Añadir elemento y pulsar Intro')}
        aria-label={t('Añadir a {field}', { field: field.label })}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
      />
    </div>
  )
}

function ItemText({ value, onCommit }: { value: string; onCommit: (s: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setDraft(value)
  }
  return (
    <input
      className="input input-bare"
      value={draft}
      maxLength={500}
      aria-label={t('Texto del elemento')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

const FREQ_LABELS: Record<RecurrenceFreq, [string, string]> = {
  daily: ['día', 'días'],
  weekly: ['semana', 'semanas'],
  monthly: ['mes', 'meses'],
  yearly: ['año', 'años'],
}

function RecurrenceEditor({ field, value, onCommit }: EditorProps) {
  const parsed = recurrenceSchema.safeParse(value)
  const r = parsed.success ? parsed.data : null
  const set = (patch: Partial<Recurrence>) =>
    onCommit(recurrenceSchema.parse({ ...(r ?? { freq: 'weekly' }), ...patch }))
  if (!r)
    return (
      <div className="recurrence-edit">
        <select
          className="input"
          aria-label={field.label}
          value=""
          onChange={(e) => e.target.value && set({ freq: e.target.value as RecurrenceFreq })}
        >
          <option value="">{t('No se repite')}</option>
          <option value="daily">{t('Cada día')}</option>
          <option value="weekly">{t('Cada semana')}</option>
          <option value="monthly">{t('Cada mes')}</option>
          <option value="yearly">{t('Cada año')}</option>
        </select>
      </div>
    )
  return (
    <div className="recurrence-edit" role="group" aria-label={field.label}>
      <div className="recurrence-row">
        <span className="faint">{t('Cada')}</span>
        <input
          className="input num recurrence-n"
          type="number"
          min={1}
          max={365}
          aria-label={t('Cada cuántos')}
          value={r.interval}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value))
            if (n >= 1 && n <= 365) set({ interval: n })
          }}
        />
        <select
          className="input"
          aria-label={t('Periodo')}
          value={r.freq}
          onChange={(e) => set({ freq: e.target.value as RecurrenceFreq })}
        >
          {RECURRENCE_FREQS.map((f) => (
            <option key={f} value={f}>
              {t(FREQ_LABELS[f][r.interval === 1 ? 0 : 1])}
            </option>
          ))}
        </select>
        <button type="button" className="btn-link" onClick={() => onCommit(null)}>
          {t('No repetir')}
        </button>
      </div>
      {r.freq === 'weekly' && (
        <div className="weekday-toggles" role="group" aria-label={t('Días de la semana')}>
          {weekdayShort().map((d, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={r.weekdays.includes(i)}
              onClick={() =>
                set({
                  weekdays: r.weekdays.includes(i)
                    ? r.weekdays.filter((x) => x !== i)
                    : [...r.weekdays, i].sort(),
                })
              }
            >
              {d}
            </button>
          ))}
        </div>
      )}
      {r.freq === 'monthly' && (
        <div className="recurrence-row">
          <span className="faint">{t('El día')}</span>
          <input
            className="input num recurrence-n"
            type="number"
            min={1}
            max={31}
            aria-label={t('Día del mes')}
            placeholder="—"
            value={r.monthDay ?? ''}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value))
              set({ monthDay: e.target.value === '' ? null : n >= 1 && n <= 31 ? n : r.monthDay })
            }}
          />
          <span className="faint">{t('(vacío: el de la fecha límite)')}</span>
        </div>
      )}
      <select
        className="input"
        aria-label={t('Cuándo se crea la siguiente')}
        value={r.mode}
        onChange={(e) => set({ mode: e.target.value as Recurrence['mode'] })}
      >
        <option value="completion">{t('La siguiente se crea al completarla')}</option>
        <option value="schedule">{t('La siguiente sigue el calendario')}</option>
      </select>
    </div>
  )
}

export function FieldEditor(props: EditorProps) {
  const { field, value, onCommit, autoFocus, onDone, id } = props
  const tz = useTimeZone()
  switch (field.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return <TextLike {...props} value={typeof value === 'string' ? value : ''} />
    case 'number':
    case 'currency':
    case 'percent':
      return <NumberLike {...props} />
    case 'rating':
      return <RatingEditor {...props} />
    case 'date':
      return (
        <input
          id={id}
          className="input"
          type="date"
          value={typeof value === 'string' ? value : ''}
          autoFocus={autoFocus}
          onChange={(e) => onCommit(e.target.value || null)}
          onBlur={() => onDone?.()}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
              e.stopPropagation()
              onDone?.()
            }
          }}
        />
      )
    case 'datetime':
      return (
        <input
          id={id}
          className="input"
          type="datetime-local"
          value={typeof value === 'string' ? toLocalInput(value, tz) : ''}
          autoFocus={autoFocus}
          onChange={(e) => onCommit(fromLocalInput(e.target.value, tz))}
          onBlur={() => onDone?.()}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
              e.stopPropagation()
              onDone?.()
            }
          }}
        />
      )
    case 'checkbox':
      return (
        <input
          id={id}
          type="checkbox"
          className="checkbox"
          checked={value === true}
          autoFocus={autoFocus}
          onChange={(e) => onCommit(e.target.checked)}
          aria-label={field.label}
        />
      )
    case 'select': {
      const opts = parseFieldConfig('select', field.config).options
      return (
        <select
          id={id}
          className="input"
          value={typeof value === 'string' ? value : ''}
          autoFocus={autoFocus}
          onChange={(e) => {
            onCommit(e.target.value || null)
            onDone?.()
          }}
          onBlur={() => onDone?.()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              onDone?.()
            }
          }}
        >
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )
    }
    case 'multiselect': {
      const opts = parseFieldConfig('multiselect', field.config).options
      const sel = new Set(Array.isArray(value) ? (value as string[]) : [])
      return (
        <span className="chips chips-edit" role="group" aria-label={field.label}>
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
                onCommit(opts.filter((x) => next.has(x.id)).map((x) => x.id))
              }}
            >
              <OptionChip option={o} />
            </button>
          ))}
          {opts.length === 0 && (
            <span className="faint">{t('Añade opciones en Ajustes → Campos.')}</span>
          )}
        </span>
      )
    }
    case 'relation':
      return <RelationEditor {...props} />
    case 'checklist':
      return <ChecklistEditor {...props} />
    case 'recurrence':
      return <RecurrenceEditor {...props} />
    case 'files':
      return <FilesEditor {...props} />
    default:
      return <FieldValue field={field} value={value} />
  }
}

/** ¿Se puede editar en una celda de la tabla? (el texto largo se edita en el panel) */
export function isInlineEditable(f: FieldDef): boolean {
  return ![
    'longtext',
    'formula',
    'rollup',
    'files',
    'relation',
    'checklist',
    'recurrence',
  ].includes(f.type)
}
