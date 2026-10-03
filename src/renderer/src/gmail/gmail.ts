import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { GmailStatus } from '@shared/gmail'
import { call, subscribe } from '../lib/ipc'

/** Estado de la conexión con Gmail, al día con los avisos del proceso principal. */
export function useGmailStatus() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['data', 'gmail', 'status'], queryFn: () => call('gmail:status') })
  useEffect(
    () =>
      subscribe('gmail:changed', (s: GmailStatus) => {
        qc.setQueryData(['data', 'gmail', 'status'], s)
      }),
    [qc],
  )
  return q.data
}
