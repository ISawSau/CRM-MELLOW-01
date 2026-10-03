import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatDate, formatDateTime } from '@shared/format'
import { gmailThreadUrl, type GmailThread } from '@shared/gmail'
import { t } from '@shared/i18n'
import { call, IpcCallError } from '../lib/ipc'
import { useTimeZone } from '../data/nav'
import { useGmailStatus } from './gmail'

/** Hilos de Gmail de un cliente (con sus contactos) o de un contacto, en su ficha. */
export function GmailThreads({ recordId, entity }: { recordId: string; entity: string }) {
  const status = useGmailStatus()
  const connected = status?.connected === true
  const qc = useQueryClient()
  const tz = useTimeZone()
  const [open, setOpen] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const key = ['data', 'gmail', 'threads', recordId]
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      call('gmail:threads', { recordId, pageToken: pageParam, refresh: false }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextPageToken,
    enabled: connected,
    retry: false,
    staleTime: 60_000,
  })

  if (!status) return null
  const pages = q.data?.pages ?? []
  const threads = pages.flatMap((p) => p.threads)
  const addresses = pages[0]?.addresses ?? []

  const when = (iso: string) => {
    const d = new Date(iso)
    return formatDate(d, tz) === formatDate(new Date(), tz)
      ? formatDateTime(d, tz).slice(-5)
      : formatDate(d, tz)
  }

  return (
    <section className="panel-rich gmail" data-testid="gmail-threads">
      <div className="gmail-head">
        <h3 className="panel-subtitle">{t('Correo')}</h3>
        {connected && addresses.length > 0 && (
          <button
            type="button"
            className="btn-link"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true)
              void call('gmail:threads', { recordId, pageToken: null, refresh: true })
                .then(() => qc.resetQueries({ queryKey: key }))
                .catch(() => {})
                .finally(() => setRefreshing(false))
            }}
          >
            {refreshing ? t('Actualizando…') : t('Actualizar')}
          </button>
        )}
      </div>
      {!connected ? (
        <p className="hint">{t('Conecta Gmail en Ajustes para ver aquí los correos.')}</p>
      ) : q.isError ? (
        <p className="danger-text">
          {q.error instanceof IpcCallError ? q.error.message : t('No se ha podido leer el correo.')}
        </p>
      ) : q.isPending ? (
        <p className="faint">{t('Buscando en Gmail…')}</p>
      ) : addresses.length === 0 ? (
        <p className="hint">
          {entity === 'cliente'
            ? t('Añade un email al cliente o a sus contactos para ver aquí sus correos.')
            : t('Añade un email para ver aquí sus correos.')}
        </p>
      ) : (
        <>
          <p className="faint gmail-addresses">
            {t('Con {addresses}', { addresses: addresses.join(', ') })}
          </p>
          {threads.length === 0 ? (
            <p className="hint">{t('No hay correos con estas direcciones.')}</p>
          ) : (
            <ul className="gmail-list">
              {threads.map((th) => (
                <ThreadItem
                  key={th.id}
                  thread={th}
                  open={open === th.id}
                  onToggle={() => setOpen(open === th.id ? null : th.id)}
                  when={when}
                  email={status.email}
                />
              ))}
            </ul>
          )}
          {q.hasNextPage && (
            <button
              type="button"
              className="btn"
              disabled={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {q.isFetchingNextPage ? t('Cargando…') : t('Cargar más')}
            </button>
          )}
        </>
      )}
    </section>
  )
}

function ThreadItem({
  thread: th,
  open,
  onToggle,
  when,
  email,
}: {
  thread: GmailThread
  open: boolean
  onToggle: () => void
  when: (iso: string) => string
  email: string | null
}) {
  return (
    <li className="gmail-thread" data-unread={th.unread} data-testid="gmail-thread">
      <button type="button" className="gmail-summary" aria-expanded={open} onClick={onToggle}>
        <span className="gmail-line">
          <span className="gmail-subject">{th.subject}</span>
          <span className="faint num">{when(th.lastDate)}</span>
        </span>
        <span className="gmail-line">
          <span className="muted gmail-who">
            {th.participants.join(', ')}
            {th.count > 1 ? ` (${th.count})` : ''}
          </span>
          {th.unread && <span className="chip">{t('sin leer')}</span>}
        </span>
        {!open && <span className="faint gmail-snippet">{th.snippet}</span>}
      </button>
      {open && (
        <div className="gmail-messages">
          <ol>
            {th.messages.map((m) => (
              <li key={m.id}>
                <span className="gmail-line">
                  <strong>{m.from}</strong>
                  <span className="faint num">{when(m.date)}</span>
                </span>
                <span className="gmail-snippet">{m.snippet}</span>
              </li>
            ))}
          </ol>
          <a href={gmailThreadUrl(th.id, email)} target="_blank" rel="noreferrer">
            {t('Abrir en Gmail')}
          </a>
        </div>
      )}
    </li>
  )
}
