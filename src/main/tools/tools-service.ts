import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, rmSync, statSync, writeSync } from 'node:fs'
import { extname, isAbsolute, join } from 'node:path'
import { todayIn } from '@shared/data/dates'
import type { FileRef } from '@shared/data/fields'
import { AppError } from '@shared/errors'
import {
  parseProbe,
  VIDEO_EXTENSIONS,
  videoArgs,
  videoOutputName,
  type SavedResult,
  type ToolsProgress,
  type VideoInfo,
  type VideoJob,
} from '@shared/tools'
import type { VaultService } from '../vault/vault-service'
import { t } from '@shared/i18n'

/**
 * Herramientas de archivos (SPEC §7.11). Guarda en la bóveda (como Documento) o exporta
 * los resultados que llegan ya procesados de la interfaz, y convierte vídeo con FFmpeg.
 *
 * FFmpeg solo lee los vídeos que el usuario elige (diálogo o arrastrar y soltar) y solo
 * escribe en la carpeta temporal de la bóveda o donde el usuario elija al exportar. Los
 * argumentos se pasan sin shell y salen de presets cerrados (D-073).
 */

/** Carpeta temporal dentro de la bóveda: lo que se procesa nunca sale de ella. */
export const TOOLS_TMP = '.herramientas'

export interface ToolsDeps {
  /** Ruta del ejecutable de FFmpeg. */
  ffmpeg: () => string
  /** Diálogo «Guardar como»; null si se cancela. */
  savePath: (defaultName: string) => Promise<string | null>
  onProgress?: (p: ToolsProgress) => void
  now?: () => Date
}

interface OpenVideo {
  path: string
  name: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
}

export class ToolsService {
  private readonly videos = new Map<string, OpenVideo>()
  private readonly running = new Map<string, ChildProcess>()

  constructor(
    private readonly vault: VaultService,
    private readonly deps: ToolsDeps,
  ) {}

  status(): { ffmpeg: boolean } {
    return { ffmpeg: existsSync(this.deps.ffmpeg()) }
  }

  // --- Resultados de la interfaz (imágenes y PDF) -----------------------------------

  async saveResult(input: {
    name: string
    data: Uint8Array
    target: 'boveda' | 'exportar'
    clientId: string | null
    tipo: 'informe' | 'herramienta' | 'contrato' | 'otro'
  }): Promise<SavedResult | null> {
    if (input.target === 'exportar') {
      const path = await this.deps.savePath(input.name)
      if (!path) return null
      const fd = openSync(path, 'w')
      try {
        writeSync(fd, input.data)
      } finally {
        closeSync(fd)
      }
      return { name: input.name, recordId: null, path }
    }
    const file = this.vault.data.importBuffer(input.name, input.data)
    return {
      name: input.name,
      recordId: this.addDocument(input.name, file, input.tipo, input.clientId),
      path: null,
    }
  }

  /** Crea un Documento con el archivo (y su cliente, si lo hay). */
  addDocument(
    name: string,
    file: FileRef,
    tipo: 'informe' | 'herramienta' | 'contrato' | 'otro',
    clientId: string | null,
  ): string {
    const data = this.vault.data
    const fields = new Map(data.listFields('documento').map((f) => [f.key, f]))
    const id = (k: string) => fields.get(k)?.id
    const values: Record<string, unknown> = {}
    const set = (k: string, v: unknown) => {
      const f = id(k)
      if (f) values[f] = v
    }
    set('nombre', name)
    set('tipo', tipo)
    set('fecha', todayIn(this.timeZone(), this.now()))
    set('archivos', [file])
    const rec = data.create('documento', values as never, { label: t('Guardar documento') })
    const cliente = id('cliente')
    if (cliente && clientId && data.get(clientId)) data.setLinks(cliente, rec.id, [clientId])
    return rec.id
  }

  // --- Vídeo --------------------------------------------------------------------------

