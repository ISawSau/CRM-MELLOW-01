import type { GmailService } from '../gmail/gmail-service'
import type { IpcHandlers } from './register'

type GmailChannel = Extract<keyof IpcHandlers, `gmail:${string}`>
export type GmailHandlers = Pick<IpcHandlers, GmailChannel>

/** Gmail en solo lectura (SPEC §7.12). */
export function createGmailHandlers(gmail: GmailService): GmailHandlers {
  return {
    'gmail:status': () => gmail.status(),
    'gmail:connect': (input) => gmail.connect(input),
    'gmail:disconnect': () => gmail.disconnect(),
    'gmail:threads': (input) => gmail.threads(input),
  }
}
