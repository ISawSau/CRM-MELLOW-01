import { randomBytes } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, normalize, relative, isAbsolute } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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
  /** Descarga a `dest`; false si no existe. */
  get(path: string, dest: string): Promise<boolean>
  put(path: string, src: string): Promise<void>
  readText(path: string): Promise<string | null>
  writeText(path: string, text: string): Promise<void>
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
    const p = this.abs(path)
    mkdirSync(dirname(p), { recursive: true })
    const tmp = join(dirname(p), `.tmp-${randomBytes(6).toString('hex')}`)
    writeFileSync(tmp, text)
    renameSync(tmp, p)
  }

  async remove(path: string): Promise<void> {
    rmSync(this.abs(path), { recursive: true, force: true })
  }
}

// --- Google Drive ------------------------------------------------------------------

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
/** Por encima de esto se usa la subida reanudable (documentación de Drive: 5 MB). */
const SIMPLE_LIMIT = 5 * 1024 * 1024
/** Trozos de la subida reanudable: múltiplo de 256 KB. */
const RESUMABLE_CHUNK = 8 * 1024 * 1024

export type FetchLike = typeof fetch

/**
 * Google Drive con el permiso `drive.file`: la app solo ve lo que ella misma crea.
 * Todo vive en una carpeta propia de la bóveda.
 */
export class DriveRemote implements Remote {
  readonly kind = 'drive'
  private folders = new Map<string, string>()

  constructor(
    private readonly rootName: string,
    private readonly token: () => Promise<string>,
    private readonly http: FetchLike = fetch,
  ) {}

  get label(): string {
    return `Google Drive · ${this.rootName}`
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.http(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await this.token()}` },
    })
    if (!res.ok && res.status !== 308 && res.status !== 404) {
      const text = await res.text().catch(() => '')
      throw new Error(
        t('Google Drive respondió {status}: {text}', {
          status: res.status,
          text: text.slice(0, 200),
        }),
      )
    }
    return res
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
      `${API}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' })}`,
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
        const res = await this.call(`${API}/files?fields=id`, {
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
        fields: 'nextPageToken, files(name)',
        pageSize: '1000',
        spaces: 'drive',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const res = await this.call(`${API}/files?${params}`)
      const json = (await res.json()) as { files?: { name: string }[]; nextPageToken?: string }
      for (const f of json.files ?? []) names.push(f.name)
      pageToken = json.nextPageToken
    } while (pageToken)
    return names
  }

  async get(path: string, dest: string): Promise<boolean> {
    const id = await this.fileId(path)
    if (!id) return false
    const res = await this.call(`${API}/files/${id}?alt=media`)
    if (res.status === 404 || !res.body) return false
    mkdirSync(dirname(dest), { recursive: true })
    const tmp = `${dest}.part`
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp))
    renameSync(tmp, dest)
    return true
  }

  async put(path: string, src: string): Promise<void> {
    const { dir, name } = this.split(path)
    const parent = await this.folder(dir)
    const existing = await this.find(name, parent, false)
    const size = statSync(src).size
    if (size <= SIMPLE_LIMIT) return this.putBuffer(parent!, name, existing, readFileSync(src))
    // Subida reanudable por trozos.
    const start = await this.call(
      existing
        ? `${UPLOAD}/files/${existing}?uploadType=resumable`
        : `${UPLOAD}/files?uploadType=resumable&fields=id`,
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
    let offset = 0
    for await (const chunk of createReadStream(src, { highWaterMark: RESUMABLE_CHUNK })) {
      const buf = chunk as Buffer
      const end = offset + buf.length - 1
      const res = await this.http(session, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${offset}-${end}/${size}` },
        body: new Uint8Array(buf),
      })
      if (res.status !== 308 && !res.ok)
        throw new Error(t('La subida a Google Drive falló ({status})', { status: res.status }))
      offset = end + 1
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
      await this.call(`${UPLOAD}/files/${existing}?uploadType=media`, {
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
    await this.call(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    })
  }

  async readText(path: string): Promise<string | null> {
    const id = await this.fileId(path)
    if (!id) return null
    const res = await this.call(`${API}/files/${id}?alt=media`)
    return res.status === 404 ? null : res.text()
  }

  async writeText(path: string, text: string): Promise<void> {
    const { dir, name } = this.split(path)
    const parent = await this.folder(dir)
    const existing = await this.find(name, parent, false)
    await this.putBuffer(parent!, name, existing, Buffer.from(text, 'utf8'))
  }

  async remove(path: string): Promise<void> {
    const { dir, name } = this.split(path)
    const parent = await this.folder(dir, false)
    if (!parent) return
    const id = (await this.find(name, parent, false)) ?? (await this.find(name, parent, true))
    if (id) await this.call(`${API}/files/${id}`, { method: 'DELETE' })
    this.folders.delete(path)
  }
}
