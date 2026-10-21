import { join } from 'node:path'
import { expect, it } from 'vitest'
import { checkSync } from '../../src/main/sync/self-check'
import { VaultService } from '../../src/main/vault/vault-service'
import { TEST_KDF, tempDir } from './helpers'

// La parte de la autoprueba que sincroniza (D-127). En el CI corre también con el SQLite
// del móvil, que es donde fallaba el registro de cambios.
it('la autoprueba sincroniza con una carpeta y sube el cambio', async () => {
  const vault = new VaultService({ kdf: TEST_KDF, hostname: 'autoprueba' })
  const parent = tempDir()
  await vault.create(parent, 'boveda', 'contraseña de prueba')
  try {
    await expect(checkSync(vault, join(tempDir(), 'nube'))).resolves.toBeUndefined()
  } finally {
    vault.dispose()
  }
})
