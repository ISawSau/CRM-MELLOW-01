import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { findEntity } from '@shared/data/entities'
import { formatDateTime } from '@shared/format'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'

/** Papelera: lo borrado se puede restaurar durante los días configurados. */
export function TrashPage() {
  const toast = useToast()
  const trash = useQuery({ queryKey: ['data', 'trash'], queryFn: () => call('data:trashList', {}) })
  const [confirming, setConfirming] = useState<string[] | null>(null)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.show(ok)
    } catch (e) {
      toast.show(e instanceof IpcCallError ? e.message : 'No se pudo completar.', 'error')
    }
  }

  const items = trash.data?.items ?? []
  return (
    <div className="page" data-testid="page-papelera">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">—</span> papelera
        </span>
        <h1 className="title">Papelera</h1>
        <p className="muted">
          Lo que envías aquí se borra para siempre a los {trash.data?.days ?? 30} días. Cámbialo en
          Ajustes → Datos.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <h2>Vacía</h2>
          <p className="muted">No hay nada en la papelera.</p>
        </div>
      ) : (
        <>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirming(items.map((i) => i.id))}
            >
              Vaciar la papelera
            </button>
          </div>
          <ul className="trash-list" data-testid="trash-list">
            {items.map((i) => (
              <li key={i.id} className="trash-item">
                <span className="trash-title">{i.title}</span>
                <span className="faint">{findEntity(i.entity)?.singular ?? i.entity}</span>
                <span className="faint num">{formatDateTime(new Date(i.deletedAt))}</span>
                <span className="faint">
                  {i.daysLeft === 0
                    ? 'se borra hoy'
                    : `quedan ${i.daysLeft} ${i.daysLeft === 1 ? 'día' : 'días'}`}
                </span>
                <span className="form-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void run(() => call('data:restore', { ids: [i.id] }), 'Restaurado.')
                    }
                  >
                    Restaurar
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setConfirming([i.id])}
                  >
                    Borrar para siempre
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
            <h2 id="purge-t">¿Borrar para siempre?</h2>
            <p className="muted">
              {confirming.length === 1
                ? 'Este registro se borrará sin posibilidad de recuperarlo.'
                : `Se borrarán ${confirming.length} registros sin posibilidad de recuperarlos.`}{' '}
              Esta acción no se puede deshacer.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                autoFocus
                onClick={() => setConfirming(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="confirm-purge"
                onClick={() => {
                  const ids = confirming
                  setConfirming(null)
                  void run(() => call('data:purge', { ids }), 'Borrado para siempre.')
                }}
              >
                Borrar para siempre
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
