/**
 * Lista blanca de canales IPC. La usa el preload (que no carga zod) para rechazar
 * cualquier canal que no esté en el contrato. Un test comprueba que coincide con
 * `ipcSchemas` de `ipc.ts`.
 */
export const IPC_CHANNELS = [
  'app:info',
  'app:activity',
  'vault:status',
  'vault:pickFolder',
  'vault:create',
  'vault:open',
  'vault:unlock',
  'vault:recover',
  'vault:lock',
  'vault:close',
  'vault:changePassword',
  'vault:rotateKey',
  'settings:setAutoLock',
  'settings:setAppearance',
  'clipboard:writeSecret',
] as const

export const IPC_EVENTS = ['vault:changed'] as const
