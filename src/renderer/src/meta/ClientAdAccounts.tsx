import { useQuery } from '@tanstack/react-query'
import { PLATFORMS } from '@shared/platforms'
import { call } from '../lib/ipc'
import { usePlatformAccounts } from '../platforms/platforms'
import { isoToEs } from './meta'

/** Cuentas publicitarias asignadas al cliente (Meta, LinkedIn y X). */
export function ClientAdAccounts({ clientId }: { clientId: string }) {
  const q = useQuery({
    queryKey: ['data', 'meta', 'client', clientId],
    queryFn: () => call('meta:clientAccounts', { clientId }),
  })
  const other = (usePlatformAccounts().data ?? []).filter((a) => a.clientId === clientId)
  if (!q.data?.length && !other.length) return null
  const since = (until: string | null) => (until ? ` · datos hasta el ${isoToEs(until)}` : '')
  return (
    <section className="panel-rich" data-testid="client-ad-accounts">
      <h3 className="panel-subtitle">Cuentas publicitarias</h3>
      <ul className="client-accounts">
        {(q.data ?? []).map((a) => (
          <li key={a.id}>
            <strong>{a.name}</strong>
            <span className="faint">
              Meta · {a.currency} · {a.timezone}
              {a.enabled
                ? a.dataUntil
                  ? since(a.dataUntil)
                  : ' · sincronizando'
                : ' · sin sincronizar'}
            </span>
          </li>
        ))}
        {other.map((a) => (
          <li key={a.id}>
            <strong>{a.name}</strong>
            <span className="faint">
              {PLATFORMS[a.platform]} ({a.source === 'api' ? 'API' : 'CSV'}) · {a.currency}
              {a.enabled ? since(a.dataUntil) : ' · sin usar'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
