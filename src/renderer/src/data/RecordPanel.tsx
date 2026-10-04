import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { diffLines } from '@shared/diff'
import { COMPUTED_TYPES, type FieldDef, type RichText } from '@shared/data/fields'
import { formatValue } from '@shared/data/format-value'
import type { HistoryEntry, LinkRef, RecordRow } from '@shared/data/records'
import { formatDateTime } from '@shared/format'
import { t } from '@shared/i18n'
import { call, IpcCallError } from '../lib/ipc'
import { Popover } from '../ui/Popover'
import { useToast } from '../ui/Toast'
import { useRecordActions } from './actions'
import { useNav } from './nav'
import { FieldEditor } from './FieldEditor'
import { FieldValue } from './FieldValue'
import { useEntityLookup, useHistory, useRecord } from './hooks'
import { RichTextEditor } from './RichTextEditor'
import { ClientAdAccounts } from '../meta/ClientAdAccounts'
import { ComposeMail } from '../gmail/ComposeMail'
import { GmailThreads } from '../gmail/GmailThreads'
import { CreativeAds } from '../meta/CreativeAds'

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
  const entityOf = useEntityLookup()
  const [tab, setTab] = useState<'detalles' | 'historial' | 'versiones'>('detalles')
  const { setValue, trash, duplicate, fail } = useRecordActions()
  const nav = useNav()

  /** Tarea nueva ya enlazada a este cliente o brief (y al cliente del brief). */
  const newLinkedTask = async (rec: RecordRow) => {
    try {
      const tf = await call('data:fields', { entity: 'tarea' })
      const byKey = (k: string) => tf.find((f) => f.key === k)
      const task = await call('data:create', { entity: 'tarea', title: t('Nueva tarea') })
      const cliente = byKey('cliente')
      const brief = byKey('brief')
      if (rec.entity === 'cliente' && cliente)
        await call('data:setLinks', { fieldId: cliente.id, fromId: task.id, toIds: [rec.id] })
      if (rec.entity === 'brief' && brief) {
        await call('data:setLinks', { fieldId: brief.id, fromId: task.id, toIds: [rec.id] })
        const bc = fields.find((f) => f.key === 'cliente')
        const linked = bc ? ((rec.values[bc.id] as LinkRef[] | undefined) ?? []) : []
        if (cliente && linked[0])
          await call('data:setLinks', {
            fieldId: cliente.id,
            fromId: task.id,
            toIds: [linked[0].id],
          })
      }
      nav.openRecord('tarea', task.id)
    } catch (e) {
      fail(e)
    }
  }

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
      <aside className="panel" aria-label={t('Ficha')}>
        <div className="panel-head">
          <span className="eyebrow">{t('registro')}</span>
          <button type="button" className="icon-btn" aria-label={t('Cerrar')} onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted panel-body">{t('Este registro ya no existe.')}</p>
      </aside>
    )
  }
  if (!r) return <aside className="panel" aria-label={t('Ficha')} aria-busy="true" />

  const entity = entityOf(r.entity)
  const titleField = fields.find((f) => f.key === entity?.titleKey && f.system)
  const visible = fields.filter((f) => f.id !== titleField?.id)
  const rich = visible.filter((f) => f.type === 'longtext')
  const props = visible.filter((f) => f.type !== 'longtext')
  const deleted = r.deletedAt !== null

  return (
    <aside
      className="panel"
      aria-label={t('Ficha: {title}', { title: r.title })}
      data-testid="record-panel"
    >
      <div className="panel-head">
        <span className="eyebrow">
          <span className="num">{entity?.singular ?? t('registro')}</span>
        </span>
        <div className="panel-actions">
          {(r.entity === 'cliente' || r.entity === 'brief') && (
            <button
              type="button"
              className="btn"
              disabled={deleted}
              onClick={() => void newLinkedTask(r)}
              data-testid="new-linked-task"
            >
              + {t('Tarea')}
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={deleted}
            onClick={() => void duplicate(r.id).then((d) => d && onOpen(d.id))}
          >
            {t('Duplicar')}
          </button>
          {r.entity === 'brief' && !deleted && <SaveAsTemplate record={r} />}
          <button
            type="button"
            className="btn btn-danger"
            disabled={deleted}
            onClick={() => {
              void trash([r.id])
              onClose()
            }}
          >
            {t('Enviar a la papelera')}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('Cerrar ficha')}
            onClick={onClose}
          >
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
            {t('Detalles')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'historial'}
            onClick={() => setTab('historial')}
          >
            {t('Historial')}
          </button>
          {VERSIONED.has(r.entity) && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'versiones'}
              onClick={() => setTab('versiones')}
            >
              {t('Versiones')}
            </button>
          )}
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
            {r.entity === 'cliente' && <ClientAdAccounts clientId={r.id} />}
            {(r.entity === 'cliente' || r.entity === 'contacto') && (
              <>
                <div className="form-actions">
                  <ComposeMail record={r} />
                </div>
                <GmailThreads key={r.id} recordId={r.id} entity={r.entity} />
              </>
            )}
            {r.entity === 'creatividad' && <CreativeAds recordId={r.id} />}
            <p className="faint panel-meta">
              {t('Creado el {created} · modificado el {updated}', {
                created: formatDateTime(new Date(r.createdAt)),
                updated: formatDateTime(new Date(r.updatedAt)),
              })}
            </p>
          </>
        ) : tab === 'historial' ? (
          <HistoryList record={r} fields={fields} />
        ) : (
          <VersionsTab record={r} fields={fields} />
        )}
      </div>
    </aside>
  )
}

