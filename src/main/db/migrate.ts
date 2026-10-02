import { AppError } from '@shared/errors'
import type { SqliteDb } from './connection'

export interface Migration {
  idx: number
  tag: string
  sql: string
}

export interface MigrateOptions {
  /** Se llama antes de aplicar migraciones sobre una base de datos con datos. */
  beforeMigrate?: (fromVersion: number, toVersion: number) => void
}

export interface MigrateResult {
  from: number
  to: number
  applied: string[]
}

const BREAKPOINT = '--> statement-breakpoint'

function ensureTable(db: SqliteDb): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    idx INTEGER PRIMARY KEY,
    tag TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
}

export function appliedMigrations(db: SqliteDb): { idx: number; tag: string }[] {
  ensureTable(db)
  return db.prepare('SELECT idx, tag FROM _migrations ORDER BY idx').all() as {
    idx: number
    tag: string
  }[]
}

/**
 * Aplica las migraciones pendientes, cada una en su propia transacción.
 *
 * - Si la base de datos tiene migraciones que esta versión de la app no conoce,
 *   se niega a continuar (VAULT_TOO_NEW) para no corromper datos.
 * - Si hay migraciones pendientes y la base de datos ya tenía alguna aplicada,
 *   llama a `beforeMigrate` (que hace la copia de seguridad) antes de tocar nada.
 */
export function runMigrations(
  db: SqliteDb,
  migrations: readonly Migration[],
  opts: MigrateOptions = {},
): MigrateResult {
  const sorted = [...migrations].sort((a, b) => a.idx - b.idx)
  sorted.forEach((m, i) => {
    if (m.idx !== i) throw new Error(`Migraciones no consecutivas: se esperaba ${i} y hay ${m.idx}`)
  })

  const applied = appliedMigrations(db)
  const known = new Map(sorted.map((m) => [m.idx, m.tag]))
  for (const a of applied) {
    if (known.get(a.idx) !== a.tag) {
      throw new AppError('VAULT_TOO_NEW', { migration: a.tag })
    }
  }

  const from = applied.length
  const pending = sorted.slice(from)
  if (pending.length === 0) return { from, to: from, applied: [] }

  if (from > 0) opts.beforeMigrate?.(from, sorted.length)

  const insert = db.prepare('INSERT INTO _migrations (idx, tag, applied_at) VALUES (?, ?, ?)')
  for (const m of pending) {
    const statements = m.sql
      .split(BREAKPOINT)
      .map((s) => s.trim())
      .filter(Boolean)
    db.transaction(() => {
      for (const s of statements) db.exec(s)
      insert.run(m.idx, m.tag, new Date().toISOString())
    })()
  }
  return { from, to: sorted.length, applied: pending.map((m) => m.tag) }
}
