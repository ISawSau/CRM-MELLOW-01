import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '@shared/errors'
import { t } from '@shared/i18n'
import { VAULT_FILES } from '../vault/vault-file'
import { connectGoogle, type GoogleClient } from './google-auth'
import { DriveRemote, type FetchLike } from './remote'
import { manifestSchema } from './sync-service'

export interface CloneOptions {
  client: GoogleClient
  /** Carpeta donde se crea la copia (una subcarpeta nueva). */
  parentPath: string
  openBrowser: (url: string) => void
  http?: FetchLike
}

/**
 * Trae una bóveda desde Google Drive a un equipo o móvil nuevo (D-101): conecta con
 * Google, busca la bóveda (la más reciente si hay varias) y baja `crm.db` y `vault.json`,
 * que vienen cifrados. Los archivos los baja después la sincronización, al desbloquear con
 * la contraseña de siempre. Devuelve la carpeta de la bóveda nueva.
 */
export async function cloneFromDrive(o: CloneOptions): Promise<string> {
  const http = o.http ?? fetch
  const tokens = await connectGoogle(o.client, o.openBrowser, http)
  const token = () => Promise.resolve(tokens.accessToken)
  const found: { remote: DriveRemote; uploadedAt: string }[] = []
  for (const name of await DriveRemote.vaultFolders(token, http)) {
    const remote = new DriveRemote(name, token, http)
    const text = await remote.readText('sync.json')
    if (!text) continue
    const m = manifestSchema.safeParse(JSON.parse(text))
    if (m.success) found.push({ remote, uploadedAt: m.data.uploadedAt })
  }
  found.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
  const latest = found[0]
  if (!latest)
    throw new AppError(
      'INVALID_INPUT',
      undefined,
      t(
        'No hay ninguna bóveda de CRM Mellow en este Google Drive. Activa antes la sincronización con Google Drive en el ordenador (con el mismo id de cliente).',
      ),
    )
  let target = join(o.parentPath, 'CRM-Boveda')
  for (let i = 2; existsSync(target); i++) target = join(o.parentPath, `CRM-Boveda-${i}`)
  mkdirSync(target, { recursive: true })
  try {
    if (!(await latest.remote.get('vault.json', join(target, VAULT_FILES.manifest))))
      throw new Error(t('Falta vault.json en el destino.'))
    if (!(await latest.remote.get('crm.db', join(target, VAULT_FILES.db))))
      throw new Error(t('Falta crm.db en el destino.'))
  } catch (e) {
    rmSync(target, { recursive: true, force: true })
    throw e
  }
  return target
}
