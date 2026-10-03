import { MetaService } from '../../src/main/meta/meta-service'
import { VaultService } from '../../src/main/vault/vault-service'
import { FAKE_ECB, FAKE_GRAPH, FakeMeta } from './meta-fake'
import { TEST_KDF, tempDir } from './helpers'

const PASSWORD = 'contraseña de prueba'

/** Bóveda nueva con el servicio de Meta apuntando a la API falsa. */
export async function setup(fake = new FakeMeta(), at = '2026-10-03T15:00:00Z') {
  const vault = new VaultService({ kdf: TEST_KDF, hostname: 'equipo' })
  await vault.create(tempDir(), 'Boveda', PASSWORD)
  let now = new Date(at)
  const sleeps: number[] = []
  const meta = new MetaService(vault, {
    http: fake.fetch as typeof fetch,
    graphUrl: FAKE_GRAPH,
    ecbUrl: FAKE_ECB,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    pollMs: 0,
  })
  return {
    vault,
    meta,
    fake,
    sleeps,
    setNow: (iso: string) => {
      now = new Date(iso)
    },
  }
}
