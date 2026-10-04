import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { VaultService } from '../main/vault/vault-service'

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
