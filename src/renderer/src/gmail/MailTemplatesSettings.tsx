import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { t } from '@shared/i18n'
import {
  MAIL_VARIABLES,
  MAX_MAIL_TEMPLATES,
  type MailTemplate,
  type MailVariable,
} from '@shared/mail-templates'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { useToast } from '../ui/Toast'
import { useMailTemplates } from './ComposeMail'

const newId = () => `p-${Date.now().toString(36)}`

/** Ajustes → Plantillas de correo (D-098). */
export function MailTemplatesSettings() {
  const qc = useQueryClient()
  const toast = useToast()
  const list = useMailTemplates().data ?? []
  const [editing, setEditing] = useState<MailTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async (next: MailTemplate[], ok: string) => {
    setError(null)
    try {
      qc.setQueryData(
        ['data', 'mail', 'templates'],
        await call('mail:setTemplates', { templates: next }),
      )
      toast.show(ok)
      return true
    } catch (e) {
      setError(e instanceof IpcCallError ? e.message : t('No se ha podido guardar.'))
      return false
    }
  }

  return (
    <section className="settings-block" data-testid="mail-templates-settings">
      <div>
        <h2>{t('Plantillas de correo')}</h2>
        <p className="desc">
          {t(
            'Textos que usas a menudo. En la ficha de un cliente o contacto, «Escribir correo…» los rellena con sus datos y los abre en Gmail o en tu programa de correo.',
          )}
        </p>
      </div>
      <div className="settings-body settings-body-wide">
        <ul className="mail-template-list">
          {list.map((m) => (
            <li key={m.id}>
              <div>
                <strong>{m.name}</strong>
                <span className="faint">{m.subject}</span>
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setEditing(m)}>
                  {t('Editar')}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() =>
                    void save(
                      list.filter((x) => x.id !== m.id),
                      t('Plantilla borrada.'),
                    )
                  }
                >
                  {t('Borrar')}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!editing && list.length < MAX_MAIL_TEMPLATES && (
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setEditing({ id: newId(), name: '', subject: '', body: '' })}
              data-testid="mail-template-new"
            >
              {t('Nueva plantilla')}
            </button>
          </div>
        )}
        {editing && (
          <TemplateForm
            key={editing.id}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSave={async (tpl) => {
              const exists = list.some((x) => x.id === tpl.id)
              const next = exists ? list.map((x) => (x.id === tpl.id ? tpl : x)) : [...list, tpl]
              if (await save(next, t('Plantilla guardada.'))) setEditing(null)
            }}
          />
        )}
        {error && <Alert>{error}</Alert>}
      </div>
    </section>
  )
}

function TemplateForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: MailTemplate
  onSave: (t: MailTemplate) => Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const set = (patch: Partial<MailTemplate>) => setDraft((d) => ({ ...d, ...patch }))
  return (
    <form
      className="form mail-template-form"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave({ ...draft, name: draft.name.trim() })
      }}
      data-testid="mail-template-form"
    >
      <div className="field">
        <label htmlFor="tpl-name">{t('Nombre de la plantilla')}</label>
        <input
          id="tpl-name"
          className="input"
          maxLength={80}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="tpl-subject">{t('Asunto')}</label>
        <input
          id="tpl-subject"
          className="input"
          maxLength={300}
          value={draft.subject}
          onChange={(e) => set({ subject: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="tpl-body">{t('Texto')}</label>
        <textarea
          id="tpl-body"
          className="input"
          rows={8}
          maxLength={10_000}
          value={draft.body}
          onChange={(e) => set({ body: e.target.value })}
        />
      </div>
      <p className="hint">
        {t('Variables:')}{' '}
        {(Object.keys(MAIL_VARIABLES) as MailVariable[]).map((v, i) => (
          <span key={v}>
            {i > 0 && ' · '}
            <code title={t(MAIL_VARIABLES[v])}>{`{${v}}`}</code>
          </span>
        ))}
      </p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={!draft.name.trim()}>
          {t('Guardar plantilla')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t('Cancelar')}
        </button>
      </div>
    </form>
  )
}
