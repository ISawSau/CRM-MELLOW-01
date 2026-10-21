import { randomBytes } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, normalize, relative, isAbsolute } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AppError } from '@shared/errors'
import { t } from '@shared/i18n'

/**
 * Almacén remoto de la sincronización (SPEC §4). Todo lo que se sube ya va cifrado
 * (crm.db con SQLCipher, archivos con AES-GCM, vault.json con las ranuras cifradas).
 *
 * Rutas: `sync.json`, `crm.db`, `vault.json`, `files/<id>.bin`, `thumbs/<id>.bin`,
 * `backups/<copia>/crm.db` y `backups/<copia>/vault.json`.
 */
export interface Remote {
  readonly kind: 'folder' | 'drive'
  readonly label: string
  /** Nombres de los elementos de una carpeta remota ('' = raíz). */
  list(dir: string): Promise<string[]>
  /** Descarga a `dest`; false si no existe. `onProgress`: bytes bajados y total. */
  get(
    path: string,
    dest: string,
    onProgress?: (received: number, total: number | null) => void,
  ): Promise<boolean>
  /** Sube `src`. `onProgress`: bytes subidos y total. */
  put(path: string, src: string, onProgress?: (sent: number, total: number) => void): Promise<void>
  readText(path: string): Promise<string | null>
  writeText(path: string, text: string): Promise<void>
  /** Contenido de un archivo pequeño (paquetes de cambios, D-125); null si no existe. */
  readBytes(path: string): Promise<Buffer | null>
  /** `fresh`: el nombre es nuevo (no hace falta buscar si ya existe). */
  writeBytes(path: string, data: Buffer, o?: { fresh?: boolean }): Promise<void>
  remove(path: string): Promise<void>
}

function checkPath(path: string): string {
  const parts = path.split('/')
  if (!path || parts.some((p) => p === '' || p === '.' || p === '..' || /[\\:]/.test(p)))
    throw new Error(`Ruta remota no válida: ${path}`)
  return path
}

/**
 * Carpeta del equipo como destino: un USB, un disco de red o una carpeta que ya
 * sincroniza otro programa (Syncthing, Nextcloud…). Escrituras atómicas.
 */
export class FolderRemote implements Remote {
  readonly kind = 'folder'
  constructor(private readonly root: string) {}

  get label(): string {
    return this.root
  }

  private abs(path: string): string {
    const p = normalize(join(this.root, checkPath(path)))
    const rel = relative(this.root, p)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Ruta fuera de la carpeta')
    return p
  }

  async list(dir: string): Promise<string[]> {
    const p = dir ? this.abs(dir) : this.root
    if (!existsSync(p)) return []
    return readdirSync(p).filter((n) => !n.startsWith('.tmp-'))
  }

  async get(path: string, dest: string): Promise<boolean> {
    const p = this.abs(path)
    if (!existsSync(p)) return false
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(p, dest)
    return true
  }

  async put(path: string, src: string): Promise<void> {
    const p = this.abs(path)
    mkdirSync(dirname(p), { recursive: true })
    const tmp = join(dirname(p), `.tmp-${randomBytes(6).toString('hex')}`)
    copyFileSync(src, tmp)
    renameSync(tmp, p)
  }

  async readText(path: string): Promise<string | null> {
    const p = this.abs(path)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, Buffer.from(text, 'utf8'))
  }

  async readBytes(path: string): Promise<Buffer | null> {
    const p = this.abs(path)
    return existsSync(p) ? readFileSync(p) : null
  }

  async writeBytes(path: string, data: Buffer): Promise<void> {
    const p = this.abs(path)
    mkdirSync(dirname(p), { recursive: true })
    const tmp = join(dirname(p), `.tmp-${randomBytes(6).toString('hex')}`)
    writeFileSync(tmp, data)
    renameSync(tmp, p)
  }

  async remove(path: string): Promise<void> {
    rmSync(this.abs(path), { recursive: true, force: true })
  }
}

