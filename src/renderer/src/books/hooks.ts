import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { DEFAULT_READER_PREFS, type ReaderPrefs } from '@shared/books'
import { call, subscribe } from '../lib/ipc'
import { isMobile } from '../lib/platform'

export const readerDevice = (): 'escritorio' | 'movil' => (isMobile() ? 'movil' : 'escritorio')

/** Al cambiar la posición, un rato de lectura o el objetivo, se vuelve a pedir. */
export function useBooksEvents(): void {
  const qc = useQueryClient()
  useEffect(
    () => subscribe('books:changed', () => void qc.invalidateQueries({ queryKey: ['books'] })),
    [qc],
  )
}

export function useReaderUrl() {
  return useQuery({
    queryKey: ['books', 'readerUrl'],
    queryFn: () => call('books:readerUrl'),
    staleTime: Infinity,
  })
}

/**
 * El archivo del libro en este equipo: si aún no está (con datos móviles no se bajan solos),
 * se baja ahora (D-131). True cuando ya se puede abrir.
 */
export function useBookFile(id: string) {
  return useQuery({
    queryKey: ['bookFile', id],
    queryFn: () => call('sync:fetchFile', { id }),
    staleTime: Infinity,
    retry: false,
  })
}

export function useBookProgress() {
  return useQuery({ queryKey: ['books', 'progress'], queryFn: () => call('books:progressAll') })
}

export function useReadingStats() {
  return useQuery({ queryKey: ['books', 'stats'], queryFn: () => call('books:stats') })
}

export function useReaderPrefs(): [ReaderPrefs, (patch: Partial<ReaderPrefs>) => void] {
  const qc = useQueryClient()
  const device = readerDevice()
  const key = ['books', 'prefs', device]
  const q = useQuery({ queryKey: key, queryFn: () => call('books:prefs', { device }) })
  const prefs = q.data ?? DEFAULT_READER_PREFS
  const set = useCallback(
    (patch: Partial<ReaderPrefs>) => {
      const next = { ...(qc.getQueryData<ReaderPrefs>(key) ?? DEFAULT_READER_PREFS), ...patch }
      qc.setQueryData(key, next)
      void call('books:setPrefs', { device, prefs: next }).catch(() => {})
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, device],
  )
  return [prefs, set]
}
