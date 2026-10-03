import { describe, expect, it } from 'vitest'
import { DEFAULT_DASHBOARD, rangeFor, yearBefore } from '../../src/shared/analysis'
import { AnalysisService } from '../../src/main/analysis/analysis-service'
import { weekStart } from '../../src/main/analysis/query'
import { dayMetrics, GOOD_TOKEN } from './meta-fake'
import { setup } from './meta-setup'

async function ready() {
  const ctx = await setup()
  await ctx.meta.connect({ token: GOOD_TOKEN, appSecret: '' })
  ctx.meta.updateAccount({ id: 'act_111', enabled: true })
  await ctx.meta.idle()
  let changes = 0
  const analysis = new AnalysisService(ctx.vault, {
    currency: () => ctx.meta.settings().displayCurrency,
    tableSettings: () => ctx.meta.tableSettings(),
    onChange: () => changes++,
    now: () => new Date('2026-10-03T15:00:00Z'),
  })
  return { ...ctx, analysis, changes: () => changes }
}

const W = { since: '2026-09-28', until: '2026-10-02' }

describe('fechas del análisis', () => {
  it('semanas de lunes, mismo periodo del año anterior y periodos', () => {
    expect(weekStart('2026-10-01')).toBe('2026-09-28')
    expect(weekStart('2026-09-28')).toBe('2026-09-28')
    expect(weekStart('2026-10-04')).toBe('2026-09-28')
    expect(yearBefore('2028-02-29')).toBe('2027-02-28')
    expect(rangeFor('90d', '2026-10-03')).toEqual({ since: '2026-07-05', until: '2026-10-02' })
  })
})

describe('consultas', () => {
  it('total, por día, semana y mes, con el periodo anterior y el del año anterior', async () => {
    const { vault, meta, analysis } = await ready()
    const total = analysis.query({ ...W })
    expect(total.currency).toBe('EUR')
    expect(total.groups).toHaveLength(1)

    const days = analysis.query({ ...W, groupBy: 'dia', compare: 'previous' })
    expect(days.groups.map((g) => g.label)).toEqual(['28/09', '29/09', '30/09', '01/10', '02/10'])
    expect(days.compareSince).toBe('2026-09-23')
    expect(days.compareGroups).toHaveLength(5)
    expect(days.compareTotals!['impresiones']).toBeGreaterThan(0)
    // La suma de los días es el total, convertido de USD con el tipo de cada día.
    const sum = days.groups.reduce((n, g) => n + (g.base['gasto'] ?? 0), 0)
    expect(sum).toBeCloseTo(total.totals['gasto']!)
    expect(days.groups[3]!.base['gasto']).toBeCloseTo(
      Number(dayMetrics('act_111', '2026-10-01').spend) / 1.1,
    )

    const weeks = analysis.query({ ...W, groupBy: 'semana' })
    expect(weeks.groups.map((g) => g.label)).toEqual(['Semana del 28/09'])
    const months = analysis.query({ ...W, groupBy: 'mes', compare: 'year' })
    expect(months.groups.map((g) => g.label)).toEqual(['sept 2026', 'oct 2026'])
    // Hace un año la cuenta no existía.
    expect(months.compareTotals).toEqual({})
    meta.dispose()
    vault.dispose()
  })

  it('por cuenta, cliente y campaña, y filtrado por cliente', async () => {
    const { vault, meta, analysis } = await ready()
    expect(analysis.query({ ...W, groupBy: 'cliente' }).groups.map((g) => g.label)).toEqual([
      'Sin cliente',
    ])
    const nombre = vault.data.listFields('cliente').find((f) => f.key === 'nombre')!
    const c = vault.data.create('cliente', { [nombre.id]: 'Acme' })
    meta.updateAccount({ id: 'act_111', clientId: c.id })
    expect(analysis.query({ ...W, groupBy: 'cliente' }).groups[0]!.label).toBe('Acme')
    expect(analysis.query({ ...W, groupBy: 'cuenta' }).groups[0]!.label).toBe('Tienda Demo')
    const camp = analysis.query({ ...W, groupBy: 'campana' })
    expect(camp.groups.map((g) => g.label)).toEqual(['Prospecting'])
    expect(
      analysis.query({ ...W, filter: { type: 'client', id: c.id } }).totals['gasto'],
    ).toBeGreaterThan(0)
    expect(analysis.query({ ...W, filter: { type: 'client', id: 'otro' } }).totals).toEqual({})
    expect(
      analysis.query({ ...W, filter: { type: 'campaign', id: 'c1' } }).totals['gasto'],
    ).toBeCloseTo(camp.totals['gasto']!)
    meta.dispose()
    vault.dispose()
  })

  it('por creatividad y etiqueta, con «Otros» para lo que no cabe', async () => {
    const { vault, meta, analysis } = await ready()
    const f = vault.data.listFields('creatividad')
    const id = (k: string) => f.find((x) => x.key === k)!.id
    const cr = vault.data.create('creatividad', {
      [id('nombre')]: 'UGC verano',
      [id('codigo')]: 'UGC',
      [id('angulo')]: ['dolor', 'oferta'],
    })
    meta.runAutoLink()
    const byCreative = analysis.query({ ...W, groupBy: 'creatividad' })
    expect(byCreative.groups.map((g) => g.label)).toEqual(['UGC verano'])
    const byTag = analysis.query({ ...W, groupBy: 'etiqueta', tagFieldId: id('angulo') })
    expect(byTag.groups.map((g) => g.label).sort()).toEqual(['Dolor', 'Oferta'])
    // El total no cuenta dos veces la creatividad con dos ángulos.
    expect(byTag.totals['gasto']).toBeCloseTo(byCreative.totals['gasto']!)
    const folded = analysis.query({ ...W, groupBy: 'etiqueta', tagFieldId: id('angulo'), limit: 1 })
    expect(folded.groups.map((g) => g.label)).toHaveLength(2)
    expect(folded.groups[1]!.label).toBe('Otros')
    const tag = analysis.query({
      ...W,
      filter: { type: 'tag', fieldId: id('angulo'), optionId: 'dolor' },
    })
    expect(tag.totals['gasto']).toBeCloseTo(byCreative.totals['gasto']!)
    expect(
      analysis.query({
        ...W,
        filter: { type: 'tag', fieldId: id('angulo'), optionId: 'beneficio' },
      }).totals,
    ).toEqual({})
    expect(
      analysis.query({ ...W, filter: { type: 'creative', id: cr.id } }).totals['gasto'],
    ).toBeCloseTo(byCreative.totals['gasto']!)
    meta.dispose()
    vault.dispose()
  })
})

