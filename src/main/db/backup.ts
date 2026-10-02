import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { VAULT_FILES } from '../vault/vault-file'
import { checkpoint, type SqliteDb } from './connection'

/**
 * Copia de seguridad local en `backups/AAAAMMDD-HHMMSS-motivo/`.
 *
 * Copia `crm.db` (cifrada) junto con el `vault.json` del momento: así la copia se
 * puede abrir con la contraseña que era válida entonces aunque después se cambie
 * o se rote la clave.
 */
export function backupVault(
  vaultPath: string,
  db: SqliteDb,
  reason: string,
  now = new Date(),
): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-')
  const safeReason = reason.replace(/[^a-z0-9-]/gi, '-').slice(0, 40)
  mkdirSync(join(vaultPath, VAULT_FILES.backups), { recursive: true })
  let dir = join(vaultPath, VAULT_FILES.backups, `${stamp}-${safeReason}`)
  for (let i = 2; ; i++) {
    try {
      mkdirSync(dir, { recursive: false })
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      dir = join(vaultPath, VAULT_FILES.backups, `${stamp}-${safeReason}-${i}`)
    }
  }
  checkpoint(db)
  copyFileSync(join(vaultPath, VAULT_FILES.db), join(dir, VAULT_FILES.db))
  copyFileSync(join(vaultPath, VAULT_FILES.manifest), join(dir, VAULT_FILES.manifest))
  return dir
}
