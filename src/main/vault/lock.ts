import { existsSync, readFileSync, rmSync } from 'node:fs'
import { hostname as osHostname } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import { writeFileAtomic } from '../fs-utils'
import { VAULT_FILES } from './vault-file'

/**
 * Archivo `.lock` de la bóveda (SPEC §3): equipo y hora de apertura.
 *
 * Mientras la bóveda está desbloqueada, la app actualiza `heartbeatAt` cada
 * HEARTBEAT_MS. Un lock cuyo latido tiene más de STALE_MS se considera abandonado
 * (la app se cerró sin liberar el lock, p. ej. por un corte de luz) y se reutiliza.
 */

export const HEARTBEAT_MS = 30_000
export const STALE_MS = 2 * 60_000

const lockSchema = z.object({
  hostname: z.string(),
  pid: z.number().int(),
  instanceId: z.string(),
  openedAt: z.string(),
  heartbeatAt: z.string(),
})
export type LockInfo = z.infer<typeof lockSchema>

export interface LockOptions {
  instanceId: string
  force?: boolean
  hostname?: string
  pid?: number
  now?: () => Date
}

function lockPath(vaultPath: string): string {
  return join(vaultPath, VAULT_FILES.lock)
}

export function readLock(vaultPath: string): LockInfo | null {
  const p = lockPath(vaultPath)
  if (!existsSync(p)) return null
  try {
    const parsed = lockSchema.safeParse(JSON.parse(readFileSync(p, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null // lock ilegible: se trata como abandonado
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** ¿Hay otra instancia usando la bóveda ahora mismo? */
export function isLockActive(lock: LockInfo, opts: LockOptions): boolean {
  if (lock.instanceId === opts.instanceId) return false
  const now = (opts.now ?? (() => new Date()))().getTime()
  const age = now - Date.parse(lock.heartbeatAt)
  if (!(age < STALE_MS)) return false
  const host = opts.hostname ?? osHostname()
  if (lock.hostname === host) return isProcessAlive(lock.pid)
  return true
}

export function acquireLock(vaultPath: string, opts: LockOptions): LockInfo {
  const existing = readLock(vaultPath)
  if (existing && !opts.force && isLockActive(existing, opts)) {
    throw new AppError('VAULT_LOCKED_ELSEWHERE', {
      hostname: existing.hostname,
      openedAt: existing.openedAt,
      heartbeatAt: existing.heartbeatAt,
    })
  }
  const now = (opts.now ?? (() => new Date()))().toISOString()
  const info: LockInfo = {
    hostname: opts.hostname ?? osHostname(),
    pid: opts.pid ?? process.pid,
    instanceId: opts.instanceId,
    openedAt: now,
    heartbeatAt: now,
  }
  writeFileAtomic(lockPath(vaultPath), JSON.stringify(info, null, 2) + '\n')
  return info
}

export function refreshLock(vaultPath: string, info: LockInfo, now = new Date()): LockInfo {
  const next = { ...info, heartbeatAt: now.toISOString() }
  writeFileAtomic(lockPath(vaultPath), JSON.stringify(next, null, 2) + '\n')
  return next
}

/** Borra el lock solo si es nuestro (si otro equipo forzó la apertura, no se toca). */
export function releaseLock(vaultPath: string, instanceId: string): void {
  const current = readLock(vaultPath)
  if (current && current.instanceId !== instanceId) return
  rmSync(lockPath(vaultPath), { force: true })
}