  /** Registra un vídeo del disco y devuelve su ficha (duración y tamaño con FFmpeg). */
  async openVideo(path: string): Promise<VideoInfo> {
    const ext = extname(path).slice(1).toLowerCase()
    if (!isAbsolute(path) || !VIDEO_EXTENSIONS.includes(ext)) throw new AppError('INVALID_INPUT')
    let size: number
    try {
      const st = statSync(path)
      if (!st.isFile()) throw new Error('no es un archivo')
      size = st.size
    } catch {
      throw new AppError('INVALID_INPUT')
    }
    this.requireFfmpeg()
    const stderr = await this.run(['-hide_banner', '-nostdin', '-i', path], null, true)
    const probe = parseProbe(stderr)
    if (probe.width === null)
      throw new AppError('TOOL_FAILED', undefined, t('El archivo no tiene vídeo o está dañado.'))
    const token = randomBytes(8).toString('hex')
    const name = path.split(/[\\/]/).pop() ?? 'video'
    const v: OpenVideo = { path, name, size, ...probe }
    this.videos.set(token, v)
    return { token, name, size, duration: v.duration, width: v.width, height: v.height }
  }

  /** Convierte un vídeo abierto. Devuelve null si se cancela el diálogo de exportar. */
  async convertVideo(job: VideoJob): Promise<SavedResult | null> {
    const v = this.videos.get(job.token)
    if (!v) throw new AppError('INVALID_INPUT')
    if (this.running.has(job.token)) throw new AppError('TOOL_BUSY')
    this.requireFfmpeg()
    const outName = videoOutputName(v.name, job.preset)
    let output: string
    if (job.target === 'exportar') {
      const p = await this.deps.savePath(outName)
      if (!p) return null
      output = p
    } else {
      output = join(this.tmpDir(), `${randomBytes(8).toString('hex')}.mp4`)
    }
    try {
      await this.run(videoArgs(v.path, output, job, v), { token: job.token, duration: v.duration })
      if (job.target === 'exportar') return { name: outName, recordId: null, path: output }
      const [file] = this.vault.data.importFiles([output])
      const renamed = { ...file!, name: outName }
      return {
        name: outName,
        recordId: this.addDocument(outName, renamed, 'herramienta', job.clientId),
        path: null,
      }
    } catch (e) {
      if (job.target === 'exportar') rmSync(output, { force: true })
      throw e
    } finally {
      if (job.target === 'boveda') rmSync(output, { force: true })
    }
  }

  cancel(token: string): void {
    this.running.get(token)?.kill()
  }

  /** Para todo lo que esté en marcha y limpia la carpeta temporal (al bloquear). */
  dispose(): void {
    for (const p of this.running.values()) p.kill()
    this.running.clear()
    this.videos.clear()
    const root = this.vault.currentPath
    if (root) rmSync(join(root, TOOLS_TMP), { recursive: true, force: true })
  }

  // --- Internos ------------------------------------------------------------------------

  private requireFfmpeg(): void {
    if (!existsSync(this.deps.ffmpeg())) throw new AppError('FFMPEG_MISSING')
  }

  private tmpDir(): string {
    const root = this.vault.currentPath
    if (!root) throw new AppError('VAULT_IS_LOCKED')
    const dir = join(root, TOOLS_TMP)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * Ejecuta FFmpeg. Con `probe`, solo lee la cabecera (FFmpeg acaba con error porque no
   * hay salida) y devuelve la salida de error. Con `progress`, informa del avance.
   */
  private run(
    args: string[],
    progress: { token: string; duration: number | null } | null,
    probe = false,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.deps.ffmpeg(), args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      if (progress) this.running.set(progress.token, child)
      let stderr = ''
      let buffer = ''
      child.stderr.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString('utf8')).slice(-20_000)
      })
      child.stdout.on('data', (d: Buffer) => {
        if (!progress) return
        buffer += d.toString('utf8')
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const m = /^out_time_us=(\d+)/.exec(line.trim())
          if (m && progress.duration)
            this.deps.onProgress?.({
              token: progress.token,
              ratio: Math.min(1, Number(m[1]) / 1e6 / progress.duration),
            })
        }
      })
      child.on('error', () => {
        if (progress) this.running.delete(progress.token)
        reject(new AppError('FFMPEG_MISSING'))
      })
      child.on('close', (code, signal) => {
        if (progress) this.running.delete(progress.token)
        if (probe) return resolve(stderr)
        if (signal) return reject(new AppError('TOOL_CANCELLED'))
        if (code !== 0)
          return reject(
            new AppError('TOOL_FAILED', undefined, t('FFmpeg no ha podido convertir el vídeo.')),
          )
        if (progress) this.deps.onProgress?.({ token: progress.token, ratio: 1 })
        resolve(stderr)
      })
    })
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private timeZone(): string {
    try {
      return this.vault.data.getProfile().timeZone
    } catch {
      return 'Europe/Madrid'
    }
  }
}
