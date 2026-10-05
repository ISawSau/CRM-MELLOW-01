import { afterEach, describe, expect, it } from 'vitest'
import { UpdateService } from '../../src/main/updates'
import { VaultService } from '../../src/main/vault/vault-service'
import {
  isNewer,
  parseLatestRelease,
  parseVersion,
  RELEASES_LATEST_API,
  RELEASES_PAGE,
} from '../../src/shared/updates'
import { TEST_KDF, tempDir } from './helpers'

const PAGE = 'https://github.com/ISawSau/CRM-MELLOW-01/releases/tag/v0.17.0'

describe('versiones', () => {
  it('compara x.y.z y no tiene en cuenta las prereleases', () => {
    expect(parseVersion('v0.16.4')).toEqual([0, 16, 4])
    expect(parseVersion('0.16.4-beta')).toBeNull()
    expect(isNewer('v0.17.0', '0.16.4')).toBe(true)
    expect(isNewer('0.16.10', '0.16.9')).toBe(true)
    expect(isNewer('0.16.4', '0.16.4')).toBe(false)
    expect(isNewer('0.16.3', '0.16.4')).toBe(false)
    expect(isNewer('1.0.0-rc1', '0.16.4')).toBe(false)
  })

  it('lee la respuesta de GitHub y solo acepta enlaces a los Releases del repositorio', () => {
    expect(parseLatestRelease({ tag_name: 'v0.17.0', html_url: PAGE })).toEqual({
      version: '0.17.0',
      url: PAGE,
    })
    expect(parseLatestRelease({ tag_name: 'v0.17.0', html_url: 'https://malo.example/x' })).toEqual(
      { version: '0.17.0', url: RELEASES_PAGE },
    )
    expect(parseLatestRelease({ tag_name: 'v0.17.0', prerelease: true })).toBeNull()
    expect(parseLatestRelease({ tag_name: 'último' })).toBeNull()
    expect(parseLatestRelease('basura')).toBeNull()
  })
})

// En Windows no se puede borrar la carpeta temporal con la base de datos abierta.
const vaults: VaultService[] = []

async function setup(tag = 'v0.17.0') {
  const vault = new VaultService({ kdf: TEST_KDF, hostname: 'equipo' })
  await vault.create(tempDir(), 'Boveda', 'contraseña de prueba')
  vaults.push(vault)
  let now = Date.parse('2026-10-05T10:00:00Z')
  const calls: { url: string; init?: RequestInit }[] = []
  let fail = false
  const http = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) })
    if (fail) throw new Error('sin red')
    return new Response(JSON.stringify({ tag_name: tag, html_url: PAGE }), { status: 200 })
  }) as unknown as typeof fetch
  const updates = new UpdateService(vault, {
    current: () => '0.16.4',
    http,
    now: () => now,
  })
  return {
    vault,
    updates,
    calls,
    advance: (ms: number) => (now += ms),
    setFail: (v: boolean) => (fail = v),
  }
}

describe('aviso de versión nueva (D-114)', () => {
  afterEach(() => {
    for (const v of vaults.splice(0)) v.dispose()
  })

  it('consulta GitHub sin token y avisa de una versión posterior', async () => {
    const { updates, calls } = await setup()
    expect(updates.status().show).toBe(false)
    await updates.check()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(RELEASES_LATEST_API)
    const headers = calls[0]!.init!.headers as Record<string, string>
    expect(headers.Accept).toBe('application/vnd.github+json')
    expect(Object.keys(headers).some((h) => h.toLowerCase() === 'authorization')).toBe(false)
    expect(updates.status()).toEqual({
      current: '0.16.4',
      latest: '0.17.0',
      url: PAGE,
      show: true,
    })
  })

  it('como mucho una vez al día; un fallo de red se reintenta en la siguiente ronda', async () => {
    const { updates, calls, advance, setFail } = await setup()
    setFail(true)
    await updates.check()
    expect(updates.status().latest).toBeNull()
    setFail(false)
    await updates.check()
    expect(calls).toHaveLength(2)
    await updates.check()
    advance(23 * 60 * 60_000)
    await updates.check()
    expect(calls).toHaveLength(2)
    advance(2 * 60 * 60_000)
    await updates.check()
    expect(calls).toHaveLength(3)
  })

  it('no avisa de la misma versión ni con el ajuste apagado; el aviso se puede cerrar', async () => {
    const same = await setup('v0.16.4')
    await same.updates.check()
    expect(same.updates.status().show).toBe(false)

    const { vault, updates, calls } = await setup()
    vault.data.setUpdateSettings({ check: false, dismissed: null })
    await updates.check()
    expect(calls).toHaveLength(0)
    vault.data.setUpdateSettings({ check: true, dismissed: null })
    await updates.check()
    expect(updates.status().show).toBe(true)
    vault.data.setUpdateSettings({ ...vault.data.getUpdateSettings(), dismissed: '0.17.0' })
    expect(updates.status().show).toBe(false)
  })

  it('con la bóveda bloqueada o sin URL (desarrollo y tests) no sale a internet', async () => {
    const { vault, updates, calls } = await setup()
    vault.lock()
    await updates.check()
    expect(calls).toHaveLength(0)
    expect(updates.status().show).toBe(false)
    const off = new UpdateService(vault, { current: () => '0.16.4', url: null })
    await off.check()
    expect(off.status().latest).toBeNull()
  })
})
