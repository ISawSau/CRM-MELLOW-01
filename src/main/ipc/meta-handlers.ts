import type { MetaService } from '../meta/meta-service'
import type { IpcHandlers } from './register'

type MetaChannel = Extract<keyof IpcHandlers, `meta:${string}`>
export type MetaHandlers = Pick<IpcHandlers, MetaChannel>

/** Meta en solo lectura (SPEC §7.3). El token entra aquí y nunca vuelve a la interfaz. */
export function createMetaHandlers(meta: MetaService): MetaHandlers {
  return {
    'meta:status': () => meta.status(),
    'meta:connect': (input) => meta.connect(input),
    'meta:disconnect': () => meta.disconnect(),
    'meta:accounts': () => meta.listAccounts(),
    'meta:refreshAccounts': () => meta.refreshAccounts(),
    'meta:updateAccount': (input) => meta.updateAccount(input),
    'meta:retryHistory': ({ id }) => meta.retryHistory(id),
    // No se espera: el histórico puede tardar horas. El progreso llega por eventos.
    'meta:syncNow': () => {
      void meta.syncNow().catch(() => {})
      return meta.status()
    },
    'meta:setSettings': (s) => meta.setSettings(s),
    'meta:performance': (q) => meta.performance(q),
    'meta:clientAccounts': ({ clientId }) => meta.accountsForClient(clientId),
  }
}
