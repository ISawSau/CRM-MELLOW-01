import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import type { FieldDef } from '@shared/data/fields'
import type { DataChange, UndoState } from '@shared/data/records'
import type { Filter, Sort, View } from '@shared/data/views'
import { call, subscribe } from '../lib/ipc'

/**
 * Datos del motor en la interfaz. Todo cuelga de la clave ['data', …]: cualquier
 * cambio que avise el proceso principal invalida esas consultas y React Query
 * vuelve a pedir solo las que están en pantalla.
 */

export const NO_UNDO: UndoState = {
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
}

export function useDataEvents() {
  const qc = useQueryClient()
  useEffect(
    () =>
      subscribe('data:changed', (c: DataChange) => {
        qc.setQueryData(['undo'], c.undo)
        void qc.invalidateQueries({ queryKey: ['data'] })
      }),
    [qc],
  )
}

export function useUndoState(): UndoState {
  const q = useQuery({ queryKey: ['undo'], queryFn: () => call('data:undoState') })
  return q.data ?? NO_UNDO
}

export function useEntities() {
  return useQuery({
    queryKey: ['data', 'entities'],
    queryFn: () => call('data:entities'),
    staleTime: Infinity,
  })
}

export function useFields(entity: string, includeDeleted = false) {
  return useQuery({
    queryKey: ['data', 'fields', entity, includeDeleted],
    queryFn: () => call('data:fields', { entity, includeDeleted }),
  })
}

export function useViews(entity: string) {
  return useQuery({
    queryKey: ['data', 'views', entity],
    queryFn: () => call('data:views', { entity }),
  })
}

export function useRecords(
  entity: string,
  opts: { filters: Filter[]; match: 'all' | 'any'; sorts: Sort[] },
) {
  return useQuery({
    queryKey: ['data', 'records', entity, opts],
    queryFn: () => call('data:query', { entity, ...opts }),
    placeholderData: keepPreviousData,
  })
}

export function useRecord(id: string | null) {
  return useQuery({
    queryKey: ['data', 'record', id],
    queryFn: () => call('data:get', { id: id! }),
    enabled: id !== null,
  })
}

export function useHistory(id: string) {
  return useQuery({
    queryKey: ['data', 'history', id],
    queryFn: () => call('data:history', { id }),
  })
}

/** Guarda la configuración de una vista y actualiza la caché sin esperar a recargar. */
export function useSaveView(entity: string) {
  const qc = useQueryClient()
  return useCallback(
    async (id: string, patch: { name?: string; config?: Partial<View['config']> }) => {
      qc.setQueryData<View[]>(['data', 'views', entity], (old) =>
        old?.map((v) =>
          v.id === id
            ? { ...v, name: patch.name ?? v.name, config: { ...v.config, ...patch.config } }
            : v,
        ),
      )
      const saved = await call('data:updateView', { id, ...patch })
      qc.setQueryData<View[]>(['data', 'views', entity], (old) =>
        old?.map((v) => (v.id === id ? saved : v)),
      )
      return saved
    },
    [qc, entity],
  )
}

export const byId = (fields: FieldDef[] | undefined) =>
  new Map((fields ?? []).map((f) => [f.id, f]))
