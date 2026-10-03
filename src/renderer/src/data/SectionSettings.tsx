import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { EntityInfo } from '@shared/ipc'
import { t } from '@shared/i18n'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { useToast } from '../ui/Toast'
import { BriefTemplatesPanel } from './BriefTemplatesSettings'
import { CollectionForm } from './CollectionsSettings'
import { FieldsEditor } from './FieldsSettings'

type Tab = 'campos' | 'plantillas' | 'coleccion'

/**
 * Ajustes de una sección (Notas, Clientes, Briefs, una colección…): sus campos y, según la
 * sección, sus plantillas o el nombre de la colección. Se abren desde la propia sección.
 */
export function SectionSettings({ entity, onClose }: { entity: EntityInfo; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('campos')
  const qc = useQueryClient()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Si hay otro diálogo encima (editar un campo), Escape es para ese.
      if (e.key === 'Escape' && document.querySelectorAll('.dialog').length === 1) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tabs: [Tab, string][] = [
    ['campos', 'Campos'],
    ...(entity.id === 'brief' ? ([['plantillas', 'Plantillas']] as [Tab, string][]) : []),
    ...(entity.custom ? ([['coleccion', 'Colección']] as [Tab, string][]) : []),
  ]
  const singular = entity.singular

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div
        className="dialog dialog-wide section-settings"
        role="dialog"
        aria-label={t('Ajustes de {label}', { label: entity.label })}
        data-testid="section-settings"
      >
        <div className="section-settings-head">
          <div>
            <span className="eyebrow">{t('ajustes de la sección')}</span>
            <h2>{entity.label}</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('Cerrar ajustes')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {tabs.length > 1 && (
          <div
            className="tabs"
            role="tablist"
            aria-label={t('Ajustes de {label}', { label: entity.label })}
          >
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                data-testid={`section-tab-${id}`}
              >
                {t(label)}
              </button>
            ))}
          </div>
        )}
        <div className="section-settings-body">
          {tab === 'campos' && (
            <>
              <p className="muted">
                {t(
                  'Los datos que se guardan de cada {singular}: añade los que necesites, cambia su nombre o sus opciones, ordénalos u ocúltalos. Eliminar un campo no borra sus datos: se puede restaurar.',
                  { singular },
                )}
              </p>
              <FieldsEditor entity={entity.id} />
            </>
          )}
          {tab === 'plantillas' && <BriefTemplatesPanel />}
          {tab === 'coleccion' && (
            <>
              <p className="muted">
                {t(
                  'Nombre de la colección en la barra lateral y en los botones. Para borrarla, ve a Ajustes → Colecciones (tiene que estar vacía).',
                )}
              </p>
              <CollectionForm
                initial={{
                  label: entity.label,
                  singular: singular.charAt(0).toUpperCase() + singular.slice(1),
                  gender: entity.gender,
                  letter: entity.letter ?? '',
                }}
                submit={t('Guardar')}
                onSubmit={async (c) => {
                  setError(null)
                  try {
                    qc.setQueryData(
                      ['data', 'entities'],
                      await call('data:updateCollection', { id: entity.id, ...c }),
                    )
                    toast.show(t('Colección guardada.'))
                    return true
                  } catch (e) {
                    setError(e instanceof IpcCallError ? e.message : t('No se ha podido guardar.'))
                    return false
                  }
                }}
              />
              {error && <Alert>{error}</Alert>}
            </>
          )}
        </div>
      </div>
    </>
  )
}
