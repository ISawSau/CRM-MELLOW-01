import { hostname } from 'node:os'
import { join } from 'node:path'
import { setLocale } from '@shared/i18n'
import { createBackend } from '../main/backend'
import { ConfigStore } from '../main/config'
import { useNativeSqlite } from '../main/db/connection'
import { androidPlatform } from './android-platform'
import { runMobileSelfTest } from './self-test'
import { startMobileServer, type MobileServer } from './server'

/**
 * Arranque del motor en Android (D-101): lo lanza el lado nativo con nodejs-mobile.
 *   main.js --port <n> --token <secreto> --data <carpeta> --cache <carpeta> --native <carpeta>
 *           --version <x.y.z>
 * `--autoprueba` (CI) comprueba el motor antes de arrancar.
 * `--native` es la carpeta de librerías nativas de la app (ahí está SQLite compilado para Android).
 * Todo lo que guarda va dentro de `--data` (bóvedas y la configuración mínima).
 */
function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  if (!v) throw new Error(`Falta --${name}`)
  return v
}

async function main(): Promise<void> {
  useNativeSqlite(join(arg('native'), 'libbetter_sqlite3.so'))
  if (process.argv.includes('--autoprueba'))
    await runMobileSelfTest(arg('cache'), (line) => console.log(`CRM Mellow autoprueba: ${line}`))
  const data = arg('data')
  const config = new ConfigStore(join(data, 'config'))
  setLocale(config.get().locale)
  let server: MobileServer | null = null
  const platform = androidPlatform({
    version: arg('version'),
    vaultsDir: join(data, 'bovedas'),
    cacheDir: arg('cache'),
    native: (request) => server?.native(request) ?? Promise.resolve(null),
  })
  const backend = createBackend({
    platform,
    config,
    hostname: `Android (${hostname()})`,
    emit: (event, payload) => server?.emit(event, payload),
  })
  backend.openLastVault()
  server = await startMobileServer({
    handlers: backend.handlers,
    getData: () => {
      try {
        return backend.vault.data
      } catch {
        return null
      }
    },
    staticDir: join(__dirname, '..', 'www'),
    token: arg('token'),
    port: Number(arg('port')),
    onNative: (what) => {
      if (backend.vault.status().state !== 'unlocked') return
      if (what === 'lock') void backend.lockWithSync()
      else if (backend.sync.status().kind && backend.sync.status().pending)
        void backend.sync.sync().catch(() => {})
    },
  })
  console.log(`CRM Mellow: motor listo en 127.0.0.1:${server.port}`)
}

main().catch((e: unknown) => {
  console.error(
    'CRM Mellow: no se ha podido arrancar el motor:',
    e instanceof Error ? e.message : e,
  )
  process.exit(1)
})
