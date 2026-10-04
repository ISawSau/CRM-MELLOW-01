import { appendFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Traza del arranque del motor en Android (D-101). Va a la salida estándar (el lado nativo la
 * pasa al registro de Android) y a `<data>/arranque.txt`, que el lado nativo vuelca al
 * registro en el siguiente arranque: si el proceso muere, lo último escrito no se pierde.
 * No contiene datos del usuario.
 */
const i = process.argv.indexOf('--data')
const file = i >= 0 && process.argv[i + 1] ? join(process.argv[i + 1]!, 'arranque.txt') : null

export function trace(message: string): void {
  const line = `CRM Mellow: ${message}\n`
  try {
    writeSync(1, line)
  } catch {
    // Sin salida estándar: queda el archivo.
  }
  if (!file) return
  try {
    appendFileSync(file, `${new Date().toISOString()} ${line}`)
  } catch {
    // Sin archivo: queda la salida estándar.
  }
}
