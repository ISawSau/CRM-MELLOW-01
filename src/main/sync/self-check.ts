import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { VaultService } from '../vault/vault-service'
import { SyncService } from './sync-service'

/**
 * Parte de la autoprueba (D-127): sincroniza la bóveda de prueba con una carpeta, apunta un
 * cambio y lo sube como paquete. Así se prueba el registro de cambios con el SQLite de cada
 * plataforma (el del móvil es más antiguo y no admite todo lo que el del escritorio).
 */
export async function checkSync(vault: VaultService, dir: string): Promise<void> {
  const sync = new SyncService(vault, { hostname: 'autoprueba', openBrowser: () => {} })
  try {
    mkdirSync(dir, { recursive: true })
    sync.configureFolder(dir)
    await sync.sync()
    const first = sync.status()
    if (first.phase !== 'idle') throw new Error(`sincronizar: ${first.error ?? first.phase}`)
    vault.data.create('cliente', {}, { title: 'Autoprueba sincronizada' })
    if (!sync.status().pending) throw new Error('el cambio no se ha apuntado para subirlo')
    await sync.sync()
    const after = sync.status()
    if (after.phase !== 'idle' || after.pending)
      throw new Error(`subir el cambio: ${after.error ?? after.phase}`)
    const changes = join(dir, 'changes')
    const packs = existsSync(changes)
      ? readdirSync(changes).flatMap((e) => readdirSync(join(changes, e)))
      : []
    if (!packs.length) throw new Error('no se ha subido el paquete de cambios')
  } finally {
    sync.dispose()
  }
}
