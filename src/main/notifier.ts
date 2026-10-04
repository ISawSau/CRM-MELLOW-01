import { todayIn } from '@shared/data/dates'
import { tn } from '@shared/i18n'
import type { Platform } from './platform'
import type { VaultService } from './vault/vault-service'

const APP = 'CRM Mellow'
const TASKS_EVERY_MS = 30 * 60_000

/**
 * Avisos del sistema (fase 14, D-107) mientras la app está abierta y la bóveda
 * desbloqueada. Solo recuentos: el sistema guarda los avisos fuera de la bóveda.
 */
export class Notifier {
  private timer: ReturnType<typeof setInterval> | null = null
  /** Día en que ya se avisó de las tareas (en memoria: como mucho una vez al día y sesión). */
  private tasksDay: string | null = null

  constructor(
    private readonly vault: VaultService,
    private readonly platform: Platform,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private unlocked(): boolean {
    return this.vault.status().state === 'unlocked'
  }

  /** Tras sincronizar con Meta: cuántos avisos nuevos de alertas o fatiga hay. */
  alerts(n: number): void {
    if (n <= 0 || !this.unlocked() || !this.vault.data.getNotifySettings().alerts) return
    this.platform.notify(
      APP,
      tn(n, 'Tienes {n} aviso nuevo en Campañas.', 'Tienes {n} avisos nuevos en Campañas.'),
    )
  }

  /** Tareas para hoy o atrasadas: una vez al día. */
  checkTasks(): void {
    if (!this.unlocked() || !this.vault.data.getNotifySettings().tasks) return
    const today = todayIn(this.vault.data.getProfile().timeZone, this.now())
    if (this.tasksDay === today) return
    const n = this.vault.data.dueTaskCount()
    this.tasksDay = today
    if (n > 0)
      this.platform.notify(
        APP,
        tn(n, 'Tienes {n} tarea para hoy o atrasada.', 'Tienes {n} tareas para hoy o atrasadas.'),
      )
  }

  start(): void {
    this.stop()
    this.timer = setInterval(() => {
      try {
        this.checkTasks()
      } catch {
        // Un aviso nunca debe romper la app.
      }
    }, TASKS_EVERY_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
