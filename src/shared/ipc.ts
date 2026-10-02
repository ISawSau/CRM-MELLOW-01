import { z } from 'zod'
import { appearanceSchema, type Appearance } from './appearance'

/**
 * Contrato IPC entre la interfaz (renderer) y el proceso principal.
 *
 * Cada canal define el esquema de entrada (validado en el proceso principal con zod,
 * porque el renderer no es de confianza) y el tipo de salida. La lista de canales
 * permitidos está en `channels.ts` para que el preload no tenga que cargar zod.
 */

/** Longitud mínima de la contraseña maestra. Ver docs/DECISIONS.md. */
export const MIN_PASSWORD_LENGTH = 8

const password = z.string().min(MIN_PASSWORD_LENGTH).max(1024)
const anyPassword = z.string().min(1).max(1024)
const absolutePath = z.string().min(1).max(4096)

export const vaultNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  // eslint-disable-next-line no-control-regex -- se excluyen a propósito los caracteres de control
  .regex(/^[^\\/:*?"<>|\u0000-\u001f]+$/, 'Nombre de carpeta no válido')
  .refine((n) => n !== '.' && n !== '..', 'Nombre de carpeta no válido')

export type VaultState = 'none' | 'locked' | 'unlocked'

export interface VaultStatus {
  state: VaultState
  /** Ruta de la bóveda seleccionada (bloqueada o desbloqueada). */
  path: string | null
  /** Nombre visible (nombre de la carpeta). */
  name: string | null
  /** Minutos de inactividad antes del bloqueo automático (solo si está desbloqueada). */
  autoLockMinutes: number | null
  /** Apariencia guardada en la bóveda (solo si está desbloqueada). */
  appearance: Appearance | null
}

export interface AppInfo {
  version: string
  platform: string
  hostname: string
  isPackaged: boolean
}

export const ipcSchemas = {
  'app:info': z.void(),
  'app:activity': z.void(),
  'vault:status': z.void(),
  'vault:pickFolder': z.object({ purpose: z.enum(['create', 'open']) }),
  'vault:create': z.object({ parentPath: absolutePath, name: vaultNameSchema, password }),
  'vault:open': z.object({ path: absolutePath }),
  'vault:unlock': z.object({ password: anyPassword, force: z.boolean().default(false) }),
  'vault:recover': z.object({
    recoveryKey: z.string().min(1).max(200),
    newPassword: password,
    force: z.boolean().default(false),
  }),
  'vault:lock': z.void(),
  'vault:close': z.void(),
  'vault:changePassword': z.object({ currentPassword: anyPassword, newPassword: password }),
  'vault:rotateKey': z.object({ password: anyPassword }),
  'settings:setAutoLock': z.object({
    minutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
  }),
  'settings:setAppearance': appearanceSchema,
  'clipboard:writeSecret': z.object({ text: z.string().min(1).max(500) }),
} as const

export interface IpcOutputs {
  'app:info': AppInfo
  'app:activity': void
  'vault:status': VaultStatus
  'vault:pickFolder': string | null
  'vault:create': { status: VaultStatus; recoveryKey: string }
  'vault:open': VaultStatus
  'vault:unlock': VaultStatus
  'vault:recover': VaultStatus
  'vault:lock': VaultStatus
  'vault:close': VaultStatus
  'vault:changePassword': void
  'vault:rotateKey': { recoveryKey: string }
  'settings:setAutoLock': VaultStatus
  'settings:setAppearance': VaultStatus
  'clipboard:writeSecret': void
}

export type IpcChannel = keyof typeof ipcSchemas
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcSchemas)[C]>
export type IpcParsedInput<C extends IpcChannel> = z.output<(typeof ipcSchemas)[C]>
export type IpcOutput<C extends IpcChannel> = IpcOutputs[C]

/** Eventos que el proceso principal envía a la interfaz. */
export interface IpcEvents {
  'vault:changed': VaultStatus
}
export type IpcEvent = keyof IpcEvents