describe('dashboards y alertas', () => {
  it('dashboard por defecto y guardado', async () => {
    const { vault, meta, analysis } = await ready()
    expect(analysis.dashboards()).toEqual([DEFAULT_DASHBOARD])
    const d = { ...DEFAULT_DASHBOARD, id: 'cliente-acme', name: 'Acme', widgets: [] }
    expect(analysis.setDashboards([DEFAULT_DASHBOARD, d]).map((x) => x.name)).toEqual([
      'General',
      'Acme',
    ])
    expect(() => analysis.setDashboards([d, d])).toThrow(/mismo id/)
    meta.dispose()
    vault.dispose()
  })

  it('una alerta avisa una vez por periodo, solo dentro de la app', async () => {
    const { vault, meta, analysis, changes } = await ready()
    const base = {
      id: 'cpa-alto',
      name: 'CPA alto',
      scope: { type: 'all' as const },
      metric: 'cpa',
      op: 'gt' as const,
      threshold: 1,
      windowDays: 3,
      enabled: true,
    }
    analysis.setAlerts([
      base,
      { ...base, id: 'roas-bajo', name: 'ROAS bajo', metric: 'roas', op: 'lt', threshold: 0.5 },
    ])
    // Al guardar se comprueban: el CPA supera 1 €; el ROAS no baja de 0,5.
    const events = analysis.events()
    expect(events).toEqual([
      expect.objectContaining({
        alertId: 'cpa-alto',
        since: '2026-09-30',
        until: '2026-10-02',
        seen: false,
      }),
    ])
    expect(events[0]!.value).toBeGreaterThan(1)
    expect(changes()).toBe(1)
    expect(analysis.evaluate()).toBe(0)
    expect(analysis.unseen()).toBe(1)
    expect(analysis.currentValues()['roas-bajo']).toBeGreaterThan(0.5)
    analysis.markSeen()
    expect(analysis.unseen()).toBe(0)
    // Desactivada no avisa.
    analysis.setAlerts([{ ...base, enabled: false, id: 'otra' }])
    expect(analysis.events()).toHaveLength(1)
    meta.dispose()
    vault.dispose()
  })
})
