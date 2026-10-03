import { useCallback } from 'react'
import type { FieldDef } from '@shared/data/fields'
import { call, IpcCallError } from '../lib/ipc'
import { t, tn } from '@shared/i18n'
import { useToast } from '../ui/Toast'

/** Escrituras de registros con aviso de error. Los datos se refrescan solos (data:changed). */
export function useRecordActions() {
  const toast = useToast()
  const fail = useCallback(
    (e: unknown) =>
      toast.show(e instanceof IpcCallError ? e.message : t('No se pudo guardar.'), 'error'),
    [toast],
  )

  const setValue = useCallback(
    async (recordId: string, field: FieldDef, value: unknown) => {
      try {
        if (field.type === 'relation')
          await call('data:setLinks', {
            fieldId: field.id,
            fromId: recordId,
            toIds: (value as string[] | null) ?? [],
          })
        else await call('data:update', { id: recordId, patch: { [field.id]: value } })
      } catch (e) {
        fail(e)
      }
    },
    [fail],
  )

  const create = useCallback(
    async (entity: string, values: Record<string, unknown> = {}) => {
      try {
        return await call('data:create', { entity, values })
      } catch (e) {
        fail(e)
        return null
      }
    },
    [fail],
  )

  const trash = useCallback(
    async (ids: string[]) => {
      try {
        await call('data:trash', { ids })
        toast.show(
          tn(
            ids.length,
            'Enviado a la papelera. Ctrl+Z para deshacer.',
            '{n} registros enviados a la papelera. Ctrl+Z para deshacer.',
          ),
        )
      } catch (e) {
        fail(e)
      }
    },
    [fail, toast],
  )

  const duplicate = useCallback(
    async (id: string) => {
      try {
        return await call('data:duplicate', { id })
      } catch (e) {
        fail(e)
        return null
      }
    },
    [fail],
  )

  return { setValue, create, trash, duplicate, fail }
}
