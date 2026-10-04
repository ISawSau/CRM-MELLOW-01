import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, openEncryptedDb, type SqliteDb } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/migrate'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { tempDir } from './helpers'

const open: SqliteDb[] = []
afterEach(() => {
  while (open.length) closeDb(open.pop()!)
})

describe('migración 0007: se quitan X y LinkedIn', () => {
  it('borra sus cuentas, sus datos y sus ajustes, y deja intacto lo de Meta', () => {
    const db = openEncryptedDb(join(tempDir(), 'crm.db'), randomBytes(32))
    open.push(db)
    const before = MIGRATIONS.findIndex((m) => m.tag === '0007_quitar_x_linkedin')
    expect(before).toBeGreaterThan(0)
    runMigrations(db, MIGRATIONS.slice(0, before))

    const now = new Date().toISOString()
    const account = db.prepare(
      `INSERT INTO ad_accounts (id, platform, name, currency, timezone, enabled, raw, updated_at)
       VALUES (?, ?, ?, 'EUR', 'Europe/Madrid', 1, '{}', ?)`,
    )
    const object = db.prepare(
      `INSERT INTO ad_objects (id, level, account_id, name, raw, synced_at)
       VALUES (?, 'campaign', ?, 'Campaña', '{}', ?)`,
    )
    for (const [id, platform] of [
      ['act_1', 'meta'],
      ['li_2', 'linkedin'],
      ['x_tienda', 'x'],
    ] as const) {
      account.run(id, platform, id, now)
      object.run(`c_${id}`, id, now)
    }
    const setting = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
    for (const key of ['linkedin.config', 'linkedin.enabled', 'platforms.mappings', 'meta.x'])
      setting.run(key, '{}', now)

    expect(runMigrations(db, MIGRATIONS).applied).toEqual(['0007_quitar_x_linkedin'])

    const ids = (sql: string) => (db.prepare(sql).all() as { id: string }[]).map((r) => r.id)
    expect(ids('SELECT id FROM ad_accounts')).toEqual(['act_1'])
    expect(ids('SELECT id FROM ad_objects')).toEqual(['c_act_1'])
    expect(ids('SELECT key AS id FROM settings')).toEqual(['meta.x'])
  })
})
