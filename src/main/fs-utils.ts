import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Escribe un archivo de forma atómica: primero a un temporal en la misma carpeta,
 * fsync y después rename. Si la app se cierra a mitad, queda el archivo antiguo
 * intacto, nunca uno a medias. Imprescindible para vault.json (contiene las claves).
 */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  const fd = openSync(tmp, 'w', 0o600)
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    let off = 0
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off)
    fsyncSync(fd)
  } catch (e) {
    closeSync(fd)
    rmSync(tmp, { force: true })
    throw e
  }
  closeSync(fd)
  try {
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  fsyncDir(dirname(path))
}

/** fsync de la carpeta para que el rename sea duradero (no existe en Windows). */
function fsyncDir(dir: string): void {
  if (process.platform === 'win32') return
  try {
    const fd = openSync(dir, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    // Algunos sistemas de archivos no permiten fsync de carpetas; no es crítico.
  }
}
