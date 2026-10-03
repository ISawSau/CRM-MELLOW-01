import type { PlatformsService } from '../platforms/platforms-service'
import type { IpcHandlers } from './register'

type PlatformsChannel = Extract<keyof IpcHandlers, `platforms:${string}` | `linkedin:${string}`>
export type PlatformsHandlers = Pick<IpcHandlers, PlatformsChannel>

/** Otras plataformas: LinkedIn (API o CSV) y X (CSV) (SPEC §7.4). */
export function createPlatformsHandlers(platforms: PlatformsService): PlatformsHandlers {
  return {
    'platforms:accounts': () => platforms.accounts(),
    'platforms:updateAccount': (input) => platforms.updateAccount(input),
    'platforms:deleteAccount': ({ id }) => platforms.deleteAccount(id),
    'platforms:savedMapping': ({ platform, headers }) => platforms.savedMapping(platform, headers),
    'platforms:importCsv': ({ input, headers }) => platforms.importCsv(input, headers),
    'linkedin:status': () => platforms.linkedinStatus(),
    'linkedin:setEnabled': ({ enabled }) => platforms.setLinkedinEnabled(enabled),
    'linkedin:connect': (input) => platforms.linkedinConnect(input),
    'linkedin:disconnect': () => platforms.linkedinDisconnect(),
    'linkedin:sync': async () => {
      await platforms.syncLinkedIn()
      return platforms.linkedinStatus()
    },
  }
}
