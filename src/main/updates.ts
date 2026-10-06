import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { t } from '@shared/i18n'
import {
  DOWNLOAD_IDLE,
  isNewer,
  parseLatestRelease,
  RELEASES_LATEST_API,
  RELEASES_PAGE,
  sumFor,
  type LatestRelease,
  type UpdateDownload,
  type UpdateStatus,
} from '@shared/updates'
import type { FetchLike } from './sync/remote'
import type { VaultService } from './vault/vault-service'

/** Cada cuánto se vuelve a mirar con la bóveda abierta. */
const EVERY_MS = 60 * 60_000
/** Como mucho una consulta cada media hora (salvo «Buscar ahora»). */
const MIN_GAP_MS = 30 * 60_000
const FIRST_CHECK_MS = 5_000
const TIMEOUT_MS = 15_000
/** Una descarga que no recibe nada en este tiempo se da por perdida. */
const DOWNLOAD_IDLE_MS = 60_000
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' }

/** Lo que devuelve la instalación del archivo ya comprobado. */
export type InstallResult =
  { kind: 'installing' } | { kind: 'command'; command: string } | { kind: 'permission' }

/**
 * Cómo se actualiza esta instalación (D-120): qué archivo de la versión le toca, dónde
 * bajarlo y cómo instalarlo. Sin destino (desarrollo, sistema sin instalador) solo se
 * avisa y se enlaza la página de descarga.
 */
export interface UpdateTarget {
  /** Final del nombre del archivo de la versión, p. ej. «-windows-x64-instalador.exe». */
  suffix: string
  /** Carpeta donde bajarlo. */
  dir: () => string
  install: (file: string) => Promise<InstallResult>
}

export interface UpdateOptions {
  /** Versión instalada. */
  current: () => string
  /** URL de la API; null desactiva la consulta (desarrollo y tests). */
  url?: string | null
  http?: FetchLike
  now?: () => number
  target?: UpdateTarget | null
  /** El estado ha cambiado (para que la interfaz lo muestre). */
  onChange?: () => void
}

/**
 * Versiones nuevas (D-114, D-120): con la bóveda abierta y el ajuste activado, consulta la
 * última versión de GitHub Releases al abrir y cada hora. Es una petición GET sin token ni
 * datos del usuario. Si esta instalación tiene destino, la actualiza desde la app: baja el
 * archivo de su sistema, comprueba su huella SHA-256 y lo instala.
 */
export class UpdateService {
  private latest: LatestRelease | null = null
  private checkedAt: number | null = null
  private checkError: string | null = null
  private inFlight = false
  private download: UpdateDownload = DOWNLOAD_IDLE
  private timer: ReturnType<typeof setInterval> | null = null
  private first: ReturnType<typeof setTimeout> | null = null
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

  private asset(): LatestRelease['assets'][number] | null {
    const suffix = this.o.target?.suffix
    if (!suffix || !this.latest) return null
    return this.latest.assets.find((a) => a.name.endsWith(suffix)) ?? null
  }

  status(): UpdateStatus {
    const current = this.o.current()
    const latest = this.latest
    const settings = this.unlocked() ? this.vault.data.getUpdateSettings() : null
    const newer = !!latest && isNewer(latest.version, current)
    return {
      current,
      latest: latest?.version ?? null,
      url: latest?.url ?? RELEASES_PAGE,
      show: newer && !!settings?.check && settings.dismissed !== latest!.version,
      newer,
      checkedAt: this.checkedAt,
      checking: this.inFlight,
      checkError: this.checkError,
      canInstall: newer && this.asset() !== null,
      download: this.download,
    }
  }

  private changed(): void {
    this.o.onChange?.()
  }

