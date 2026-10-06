import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Platform } from '../main/platform'
import { checkHttps } from './self-test'

/**
 * Sonda del CI en el emulador (D-118): reproduce lo que pasa al conectar con Google. La app
 * pasa a segundo plano (el usuario está en el navegador) y Google vuelve a una dirección
 * local del motor. El script del emulador (scripts/probar-android-emulador.sh) manda la app
 * al fondo, espera más de los 10 s tras los que Android congela las apps en segundo plano y
 * llama a esa dirección como haría el navegador.
 *
 *   sin-servicio  así estaba la app: se espera que el motor esté congelado (no contesta).
 *   con-servicio  con el servicio en primer plano: tiene que contestar y tener red.
 *
 * Solo se ejecuta con --autoprueba. No toca datos del usuario.
 */
export async function runBackgroundProbe(o: {
  platform: Platform
  nativeReady: () => boolean
  log: (line: string) => void
}): Promise<void> {
  for (let i = 0; i < 120 && !o.nativeReady(); i++) await sleep(500)
  if (!o.nativeReady()) return o.log('sonda: el lado nativo no se ha conectado')
  for (const mode of ['sin-servicio', 'con-servicio'] as const) {
    const release = mode === 'con-servicio' ? o.platform.keepRunning?.('Prueba del CI') : undefined
    // Mayor parada del motor mientras espera: si Android lo congela, el reloj sigue y los
    // latidos no; al descongelarse se ve el hueco.
    let last = Date.now()
    let maxGap = 0
    const beat = setInterval(() => {
      const now = Date.now()
      maxGap = Math.max(maxGap, now - last)
      last = now
    }, 250)
    try {
      await new Promise<void>((resolve) => {
        const server = createServer((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain', Connection: 'close' })
          res.end('sonda ok\n')
          server.close()
          o.log(`sonda ${mode}: recibido (el motor estuvo parado hasta ${maxGap} ms)`)
          // Red con la app aún en segundo plano (el script la trae al frente después).
          void checkHttps((line) => o.log(`sonda ${mode}: ${line}`)).finally(resolve)
        })
        const timer = setTimeout(() => {
          server.close()
          o.log(`sonda ${mode}: nadie ha llamado`)
          resolve()
        }, 180_000)
        server.on('close', () => clearTimeout(timer))
        server.listen(0, '127.0.0.1', () =>
          o.log(`sonda ${mode}: esperando en el puerto ${(server.address() as AddressInfo).port}`),
        )
      })
    } finally {
      clearInterval(beat)
      release?.()
    }
    await sleep(2_000)
  }
  o.log('sonda: terminada')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
