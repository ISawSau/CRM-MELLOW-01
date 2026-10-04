import { describe, expect, it } from 'vitest'
import {
  actionKey,
  BUILT_IN_PRESETS,
  computeMetrics,
  knownKeys,
  metaTableSettingsSchema,
  metricProblem,
  ruleColor,
} from '../../src/shared/meta-metrics'
import { compilePattern, parseAdName } from '../../src/main/meta/creatives'
import { attributionText, previewLink } from '../../src/main/meta/table'
import { dayMetrics, GOOD_TOKEN } from './meta-fake'
import { setup } from './meta-setup'

const Q = { accountId: 'act_111', since: '2026-10-01', until: '2026-10-02' }

async function connected() {
  const ctx = await setup()
  await ctx.meta.connect({ token: GOOD_TOKEN, appSecret: '' })
  ctx.meta.updateAccount({ id: 'act_111', enabled: true })
  await ctx.meta.idle()
  return ctx
}

describe('métricas de la tabla', () => {
  it('calcula las derivadas, el hold rate configurable y las métricas propias', () => {
    const base = {
      gasto: 100,
      impresiones: 10_000,
      clics: 300,
      clics_enlace: 200,
      compras: 4,
      valor_compras: 400,
      carritos: 10,
      reproducciones_3s: 2500,
      thruplays: 800,
      acc_lead: 5,
    }
    const m = computeMetrics(base, null, {
      holdRate: 'thruplays / reproducciones_3s * 100',
      actionTypes: ['lead', 'offsite_conversion.fb_pixel_purchase'],
      custom: [
        {
          key: 'beneficio',
          label: 'Beneficio',
          expression: 'valor_compras - gasto - 50',
          format: 'currency',
          decimals: 2,
        },
        {
          key: 'margen',
          label: 'Margen',
          expression: 'beneficio / valor_compras * 100',
          format: 'percent',
          decimals: 1,
        },
        {
          key: 'roto',
          label: 'Roto',
          expression: 'gasto / acc_offsite_conversion_fb_pixel_purchase',
          format: 'number',
          decimals: 2,
        },
      ],
    })
    expect(m).toMatchObject({
      cpm: 10,
      cpc: 0.5,
      ctr: 3,
      ctr_enlace: 2,
      roas: 4,
      ticket_medio: 100,
      cpa: 25,
      coste_carrito: 10,
      conversion_carrito: 40,
      hook_rate: 25,
      hold_rate: 32,
      beneficio: 250,
      margen: 62.5,
      acc_lead: 5,
      // Acción que la fila no tiene: vale 0, así que dividir entre ella deja vacío.
      acc_offsite_conversion_fb_pixel_purchase: 0,
      roto: null,
      alcance: null,
    })
    // Sin impresiones las tasas quedan vacías, no infinitas.
    expect(computeMetrics({ gasto: 5 }, null)['cpm']).toBeNull()
  })

  it('valida las fórmulas propias sin eval y solo con métricas que existen', () => {
    const known = knownKeys([])
    expect(metricProblem('valor_compras - gasto', known)).toBeNull()
    expect(metricProblem('acc_lead * 2', known)).toBeNull()
    expect(metricProblem('gastos * 2', known)).toMatch(/gastos/)
    expect(metricProblem('constructor', known)).toMatch(/constructor/)
    expect(metricProblem('gasto +', known)).not.toBeNull()
    expect(actionKey('offsite_conversion.fb_pixel_purchase')).toBe(
      'offsite_conversion_fb_pixel_purchase',
    )
  })

  it('formato condicional: la primera regla que se cumple', () => {
    const rules = [
      { column: 'roas', op: 'gt' as const, a: 3, color: 'verde' as const },
      { column: 'roas', op: 'lt' as const, a: 1, color: 'vino' as const },
      { column: 'cpa', op: 'between' as const, a: 30, b: 10, color: 'ambar' as const },
    ]
    expect(ruleColor(rules, 'roas', 4)).toBe('verde')
    expect(ruleColor(rules, 'roas', 0.5)).toBe('vino')
    expect(ruleColor(rules, 'roas', 2)).toBeNull()
    expect(ruleColor(rules, 'cpa', 20)).toBe('ambar')
    expect(ruleColor(rules, 'cpa', null)).toBeNull()
  })

  it('los presets de serie solo usan columnas que existen', () => {
    const settings = metaTableSettingsSchema.parse({})
    expect(settings).toMatchObject({ naming: { byCode: true, pattern: '' }, metrics: [] })
    const keys = knownKeys([])
    const config = new Set([
      'entrega',
      'presupuesto',
      'puja',
      'objetivo',
      'atribucion',
      'inicio',
      'fin',
      'ultima_edicion',
      'calidad',
      'interaccion',
      'conversion',
      'creatividad',
    ])
    for (const p of BUILT_IN_PRESETS)
      for (const c of p.columns) expect(keys.has(c) || config.has(c), `${p.id}: ${c}`).toBe(true)
  })

  it('convención de nombres y texto de atribución', () => {
    const p = compilePattern('{cliente}_{angulo}_{formato}_v{version}')!
    expect(parseAdName(p, 'Acme_Dolor_UGC_v3')).toEqual({
      cliente: 'Acme',
      angulo: 'Dolor',
      formato: 'UGC',
      version: '3',
    })
    expect(parseAdName(p, 'otro nombre')).toBeNull()
    expect(compilePattern('sin llaves')).toBeNull()
    expect(
      attributionText(
        JSON.stringify({
          attribution_spec: [
            { event_type: 'CLICK_THROUGH', window_days: 7 },
            { event_type: 'VIEW_THROUGH', window_days: 1 },
          ],
        }),
      ),
    ).toBe('7 días tras hacer clic, 1 día tras ver')
  })
})

