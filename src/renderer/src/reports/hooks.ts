import { useQuery } from '@tanstack/react-query'
import { call } from '../lib/ipc'

export function useReportTemplates() {
  return useQuery({
    queryKey: ['data', 'reports', 'templates'],
    queryFn: () => call('reports:templates'),
  })
}
