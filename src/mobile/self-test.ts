import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { rootCertificates } from 'node:tls'
import { join } from 'node:path'
import { argon2id } from 'hash-wasm'
import { collator, norm } from '@shared/data/text'
import { formatDate, formatNumber } from '@shared/format'
import { sqliteVersion } from '../main/db/connection'
import { describeNetError } from '../main/sync/google-auth'
import { VaultService } from '../main/vault/vault-service'

function expect(what: string, got: string, want: string): void {
  if (got !== want) throw new Error(`${what}: «${got}» en vez de «${want}»`)
}

/** Fechas por zona horaria, números, orden y búsqueda sin tildes (sin ICU, ver intl.ts). */
function checkIntl(): void {
  const when = Date.UTC(2026, 6, 1, 22, 30)
  expect('fecha en Madrid', formatDate(when, 'Europe/Madrid'), '02/07/2026')
  expect('fecha en Nueva York', formatDate(when, 'America/New_York'), '01/07/2026')
  expect('número', formatNumber(1234.56, 2), '1.234,56')
  expect(
    'orden',
    ['zeta', 'Ñu', 'oso', 'nube', 'Árbol'].sort(collator.compare).join(' '),
    'Árbol nube Ñu oso zeta',
  )
  expect('sin tildes', norm('Campaña José'), 'campana jose')
}

/**
 * Conexión HTTPS con Google como la que hace «Traer desde Google Drive» (D-116). Solo avisa
 * (el emulador del CI puede no tener red), pero deja en el registro la causa si falla.
 */
export async function checkHttps(log: (line: string) => void): Promise<void> {
  const env = `OpenSSL ${process.versions.openssl}, ${rootCertificates.length} certificados raíz`
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(20_000),
    })
    log(`ok  HTTPS con Google (respuesta ${res.status}; ${env})`)
  } catch (e) {
    log(`aviso HTTPS con Google: ${describeNetError(e)} (${env})`)
  }
}

/**
 * Autoprueba del motor en el móvil (D-101): cifrado, SQLite compilado para Android,
 * migraciones y datos. La lanza el CI en el emulador (`--ez autoprueba true`) y deja el
 * resultado en el registro de Android. No toca la bóveda del usuario.
 */
export async function runMobileSelfTest(
  cacheDir: string,
  log: (line: string) => void,
): Promise<boolean> {
  const parent = mkdtempSync(join(cacheDir, 'autoprueba-'))
  const vault = new VaultService()
  try {
    log(`ok  SQLite ${sqliteVersion()}`)
    checkIntl()
    log('ok  fechas, zonas horarias, números y orden')
    const t1 = Date.now()
    await argon2id({
      password: 'prueba',
      salt: new Uint8Array(16),
      parallelism: 1,
      iterations: 1,
      memorySize: 1024,
      hashLength: 32,
      outputType: 'hex',
    })
    log(`ok  Argon2id (${Date.now() - t1} ms)`)
    const password = 'autoprueba-' + Date.now()
    const t0 = Date.now()
    const { status } = await vault.create(parent, 'boveda', password)
    log(`ok  bóveda creada (${Date.now() - t0} ms)`)
    const client = vault.data.create('cliente', {}, { title: 'Autoprueba' })
    vault.lock()
    const files = readdirSync(status.path!)
    if (files.some((f) => f.endsWith('-wal') || f.endsWith('-shm') || f === '.lock'))
      throw new Error(`quedan archivos sueltos al bloquear: ${files.join(', ')}`)
    await vault.unlock(password)
    if (vault.data.get(client.id)?.title !== 'Autoprueba')
      throw new Error('los datos no se han conservado')
    log('ok  bloqueada y desbloqueada con los datos intactos')
    await checkHttps(log)
    log('AUTOPRUEBA CORRECTA')
    return true
  } catch (e) {
    log(`MAL ${e instanceof Error ? e.message : String(e)}`)
    log('AUTOPRUEBA FALLIDA')
    return false
  } finally {
    vault.dispose()
    rmSync(parent, { recursive: true, force: true })
  }
}