describe('desgloses, alcance y moneda del cliente', () => {
  it('activar un desglose descarga el histórico desglosado y se ve en la tabla', async () => {
    const { vault, meta, fake } = await connected()
    fake.requests = []
    const list = meta.setBreakdowns('act_111', { campaign: ['edad'], adset: [], ad: ['ubicacion'] })
    expect(list[0]!.breakdowns).toEqual({ campaign: ['edad'], adset: [], ad: ['ubicacion'] })
    await meta.idle()
    // Informes asíncronos con el parámetro breakdowns, por meses.
    const posted = fake.requests.filter((r) => r.method === 'POST')
    expect(posted.some((r) => r.params.get('breakdowns') === 'age')).toBe(true)
    expect(
      posted.some((r) => r.params.get('breakdowns') === 'publisher_platform,platform_position'),
    ).toBe(true)
    expect(meta.listAccounts()[0]).toMatchObject({ historyDone: true })

    const t = meta.table({ ...Q, level: 'campaign', breakdown: 'edad' })
    expect(t.breakdowns).toEqual(['edad'])
    const row = t.rows[0]!
    expect(row.breakdown!.map((b) => b.value).sort()).toEqual(['18-24', '25-34'])
    const sum = row.breakdown!.reduce((n, b) => n + b.base['gasto']!, 0)
    expect(sum).toBeCloseTo(row.base['gasto']!, 1)
    const ads = meta.table({ ...Q, level: 'ad', breakdown: 'ubicacion' })
    expect(ads.rows[0]!.breakdown!.map((b) => b.value)).toContain('instagram · story')
    // Un desglose no activado para el nivel no devuelve nada.
    expect(meta.table({ ...Q, level: 'adset', breakdown: 'edad' }).rows[0]!.breakdown).toBeNull()

    // Las siguientes sincronizaciones también traen los desgloses.
    fake.requests = []
    await meta.syncNow()
    expect(
      fake.requests.some((r) => r.method === 'GET' && r.params.get('breakdowns') === 'age'),
    ).toBe(true)

    // Desactivarlo borra sus datos.
    meta.setBreakdowns('act_111', { campaign: [], adset: [], ad: [] })
    const n = vault.sqlite.prepare('SELECT COUNT(*) AS n FROM ad_breakdowns').get() as { n: number }
    expect(n.n).toBe(0)
    meta.dispose()
    vault.dispose()
  })

  it('alcance y frecuencia del periodo se piden a Meta y quedan guardados', async () => {
    const { vault, meta, fake } = await connected()
    const q = { ...Q, level: 'adset' as const, parentId: 'c1' }
    expect(meta.table(q)).toMatchObject({ rangeMissing: true, totalsRange: null })
    fake.requests = []
    await meta.fetchRange(q)
    // Sin time_increment: un valor por entidad para todo el periodo.
    expect(fake.requests.map((r) => r.path)).toEqual(['c1/insights', 'c1/insights'])
    expect(fake.requests.every((r) => !r.params.has('time_increment'))).toBe(true)
    const t = meta.table(q)
    expect(t.rangeMissing).toBe(false)
    expect(t.rows[0]!.range).toMatchObject({ clics_enlace_unicos: 42, ctr_enlace_unico: 1.5 })
    expect(t.rows[0]!.range!.alcance).toBeGreaterThan(0)
    expect(t.totalsRange!.frecuencia).toBeCloseTo(2.5, 1)
    meta.dispose()
    vault.dispose()
  })

  it('si el cliente tiene moneda propia, la tabla usa la suya', async () => {
    const { vault, meta } = await connected()
    const fields = vault.data.listFields('cliente')
    const nombre = fields.find((f) => f.key === 'nombre')!
    const moneda = fields.find((f) => f.key === 'moneda')!
    const c = vault.data.create('cliente', { [nombre.id]: 'Acme', [moneda.id]: 'gbp' })
    meta.updateAccount({ id: 'act_111', clientId: c.id })
    const t = meta.table({ ...Q, level: 'campaign' })
    expect(t.currency).toBe('GBP')
    const gbp =
      (Number(dayMetrics('c1', '2026-10-01').spend) / 1.1) * 0.84 +
      (Number(dayMetrics('c1', '2026-10-02').spend) / 1.25) * 0.85
    expect(t.rows[0]!.base['gasto']).toBeCloseTo(gbp)
    meta.dispose()
    vault.dispose()
  })
})

