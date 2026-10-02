import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireLock, readLock, releaseLock, STALE_MS } from '../../src/main/vault/lock'
import { tempDir } from './helpers'

describe('.lock de la bóveda', () => {
  it('guarda equipo y hora', () => {
    const dir = tempDir()
    acquireLock(dir, { instanceId: 'a', hostname: 'portatil' })
    const lock = readLock(dir)!
    expect(lock.hostname).toBe('portatil')
    expect(Date.parse(lock.openedAt)).not.toBeNaN()
  })

  it('avisa si otro equipo la tiene abierta recientemente', () => {
    const dir = tempDir()
    acquireLock(dir, { instanceId: 'a', hostname: 'sobremesa' })
    expect(() => acquireLock(dir, { instanceId: 'b', hostname: 'portatil' })).toThrowError(
      expect.objectContaining({ code: 'VAULT_LOCKED_ELSEWHERE' }),
    )
  })

  it('permite forzar la apertura', () => {
    const dir = tempDir()
    acquireLock(dir, { instanceId: 'a', hostname: 'sobremesa' })
    acquireLock(dir, { instanceId: 'b', hostname: 'portatil', force: true })
    expect(readLock(dir)!.hostname).toBe('portatil')
  })

  it('reutiliza un lock abandonado (sin latido reciente)', () => {
    const dir = tempDir()
    const t0 = new Date('2026-10-01T10:00:00Z')
    acquireLock(dir, { instanceId: 'a', hostname: 'sobremesa', now: () => t0 })
    const later = new Date(t0.getTime() + STALE_MS + 1000)
    acquireLock(dir, { instanceId: 'b', hostname: 'portatil', now: () => later })
    expect(readLock(dir)!.instanceId).toBe('b')
  })

  it('en el mismo equipo, un lock de un proceso que ya no existe no bloquea', () => {
    const dir = tempDir()
    acquireLock(dir, { instanceId: 'a', hostname: 'pc', pid: 2 ** 22 + 12345 })
    acquireLock(dir, { instanceId: 'b', hostname: 'pc' })
    expect(readLock(dir)!.instanceId).toBe('b')
  })

  it('al liberar, solo borra el lock propio', () => {
    const dir = tempDir()
    acquireLock(dir, { instanceId: 'a', hostname: 'pc1' })
    acquireLock(dir, { instanceId: 'b', hostname: 'pc2', force: true })
    releaseLock(dir, 'a')
    expect(existsSync(join(dir, '.lock'))).toBe(true)
    releaseLock(dir, 'b')
    expect(existsSync(join(dir, '.lock'))).toBe(false)
  })
})
