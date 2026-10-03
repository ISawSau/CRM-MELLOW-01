import type { VaultService } from './vault/vault-service'

const CHECK_EVERY_MS = 15_000

/**
 * Bloqueo automático por inactividad (SPEC §5). La interfaz avisa de actividad
 * (teclado, ratón) como mucho cada pocos segundos; si pasan los minutos
 * configurados sin actividad, la bóveda se bloquea y la clave sale de memoria.
 */
export class AutoLock {
  private lastActivity = Date.now()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly vault: VaultService,
    private readonly now: () => number = Date.now,
    /** Cómo bloquear (la app sube antes lo pendiente a la sincronización). */
    private readonly lock: () => void = () => vault.lock(),
  ) {}

  start(): void {
    this.stop()
    this.lastActivity = this.now()
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  touch(): void {
    this.lastActivity = this.now()
  }

  /** Devuelve true si ha bloqueado. Público para poder probarlo. */
  check(): boolean {
    const status = this.vault.status()
    if (status.state !== 'unlocked' || status.autoLockMinutes === null) return false
    if (this.now() - this.lastActivity >= status.autoLockMinutes * 60_000) {
      this.stop()
      this.lock()
      return true
    }
    return false
  }
}