// --- Google Drive ------------------------------------------------------------------

/** Direcciones de la API de Drive (los tests de interfaz usan un Google falso). */
export interface DriveUrls {
  api: string
  upload: string
}
export const DRIVE_URLS: DriveUrls = {
  api: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
}
const FOLDER = 'application/vnd.google-apps.folder'
/** Nombre de la carpeta de cada bóveda en Drive: el prefijo y el principio de su id. */
export const DRIVE_ROOT_PREFIX = 'CRM Mellow · '
/** Por encima de esto se usa la subida reanudable (documentación de Drive: 5 MB). */
const SIMPLE_LIMIT = 5 * 1024 * 1024
/** Trozos de la subida reanudable: múltiplo de 256 KB. */
const RESUMABLE_CHUNK = 8 * 1024 * 1024
/** Una descarga que no recibe nada en este tiempo se da por perdida (red móvil caída). */
const DOWNLOAD_IDLE_MS = 60_000
/**
 * Límite de cada llamada a Drive (D-124). Sin él, una conexión del móvil que se queda a
 * medias (cobertura, cambio de wifi a datos) dejaba la sincronización en «sincronizando»
 * para siempre.
 */
const CALL_TIMEOUT_MS = 60_000
/** Límite de cada trozo de una subida reanudable (8 MB con mala cobertura). */
const CHUNK_TIMEOUT_MS = 5 * 60_000
/** Esperas antes de cada reintento ante fallos de red, 429 o 5xx. */
const RETRY_DELAYS_MS = [1_000, 4_000, 15_000, 30_000]

export interface DriveTiming {
  callTimeoutMs: number
  chunkTimeoutMs: number
  idleMs: number
  retryDelaysMs: number[]
}
const DEFAULT_TIMING: DriveTiming = {
  callTimeoutMs: CALL_TIMEOUT_MS,
  chunkTimeoutMs: CHUNK_TIMEOUT_MS,
  idleMs: DOWNLOAD_IDLE_MS,
  retryDelaysMs: RETRY_DELAYS_MS,
}

/** Fallo de red (sin respuesta de Drive) o tiempo agotado: se puede reintentar. */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof AppError) return false
  if (!(e instanceof Error)) return false
  if (e.name === 'AbortError' || e.name === 'TimeoutError' || e.name === 'DriveBusyError')
    return true
  const cause = (e as { cause?: unknown }).cause
  const text = `${e.message} ${String((e as { code?: unknown }).code ?? '')} ${cause instanceof Error ? `${cause.message} ${String((cause as { code?: unknown }).code ?? '')}` : ''}`
  return (
    (e instanceof TypeError && /fetch failed|network|terminated/i.test(e.message)) ||
    /ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|UND_ERR|socket hang up|other side closed/i.test(
      text,
    )
  )
}

