import { describe, expect, it } from 'vitest'
import { AnalysisService } from '../../src/main/analysis/analysis-service'
import { GOOD_TOKEN } from './meta-fake'
import { setup } from './meta-setup'

describe('facturación y beneficio por cliente', () => {
  it('suma facturado, cobrado, pendiente, vencido, gastos y lo previsto por acuerdo', async () => {
    const { vault, meta } = await setup()
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()
    const analysis = new AnalysisService(vault, {
      currency: () => 'EUR',
      tableSettings: () => meta.tableSettings(),
      now: () => new Date('2026-10-03T15:00:00Z'),
    })
    const d = vault.data
    const id = (entity: string, key: string) => d.listFields(entity).find((f) => f.key === key)!.id

    const acme = d.create('cliente', {
      [id('cliente', 'nombre')]: 'Acme',
      [id('cliente', 'fee')]: 1000,
      [id('cliente', 'acuerdo')]: ['fee', 'porcentaje'],
      [id('cliente', 'porcentaje_gasto')]: 10,
    })
    meta.updateAccount({ id: 'act_111', clientId: acme.id })
    const factura = (values: Record<string, unknown>) => {
      const r = d.create('factura', {
        [id('factura', 'numero')]: values['numero'],
        [id('factura', 'base')]: values['base'],
        [id('factura', 'iva')]: 21,
        [id('factura', 'estado')]: values['estado'],
        [id('factura', 'emision')]: values['emision'],
        [id('factura', 'vencimiento')]: values['vencimiento'] ?? null,
        [id('factura', 'cobro')]: values['cobro'] ?? null,
        [id('factura', 'moneda')]: values['moneda'] ?? 'eur',
      })
      d.setLinks(id('factura', 'cliente'), r.id, [acme.id])
      return r
    }
    // Cobrada en el periodo: 1.000 + 21 % = 1.210 €.
    factura({
      numero: 'F-1',
      base: 1000,
      estado: 'cobrada',
      emision: '2026-10-01',
      cobro: '2026-10-02',
    })
    // Pendiente en dólares y vencida: 110 + 21 % = 133,10 US$.
    const vencida = factura({
      numero: 'F-2',
      base: 110,
      estado: 'pendiente',
      emision: '2026-10-01',
      vencimiento: '2026-10-02',
      moneda: 'usd',
    })
    // Pendiente sin vencer y de fuera del periodo.
    factura({
      numero: 'F-0',
      base: 100,
      estado: 'pendiente',
      emision: '2026-08-01',
      vencimiento: '2026-12-01',
    })
    const g = d.create('gasto', {
      [id('gasto', 'concepto')]: 'Editor de vídeo',
      [id('gasto', 'fecha')]: '2026-10-01',
      [id('gasto', 'importe')]: 200,
      [id('gasto', 'moneda')]: 'eur',
    })
    d.setLinks(id('gasto', 'cliente'), g.id, [acme.id])
    // Un gasto sin cliente.
    d.create('gasto', {
      [id('gasto', 'concepto')]: 'Software',
      [id('gasto', 'fecha')]: '2026-10-02',
      [id('gasto', 'importe')]: 50,
    })

    const s = analysis.billing('2026-10-01', '2026-10-02')
    expect(s.currency).toBe('EUR')
    const acmeRow = s.rows.find((r) => r.client === 'Acme')!
    expect(acmeRow.facturado).toBeCloseTo(1210 + 133.1 / 1.1)
    expect(acmeRow.facturas).toBe(2)
    expect(acmeRow.cobrado).toBeCloseTo(1210)
    // Pendiente al tipo de hoy (sábado 3: el del viernes 2, 1,25).
    expect(acmeRow.pendiente).toBeCloseTo(133.1 / 1.25 + 121)
    expect(acmeRow.vencido).toBeCloseTo(133.1 / 1.25)
    expect(acmeRow.gastos).toBe(200)
    expect(acmeRow.beneficio).toBeCloseTo(1010)
    expect(acmeRow.inversion).toBeGreaterThan(0)
    expect(acmeRow.porcentajePrevisto).toBeCloseTo(acmeRow.inversion * 0.1)
    // Fee mensual prorrateado: 2 días de un mes medio.
    expect(acmeRow.feePrevisto).toBeCloseTo((1000 * 2) / (365 / 12))
    expect(s.rows.find((r) => r.client === 'Sin cliente')!.gastos).toBe(50)
    expect(s.totals.gastos).toBe(250)
    expect(s.overdue).toEqual([
      expect.objectContaining({
        id: vencida.id,
        numero: 'F-2',
        client: 'Acme',
        currency: 'USD',
        days: 1,
      }),
    ])
    meta.dispose()
    vault.dispose()
  })
})
