import { describe, expect, it } from 'vitest'
import { ONBOARDING_CHECKLIST } from '../../src/shared/data/entities'
import { analyze } from '../../src/main/analysis/query'
import { pacing } from '../../src/main/analysis/pacing'
import { daysInMonth, pacingOf } from '../../src/shared/growth'
import { DEFAULT_HOME_LAYOUT } from '../../src/shared/home'
import { targetRatio } from '../../src/shared/meta-metrics'
import { GOOD_TOKEN } from './meta-fake'
import { setup } from './meta-setup'

const Q = { accountId: 'act_111', since: '2026-10-01', until: '2026-10-02' }

async function connected() {
  const ctx = await setup()
  await ctx.meta.connect({ token: GOOD_TOKEN, appSecret: '' })
  ctx.meta.updateAccount({ id: 'act_111', enabled: true })
  await ctx.meta.idle()
  return ctx
}

describe('objetivos del cliente (fase 14)', () => {
  it('la fila se mide contra el CPA o el ROAS objetivo', () => {
    const cpa = { metric: 'cpa', value: 20 } as const
    expect(targetRatio(cpa, { gasto: 100, cpa: 10 })).toBe(0.5)
    expect(targetRatio(cpa, { gasto: 100, cpa: 30 })).toBe(1.5)
    // Sin compras: fuera de objetivo si ya ha gastado un CPA entero; si no, aún no se sabe.
    expect(targetRatio(cpa, { gasto: 25, cpa: null })).toBe(Infinity)
    expect(targetRatio(cpa, { gasto: 5, cpa: null })).toBeNull()
    const roas = { metric: 'roas', value: 4 } as const
    expect(targetRatio(roas, { gasto: 100, roas: 8 })).toBe(0.5)
    expect(targetRatio(roas, { gasto: 100, roas: 2 })).toBe(2)
    expect(targetRatio(roas, { gasto: 100, roas: 0 })).toBe(Infinity)
    expect(targetRatio(roas, { gasto: 0, roas: null })).toBeNull()
  })

  it('la tabla trae el objetivo del cliente de la cuenta, en la moneda de la tabla', async () => {
    const { vault, meta } = await connected()
    expect(meta.table({ ...Q, level: 'campaign' }).target).toBeNull()
    const f = (key: string) => vault.data.listFields('cliente').find((x) => x.key === key)!.id
    const c = vault.data.create('cliente', { [f('nombre')]: 'Acme', [f('roas_objetivo')]: 3 })
    meta.updateAccount({ id: 'act_111', clientId: c.id })
    expect(meta.table({ ...Q, level: 'campaign' }).target).toEqual({ metric: 'roas', value: 3 })
    // El CPA manda sobre el ROAS; medido en resultados si así se indica.
    vault.data.update(c.id, { [f('cpa_objetivo')]: 25 })
    expect(meta.table({ ...Q, level: 'ad' }).target).toEqual({ metric: 'cpa', value: 25 })
    vault.data.update(c.id, { [f('cpa_medida')]: 'resultados' })
    expect(meta.table({ ...Q, level: 'ad' }).target).toEqual({
      metric: 'coste_resultado',
      value: 25,
    })
    meta.dispose()
    vault.dispose()
  })

  it('un cliente nuevo empieza con la lista de arranque', async () => {
    const { vault, meta } = await connected()
    const fields = vault.data.listFields('cliente')
    const arranque = fields.find((x) => x.key === 'arranque')!
    const c = vault.data.create('cliente', {}, { title: 'Nuevo' })
    const items = c.values[arranque.id] as { text: string; done: boolean }[]
    expect(items.map((i) => i.text)).toEqual(ONBOARDING_CHECKLIST)
    expect(items.every((i) => !i.done)).toBe(true)
    // Lo que se pase al crear manda sobre la plantilla.
    const d = vault.data.create('cliente', { [arranque.id]: [] }, { title: 'Otro' })
    expect(d.values[arranque.id] ?? []).toEqual([])
    meta.dispose()
    vault.dispose()
  })
})

describe('ritmo de gasto (fase 14)', () => {
  it('proyecta a fin de mes y avisa si se pasa o se queda corto', () => {
    expect(daysInMonth('2026-10-03')).toBe(31)
    expect(daysInMonth('2028-02-10')).toBe(29)
    expect(pacingOf(300, 3100, 3, 31)).toEqual({ projected: 3100, status: 'ok' })
    expect(pacingOf(400, 3100, 3, 31).status).toBe('over')
    expect(pacingOf(200, 3100, 3, 31).status).toBe('under')
  })

  it('suma el gasto del mes de las cuentas de cada cliente con presupuesto', async () => {
    const { vault, meta } = await connected()
    const f = (key: string) => vault.data.listFields('cliente').find((x) => x.key === key)!.id
    expect(pacing(vault.sqlite, vault.data, '2026-10-03')).toEqual([])
    const c = vault.data.create('cliente', {
      [f('nombre')]: 'Acme',
      [f('presupuesto_mensual')]: 1000,
    })
    meta.updateAccount({ id: 'act_111', clientId: c.id })
    const [row] = pacing(vault.sqlite, vault.data, '2026-10-03')
    const spent = analyze(
      vault.sqlite,
      vault.data,
      { since: '2026-10-01', until: '2026-10-03', filter: { type: 'client', id: c.id } },
      'EUR',
    ).totals['gasto']!
    expect(spent).toBeGreaterThan(0)
    expect(row).toMatchObject({ client: 'Acme', budget: 1000, currency: 'EUR', day: 3, days: 31 })
    expect(row!.spent).toBeCloseTo(spent)
    expect(row!.projected).toBeCloseTo((spent / 3) * 31)
    meta.dispose()
    vault.dispose()
  })

  it('la tarjeta nueva aparece en un Inicio ya personalizado, y si se quita no vuelve', async () => {
    const { vault, meta } = await connected()
    const old = DEFAULT_HOME_LAYOUT.items.filter((i) => i.kind === 'card' && i.id !== 'ritmo')
    vault.sqlite
      .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('home.layout', JSON.stringify({ items: old }), '2026-10-01T00:00:00Z')
    const ids = () => vault.data.getHomeLayout().items.map((i) => (i.kind === 'card' ? i.id : ''))
    expect(ids()).toContain('ritmo')
    vault.data.setHomeLayout({ items: old })
    expect(ids()).not.toContain('ritmo')
    meta.dispose()
    vault.dispose()
  })
})
