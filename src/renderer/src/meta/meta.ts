import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { shiftDate } from '@shared/data/dates'
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

export type RangePreset = 'today' | 'yesterday' | '7d' | '14d' | '30d' | 'month' | 'lastMonth'

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  '7d': 'Últimos 7 días',
  '14d': 'Últimos 14 días',
  '30d': 'Últimos 30 días',
  month: 'Este mes',
  lastMonth: 'Mes pasado',
}

/** Fechas del rango (en la zona de la cuenta). Los «últimos N días» no incluyen hoy. */
export function rangeFor(preset: RangePreset, today: string): { since: string; until: string } {
  const yesterday = shiftDate(today, -1)
  switch (preset) {
    case 'today':
      return { since: today, until: today }
    case 'yesterday':
      return { since: yesterday, until: yesterday }
    case '7d':
      return { since: shiftDate(today, -7), until: yesterday }
    case '14d':
      return { since: shiftDate(today, -14), until: yesterday }
    case '30d':
      return { since: shiftDate(today, -30), until: yesterday }
    case 'month':
      return { since: `${today.slice(0, 7)}-01`, until: today }
    case 'lastMonth': {
      const end = shiftDate(`${today.slice(0, 7)}-01`, -1)
      return { since: `${end.slice(0, 7)}-01`, until: end }
    }
  }
}

/** «2026-10-03» → «03/10/2026» */
export function isoToEs(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
