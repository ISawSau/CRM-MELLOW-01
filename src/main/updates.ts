import {
  isNewer,
  parseLatestRelease,
  RELEASES_LATEST_API,
  RELEASES_PAGE,
  type UpdateStatus,
} from '@shared/updates'
import type { FetchLike } from './sync/remote'
import type { VaultService } from './vault/vault-service'

const DAY_MS = 24 * 60 * 60_000
const EVERY_MS = 6 * 60 * 60_000
const TIMEOUT_MS = 15_000

export interface UpdateOptions {
  /** Versión instalada. */
  current: () => string
  /** URL de la API; null desactiva la consulta (desarrollo y tests). */
  url?: string | null
  http?: FetchLike
  now?: () => number
  /** Hay una versión nueva conocida (para que la interfaz la muestre). */
  onChange?: () => void
}

/**
 * Aviso de versión nueva (D-114): con la bóveda abierta y el ajuste activado, consulta
 * como mucho una vez al día la última versión de GitHub Releases. No manda ningún dato
 * del usuario: es una petición GET sin token ni cabeceras propias más allá de las que
 * pide la API.
 */
export class UpdateService {
  private latest: { version: string; url: string } | null = null
  private checkedAt: number | null = null
  private inFlight = false
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly url: string | null
  private readonly http: FetchLike
  private readonly now: () => number

  constructor(
    private readonly vault: VaultService,
    private readonly o: UpdateOptions,
  ) {
    this.url = o.url === undefined ? RELEASES_LATEST_API : o.url
    this.http = o.http ?? fetch
    this.now = o.now ?? Date.now
  }

  private unlocked(): boolean {
    return this.vault.status().state === 'unlocked'
  }

  status(): UpdateStatus {
    const current = this.o.current()
    const latest = this.latest
    const settings = this.unlocked() ? this.vault.data.getUpdateSettings() : null
    return {
      current,
      latest: latest?.version ?? null,
      url: latest?.url ?? RELEASES_PAGE,
      show:
        !!latest &&
        !!settings?.check &&
        settings.dismissed !== latest.version &&
        isNewer(latest.version, current),
    }
  }

  /** Consulta GitHub si toca. Un fallo de red se ignora: se reintenta más tarde. */
  async check(): Promise<void> {
    if (!this.url || !this.unlocked() || !this.vault.data.getUpdateSettings().check) return
    if (this.inFlight || (this.checkedAt !== null && this.now() - this.checkedAt < DAY_MS)) return
    this.inFlight = true
    try {
      const res = await this.http(this.url, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      // Con respuesta (aunque sea un error de GitHub) no se repite hasta el día siguiente.
      this.checkedAt = this.now()
      if (!res.ok) return
      const found = parseLatestRelease(await res.json())
      if (found && found.version !== this.latest?.version) {
        this.latest = found
        this.o.onChange?.()
      }
    } catch {
      // Sin conexión: no pasa nada, se vuelve a mirar en la próxima ronda.
    } finally {
      this.inFlight = false
    }
  }

  start(): void {
    this.stop()
    const run = () => void this.check()
    // Un poco después de abrir la bóveda, y después cada pocas horas (respeta el día).
    setTimeout(run, 10_000).unref?.()
    this.timer = setInterval(run, EVERY_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
