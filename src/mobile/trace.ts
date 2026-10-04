import { writeSync } from 'node:fs'

/**
 * Traza del arranque en el registro de Android (D-101). Escribe directamente y sin esperar,
 * para que quede aunque el motor se caiga justo después. Se importa la primera en main.ts.
 */
export function trace(message: string): void {
  try {
    writeSync(1, `CRM Mellow: ${message}\n`)
  } catch {
    // Sin salida estándar no hay nada que hacer.
  }
}

trace(`motor arrancando (Node ${process.version}, ${process.arch})`)
