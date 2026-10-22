/**
 * Bloqueo al salir de la app en el móvil (D-130). Al apagar la pantalla o pasar a segundo
 * plano no se bloquea al momento: la bóveda sigue abierta los minutos elegidos y después se
 * bloquea. Si se vuelve antes, sigue abierta; si se vuelve tarde (el reloj pudo no saltar con
 * el móvil dormido), se bloquea antes de enseñar nada. Con 0 minutos se bloquea al salir.
 *
 * La clave nunca sale de la memoria del motor: si Android cierra el proceso, hay que volver a
 * escribir la contraseña. Mientras dura, el lado nativo tiene la app viva con un aviso.
 */
export class AwayLock {
  private since: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly o: {
      /** Minutos que sigue abierta tras salir (0: se bloquea al salir). */
      minutes: () => number
      /** ¿Hay una bóveda abierta? */
      unlocked: () => boolean
      lock: () => void
      /** Fuera (true) o de vuelta (false): el bloqueo por inactividad se para mientras tanto. */
      onAway?: (away: boolean) => void
      now?: () => number
    },
  ) {}

  private now(): number {
    return this.o.now?.() ?? Date.now()
  }

  get away(): boolean {
    return this.since !== null
  }

  /** Pantalla apagada o app en segundo plano. */
  leave(): void {
    if (!this.o.unlocked() || this.since !== null) return
    const minutes = this.o.minutes()
    if (minutes <= 0) {
      this.o.lock()
      return
    }
    this.since = this.now()
    this.o.onAway?.(true)
    this.timer = setTimeout(() => this.expire(), minutes * 60_000)
  }

  /** De vuelta a la app. True si ha tenido que bloquear (se ha pasado el tiempo). */
  back(): boolean {
    if (this.since === null) return false
    const late = this.now() - this.since >= this.o.minutes() * 60_000
    this.clear()
    if (late && this.o.unlocked()) {
      this.o.lock()
      return true
    }
    this.o.onAway?.(false)
    return false
  }

  /** Bloqueada por otro motivo (o desbloqueada de nuevo): se olvida la salida. */
  reset(): void {
    this.clear()
  }

  private expire(): void {
    this.timer = null
    if (this.since === null) return
    this.clear()
    if (this.o.unlocked()) this.o.lock()
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.since = null
  }
}
