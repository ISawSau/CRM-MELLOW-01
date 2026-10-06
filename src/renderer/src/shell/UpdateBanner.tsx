import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { formatNumber } from '@shared/format'
import { t } from '@shared/i18n'
import type { UpdateStatus } from '@shared/updates'
import { call, subscribe } from '../lib/ipc'

export const UPDATES_KEY = ['data', 'updates', 'status']

const mb = (bytes: number) => formatNumber(bytes / (1024 * 1024), 1)

/** Estado de las versiones nuevas, al día con los eventos del motor (D-114, D-120). */
export function useUpdateStatus() {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: UPDATES_KEY, queryFn: () => call('updates:status') })
  useEffect(
    () =>
      subscribe('updates:changed', () => {
        void qc.invalidateQueries({ queryKey: ['data', 'updates'] })
      }),
    [qc],
  )
  return status
}

/** Avance o resultado de «Actualizar», para el aviso y para Ajustes. */
export function UpdateProgress({ s }: { s: UpdateStatus }) {
  const d = s.download
  if (d.phase === 'downloading')
    return (
      <span className="update-progress" data-testid="update-progress">
        {d.total
          ? t('Bajando la versión {latest}: {done} de {total} MB…', {
              latest: s.latest ?? '',
              done: mb(d.received),
              total: mb(d.total),
            })
          : t('Bajando la versión {latest}…', { latest: s.latest ?? '' })}
        {d.total ? <progress max={d.total} value={d.received} aria-label={t('Descarga')} /> : null}
      </span>
    )
  if (d.phase === 'installing')
    return (
      <span data-testid="update-progress">
        {t('Instalando la versión {latest}: la app se cerrará y se abrirá la nueva.', {
          latest: s.latest ?? '',
        })}
      </span>
    )
  if (d.phase === 'permission')
    return (
      <span data-testid="update-progress">
        {t(
          'Android tiene que permitir a CRM Mellow instalar apps: actívalo en el ajuste que se acaba de abrir, vuelve y pulsa otra vez «Actualizar».',
        )}
      </span>
    )
  if (d.phase === 'command' && d.command)
    return (
      <span className="update-command" data-testid="update-progress">
        {t('Bajada y comprobada. Para instalarla, abre una terminal y pega:')}
        <code data-testid="update-command">{d.command}</code>
        <button
          type="button"
          className="btn btn-link"
          onClick={() => void call('clipboard:writeText', { text: d.command! })}
        >
          {t('Copiar')}
        </button>
      </span>
    )
  if (d.phase === 'error')
    return (
      <span className="update-error" role="alert" data-testid="update-error">
        {t('No se ha podido actualizar: {message}', { message: d.message ?? '' })}
      </span>
    )
  return null
}

/**
 * Aviso de versión nueva (D-114, D-120). El motor consulta GitHub al abrir la bóveda y cada
 * hora; aquí se muestra el resultado. «Actualizar» baja e instala la versión desde la app
 * (si esta instalación lo permite); si no, «Descargar» abre la página de la versión.
 */
export function UpdateBanner() {
  const qc = useQueryClient()
  const status = useUpdateStatus()
  const s = status.data
  if (!s?.show || !s.latest) return null
  const busy = s.download.phase === 'downloading' || s.download.phase === 'installing'
  const dismiss = () =>
    void call('updates:dismiss', { version: s.latest! })
      .then((next) => qc.setQueryData(UPDATES_KEY, next))
      .catch(() => {})
  const install = () =>
    void call('updates:install')
      .then((next) => qc.setQueryData(UPDATES_KEY, next))
      .catch(() => {})
  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <span className="marker" aria-hidden="true" />
      <span>
        {t('Hay una versión nueva de CRM Mellow: {latest} (tienes la {current}).', {
          latest: s.latest,
          current: s.current,
        })}{' '}
        <UpdateProgress s={s} />
      </span>
      {s.canInstall ? (
        <button
          type="button"
          className="btn"
          onClick={install}
          disabled={busy}
          data-testid="update-install"
        >
          {s.download.phase === 'error' ? t('Reintentar') : t('Actualizar')}
        </button>
      ) : (
        <a className="btn" href={s.url} target="_blank" rel="noreferrer">
          {t('Descargar')}
        </a>
      )}
      {s.canInstall && (
        <a className="btn btn-link" href={s.url} target="_blank" rel="noreferrer">
          {t('Novedades')}
        </a>
      )}
      {!busy && (
        <button type="button" className="btn btn-link" onClick={dismiss}>
          {t('Ahora no')}
        </button>
      )}
    </div>
  )
}
