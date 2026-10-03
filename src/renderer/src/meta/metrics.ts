import { useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@shared/i18n'
import type { MetaTableSettings } from '@shared/meta-metrics'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'

export function useTableSettings() {
  return useQuery({
    queryKey: ['data', 'meta', 'table-settings'],
    queryFn: () => call('meta:tableSettings'),
  })
}

/** Guarda los ajustes de la tabla partiendo siempre de los más recientes. */
export function useSaveTableSettings() {
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['data', 'meta', 'table-settings']
  return (patch: Partial<MetaTableSettings>) => {
    const latest = qc.getQueryData<MetaTableSettings>(key)
    if (!latest) return Promise.resolve()
    const next = { ...latest, ...patch }
    void qc.cancelQueries({ queryKey: key })
    qc.setQueryData(key, next)
    return call('meta:setTableSettings', next)
      .then((s) => qc.setQueryData(key, s))
      .catch((e: unknown) => {
        void qc.invalidateQueries({ queryKey: key })
        toast.show(e instanceof IpcCallError ? e.message : t('No se pudo guardar.'), 'error')
      })
  }
}

export function useActionTypes() {
  return useQuery({
    queryKey: ['data', 'meta', 'action-types'],
    queryFn: () => call('meta:actionTypes'),
  })
}

export { columnLabel, delta, formatMetric, isConfigColumn, metricDefs } from '@shared/metric-format'
