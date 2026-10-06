/**
 * Conexión con Google vista desde la interfaz (D-118): el inicio de sesión pendiente (para
 * volver a abrir el navegador o pegar la dirección si no vuelve solo) y el estado de
 * «Traer desde Google Drive», que se consulta en lugar de esperar una sola respuesta larga.
 */

export interface GoogleLoginStatus {
  /** Hay un inicio de sesión esperando la respuesta de Google. */
  pending: boolean
  /** Dirección de Google para volver a abrir el navegador. */
  authUrl: string | null
}

export type ClonePhase =
  /** Nada en marcha. */
  | 'idle'
  /** Esperando a que el usuario inicie sesión en el navegador. */
  | 'login'
  /** Google ha respondido: se canjea el código por el acceso. */
  | 'token'
  /** Buscando la bóveda en Google Drive. */
  | 'search'
  /** Bajando la bóveda. */
  | 'download'
  /** Bóveda traída y abierta: falta desbloquearla. */
  | 'done'
  | 'error'

export interface CloneStatus {
  phase: ClonePhase
  /** Bytes bajados y total (si Drive lo dice) en la fase `download`. */
  received: number
  total: number | null
  error: { code: string; message: string } | null
}

export const CLONE_IDLE: CloneStatus = { phase: 'idle', received: 0, total: null, error: null }

/** Fases en las que el trabajo sigue en marcha. */
export function cloneActive(s: CloneStatus | undefined): boolean {
  return (
    !!s &&
    (s.phase === 'login' || s.phase === 'token' || s.phase === 'search' || s.phase === 'download')
  )
}
