import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHUNK, FileStore } from '../../src/main/files/file-store'
import { tempDir } from './helpers'

function store(secret = randomBytes(32)) {
  const dir = tempDir()
  return { fs: new FileStore(secret, dir), dir, secret }
}

const pathOf = (dir: string, id: string) => join(dir, 'files', id.slice(0, 2), `${id}.bin`)

describe('almacén de archivos cifrado', () => {
  it('guarda, deduplica y recupera el contenido exacto', () => {
    const { fs, dir } = store()
    const data = Buffer.concat([Buffer.from('Hola, creatividad '), randomBytes(CHUNK * 2 + 123)])
    const a = fs.importBuffer(data)
    const b = fs.importBuffer(data)
    expect(a.id).toMatch(/^[a-f0-9]{64}$/)
    expect(b.id).toBe(a.id)
    expect(a.size).toBe(data.length)
    expect(fs.read(a.id).equals(data)).toBe(true)
    expect(fs.size(a.id)).toBe(data.length)
    // En disco no aparece el contenido en claro.
    expect(readFileSync(pathOf(dir, a.id)).includes(Buffer.from('Hola, creatividad'))).toBe(false)
    // No quedan temporales.
    expect(readdirSync(join(dir, 'files')).filter((f) => f.startsWith('.tmp'))).toEqual([])
  })

  it('lee trozos que cruzan bloques (vídeos con avance)', () => {
    const { fs } = store()
    const data = randomBytes(CHUNK * 3 + 10)
    const { id } = fs.importBuffer(data)
    const slice = (s: number, e: number) => Buffer.concat([...fs.readRange(id, s, e)])
    expect(slice(0, 9).equals(data.subarray(0, 10))).toBe(true)
    expect(slice(CHUNK - 5, CHUNK + 5).equals(data.subarray(CHUNK - 5, CHUNK + 6))).toBe(true)
    expect(slice(CHUNK * 3, CHUNK * 3 + 9).equals(data.subarray(CHUNK * 3))).toBe(true)
    expect(slice(10, 10 ** 9).length).toBe(data.length - 10)
  })

  it('importa desde una ruta del disco y admite archivos vacíos', () => {
    const { fs, dir } = store()
    const src = join(dir, 'origen.txt')
    writeFileSync(src, 'texto de prueba')
    const { id } = fs.importPath(src)
    expect(fs.read(id).toString()).toBe('texto de prueba')
    const empty = fs.importBuffer(new Uint8Array())
    expect(fs.read(empty.id).length).toBe(0)
  })

  it('detecta manipulaciones y claves incorrectas', () => {
    const { fs, dir, secret } = store()
    const data = randomBytes(CHUNK * 2 + 50)
    const { id } = fs.importBuffer(data)
    const p = pathOf(dir, id)
    const original = readFileSync(p)

    const flipped = Buffer.from(original)
    flipped[original.length - 40]! ^= 1
    writeFileSync(p, flipped)
    expect(() => fs.read(id)).toThrow()

    // Truncar el último bloque (cambia el tamaño en la cabecera para que cuadre).
    const truncated = Buffer.from(original.subarray(0, 29 + CHUNK + 16))
    truncated.writeBigUInt64BE(BigInt(CHUNK), 21)
    writeFileSync(p, truncated)
    expect(() => fs.read(id)).toThrow()

    writeFileSync(p, original)
    expect(fs.read(id).equals(data)).toBe(true)
    const other = new FileStore(randomBytes(32), dir)
    expect(() => other.read(id)).toThrow()
    expect(new FileStore(secret, dir).read(id).equals(data)).toBe(true)
  })

  it('el id depende de la clave: otra bóveda no puede adivinar el hash', () => {
    const data = Buffer.from('mismo contenido')
    expect(store().fs.importBuffer(data).id).not.toBe(store().fs.importBuffer(data).id)
  })

  it('guarda miniaturas con el id del archivo', () => {
    const { fs } = store()
    const { id } = fs.importBuffer(Buffer.from('imagen'))
    fs.saveThumb(id, Buffer.from('miniatura'))
    expect(fs.read(id, 'thumbs').toString()).toBe('miniatura')
    fs.saveThumb(id, Buffer.from('otra'))
    expect(fs.read(id, 'thumbs').toString()).toBe('otra')
    fs.remove(id)
    expect(fs.exists(id)).toBe(false)
    expect(fs.exists(id, 'thumbs')).toBe(false)
  })
})

describe('rangos del protocolo vault://', () => {
  it('interpreta las peticiones por rangos de los vídeos', async () => {
    const { parseRange } = await import('../../src/main/files/vault-protocol')
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBe('invalid')
    expect(parseRange('bytes=5-1', 100)).toBe('invalid')
    expect(parseRange('items=0-1', 100)).toBe('invalid')
  })
})
