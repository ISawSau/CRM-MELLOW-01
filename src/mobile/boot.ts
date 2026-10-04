import { mkdirSync } from 'node:fs'
import { trace } from './trace'

/**
 * Lo primero que se ejecuta en el motor de Android (D-101), antes de cargar el resto. En
 * Android salir de Node cierra la app entera, así que los errores sin capturar se apuntan y el
 * motor sigue, y nada puede terminar el proceso.
 */
const i = process.argv.indexOf('--data')
if (i >= 0 && process.argv[i + 1]) mkdirSync(process.argv[i + 1]!, { recursive: true })

process.on('uncaughtException', (e) => trace(`error sin capturar: ${e.stack ?? e.message}`))
process.on('unhandledRejection', (e) =>
  trace(
    `promesa rechazada sin capturar: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
  ),
)
process.exit = ((code?: number) => {
  trace(`process.exit(${code ?? ''}) ignorado: el motor no puede salir en Android`)
}) as typeof process.exit

trace(`motor arrancando (Node ${process.version}, ${process.arch})`)
