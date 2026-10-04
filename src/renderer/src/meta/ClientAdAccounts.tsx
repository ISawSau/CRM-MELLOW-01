import { useQuery } from '@tanstack/react-query'
import { t } from '@shared/i18n'
import { call } from '../lib/ipc'
import { isoToEs } from './meta'

/** Cuentas publicitarias de Meta asignadas al cliente. */
export function ClientAdAccounts({ clientId }: { clientId: string }) {
  const q = useQuery({
    queryKey: ['data', 'meta', 'client', clientId],
    queryFn: () => call('meta:clientAccounts', { clientId }),
  })
  if (!q.data?.length) return null
  const since = (until: string | null) =>
    until ? t(' · datos hasta el {date}', { date: isoToEs(until) }) : ''
  return (
    <section className="panel-rich" data-testid="client-ad-accounts">
      <h3 className="panel-subtitle">{t('Cuentas publicitarias')}</h3>
      <ul className="client-accounts">
        {(q.data ?? []).map((a) => (
          <li key={a.id}>
            <strong>{a.name}</strong>
            <span className="faint">
              Meta · {a.currency} · {a.timezone}
              {a.enabled
                ? a.dataUntil
                  ? since(a.dataUntil)
                  : t(' · sincronizando')
                : t(' · sin sincronizar')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
