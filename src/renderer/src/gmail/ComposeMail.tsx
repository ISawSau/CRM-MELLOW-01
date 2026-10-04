import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { LinkRef, RecordRow } from '@shared/data/records'
import { currentLocale, formatDate } from '@shared/format'
import { t } from '@shared/i18n'
import {
  fillTemplate,
  gmailComposeUrl,
  mailtoUrl,
  type MailTemplate,
  type MailVariable,
} from '@shared/mail-templates'
import { useFields } from '../data/hooks'
import { useProfile, useTimeZone } from '../data/nav'
import { call } from '../lib/ipc'
import { useToast } from '../ui/Toast'

export function useMailTemplates() {
  return useQuery({
    queryKey: ['data', 'mail', 'templates'],
    queryFn: () => call('mail:templates'),
  })
}

/** Valores de las variables para un cliente o contacto. */
function useVariables(record: RecordRow): Partial<Record<MailVariable, string>> {
  const profile = useProfile().data
  const tz = useTimeZone()
  const fields = useFields(record.entity).data
  return useMemo(() => {
    let cliente = record.entity === 'cliente' ? record.title : ''
    if (record.entity === 'contacto') {
      const f = fields?.find((x) => x.key === 'cliente')
      const links = f ? (record.values[f.id] as LinkRef[] | undefined) : undefined
      cliente = links?.[0]?.title ?? ''
    }
    const now = new Date()
    return {
      nombre: record.title,
      cliente,
      mi_nombre: profile?.name ?? '',
      empresa: profile?.company ?? '',
      fecha: formatDate(now, tz),
      mes: new Intl.DateTimeFormat(currentLocale(), { month: 'long', timeZone: tz }).format(now),
    }
  }, [record, fields, profile, tz])
}

/**
 * «Escribir correo» en la ficha de un cliente o contacto (D-098): plantilla rellena con sus
 * datos, que se abre en Gmail o en el programa de correo para revisarla y enviarla allí.
 */
export function ComposeMail({ record }: { record: RecordRow }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => setOpen(true)}
        data-testid="compose-mail"
      >
        {t('Escribir correo…')}
      </button>
      {open && <ComposeDialog record={record} onClose={() => setOpen(false)} />}
    </>
  )
}

function ComposeDialog({ record, onClose }: { record: RecordRow; onClose: () => void }) {
  const toast = useToast()
  const templates = useMailTemplates().data ?? []
  const addresses = useQuery({
    queryKey: ['data', 'mail', 'addresses', record.id],
    queryFn: () => call('mail:addresses', { recordId: record.id }),
  })
  const vars = useVariables(record)
  const [to, setTo] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [picked, setPicked] = useState('')
  const recipients = (to ?? (addresses.data ?? []).join(', '))
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  const use = (tpl: MailTemplate | undefined) => {
    setPicked(tpl?.id ?? '')
    setSubject(tpl ? fillTemplate(tpl.subject, vars) : '')
    setBody(tpl ? fillTemplate(tpl.body, vars) : '')
  }
  const ready = recipients.length > 0 && (subject.trim() !== '' || body.trim() !== '')
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-label={t('Escribir correo')}
        data-testid="compose-dialog"
      >
        <h2>{t('Escribir correo')}</h2>
        <p className="muted">
          {t(
            'La app no envía correos: se abre en Gmail o en tu programa de correo para que lo revises y lo envíes desde allí.',
          )}
        </p>
        <div className="field">
          <label htmlFor="mail-template">{t('Plantilla')}</label>
          <select
            id="mail-template"
            className="input"
            value={picked}
            onChange={(e) => use(templates.find((x) => x.id === e.target.value))}
          >
            <option value="">{t('Sin plantilla')}</option>
            {templates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="mail-to">{t('Para')}</label>
          <input
            id="mail-to"
            className="input"
            value={to ?? (addresses.data ?? []).join(', ')}
            placeholder={t('correo@ejemplo.com')}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="mail-subject">{t('Asunto')}</label>
          <input
            id="mail-subject"
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="mail-body">{t('Texto')}</label>
          <textarea
            id="mail-body"
            className="input"
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div className="form-actions">
          <a
            className="btn btn-primary"
            href={ready ? gmailComposeUrl(recipients, subject, body) : undefined}
            aria-disabled={!ready}
            target="_blank"
            rel="noreferrer"
            data-testid="compose-gmail"
          >
            {t('Abrir en Gmail')}
          </a>
          <a
            className="btn"
            href={ready ? mailtoUrl(recipients, subject, body) : undefined}
            aria-disabled={!ready}
            target="_blank"
            rel="noreferrer"
            data-testid="compose-mailto"
          >
            {t('Abrir en mi programa de correo')}
          </a>
          <button
            type="button"
            className="btn"
            disabled={!body.trim() && !subject.trim()}
            onClick={() =>
              void call('clipboard:writeText', { text: `${subject}\n\n${body}`.trim() })
                .then(() => toast.show(t('Correo copiado.')))
                .catch(() => toast.show(t('No se han podido copiar.'), 'error'))
            }
          >
            {t('Copiar')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('Cerrar')}
          </button>
        </div>
      </div>
    </>
  )
}
