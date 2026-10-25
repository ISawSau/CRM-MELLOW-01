import { afterEach, describe, expect, it } from 'vitest'
import { replaceInsights } from '../../src/main/meta/store'
import { SyncService } from '../../src/main/sync/sync-service'
import { GOOD_TOKEN } from './meta-fake'
import { setup } from './meta-setup'
import { tempDir } from './helpers'

/**
 * Sincronización ligera (D-131): lo que no cambia no viaja. Mide cuántas filas quedan
 * apuntadas para subir tras volver a bajar de Meta los mismos datos.
 */
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

const outbox = (v: { sqlite: { prepare: (s: string) => { all: () => unknown[] } } }) =>
  v.sqlite.prepare('SELECT tbl, COUNT(*) AS n FROM sync_outbox GROUP BY tbl').all() as {
    tbl: string
    n: number
  }[]

describe('sincronización ligera (D-131)', () => {
  it('volver a bajar de Meta los mismos datos no apunta nada para subir', async () => {
    const { vault, meta } = await setup()
    const sync = new SyncService(vault, { hostname: 'equipo', openBrowser: () => {} })
    cleanups.push(() => {
      meta.dispose()
      sync.dispose()
      vault.dispose()
    })
    sync.configureFolder(tempDir())
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()
    const first = outbox(vault).reduce((s, r) => s + r.n, 0)
    await sync.sync()
    expect(outbox(vault)).toEqual([])
    // La sincronización de cada hora: la misma ventana, los mismos datos.
    await meta.syncNow()
    const again = outbox(vault)
    expect(first).toBeGreaterThan(50)
    expect(again.filter((r) => r.tbl !== 'settings')).toEqual([])

    // Lo que sí cambia viaja: un día con otro gasto y un día que Meta ya no devuelve.
    await sync.sync()
    const db = vault.sqlite
    const days = db
      .prepare(
        "SELECT date FROM ad_insights_daily WHERE level = 'account' AND account_id = 'act_111' ORDER BY date",
      )
      .all() as { date: string }[]
    const [gone, changed] = [days[0]!.date, days[1]!.date]
    replaceInsights(
      db,
      'act_111',
      'account',
      gone,
      changed,
      [{ date_start: changed, spend: '999.99', impressions: '10' }],
      new Date().toISOString(),
    )
    // Los dos días y sus acciones (el día cambiado ya no trae ninguna).
    expect(outbox(vault).find((r) => r.tbl === 'ad_insights_daily')?.n).toBe(2)
    expect(outbox(vault).map((r) => r.tbl)).toEqual(['ad_actions', 'ad_insights_daily'])
    const row = db
      .prepare("SELECT spend FROM ad_insights_daily WHERE level = 'account' AND date = ?")
      .get(changed) as { spend: number }
    expect(row.spend).toBe(999.99)
    expect(
      db.prepare("SELECT 1 FROM ad_insights_daily WHERE level = 'account' AND date = ?").get(gone),
    ).toBeUndefined()
  })
})