  /**
   * Consulta GitHub si toca (o siempre, con `force`: «Buscar ahora»). Un fallo de red se
   * guarda para mostrarlo y se reintenta en la próxima ronda.
   */
  async check(force = false): Promise<void> {
    if (!this.url || !this.unlocked()) return
    if (!force && !this.vault.data.getUpdateSettings().check) return
    if (this.inFlight) return
    if (!force && this.checkedAt !== null && this.now() - this.checkedAt < MIN_GAP_MS) return
    this.inFlight = true
    this.changed()
    try {
      const res = await this.http(this.url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(t('GitHub respondió {status}.', { status: res.status }))
      const found = parseLatestRelease(await res.json())
      if (!found) throw new Error(t('GitHub no ha dado una versión publicada.'))
      this.latest = found
      this.checkedAt = this.now()
      this.checkError = null
    } catch (e) {
      this.checkError = e instanceof Error ? e.message : String(e)
    } finally {
      this.inFlight = false
      this.changed()
    }
  }

  private setDownload(next: Partial<UpdateDownload>): void {
    this.download = { ...this.download, ...next }
    this.changed()
  }

  /** Huella SHA-256 esperada: la que da GitHub o, si no, la de SHA256SUMS.txt. */
  private async expectedSum(name: string, digest: string | null): Promise<string> {
    if (digest?.startsWith('sha256:')) return digest.slice(7).toLowerCase()
    const sums = this.latest?.assets.find((a) => a.name === 'SHA256SUMS.txt')
    if (sums) {
      const res = await this.http(sums.url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      const found = res.ok ? sumFor(await res.text(), name) : null
      if (found) return found
    }
    throw new Error(t('La versión nueva no trae su huella SHA-256: no se instala sin comprobarla.'))
  }

  /**
   * Baja el archivo de la versión nueva para este sistema, comprueba su huella y lo
   * instala. Si algo falla queda en «error» con el motivo y se puede reintentar.
   */
  async install(): Promise<UpdateStatus> {
    const target = this.o.target
    const asset = this.asset()
    if (!target || !asset || !this.status().newer) return this.status()
    if (this.download.phase === 'downloading' || this.download.phase === 'installing')
      return this.status()
    this.setDownload({ ...DOWNLOAD_IDLE, phase: 'downloading', total: asset.size || null })
    const dir = target.dir()
    const file = join(dir, asset.name)
    const part = `${file}.part`
    try {
      const expected = await this.expectedSum(asset.name, asset.digest)
      mkdirSync(dir, { recursive: true })
      const ctrl = new AbortController()
      const res = await this.http(asset.url, { signal: ctrl.signal })
      if (!res.ok || !res.body)
        throw new Error(t('GitHub respondió {status}.', { status: res.status }))
      const total = Number(res.headers.get('content-length')) || asset.size || null
      const hash = createHash('sha256')
      let received = 0
      let lastEmit = 0
      const stalled = setTimeout(() => ctrl.abort(), DOWNLOAD_IDLE_MS)
      const meter = new Transform({
        transform: (chunk: Buffer, _encoding, done) => {
          hash.update(chunk)
          received += chunk.length
          stalled.refresh()
          // Avance para la interfaz, sin inundarla.
          if (this.now() - lastEmit > 250) {
            lastEmit = this.now()
            this.setDownload({ received, total })
          }
          done(null, chunk)
        },
      })
      try {
        await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(part))
      } finally {
        clearTimeout(stalled)
      }
      if (hash.digest('hex') !== expected) {
        rmSync(part, { force: true })
        throw new Error(
          t(
            'El archivo bajado no coincide con su huella SHA-256: no se instala. Vuelve a intentarlo.',
          ),
        )
      }
      renameSync(part, file)
      this.setDownload({ received, total, file, phase: 'installing' })
      const result = await target.install(file)
      if (result.kind === 'command') this.setDownload({ phase: 'command', command: result.command })
      else if (result.kind === 'permission') this.setDownload({ phase: 'permission' })
    } catch (e) {
      rmSync(part, { force: true })
      this.setDownload({
        phase: 'error',
        message:
          e instanceof Error && e.name !== 'AbortError'
            ? e.message
            : t('La descarga se ha cortado.'),
      })
    }
    return this.status()
  }

  start(): void {
    this.stop()
    const run = () => void this.check()
    // Al poco de abrir la bóveda, y después cada hora.
    this.first = setTimeout(run, FIRST_CHECK_MS)
    this.first.unref?.()
    this.timer = setInterval(run, EVERY_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
    this.first = null
    this.timer = null
  }
}
