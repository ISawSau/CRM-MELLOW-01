import './boot'
import './intl'
import { trace } from './trace'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { setLocale } from '@shared/i18n'
import { createBackend } from '../main/backend'
import { ConfigStore } from '../main/config'
import { useNativeSqlite } from '../main/db/connection'
import { androidPlatform, androidUpdateTarget } from './android-platform'
import { runBackgroundProbe } from './background-probe'
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
/** Compilación para los tests de interfaz del PC (vite.mobile.config.ts). */
declare const __CRM_MOBILE_TEST__: boolean

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  if (!v) throw new Error(`Falta --${name}`)
  return v
}

async function main(): Promise<void> {
  // Sin --native (tests de interfaz en el PC) se usa el SQLite de node_modules.
  trace('módulos cargados')
  if (process.argv.includes('--native')) {
    useNativeSqlite(join(arg('native'), 'libbetter_sqlite3.so'))
    trace('SQLite cargado')
  }
  const selfTest = process.argv.includes('--autoprueba')
  if (selfTest) await runMobileSelfTest(arg('cache'), (line) => trace(`autoprueba: ${line}`))
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
    // Fotos y documentos sí; los vídeos grandes se quedan en la nube (se ven sus miniaturas).
    maxAutoDownloadBytes: 25 * 1024 * 1024,
    updateTarget: androidUpdateTarget({
      cacheDir: arg('cache'),
      native: (request) => server?.native(request) ?? Promise.resolve(null),
    }),
    // Los tests del PC no salen a GitHub (solo a su servidor falso, si lo dan).
    ...(__CRM_MOBILE_TEST__ ? { releasesUrl: process.env['CRM_TEST_RELEASES_URL'] ?? null } : {}),
    ...(__CRM_MOBILE_TEST__ && process.env['CRM_TEST_GOOGLE_URL']
      ? { testUrls: { google: process.env['CRM_TEST_GOOGLE_URL'] } }
      : {}),
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
  trace(`motor listo en 127.0.0.1:${server.port}`)
  // CI: qué pasa con la app en segundo plano mientras se inicia sesión en Google (D-118).
  if (selfTest) {
    const s = server
    void runBackgroundProbe({ platform, nativeReady: () => s.nativeConnected(), log: trace })
  }
}

// Si falla, se deja escrito y el proceso sigue vivo: en Android salir de Node cierra la app
// entera (y la deja colgada). La interfaz se queda en «Abriendo…» y el registro dice por qué.
main().catch((e: unknown) => {
  trace(
    `no se ha podido arrancar el motor: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
  )
})
