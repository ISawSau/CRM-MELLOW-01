import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { call, subscribe } from './lib/ipc'

/**
 * Pantalla provisional de la fase 0. Las pantallas reales (bienvenida, desbloqueo,
 * barra lateral, barra de estado, Ctrl+K) se construyen cuando se aprueben los
 * tokens de docs/DESIGN.md (SPEC §8).
 */
export function App() {
  const qc = useQueryClient()
  const info = useQuery({ queryKey: ['app:info'], queryFn: () => call('app:info') })
  const status = useQuery({ queryKey: ['vault:status'], queryFn: () => call('vault:status') })

  useEffect(() => subscribe('vault:changed', (s) => qc.setQueryData(['vault:status'], s)), [qc])

  return (
    <main data-testid="placeholder">
      <h1>CRM Mellow</h1>
      <p>Interfaz pendiente de aprobar los tokens de diseño (docs/DESIGN.md).</p>
      <p data-testid="version">Versión {info.data?.version ?? '…'}</p>
      <p data-testid="vault-state">Bóveda: {status.data?.state ?? '…'}</p>
    </main>
  )
}
