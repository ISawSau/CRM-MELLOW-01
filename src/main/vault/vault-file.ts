import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import { writeFileAtomic } from '../fs-utils'

/** Nombres fijos dentro de la carpeta de la bóveda (SPEC §3). */
export const VAULT_FILES = {
  manifest: 'vault.json',
  db: 'crm.db',
  files: 'files',
  thumbs: 'thumbs',
  backups: 'backups',
  lock: '.lock',
} as const

export const VAULT_FORMAT = 'crm-mellow-vault'
export const VAULT_FORMAT_VERSION = 1

const wrappedKey = z.object({
  salt: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
})

const kdf = z.object({
  algorithm: z.literal('argon2id'),
  version: z.literal(19),
  memoryKiB: z.number().int().min(8),
  iterations: z.number().int().min(1),
  parallelism: z.number().int().min(1),
})

export const vaultManifestSchema = z.object({
  format: z.literal(VAULT_FORMAT),
  formatVersion: z.number().int().min(1),
  vaultId: z.uuid(),
  createdAt: z.string(),
  /** Número de migraciones aplicadas. Una app que conoce menos se niega a abrir. */
  schemaVersion: z.number().int().min(0),
  kdf,
  keySlots: z.object({ password: wrappedKey, recovery: wrappedKey }),
  /** Se incrementa cada vez que se rota la clave maestra. */
  keyGeneration: z.number().int().min(1),
})

export type VaultManifest = z.infer<typeof vaultManifestSchema>

export function manifestPath(vaultPath: string): string {
  return join(vaultPath, VAULT_FILES.manifest)
}

export function isVaultFolder(vaultPath: string): boolean {
  return existsSync(manifestPath(vaultPath))
}

export function readManifest(vaultPath: string): VaultManifest {
  const p = manifestPath(vaultPath)
  if (!existsSync(p)) throw new AppError('NOT_A_VAULT')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    throw new AppError('VAULT_CORRUPT')
  }
  // Primero el formato, para dar un mensaje claro si la bóveda es de una versión futura.
  const head = z.object({ format: z.string(), formatVersion: z.number() }).safeParse(raw)
  if (!head.success || head.data.format !== VAULT_FORMAT) throw new AppError('VAULT_CORRUPT')
  if (head.data.formatVersion > VAULT_FORMAT_VERSION) throw new AppError('VAULT_TOO_NEW')
  const parsed = vaultManifestSchema.safeParse(raw)
  if (!parsed.success) throw new AppError('VAULT_CORRUPT')
  return parsed.data
}

export function writeManifest(vaultPath: string, manifest: VaultManifest): void {
  writeFileAtomic(manifestPath(vaultPath), JSON.stringify(manifest, null, 2) + '\n')
}

/** Datos asociados (AAD) de cada ranura: la ata a esta bóveda y a esta generación de clave. */
export function slotAad(
  manifest: Pick<VaultManifest, 'vaultId' | 'keyGeneration'>,
  slot: 'password' | 'recovery',
): string {
  return `${VAULT_FORMAT}/v${VAULT_FORMAT_VERSION}/${manifest.vaultId}/gen${manifest.keyGeneration}/${slot}`
}
