import { useQuery } from '@tanstack/react-query'
import { call } from '../lib/ipc'
import { isoToEs } from './meta'

/** Cuentas publicitarias asignadas al cliente (se asignan en Campañas → Cuentas). */
export function ClientAdAccounts({ clientId }: { clientId: string }) {
  const q = useQuery({
    queryKey: ['data', 'meta', 'client', clientId],
    queryFn: () => call('meta:clientAccounts', { clientId }),
  })
  if (!q.data?.length) return null
  return (
    <section className="panel-rich" data-testid="client-ad-accounts">
      <h3 className="panel-subtitle">Cuentas publicitarias</h3>
      <ul className="client-accounts">
        {q.data.map((a) => (
          <li key={a.id}>
            <strong>{a.name}</strong>
            <span className="faint">
              Meta · {a.currency} · {a.timezone}
              {a.enabled
                ? a.dataUntil
                  ? ` · datos hasta el ${isoToEs(a.dataUntil)}`
                  : ' · sincronizando'
                : ' · sin sincronizar'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
