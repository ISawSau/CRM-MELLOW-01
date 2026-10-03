import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { CollectionInput } from '@shared/data/collections'
import type { EntityInfo } from '@shared/ipc'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { useToast } from '../ui/Toast'
import { useEntities } from './hooks'

const firstLetter = (s: string) =>
  s
    .trim()
    .charAt(0)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/, '')

/** Nombre, singular, género y letra de una colección. */
export function CollectionForm({
  initial,
  submit,
  onSubmit,
  extra,
}: {
  initial: CollectionInput
  submit: string
  onSubmit: (c: CollectionInput) => Promise<boolean>
  extra?: React.ReactNode
}) {
  const [c, setC] = useState(initial)
  const [letterTouched, setLetterTouched] = useState(initial.letter !== '')
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<CollectionInput>) => setC((x) => ({ ...x, ...patch }))
  const ok = c.label.trim() && c.singular.trim() && /^[A-ZÑ0-9]$/u.test(c.letter)
  const prefix = initial.label ? `${initial.label}: ` : ''
  return (
    <form
      className="collection-form"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        void onSubmit(c)
          .then((done) => {
            if (done && !initial.label) {
              setC(initial)
              setLetterTouched(false)
            }
          })
          .finally(() => setBusy(false))
      }}
    >
      <div className="field">
        <label>
          Nombre (en plural)
          <input
            className="input"
            aria-label={`${prefix}Nombre (en plural)`}
            maxLength={40}
            placeholder="Proveedores"
            value={c.label}
            onChange={(e) =>
              set({
                label: e.target.value,
                ...(letterTouched ? {} : { letter: firstLetter(e.target.value) }),
              })
            }
          />
        </label>
      </div>
      <div className="field">
        <label>
          En singular
          <input
            className="input"
            aria-label={`${prefix}En singular`}
            maxLength={40}
            placeholder="Proveedor"
            value={c.singular}
            onChange={(e) => set({ singular: e.target.value })}
          />
        </label>
      </div>
      <div className="field">
        <label>
          Género
          <select
            className="input"
            aria-label={`${prefix}Género`}
            value={c.gender}
            onChange={(e) => set({ gender: e.target.value as 'f' | 'm' })}
          >
            <option value="m">Masculino</option>
            <option value="f">Femenino</option>
          </select>
        </label>
      </div>
      <div className="field collection-letter">
        <label>
          Letra
          <input
            className="input mono"
            aria-label={`${prefix}Letra`}
            maxLength={1}
            value={c.letter}
            onChange={(e) => {
              setLetterTouched(true)
              set({ letter: e.target.value.toUpperCase() })
            }}
          />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={!ok || busy}>
          {submit}
        </button>
        {extra}
      </div>
    </form>
  )
}

export const EMPTY_COLLECTION: CollectionInput = {
  label: '',
  singular: '',
  gender: 'm',
  letter: '',
}

/** Ajustes → Colecciones (SPEC §6, fase 12). */
export function CollectionsSettings() {
  const qc = useQueryClient()
  const toast = useToast()
  const custom = (useEntities().data ?? []).filter((e) => e.custom)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<EntityInfo | null>(null)

  const run = async (p: Promise<EntityInfo[]>, ok: string): Promise<boolean> => {
    setError(null)
    try {
      qc.setQueryData(['data', 'entities'], await p)
      toast.show(ok)
      return true
    } catch (e) {
      setError(e instanceof IpcCallError ? e.message : 'No se ha podido guardar.')
      return false
    }
  }

  return (
    <section className="settings-block" data-testid="collections-settings">
      <div>
        <h2>Colecciones</h2>
        <p className="desc">
          Tablas propias para lo que necesites (proveedores, ideas, equipos…). Cada colección
          aparece en la barra lateral y funciona como las demás: campos, vistas, relaciones,
          fórmulas, búsqueda y papelera. Sus campos se añaden desde la propia colección, con «⚙
          Ajustes».
        </p>
      </div>
      <div className="settings-body settings-body-wide">
        {custom.length > 0 && (
          <ul className="collection-list">
            {custom.map((e) => (
              <li key={e.id}>
                <CollectionForm
                  initial={{
                    label: e.label,
                    singular: e.singular.charAt(0).toUpperCase() + e.singular.slice(1),
                    gender: e.gender,
                    letter: e.letter ?? '',
                  }}
                  submit="Guardar"
                  onSubmit={(c) =>
                    run(call('data:updateCollection', { id: e.id, ...c }), 'Colección guardada.')
                  }
                  extra={
                    <button type="button" className="btn btn-danger" onClick={() => setConfirm(e)}>
                      Borrar…
                    </button>
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <h3 className="panel-subtitle">Nueva colección</h3>
        <CollectionForm
          initial={EMPTY_COLLECTION}
          submit="Crear colección"
          onSubmit={(c) =>
            run(
              call('data:createCollection', c),
              `«${c.label.trim()}» ya está en la barra lateral.`,
            )
          }
        />
        {error && <Alert>{error}</Alert>}
      </div>
      {confirm && (
        <>
          <div className="overlay" onClick={() => setConfirm(null)} />
          <div className="dialog" role="dialog" aria-label="Borrar colección">
            <h2>¿Borrar la colección «{confirm.label}»?</h2>
            <p className="muted">
              Solo se puede borrar vacía: se borran sus campos, sus vistas y lo que tenga en la
              papelera. No se puede deshacer.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  void run(call('data:deleteCollection', { id: confirm.id }), 'Colección borrada.')
                  setConfirm(null)
                }}
              >
                Borrar colección
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
