import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { PLATFORMS } from '@shared/platforms'
import { call, subscribe } from '../lib/ipc'
import { useMetaAccounts } from '../meta/meta'

/** Cuentas de LinkedIn y X, al día con los avisos del proceso principal. */
export function usePlatformAccounts() {
  const qc = useQueryClient()
  useEffect(
    () =>
      subscribe('platforms:changed', () => {
        // Llegan métricas nuevas: también cambian Análisis, Facturación e Inicio.
        void qc.invalidateQueries({ queryKey: ['data'] })
      }),
    [qc],
  )
  return useQuery({
    queryKey: ['data', 'platforms', 'accounts'],
    queryFn: () => call('platforms:accounts'),
  })
}

export function useLinkedInStatus() {
  return useQuery({
    queryKey: ['data', 'platforms', 'linkedin'],
    queryFn: () => call('linkedin:status'),
  })
}

/** Todas las cuentas activadas de todas las plataformas (filtros de Análisis). */
export function useAllAccounts(): { id: string; name: string }[] {
  const meta = useMetaAccounts().data ?? []
  const other = usePlatformAccounts().data ?? []
  return [
    ...meta.filter((a) => a.enabled).map((a) => ({ id: a.id, name: a.name })),
    ...other
      .filter((a) => a.enabled)
      .map((a) => ({ id: a.id, name: `${a.name} (${PLATFORMS[a.platform]})` })),
  ]
}
