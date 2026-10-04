import { describe, expect, it } from 'vitest'
import { ONBOARDING_CHECKLIST } from '../../src/shared/data/entities'
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
