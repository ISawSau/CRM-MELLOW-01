import type { GmailService } from '../gmail/gmail-service'
import type { VaultService } from '../vault/vault-service'
import type { IpcHandlers } from './register'

type GmailChannel = Extract<keyof IpcHandlers, `gmail:${string}` | `mail:${string}`>
export type GmailHandlers = Pick<IpcHandlers, GmailChannel>

/** Gmail en solo lectura (SPEC §7.12) y plantillas de correo (D-098). */
export function createGmailHandlers(gmail: GmailService, vault: VaultService): GmailHandlers {
  return {
    'mail:templates': () => vault.data.getMailTemplates(),
    'mail:setTemplates': ({ templates }) => vault.data.setMailTemplates(templates),
    'mail:addresses': ({ recordId }) => gmail.addressesFor(recordId),
    'gmail:status': () => gmail.status(),
    'gmail:connect': (input) => gmail.connect(input),
    'gmail:disconnect': () => gmail.disconnect(),
    'gmail:threads': (input) => gmail.threads(input),
  }
}
