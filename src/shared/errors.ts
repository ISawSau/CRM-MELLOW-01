/**
 * Errores que el proceso principal devuelve a la interfaz. El código es estable
 * (la interfaz decide qué hacer según él); el mensaje ya está en español.
 */
export const ERROR_MESSAGES = {
  WRONG_PASSWORD:
    'La contraseña no es correcta. Inténtalo de nuevo o usa la clave de recuperación.',
  WRONG_RECOVERY_KEY: 'La clave de recuperación no es correcta. Revisa que esté completa.',
  WEAK_PASSWORD: 'La contraseña es demasiado corta.',
  NOT_A_VAULT: 'Esa carpeta no contiene una bóveda.',
  VAULT_EXISTS: 'Esa carpeta ya contiene una bóveda. Ábrela en lugar de crear una nueva.',
  FOLDER_NOT_EMPTY: 'Elige una carpeta vacía o una carpeta nueva para la bóveda.',
  VAULT_CORRUPT: 'El archivo vault.json está dañado o no es válido.',
  VAULT_TOO_NEW:
    'Esta bóveda se creó con una versión más nueva de la app. Actualiza la app antes de abrirla.',
  VAULT_LOCKED_ELSEWHERE: 'La bóveda parece abierta en otro equipo.',
  VAULT_NOT_OPEN: 'No hay ninguna bóveda abierta.',
  VAULT_IS_LOCKED: 'La bóveda está bloqueada.',
  PATH_NOT_ALLOWED: 'Elige la carpeta con el selector de la app.',
  INVALID_INPUT: 'Los datos enviados no son válidos.',
  MIGRATION_FAILED:
    'No se pudo actualizar la base de datos. Se ha guardado una copia de seguridad en backups/.',
  UNKNOWN: 'Ha ocurrido un error inesperado.',
} as const

export type ErrorCode = keyof typeof ERROR_MESSAGES

export class AppError extends Error {
  readonly code: ErrorCode
  readonly details: Record<string, unknown> | undefined

  constructor(code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    super(message ?? ERROR_MESSAGES[code])
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

export interface IpcError {
  code: ErrorCode
  message: string
  details?: Record<string, unknown>
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }
