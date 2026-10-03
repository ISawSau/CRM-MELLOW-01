import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { SqliteDb } from '../db/connection'
import { deriveSubkey, zeroize } from '../vault/crypto'

/**
 * Almacén de archivos cifrados de la bóveda (SPEC §3 y §7.8).
 *
 * - Id: HMAC-SHA256 del contenido con una clave de la bóveda. Deduplica (el mismo
 *   archivo dos veces se guarda una vez) sin revelar el hash real del contenido.
 * - Cifrado: AES-256-GCM por bloques de 1 MiB. Cada bloque lleva su nonce (base +
 *   número de bloque) y su etiqueta, y autentica la cabecera, su posición y si es el
 *   último: no se pueden reordenar, truncar ni mezclar bloques. Se puede leer un
 *   trozo cualquiera (vídeos con avance) descifrando solo los bloques necesarios.
 * - La clave de archivos es aleatoria y vive dentro de la base de datos cifrada, así
 *   que rotar la clave maestra no obliga a volver a cifrar los archivos.
 *
 * Formato: "CRMF" | versión (1) | tamaño de bloque (u32) | nonce base (12) |
 * tamaño en claro (u64) | bloques (cifrado + etiqueta de 16 bytes).
 */

const MAGIC = Buffer.from('CRMF')
const VERSION = 1
export const CHUNK = 1024 * 1024
const HEADER = 4 + 1 + 4 + 12 + 8
const TAG = 16
const ID_RE = /^[a-f0-9]{64}$/

export function isFileId(id: string): boolean {
  return ID_RE.test(id)
}

function nonceFor(base: Buffer, index: number): Buffer {
  const n = Buffer.from(base)
  n.writeUInt32BE((n.readUInt32BE(8) ^ index) >>> 0, 8)
  return n
}

function aadFor(header: Buffer, index: number, last: boolean): Buffer {
  const extra = Buffer.alloc(5)
  extra.writeUInt32BE(index, 0)
  extra[4] = last ? 1 : 0
  return Buffer.concat([header, extra])
}

interface Header {
  chunk: number
  nonce: Buffer
  size: number
  raw: Buffer
}

function parseHeader(raw: Buffer): Header {
  if (raw.length < HEADER || !raw.subarray(0, 4).equals(MAGIC) || raw[4] !== VERSION)
    throw new Error('Archivo de la bóveda dañado o de una versión desconocida')
  return {
    chunk: raw.readUInt32BE(5),
    nonce: raw.subarray(9, 21),
    size: Number(raw.readBigUInt64BE(21)),
    raw: raw.subarray(0, HEADER),
  }
}

export class FileStore {
  private readonly encKey: Buffer
  private readonly macKey: Buffer
  private readonly root: string

  /** `secret`: clave de archivos de la bóveda (32 bytes). `vaultPath`: carpeta de la bóveda. */
  constructor(secret: Buffer, vaultPath: string) {
    this.encKey = deriveSubkey(secret, 'crm-mellow/files/enc/v1')
    this.macKey = deriveSubkey(secret, 'crm-mellow/files/mac/v1')
    this.root = vaultPath
  }

  dispose(): void {
    zeroize(this.encKey)
    zeroize(this.macKey)
  }

  private pathOf(kind: 'files' | 'thumbs', id: string): string {
    if (!isFileId(id)) throw new Error('Id de archivo no válido')
    return join(this.root, kind, id.slice(0, 2), `${id}.bin`)
  }

  exists(id: string, kind: 'files' | 'thumbs' = 'files'): boolean {
    return isFileId(id) && existsSync(this.pathOf(kind, id))
  }

  /**
   * Cifra y guarda un contenido que se lee por bloques con `read(buf)` (devuelve los
   * bytes leídos, 0 al final). Devuelve el id y el tamaño. Si ya existe, no se duplica.
   */
  private store(
    read: (buf: Buffer) => number,
    size: number,
    kind: 'files' | 'thumbs',
    forcedId?: string,
  ): { id: string; size: number } {
    const nonce = randomBytes(12)
    const header = Buffer.alloc(HEADER)
    MAGIC.copy(header, 0)
    header[4] = VERSION
    header.writeUInt32BE(CHUNK, 5)
    nonce.copy(header, 9)
    header.writeBigUInt64BE(BigInt(size), 21)
    const tmpDir = join(this.root, kind)
    mkdirSync(tmpDir, { recursive: true })
    const tmp = join(tmpDir, `.tmp-${randomBytes(8).toString('hex')}`)
    const mac = createHmac('sha256', this.macKey)
    const out = openSync(tmp, 'wx')
    let total = 0
    try {
      writeSync(out, header)
      const buf = Buffer.alloc(CHUNK)
      const chunks = Math.max(1, Math.ceil(size / CHUNK))
      for (let i = 0; i < chunks; i++) {
        const want = Math.min(CHUNK, size - total)
        let got = 0
        while (got < want) {
          const n = read(buf.subarray(got, want))
          if (n <= 0) break
          got += n
        }
        if (got !== want) throw new Error('El archivo ha cambiado mientras se importaba')
        const plain = buf.subarray(0, got)
        mac.update(plain)
        const last = i === chunks - 1
        const c = createCipheriv('aes-256-gcm', this.encKey, nonceFor(nonce, i))
        c.setAAD(aadFor(header, i, last))
        writeSync(out, Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]))
        total += got
      }
    } catch (e) {
      closeSync(out)
      rmSync(tmp, { force: true })
      throw e
    }
    closeSync(out)
    const id = forcedId ?? mac.digest('hex')
    const dest = this.pathOf(kind, id)
    if (existsSync(dest)) {
      rmSync(tmp, { force: true })
    } else {
      mkdirSync(dirname(dest), { recursive: true })
      renameSync(tmp, dest)
    }
    return { id, size: total }
  }

  /** Importa un archivo del disco sin cargarlo entero en memoria. */
  importPath(path: string): { id: string; size: number } {
    const fd = openSync(path, 'r')
    try {
      const size = fstatSync(fd).size
      return this.store((b) => readSync(fd, b, 0, b.length, null), size, 'files')
    } finally {
      closeSync(fd)
    }
  }

  importBuffer(data: Uint8Array): { id: string; size: number } {
    let pos = 0
    const src = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    return this.store(
      (b) => {
        const n = src.copy(b, 0, pos, Math.min(pos + b.length, src.length))
        pos += n
        return n
      },
      src.length,
      'files',
    )
  }

  /** Guarda la miniatura de un archivo (con el mismo id, en `thumbs/`). */
  saveThumb(id: string, data: Uint8Array): void {
    let pos = 0
    const src = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const dest = this.pathOf('thumbs', id)
    if (existsSync(dest)) rmSync(dest)
    this.store(
      (b) => {
        const n = src.copy(b, 0, pos, Math.min(pos + b.length, src.length))
        pos += n
        return n
      },
      src.length,
      'thumbs',
      id,
    )
  }

  /** Tamaño en claro. */
  size(id: string, kind: 'files' | 'thumbs' = 'files'): number {
    const fd = openSync(this.pathOf(kind, id), 'r')
    try {
      const raw = Buffer.alloc(HEADER)
      readSync(fd, raw, 0, HEADER, 0)
      return parseHeader(raw).size
    } finally {
      closeSync(fd)
    }
  }

  /**
   * Descifra los bytes [start, end] (ambos incluidos) bloque a bloque. Lanza si algún
   * bloque no se autentica (archivo manipulado o clave incorrecta).
   */
  *readRange(
    id: string,
    start = 0,
    end?: number,
    kind: 'files' | 'thumbs' = 'files',
  ): Generator<Buffer> {
    const fd = openSync(this.pathOf(kind, id), 'r')
    try {
      const raw = Buffer.alloc(HEADER)
      readSync(fd, raw, 0, HEADER, 0)
      const h = parseHeader(raw)
      const last = end === undefined ? h.size - 1 : Math.min(end, h.size - 1)
      if (h.size === 0 || start > last) return
      const chunks = Math.max(1, Math.ceil(h.size / h.chunk))
      const first = Math.floor(start / h.chunk)
      const lastChunk = Math.floor(last / h.chunk)
      for (let i = first; i <= lastChunk; i++) {
        const plainLen = Math.min(h.chunk, h.size - i * h.chunk)
        const enc = Buffer.alloc(plainLen + TAG)
        readSync(fd, enc, 0, enc.length, HEADER + i * (h.chunk + TAG))
        const d = createDecipheriv('aes-256-gcm', this.encKey, nonceFor(h.nonce, i))
        d.setAAD(aadFor(h.raw, i, i === chunks - 1))
        d.setAuthTag(enc.subarray(plainLen))
        const plain = Buffer.concat([d.update(enc.subarray(0, plainLen)), d.final()])
        const from = i === first ? start - i * h.chunk : 0
        const to = i === lastChunk ? last - i * h.chunk + 1 : plainLen
        yield plain.subarray(from, to)
      }
    } finally {
      closeSync(fd)
    }
  }

  read(id: string, kind: 'files' | 'thumbs' = 'files'): Buffer {
    return Buffer.concat([...this.readRange(id, 0, undefined, kind)])
  }

  remove(id: string): void {
    rmSync(this.pathOf('files', id), { force: true })
    rmSync(this.pathOf('thumbs', id), { force: true })
  }
}

/**
 * Clave de archivos de la bóveda: aleatoria, guardada como ajuste dentro de la base
 * de datos cifrada. Se crea la primera vez que hace falta.
 */
export function loadOrCreateFilesKey(db: SqliteDb): Buffer {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'files.key'").get() as
    { value: string } | undefined
  if (row) {
    const hex = JSON.parse(row.value) as string
    if (/^[a-f0-9]{64}$/.test(hex)) return Buffer.from(hex, 'hex')
  }
  const key = randomBytes(32)
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('files.key', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(key.toString('hex')), new Date().toISOString())
  return key
}
