import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { VaultStatus } from '@shared/ipc'
import { call, IpcCallError, subscribe } from './ipc'

/** Estado de la bóveda, siempre al día con los eventos del proceso principal. */
export function useVaultStatus() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['vault:status'], queryFn: () => call('vault:status') })
  useEffect(
    () => subscribe('vault:changed', (s: VaultStatus) => qc.setQueryData(['vault:status'], s)),
    [qc],
  )
  return query
}

export function useAppInfo() {
  return useQuery({ queryKey: ['app:info'], queryFn: () => call('app:info'), staleTime: Infinity })
}

/** Ejecuta una acción asíncrona guardando si está en curso y el último error. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<IpcCallError | null>(null)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setPending(true)
    setError(null)
    try {
      return await fnRef.current(...args)
    } catch (e) {
      setError(
        e instanceof IpcCallError
          ? e
          : new IpcCallError({ code: 'UNKNOWN', message: 'Ha ocurrido un error inesperado.' }),
      )
      return undefined
    } finally {
      setPending(false)
    }
  }, [])
  return { run, pending, error, clearError: () => setError(null) }
}

/**
 * Avisa al proceso principal de que hay actividad (para el bloqueo automático),
 * como mucho una vez cada 20 s.
 */
export function useActivityPing() {
  useEffect(() => {
    let last = 0
    const ping = () => {
      const now = Date.now()
      if (now - last < 20_000) return
      last = now
      void call('app:activity').catch(() => {})
    }
    const events = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const
    for (const e of events) window.addEventListener(e, ping, { passive: true })
    return () => {
      for (const e of events) window.removeEventListener(e, ping)
    }
  }, [])
}