/** Entidades con versiones guardadas (SPEC §7.8). */
const VERSIONED = new Set(['creatividad', 'brief'])

function versionText(field: FieldDef | undefined, v: unknown): string {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return ''
  if (!field) return ''
  if (field.type === 'longtext') return (v as RichText).text
  return formatValue(field, v)
}

function VersionsTab({ record, fields }: { record: RecordRow; fields: FieldDef[] }) {
  const qc = useQueryClient()
  const { fail } = useRecordActions()
  const versions = useQuery({
    queryKey: ['data', 'versions', record.id],
    queryFn: () => call('versions:list', { recordId: record.id }),
  })
  const [note, setNote] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const comparable = fields.filter((f) => !['formula', 'rollup', 'relation'].includes(f.type))
  const current = record.values

  return (
    <div className="versions" data-testid="versions">
      <form
        className="version-new"
        onSubmit={(e) => {
          e.preventDefault()
          void call('versions:create', { recordId: record.id, note })
            .then(() => {
              setNote('')
              return qc.invalidateQueries({ queryKey: ['data', 'versions', record.id] })
            })
            .catch(fail)
        }}
      >
        <input
          className="input"
          placeholder={t('Nota de la versión (opcional)')}
          aria-label={t('Nota de la versión')}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          {t('Guardar versión')}
        </button>
      </form>
      <p className="hint">
        {t(
          'Guarda una versión cuando el copy o la creatividad estén listos para lanzar; así puedes compararla y volver a ella.',
        )}
      </p>
      <ol className="version-list">
        {(versions.data ?? []).map((v) => {
          const changed = comparable.filter(
            (f) => versionText(f, v.data[f.id]) !== versionText(f, current[f.id]),
          )
          return (
            <li key={v.id} className="version">
              <div className="history-head">
                <span>
                  <strong className="num">v{v.number}</strong> {v.note}
                </span>
                <span className="faint num">{formatDateTime(new Date(v.createdAt))}</span>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setOpen(open === v.id ? null : v.id)}
                >
                  {changed.length
                    ? t(
                        open === v.id
                          ? 'Ocultar cambios respecto a ahora ({n})'
                          : 'Ver cambios respecto a ahora ({n})',
                        { n: changed.length },
                      )
                    : t('Igual que ahora')}
                </button>
                {changed.length > 0 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void call('versions:restore', { versionId: v.id }).catch(fail)}
                  >
                    {t('Restaurar v{n}', { n: v.number })}
                  </button>
                )}
              </div>
              {open === v.id && (
                <div className="version-diff">
                  {changed.map((f) =>
                    f.type === 'longtext' ? (
                      <div key={f.id}>
                        <h4 className="panel-subtitle">{f.label}</h4>
                        <pre className="diff">
                          {diffLines(
                            versionText(f, v.data[f.id]),
                            versionText(f, current[f.id]),
                          ).map((l, i) => (
                            <span key={i} className="diff-line" data-kind={l.kind}>
                              {l.kind === 'added' ? '+ ' : l.kind === 'removed' ? '− ' : '  '}
                              {l.text}
                              {'\n'}
                            </span>
                          ))}
                        </pre>
                      </div>
                    ) : (
                      <p key={f.id} className="muted">
                        <strong>{f.label}</strong>: {versionText(f, v.data[f.id]) || t('vacío')} →{' '}
                        {versionText(f, current[f.id]) || t('vacío')}
                      </p>
                    ),
                  )}
                </div>
              )}
            </li>
          )
        })}
        {versions.data?.length === 0 && (
          <li className="faint">{t('Aún no hay versiones guardadas.')}</li>
        )}
      </ol>
    </div>
  )
}

function changeText(field: FieldDef | undefined, v: unknown): string {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return t('vacío')
  if (!field) return '…'
  if (field.type === 'relation') return t('{n} enlazados', { n: (v as string[]).length })
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
            <span>{t(ACTION_LABELS[h.action])}</span>
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

/** Guardar el contenido de un brief como plantilla nueva (fase 12). */
function SaveAsTemplate({ record }: { record: RecordRow }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(record.title)
  return (
    <Popover
      label={t('Guardar como plantilla')}
      button={t('Como plantilla')}
      align="end"
      testId="save-as-template"
      title={t('Guardar este brief como plantilla')}
    >
      {(close) => (
        <form
          className="popover-form"
          onSubmit={(e) => {
            e.preventDefault()
            void call('briefs:saveAsTemplate', { recordId: record.id, name })
              .then((list) => {
                qc.setQueryData(['data', 'brief-templates'], list)
                toast.show(
                  t('Plantilla «{name}» guardada. Edítala en Ajustes.', { name: name.trim() }),
                )
                close()
              })
              .catch((err: unknown) =>
                toast.show(
                  err instanceof IpcCallError ? err.message : t('No se pudo guardar la plantilla.'),
                  'error',
                ),
              )
          }}
        >
          <label htmlFor="tpl-from-brief">{t('Nombre de la plantilla')}</label>
          <input
            id="tpl-from-brief"
            className="input"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="hint">{t('Cada título del contenido será una sección.')}</p>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            {t('Guardar plantilla')}
          </button>
        </form>
      )}
    </Popover>
  )
}