describe('creatividades y anuncios', () => {
  async function withCreatives() {
    const ctx = await connected()
    const f = ctx.vault.data.listFields('creatividad')
    const id = (k: string) => f.find((x) => x.key === k)!.id
    const ugc = ctx.vault.data.create('creatividad', {
      [id('nombre')]: 'UGC verano',
      [id('codigo')]: 'UGC',
      [id('formato')]: 'ugc',
      [id('angulo')]: ['dolor', 'oferta'],
    })
    const otra = ctx.vault.data.create('creatividad', {
      [id('nombre')]: 'Estático',
      [id('formato')]: 'estatico',
    })
    return { ...ctx, ugc, otra, fieldId: id }
  }

  it('vínculo automático por código, manual, y desvincular no se deshace solo', async () => {
    const { vault, meta, ugc, otra } = await withCreatives()
    // El anuncio «Vídeo UGC» contiene el código «UGC» como palabra.
    expect(meta.runAutoLink()).toBe(1)
    expect(meta.creativeLinks(ugc.id)).toEqual([
      expect.objectContaining({
        id: 'a1',
        name: 'Vídeo UGC',
        source: 'auto',
        accountName: 'Tienda Demo',
      }),
    ])
    const ads = meta.table({ ...Q, level: 'ad' })
    expect(ads.rows[0]!.creatives).toEqual([{ id: ugc.id, title: 'UGC verano' }])
    // Clic en el anuncio: su vista previa pública en Meta.
    expect(ads.rows[0]!.previewUrl).toBe('https://fb.me/adspreview/a1')
    expect(meta.table({ ...Q, level: 'campaign' }).rows[0]!.previewUrl).toBeNull()

    // Buscar y vincular a mano.
    expect(meta.searchAds('vídeo ugc').map((h) => h.id)).toEqual(['a1'])
    expect(meta.searchAds('prospecting').map((h) => h.id)).toEqual(['a1'])
    expect(meta.searchAds('nada')).toEqual([])
    meta.setCreativeLink(otra.id, 'a1', true)
    expect(meta.creativeLinks(otra.id)[0]).toMatchObject({ source: 'manual' })

    // Desvincular: el automático no lo vuelve a crear.
    meta.setCreativeLink(ugc.id, 'a1', false)
    expect(meta.creativeLinks(ugc.id)).toEqual([])
    meta.runAutoLink()
    expect(meta.creativeLinks(ugc.id)).toEqual([])
    expect(() => meta.setCreativeLink(ugc.id, 'no-existe', true)).toThrow(/anuncio/)
    meta.dispose()
    vault.dispose()
  })

  it('convención de nombres configurable', async () => {
    const { vault, meta, fake, ugc } = await withCreatives()
    fake.ads[0]!['name'] = 'Tienda_Dolor_UGC_v2'
    meta.setTableSettings({
      ...meta.tableSettings(),
      naming: { byCode: false, pattern: '{*}_{angulo}_{formato}_v{version}' },
    })
    await meta.syncNow()
    expect(meta.creativeLinks(ugc.id).map((l) => l.id)).toEqual(['a1'])
    meta.dispose()
    vault.dispose()
  })

  it('rendimiento por creatividad y ranking por etiqueta', async () => {
    const { vault, meta, ugc, fieldId } = await withCreatives()
    meta.runAutoLink()
    const perf = meta.creativePerf(ugc.id, Q.since, Q.until)
    const adRow = meta.table({ ...Q, level: 'ad' }).rows[0]!
    expect(perf).toMatchObject({ currency: 'EUR', partial: false, ads: 1 })
    expect(perf.base['gasto']).toBeCloseTo(adRow.base['gasto']!)

    const byAngle = meta.tagPerf(fieldId('angulo'), Q.since, Q.until, null)
    // Una creatividad con dos ángulos cuenta en los dos.
    expect(byAngle.groups.map((g) => g.label).sort()).toEqual(['Dolor', 'Oferta'])
    expect(byAngle.groups[0]!.base['gasto']).toBeCloseTo(adRow.base['gasto']!)
    expect(byAngle.creatives.map((c) => c.label)).toEqual(['UGC verano'])
    const byFormat = meta.tagPerf(fieldId('formato'), Q.since, Q.until, null)
    expect(byFormat.groups).toEqual([
      expect.objectContaining({ label: 'UGC', creatives: 1, ads: 1 }),
    ])
    expect(() => meta.tagPerf(fieldId('nombre'), Q.since, Q.until, null)).toThrow(/selección/)
    meta.dispose()
    vault.dispose()
  })
})

describe('vista previa del anuncio', () => {
  it('solo enlaces https', () => {
    expect(previewLink('{"preview_shareable_link":"https://fb.me/x"}')).toBe('https://fb.me/x')
    expect(previewLink('{"preview_shareable_link":"javascript:alert(1)"}')).toBeNull()
    expect(previewLink('{"preview_shareable_link":"http://fb.me/x"}')).toBeNull()
    expect(previewLink('{}')).toBeNull()
    expect(previewLink('no es json')).toBeNull()
  })
})
