import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { formatDateTime } from '@shared/format'
import { t, tn } from '@shared/i18n'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { useEntityLookup } from './hooks'

/** Papelera: lo borrado se puede restaurar durante los días configurados. */
export function TrashPage() {
  const toast = useToast()
  const entityOf = useEntityLookup()
  const trash = useQuery({ queryKey: ['data', 'trash'], queryFn: () => call('data:trashList', {}) })
  const [confirming, setConfirming] = useState<string[] | null>(null)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.show(ok)
    } catch (e) {
      toast.show(e instanceof IpcCallError ? e.message : t('No se pudo completar.'), 'error')
    }
  }

  const items = trash.data?.items ?? []
  return (
    <div className="page" data-testid="page-papelera">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">—</span> {t('papelera')}
        </span>
        <h1 className="title">{t('Papelera')}</h1>
        <p className="muted">
          {t(
            'Lo que envías aquí se borra para siempre a los {n} días. Cámbialo en Ajustes → Datos.',
            {
              n: trash.data?.days ?? 30,
            },
          )}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <h2>{t('Vacía')}</h2>
          <p className="muted">{t('No hay nada en la papelera.')}</p>
        </div>
      ) : (
        <>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirming(items.map((i) => i.id))}
            >
              {t('Vaciar la papelera')}
            </button>
          </div>
          <ul className="trash-list" data-testid="trash-list">
            {items.map((i) => (
              <li key={i.id} className="trash-item">
                <span className="trash-title">{i.title}</span>
                <span className="faint">{entityOf(i.entity)?.singular ?? i.entity}</span>
                <span className="faint num">{formatDateTime(new Date(i.deletedAt))}</span>
                <span className="faint">
                  {i.daysLeft === 0
                    ? t('se borra hoy')
                    : tn(i.daysLeft, 'quedan {n} día', 'quedan {n} días')}
                </span>
                <span className="form-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void run(() => call('data:restore', { ids: [i.id] }), t('Restaurado.'))
                    }
                  >
                    {t('Restaurar')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setConfirming([i.id])}
                  >
                    {t('Borrar para siempre')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {confirming && (
        <>
          <div className="overlay" onClick={() => setConfirming(null)} />
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="purge-t">
            <h2 id="purge-t">{t('¿Borrar para siempre?')}</h2>
            <p className="muted">
              {confirming.length === 1
                ? t('Este registro se borrará sin posibilidad de recuperarlo.')
                : t('Se borrarán {n} registros sin posibilidad de recuperarlos.', {
                    n: confirming.length,
                  })}{' '}
              {t('Esta acción no se puede deshacer.')}
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                autoFocus
                onClick={() => setConfirming(null)}
              >
                {t('Cancelar')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="confirm-purge"
                onClick={() => {
                  const ids = confirming
                  setConfirming(null)
                  void run(() => call('data:purge', { ids }), t('Borrado para siempre.'))
                }}
              >
                {t('Borrar para siempre')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
