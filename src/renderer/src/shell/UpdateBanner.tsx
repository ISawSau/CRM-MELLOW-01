import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { t } from '@shared/i18n'
import { call, subscribe } from '../lib/ipc'

/**
 * Aviso de versión nueva (D-114). El motor consulta GitHub como mucho una vez al día;
 * aquí solo se lee su resultado. Se puede cerrar para esa versión o apagar en Ajustes.
 */
export function UpdateBanner() {
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: ['data', 'updates', 'status'],
    queryFn: () => call('updates:status'),
  })
  useEffect(
    () =>
      subscribe('updates:changed', () => {
        void qc.invalidateQueries({ queryKey: ['data', 'updates'] })
      }),
    [qc],
  )
  const s = status.data
  if (!s?.show || !s.latest) return null
  const dismiss = () =>
    void call('updates:dismiss', { version: s.latest! })
      .then((next) => qc.setQueryData(['data', 'updates', 'status'], next))
      .catch(() => {})
  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <span className="marker" aria-hidden="true" />
      <span>
        {t('Hay una versión nueva de CRM Mellow: {latest} (tienes la {current}).', {
          latest: s.latest,
          current: s.current,
        })}
      </span>
      <a className="btn" href={s.url} target="_blank" rel="noreferrer">
        {t('Descargar')}
      </a>
      <button type="button" className="btn btn-link" onClick={dismiss}>
        {t('Ahora no')}
      </button>
    </div>
  )
}
