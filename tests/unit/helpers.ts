import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import type { KdfParams } from '../../src/main/vault/crypto'

/** Parámetros de Argon2id baratos para que los tests vayan rápido. Nunca en producción. */
export const TEST_KDF: KdfParams = {
  algorithm: 'argon2id',
  version: 19,
  memoryKiB: 1024,
  iterations: 1,
  parallelism: 1,
}

const dirs: string[] = []

export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'crm-test-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