/** Respuesta de Drive que se repite: límite de uso o fallo temporal de Google. */
function isRetryableStatus(status: number, text: string): boolean {
  return (
    status === 429 ||
    status >= 500 ||
    (status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(text))
  )
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** «bytes=0-42» → 43 (el siguiente byte que hay que mandar); sin cabecera, 0. */
function nextOffset(res: Response): number {
  const m = /bytes=(\d+)-(\d+)/.exec(res.headers.get('range') ?? '')
  return m ? Number(m[2]) + 1 : 0
}

/**
 * Error de una respuesta de Drive. Los dos fallos de configuración típicos se explican:
 * la API de Drive sin activar en el proyecto de Google Cloud y el acceso rechazado.
 */
export function driveError(status: number, text: string): Error {
  if (
    status === 403 &&
    /SERVICE_DISABLED|accessNotConfigured|has not been used in project|is disabled/i.test(text)
  )
    return new AppError(
      'GOOGLE_ERROR',
      undefined,
      t(
        'La API de Google Drive no está activada en tu proyecto de Google Cloud. Actívala en «APIs y servicios» → «Biblioteca» → «Google Drive API», espera un par de minutos y vuelve a intentarlo.',
      ),
    )
  if (status === 401)
    return new AppError(
      'GOOGLE_ERROR',
      undefined,
      t('Google Drive no ha aceptado el acceso. Vuelve a conectar con Google.'),
    )
  return new Error(
    t('Google Drive respondió {status}: {text}', { status, text: text.slice(0, 200) }),
  )
}

export type FetchLike = typeof fetch

/**
 * Google Drive con el permiso `drive.file`: la app solo ve lo que ella misma crea.
 * Todo vive en una carpeta propia de la bóveda.
 */
export class DriveRemote implements Remote {
  readonly kind = 'drive'
  private folders = new Map<string, string>()
  /** Ids de los archivos vistos al listar: leerlos luego no necesita buscarlos (D-125). */
  private known = new Map<string, string>()

  private readonly timing: DriveTiming

  constructor(
    private readonly rootName: string,
    private readonly token: () => Promise<string>,
    private readonly http: FetchLike = fetch,
    private readonly urls: DriveUrls = DRIVE_URLS,
    timing: Partial<DriveTiming> = {},
  ) {
    this.timing = { ...DEFAULT_TIMING, ...timing }
  }

  get label(): string {
    return `Google Drive · ${this.rootName}`
  }

  /**
   * Carpetas de bóvedas de CRM Mellow en la raíz de Drive («CRM Mellow · <id>»). Con
   * `drive.file` solo aparecen las que creó la propia app (desde cualquier equipo).
   */
  static async vaultFolders(
    token: () => Promise<string>,
    http: FetchLike = fetch,
    urls: DriveUrls = DRIVE_URLS,
  ): Promise<string[]> {
    const q = [
      `name contains '${DRIVE_ROOT_PREFIX}'`,
      'trashed = false',
      `'root' in parents`,
      `mimeType = '${FOLDER}'`,
    ].join(' and ')
    const res = await http(
      `${urls.api}/files?${new URLSearchParams({ q, fields: 'files(name)', pageSize: '50', spaces: 'drive' })}`,
      {
        headers: { Authorization: `Bearer ${await token()}` },
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      },
    )
    if (!res.ok) throw driveError(res.status, await res.text().catch(() => ''))
    const json = (await res.json()) as { files?: { name: string }[] }
    return [...new Set((json.files ?? []).map((f) => f.name))].filter((n) =>
      n.startsWith(DRIVE_ROOT_PREFIX),
    )
  }

  /**
   * Llamada a Drive con límite de tiempo y reintentos ante fallos de red, 429 y 5xx
   * (D-124). Devuelve la respuesta (también 308 y 404); el resto de errores se lanzan.
   * `stream`: el límite solo cubre hasta las cabeceras (el cuerpo lo vigila quien lo lee).
   */
  private async call(
    url: string,
    init: RequestInit = {},
    o: { stream?: boolean; timeoutMs?: number; auth?: boolean; retry?: boolean } = {},
  ): Promise<Response> {
    // Sin reintentos aquí cuando quien llama ya repite la operación entera (descargas).
    const delays = o.retry === false ? [] : this.timing.retryDelaysMs
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController()
      const timer = setTimeout(
        () => ctrl.abort(new DOMException('Drive no responde', 'TimeoutError')),
        o.timeoutMs ?? this.timing.callTimeoutMs,
      )
      try {
        const headers: Record<string, string> = {
          ...((init.headers as Record<string, string>) ?? {}),
        }
        if (o.auth !== false) headers['Authorization'] = `Bearer ${await this.token()}`
        const res = await this.http(url, { ...init, headers, signal: ctrl.signal })
        if (res.ok || res.status === 308 || res.status === 404) {
          if (!o.stream) {
            // El cuerpo se lee ya, dentro del límite de tiempo.
            const body = await res.arrayBuffer()
            return new Response([204, 205, 304].includes(res.status) ? null : body, {
              status: res.status,
              headers: res.headers,
            })
          }
          return res
        }
        const text = await res.text().catch(() => '')
        const busy = isRetryableStatus(res.status, text)
        if (busy && attempt < delays.length) {
          await sleep(delays[attempt]!)
          continue
        }
        const err = driveError(res.status, text)
        // Google ocupado: quien repite la operación entera (descargas) puede reintentarla.
        if (busy) err.name = 'DriveBusyError'
        throw err
      } catch (e) {
        if (!isNetworkError(e) || attempt >= delays.length) throw e
        await sleep(delays[attempt]!)
      } finally {
        // Con `stream`, el cuerpo lo vigila quien lo lee (sin datos en `idleMs`, se corta).
        clearTimeout(timer)
      }
    }
  }

  private static q(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  }

  private async find(name: string, parent: string | null, folder: boolean): Promise<string | null> {
    const q = [
      `name = '${DriveRemote.q(name)}'`,
      'trashed = false',
      parent ? `'${parent}' in parents` : `'root' in parents`,
      folder ? `mimeType = '${FOLDER}'` : `mimeType != '${FOLDER}'`,
    ].join(' and ')
    const res = await this.call(
      `${this.urls.api}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' })}`,
    )
    const json = (await res.json()) as { files?: { id: string }[] }
    return json.files?.[0]?.id ?? null
  }

  /** Id de la carpeta remota (la crea si hace falta). `dir` relativo a la raíz. */
  private async folder(dir: string, create = true): Promise<string | null> {
    const key = dir
    const cached = this.folders.get(key)
    if (cached) return cached
    let parent: string | null = null
    let path = ''
    for (const part of [this.rootName, ...(dir ? dir.split('/') : [])]) {
      path = path ? `${path}/${part}` : part
      const known = this.folders.get(path)
      if (known) {
        parent = known
        continue
      }
      let id = await this.find(part, parent, true)
      if (!id) {
        if (!create) return null
        const res = await this.call(`${this.urls.api}/files?fields=id`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: part, mimeType: FOLDER, parents: parent ? [parent] : [] }),
        })
        id = ((await res.json()) as { id: string }).id
      }
      this.folders.set(path, id)
      parent = id
    }
    this.folders.set(key, parent!)
    return parent
  }

  private split(path: string): { dir: string; name: string } {
    checkPath(path)
    const i = path.lastIndexOf('/')
    return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) }
  }

  private async fileId(path: string): Promise<string | null> {
    const seen = this.known.get(path)
    if (seen) return seen
    const { dir, name } = this.split(path)
    const parent = await this.folder(dir, false)
    return parent ? this.find(name, parent, false) : null
  }

  async list(dir: string): Promise<string[]> {
    const parent = await this.folder(dir, false)
    if (!parent) return []
    const names: string[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q: `'${parent}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name)',
        pageSize: '1000',
        spaces: 'drive',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const res = await this.call(`${this.urls.api}/files?${params}`)
      const json = (await res.json()) as {
        files?: { id: string; name: string }[]
        nextPageToken?: string
      }
      for (const f of json.files ?? []) {
        names.push(f.name)
        this.known.set(dir ? `${dir}/${f.name}` : f.name, f.id)
      }
      pageToken = json.nextPageToken
    } while (pageToken)
    return names
  }

  async get(
    path: string,
    dest: string,
    onProgress?: (received: number, total: number | null) => void,
  ): Promise<boolean> {
    const id = await this.fileId(path)
    if (!id) return false
    mkdirSync(dirname(dest), { recursive: true })
    const tmp = `${dest}.part`
    rmSync(tmp, { force: true })
    const delays = this.timing.retryDelaysMs
    // Si se corta, sigue por donde iba (cabecera Range) en lugar de empezar de cero.
    for (let attempt = 0; ; attempt++) {
      const have = existsSync(tmp) ? statSync(tmp).size : 0
      try {
        const done = await this.download(id, tmp, have, onProgress)
        if (!done) return false
        break
      } catch (e) {
        if (!isNetworkError(e) || attempt >= delays.length) {
          rmSync(tmp, { force: true })
          throw e
        }
        await sleep(delays[attempt]!)
      }
    }
    renameSync(tmp, dest)
    return true
  }

  /** Una pasada de descarga a `tmp` desde el byte `from`. False si ya no existe. */
  private async download(
    id: string,
    tmp: string,
    from: number,
    onProgress?: (received: number, total: number | null) => void,
  ): Promise<boolean> {
    const res = await this.call(
      `${this.urls.api}/files/${id}?alt=media`,
      from > 0 ? { headers: { Range: `bytes=${from}-` } } : {},
      { stream: true, retry: false },
    )
    if (res.status === 404 || !res.body) {
      await res.body?.cancel().catch(() => {})
      return false
    }
    // 206: el resto del archivo; 200: el archivo entero (el servidor no admite Range).
    const resume = from > 0 && res.status === 206
    const length = Number(res.headers.get('content-length')) || null
    const total = length === null ? null : resume ? from + length : length
    const body = Readable.fromWeb(res.body as never)
    const stalled = setTimeout(() => {
      const e = new Error(t('La descarga de Google Drive se ha quedado parada.'))
      e.name = 'TimeoutError'
      body.destroy(e)
    }, this.timing.idleMs)
    let received = resume ? from : 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length
        stalled.refresh()
        onProgress?.(received, total)
        done(null, chunk)
      },
    })
    try {
      await pipeline(body, meter, createWriteStream(tmp, { flags: resume ? 'a' : 'w' }))
    } finally {
      clearTimeout(stalled)
    }
    return true
  }

  async put(
    path: string,
    src: string,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const { dir, name } = this.split(path)
    const parent = await this.folder(dir)
    const existing = await this.find(name, parent, false)
    const size = statSync(src).size
    if (size <= SIMPLE_LIMIT) {
      await this.putBuffer(parent!, name, existing, readFileSync(src))
      onProgress?.(size, size)
      return
    }
    await this.putResumable(parent!, name, existing, src, size, onProgress)
  }

  /** Abre una sesión de subida reanudable. */
  private async session(parent: string, name: string, existing: string | null, size: number) {
    const start = await this.call(
      existing
        ? `${this.urls.upload}/files/${existing}?uploadType=resumable`
        : `${this.urls.upload}/files?uploadType=resumable&fields=id`,
      {
        method: existing ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'application/octet-stream',
          'X-Upload-Content-Length': String(size),
        },
        body: JSON.stringify(existing ? {} : { name, parents: [parent] }),
      },
    )
    const session = start.headers.get('location')
    if (!session) throw new Error(t('Google Drive no devolvió la sesión de subida'))
    return session
  }

  /**
   * Subida reanudable por trozos (documentación de Drive, «Resume an interrupted upload»):
   * si un trozo falla, se pregunta a Drive cuánto ha recibido (un PUT vacío
   * con `Content-Range` «bytes asterisco barra total») y se sigue desde ahí; si la sesión ha caducado
   * (404 u otro 4xx), se empieza una nueva.
   */
  private async putResumable(
    parent: string,
    name: string,
    existing: string | null,
    src: string,
    size: number,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const delays = this.timing.retryDelaysMs
    let session = await this.session(parent, name, existing, size)
    let offset = 0
    let failures = 0
    let ask = false
    const fail = async (e: unknown) => {
      if (failures >= delays.length) throw e
      await sleep(delays[failures++]!)
    }
    const fd = openSync(src, 'r')
    try {
      while (offset < size) {
        let res: Response
        if (ask) {
          try {
            res = await this.call(
              session,
              { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } },
              { auth: false },
            )
          } catch (e) {
            if (!isNetworkError(e)) {
              // Sesión caducada o rechazada: otra nueva desde el principio.
              await fail(e)
              session = await this.session(parent, name, existing, size)
              offset = 0
              ask = false
              continue
            }
            throw e
          }
        } else {
          const len = Math.min(RESUMABLE_CHUNK, size - offset)
          const buf = Buffer.alloc(len)
          readSync(fd, buf, 0, len, offset)
          const ctrl = new AbortController()
          const timer = setTimeout(
            () => ctrl.abort(new DOMException('Drive no responde', 'TimeoutError')),
            this.timing.chunkTimeoutMs,
          )
          try {
            res = await this.http(session, {
              method: 'PUT',
              headers: { 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` },
              body: new Uint8Array(buf),
              signal: ctrl.signal,
            })
            await res.arrayBuffer().catch(() => null)
          } catch (e) {
            if (!isNetworkError(e)) throw e
            await fail(e)
            ask = true
            continue
          } finally {
            clearTimeout(timer)
          }
        }
        if (res.ok) {
          onProgress?.(size, size)
          return
        }
        if (res.status === 308) {
          const next = nextOffset(res)
          // Un trozo que no avanza cuenta como fallo (así nunca da vueltas sin fin).
          if (!ask && next <= offset)
            await fail(new Error(t('La subida a Google Drive no avanza.')))
          else if (!ask) failures = 0
          offset = next
          ask = false
          onProgress?.(offset, size)
          continue
        }
        const text = await res.text().catch(() => '')
        await fail(
          new Error(t('La subida a Google Drive falló ({status})', { status: res.status })),
        )
        if (isRetryableStatus(res.status, text)) {
          ask = true
          continue
        }
        session = await this.session(parent, name, existing, size)
        offset = 0
        ask = false
      }
    } finally {
      closeSync(fd)
    }
  }

  /** Subida simple (hasta 5 MB) de un contenido en memoria. */
  private async putBuffer(
    parent: string,
    name: string,
    existing: string | null,
    data: Buffer,
  ): Promise<void> {
    if (existing) {
      await this.call(`${this.urls.upload}/files/${existing}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(data),
      })
      return
    }
    const boundary = `crm-${randomBytes(8).toString('hex')}`
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          JSON.stringify({ name, parents: [parent] }) +
          `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ])
    await this.call(`${this.urls.upload}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    })
  }

  async readText(path: string): Promise<string | null> {
    const id = await this.fileId(path)
    if (!id) return null
    const res = await this.call(`${this.urls.api}/files/${id}?alt=media`)
    return res.status === 404 ? null : res.text()
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, Buffer.from(text, 'utf8'))
  }

  async readBytes(path: string): Promise<Buffer | null> {
    const id = await this.fileId(path)
    if (!id) return null
    const res = await this.call(`${this.urls.api}/files/${id}?alt=media`)
    if (res.status === 404) {
      this.known.delete(path)
      return null
    }
    return Buffer.from(await res.arrayBuffer())
  }

  async writeBytes(path: string, data: Buffer, o: { fresh?: boolean } = {}): Promise<void> {
    const { dir, name } = this.split(path)
    const parent = await this.folder(dir)
    const existing = o.fresh ? null : await this.find(name, parent, false)
    await this.putBuffer(parent!, name, existing, data)
  }

  async remove(path: string): Promise<void> {
    const { dir, name } = this.split(path)
    const parent = await this.folder(dir, false)
    if (!parent) return
    const id = (await this.find(name, parent, false)) ?? (await this.find(name, parent, true))
    if (id) await this.call(`${this.urls.api}/files/${id}`, { method: 'DELETE' })
    this.folders.delete(path)
    for (const k of [...this.known.keys()])
      if (k === path || k.startsWith(`${path}/`)) this.known.delete(k)
    for (const k of [...this.folders.keys()]) if (k.startsWith(`${path}/`)) this.folders.delete(k)
  }
}
