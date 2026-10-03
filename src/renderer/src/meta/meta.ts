import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { MetaStatus } from '@shared/meta'
import { call, subscribe } from '../lib/ipc'

/** Estado de Meta, al día con los avisos del proceso principal. */
export function useMetaStatus() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['data', 'meta', 'status'], queryFn: () => call('meta:status') })
  useEffect(
    () =>
      subscribe('meta:changed', (s: MetaStatus) => {
        qc.setQueryData(['data', 'meta', 'status'], s)
        // Han podido llegar métricas o cambiar las cuentas.
        void qc.invalidateQueries({
          queryKey: ['data', 'meta'],
          predicate: (query) => query.queryKey[2] !== 'status',
        })
      }),
    [qc],
  )
  return q.data
}

export function useMetaAccounts() {
  return useQuery({ queryKey: ['data', 'meta', 'accounts'], queryFn: () => call('meta:accounts') })
}

/** Estado efectivo de entrega (effective_status de la API) en español. */
export const DELIVERY_LABELS: Record<string, string> = {
  ACTIVE: 'Activa',
  PAUSED: 'Pausada',
  DELETED: 'Eliminada',
  ARCHIVED: 'Archivada',
  CAMPAIGN_PAUSED: 'Campaña pausada',
  ADSET_PAUSED: 'Conjunto pausado',
  IN_PROCESS: 'En proceso',
  WITH_ISSUES: 'Con problemas',
  PENDING_REVIEW: 'En revisión',
  DISAPPROVED: 'Rechazado',
  PREAPPROVED: 'Preaprobado',
  PENDING_BILLING_INFO: 'Falta el pago',
}

export function deliveryTone(status: string | null): string {
  if (status === 'ACTIVE') return 'verde'
  if (status === 'WITH_ISSUES' || status === 'DISAPPROVED') return 'vino'
  if (status === 'PENDING_REVIEW' || status === 'IN_PROCESS') return 'ambar'
  return 'gris'
}

// Periodos compartidos con Análisis.
export { RANGE_LABELS, rangeFor, type RangePreset } from '@shared/analysis'

/** «2026-10-03» → «03/10/2026» */
export function isoToEs(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
