import { IDLE_LIMIT_SECONDS, MIN_SESSION_SECONDS, type ReadingSession } from '@shared/books'
import { call } from '../lib/ipc'

/**
 * Rato de lectura (D-123). Cuenta el tiempo con el libro a la vista y pasando páginas: si
 * pasan más de tres minutos sin pasar página (o la app se va a segundo plano), ese hueco no
 * cuenta. Se guarda cada 30 s y al cerrar, con el mismo id: si la app se cierra de golpe
 * se pierde como mucho medio minuto.
 */

const TICK_MS = 15_000
const SAVE_MS = 30_000

const uuid = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')

export class ReadingTracker {
  private readonly id = uuid()
  private readonly startedAt = new Date()
  private seconds = 0
  private pages = 0
  private from: number | null = null
  private to = 0
  private lastTick = Date.now()
  private lastActivity = Date.now()
  private lastSaved = 0
  private savedSeconds = -1
  private readonly timer: ReturnType<typeof setInterval>
  private readonly onVisibility = () => {
    this.tick()
    if (document.visibilityState === 'hidden') void this.save()
    else this.lastTick = Date.now()
  }

  constructor(
    private readonly recordId: string,
    private readonly now: () => number = Date.now,
  ) {
    this.lastTick = this.lastActivity = this.now()
    this.timer = setInterval(() => {
      this.tick()
      if (this.now() - this.lastSaved >= SAVE_MS) void this.save()
    }, TICK_MS)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  /** Suma el tiempo desde la última vez, si el libro estaba a la vista y en uso. */
  private tick(): void {
    const now = this.now()
    const visible = document.visibilityState !== 'hidden'
    const idle = (now - this.lastActivity) / 1000 > IDLE_LIMIT_SECONDS
    if (visible && !idle) this.seconds += Math.max(0, now - this.lastTick) / 1000
    this.lastTick = now
  }

  /** Página nueva (o la primera posición al abrir). */
  moved(fraction: number): void {
    this.tick()
    if (this.from === null) this.from = fraction
    else if (fraction !== this.to) this.pages++
    this.to = fraction
    this.lastActivity = this.now()
  }

  /** Cualquier otra interacción (tocar, abrir el índice): sigues leyendo. */
  touch(): void {
    this.tick()
    this.lastActivity = this.now()
  }

  snapshot(): ReadingSession | null {
    const seconds = Math.round(this.seconds)
    if (seconds < MIN_SESSION_SECONDS || this.from === null) return null
    return {
      id: this.id,
      recordId: this.recordId,
      startedAt: this.startedAt.toISOString(),
      endedAt: new Date(this.now()).toISOString(),
      seconds,
      fromFraction: this.from,
      toFraction: this.to,
      pages: this.pages,
    }
  }

  async save(): Promise<void> {
    this.lastSaved = this.now()
    const s = this.snapshot()
    if (!s || s.seconds === this.savedSeconds) return
    this.savedSeconds = s.seconds
    await call('books:saveSession', s).catch(() => {})
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.tick()
    await this.save()
  }
}
