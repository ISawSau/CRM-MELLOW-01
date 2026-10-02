import { useEffect, useState } from 'react'
import { findEntity } from '@shared/data/entities'
import { COMPUTED_TYPES, type FieldDef, type RichText } from '@shared/data/fields'
import { formatValue } from '@shared/data/format-value'
import type { HistoryEntry, RecordRow } from '@shared/data/records'
import { formatDateTime } from '@shared/format'
import { useRecordActions } from './actions'
import { FieldEditor } from './FieldEditor'
import { FieldValue } from './FieldValue'
import { useHistory, useRecord } from './hooks'
import { RichTextEditor } from './RichTextEditor'

const ACTION_LABELS: Record<HistoryEntry['action'], string> = {
  create: 'Creado',
  update: 'Editado',
  delete: 'Enviado a la papelera',
  restore: 'Restaurado',
}

/** Panel lateral con la ficha completa de un registro. */
export function RecordPanel({
  id,
  fields,
  onClose,
  onOpen,
}: {
  id: string
  fields: FieldDef[]
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const record = useRecord(id)
  const [tab, setTab] = useState<'detalles' | 'historial'>('detalles')
  const { setValue, trash, duplicate } = useRecordActions()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const r = record.data
  if (record.isError) {
    return (
      <aside className="panel" aria-label="Ficha">
        <div className="panel-head">
          <span className="eyebrow">registro</span>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted panel-body">Este registro ya no existe.</p>
      </aside>
    )
  }
  if (!r) return <aside className="panel" aria-label="Ficha" aria-busy="true" />

  const entity = findEntity(r.entity)
  const titleField = fields.find((f) => f.key === entity?.titleKey && f.system)
  const visible = fields.filter((f) => f.id !== titleField?.id)
  const rich = visible.filter((f) => f.type === 'longtext')
  const props = visible.filter((f) => f.type !== 'longtext')
  const deleted = r.deletedAt !== null

  return (
    <aside className="panel" aria-label={`Ficha: ${r.title}`} data-testid="record-panel">
      <div className="panel-head">
        <span className="eyebrow">
          <span className="num">{entity?.singular ?? 'registro'}</span>
        </span>
        <div className="panel-actions">
          <button
            type="button"
            className="btn"
            disabled={deleted}
            onClick={() => void duplicate(r.id).then((d) => d && onOpen(d.id))}
          >
            Duplicar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={deleted}
            onClick={() => {
              void trash([r.id])
              onClose()
            }}
          >
            Enviar a la papelera
          </button>
          <button type="button" className="icon-btn" aria-label="Cerrar ficha" onClick={onClose}>
            ×
          </button>
        </div>
      </div>

      <div className="panel-body">
        {titleField && (
          <div className="panel-title">
            <FieldEditor
              key={r.id}
              field={titleField}
              value={r.values[titleField.id]}
              onCommit={(v) => void setValue(r.id, titleField, v)}
              id="panel-title"
            />
            <label htmlFor="panel-title" className="sr-only">
              {titleField.label}
            </label>
          </div>
        )}

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'detalles'}
            onClick={() => setTab('detalles')}
          >
            Detalles
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'historial'}
            onClick={() => setTab('historial')}
          >
            Historial
          </button>
        </div>

        {tab === 'detalles' ? (
          <>
            <dl className="props">
              {props.map((f) => (
                <div key={f.id} className="prop">
                  <dt>
                    <label htmlFor={`prop-${f.id}`}>{f.label}</label>
                  </dt>
                  <dd>
                    {COMPUTED_TYPES.includes(f.type) ? (
                      <FieldValue field={f} value={r.values[f.id]} />
                    ) : (
                      <FieldEditor
                        key={`${r.id}:${f.id}`}
                        id={`prop-${f.id}`}
                        field={f}
                        value={r.values[f.id]}
                        onCommit={(v) => void setValue(r.id, f, v)}
                      />
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {rich.map((f) => (
              <section key={f.id} className="panel-rich">
                <h3 className="panel-subtitle">{f.label}</h3>
                <RichTextEditor
                  key={`${r.id}:${f.id}`}
                  label={f.label}
                  value={(r.values[f.id] as RichText | undefined) ?? null}
                  onCommit={(v) => void setValue(r.id, f, v)}
                />
              </section>
            ))}
            <p className="faint panel-meta">
              Creado el {formatDateTime(new Date(r.createdAt))} · modificado el{' '}
              {formatDateTime(new Date(r.updatedAt))}
            </p>
          </>
        ) : (
          <HistoryList record={r} fields={fields} />
        )}
      </div>
    </aside>
  )
}

function changeText(field: FieldDef | undefined, v: unknown): string {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return 'vacío'
  if (!field) return '…'
  if (field.type === 'relation') return `${(v as string[]).length} enlazados`
  return formatValue(field, v) || '…'
}

function HistoryList({ record, fields }: { record: RecordRow; fields: FieldDef[] }) {
  const history = useHistory(record.id)
  const map = new Map(fields.map((f) => [f.id, f]))
  if (!history.data) return null
  return (
    <ol className="history" data-testid="history">
      {history.data.map((h) => (
        <li key={h.id}>
          <div className="history-head">
            <span>{ACTION_LABELS[h.action]}</span>
            <span className="faint num">{formatDateTime(new Date(h.at))}</span>
          </div>
          {h.action === 'update' && (
            <ul>
              {h.changes.map((c) => (
                <li key={c.fieldId} className="muted">
                  <strong>{c.label}</strong>: {changeText(map.get(c.fieldId), c.from)} →{' '}
                  {changeText(map.get(c.fieldId), c.to)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
