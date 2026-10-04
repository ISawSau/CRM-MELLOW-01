import { describe, expect, it } from 'vitest'
import { ONBOARDING_CHECKLIST } from '../../src/shared/data/entities'
import { analyze } from '../../src/main/analysis/query'
import { AnalysisService } from '../../src/main/analysis/analysis-service'
import { pacing } from '../../src/main/analysis/pacing'
import { Notifier } from '../../src/main/notifier'
import type { Platform } from '../../src/main/platform'
import {
  abVerdict,
  daysInMonth,
  fatigueOf,
  pacingOf,
  parseAdIds,
  weeklySummaryText,
} from '../../src/shared/growth'
import { DEFAULT_HOME_LAYOUT } from '../../src/shared/home'
import { computeMetrics, metaTableSettingsSchema, targetRatio } from '../../src/shared/meta-metrics'
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

describe('fatiga creativa (fase 14)', () => {
  const w = (impressions: number, linkClicks: number, dailyReach: number, purchases = 0) => ({
    impressions,
    linkClicks,
    spend: impressions / 100,
    purchases,
    results: 0,
    dailyReach,
  })

  it('cae el CTR y sube la frecuencia o el coste: fatiga; si no, nada', () => {
    const base = w(7000, 140, 7000 / 1.2) // CTR 2 %, frecuencia 1,2
    const tired = fatigueOf(w(3000, 36, 3000 / 1.6), base) // CTR 1,2 %, frecuencia 1,6
    expect(tired?.ctrDrop).toBeCloseTo(0.4)
    expect(tired?.frequencyRise).toBeCloseTo(1.6 / 1.2 - 1)
    // CTR igual: no hay fatiga aunque suba la frecuencia.
    expect(fatigueOf(w(3000, 60, 3000 / 1.6), base)).toBeNull()
    // CTR cae pero ni frecuencia ni coste suben.
    expect(fatigueOf(w(3000, 36, 3000 / 1.2), base)).toBeNull()
    // Coste por compra sube un 50 %: también es fatiga.
    expect(
      fatigueOf(w(3000, 36, 3000 / 1.2, 2), w(7000, 140, 7000 / 1.2, 7))?.costRise,
    ).toBeCloseTo(0.5)
    // Pocas impresiones: no se juzga.
    expect(fatigueOf(w(500, 2, 400), base)).toBeNull()
  })

  it('avisa una vez por anuncio y semana, y se puede apagar', async () => {
    const { vault, meta } = await connected()
    const ins = vault.sqlite.prepare(
      `INSERT OR REPLACE INTO ad_insights_daily
         (level, entity_id, date, account_id, campaign_id, adset_id, spend, impressions, reach,
          link_clicks, fetched_at)
       VALUES ('ad', 'a1', ?, 'act_111', 'c1', 's1', 10, 1000, ?, ?, '2026-10-03T00:00:00Z')`,
    )
    // Del 23 al 29 de septiembre: CTR 2 %, frecuencia 1,2. Del 30 al 2: CTR 1 %, frecuencia 1,6.
    for (let d = 23; d <= 29; d++) ins.run(`2026-09-${d}`, 833, 20)
    for (const day of ['2026-09-30', '2026-10-01', '2026-10-02']) ins.run(day, 625, 10)
    let now = new Date('2026-10-03T10:00:00Z')
    const analysis = new AnalysisService(vault, {
      currency: () => 'EUR',
      tableSettings: () => metaTableSettingsSchema.parse({}),
      now: () => now,
    })
    expect(analysis.fatigueEnabled()).toBe(true)
    expect(analysis.evaluate()).toBe(1)
    const [e] = analysis.events()
    expect(e!.name).toContain('Vídeo UGC')
    expect(e!.value).toBeCloseTo(1)
    expect(e!.threshold).toBeCloseTo(2)
    // Al día siguiente sigue cansado, pero no se repite el aviso hasta pasada una semana.
    now = new Date('2026-10-04T10:00:00Z')
    ins.run('2026-10-03', 625, 10)
    expect(analysis.evaluate()).toBe(0)
    analysis.setFatigueEnabled(false)
    expect(analysis.fatigueEnabled()).toBe(false)
    meta.dispose()
    vault.dispose()
  })
})

describe('avisos del sistema (fase 14)', () => {
  it('cuenta las tareas para hoy o atrasadas y avisa una vez al día, solo con el número', async () => {
    const { vault, meta } = await connected()
    const f = (key: string) => vault.data.listFields('tarea').find((x) => x.key === key)!.id
    const sent: { title: string; body: string }[] = []
    const platform = { notify: (title: string, body: string) => sent.push({ title, body }) }
    let now = new Date('2026-10-03T09:00:00Z')
    const notifier = new Notifier(vault, platform as unknown as Platform, () => now)
    notifier.checkTasks()
    expect(sent).toEqual([]) // sin tareas
    const today = vault.data.create(
      'tarea',
      { [f('fecha_limite')]: '2026-10-03' },
      { title: 'Hoy' },
    )
    vault.data.create('tarea', { [f('fecha_limite')]: '2026-10-01' }, { title: 'Atrasada' })
    vault.data.create('tarea', { [f('fecha_limite')]: '2026-10-09' }, { title: 'Luego' })
    vault.data.create(
      'tarea',
      { [f('fecha_limite')]: '2026-10-02', [f('estado')]: 'hecha' },
      { title: 'Hecha' },
    )
    expect(vault.data.dueTaskCount()).toBe(2)
    notifier.checkTasks() // ya se miró hoy: no repite
    expect(sent).toEqual([])
    now = new Date('2026-10-04T09:00:00Z')
    notifier.checkTasks()
    expect(sent).toEqual([{ title: 'CRM Mellow', body: 'Tienes 2 tareas para hoy o atrasadas.' }])
    expect(sent[0]!.body).not.toContain('Hoy')
    // Alertas: solo si hay avisos nuevos y está activado.
    notifier.alerts(0)
    notifier.alerts(3)
    expect(sent.at(-1)!.body).toBe('Tienes 3 avisos nuevos en Campañas.')
    vault.data.setNotifySettings({ alerts: false, tasks: false })
    notifier.alerts(1)
    now = new Date('2026-10-05T09:00:00Z')
    notifier.checkTasks()
    expect(sent).toHaveLength(2)
    expect(today.id).toBeTruthy()
    meta.dispose()
    vault.dispose()
  })
})

describe('tests A/B (fase 14)', () => {
  const v = (base: Record<string, number>) => computeMetrics(base, null)

  it('gana quien es mejor en la métrica solo si la diferencia es clara', () => {
    // CTR 1 % frente a 1,5 % con 20 000 impresiones cada una: B gana claramente.
    const a = { impresiones: 20_000, clics_enlace: 200, gasto: 200 }
    const b = { impresiones: 20_000, clics_enlace: 300, gasto: 200 }
    const ctr = abVerdict('ctr-enlace', v(a), v(b), a, b)
    expect(ctr.winner).toBe('b')
    expect(ctr.lift).toBeCloseTo(0.5)
    expect(ctr.significant).toBe(true)
    // Con 10 veces menos datos, la misma diferencia no es clara.
    const a2 = { impresiones: 2000, clics_enlace: 20, gasto: 20 }
    const b2 = { impresiones: 2000, clics_enlace: 30, gasto: 20 }
    expect(abVerdict('ctr-enlace', v(a2), v(b2), a2, b2)).toMatchObject({
      winner: null,
      significant: false,
    })
    // CPA: menos es mejor. A: 100 compras con 2000 €; B: 60 con 2000 €.
    const a3 = { gasto: 2000, compras: 100, impresiones: 50_000 }
    const b3 = { gasto: 2000, compras: 60, impresiones: 50_000 }
    const cpa = abVerdict('cpa', v(a3), v(b3), a3, b3)
    expect(cpa.winner).toBe('a')
    expect(cpa.lift).toBeLessThan(0)
    // Sin datos en una variante: nada.
    expect(abVerdict('cpa', v({}), v(b3), {}, b3).lift).toBeNull()
  })

  it('lee los anuncios de cada variante y suma sus cifras entre las fechas del test', async () => {
    expect(parseAdIds(' a1, a2 ,a1,, x y ')).toEqual(['a1', 'a2'])
    const { vault, meta } = await connected()
    const f = (key: string) => vault.data.listFields('prueba').find((x) => x.key === key)!.id
    const rec = vault.data.create(
      'prueba',
      {
        [f('inicio')]: '2026-10-01',
        [f('fin')]: '2026-10-02',
        [f('anuncios_a')]: 'a1',
        [f('metrica')]: 'ctr-enlace',
      },
      { title: 'Hook A contra B' },
    )
    const r = meta.abTest(rec.id)
    expect(r).toMatchObject({ since: '2026-10-01', until: '2026-10-02', metric: 'ctr-enlace' })
    expect(r.a.ads).toEqual([{ id: 'a1', name: 'Vídeo UGC', accountName: 'Tienda Demo' }])
    expect(r.a.base['impresiones']).toBeGreaterThan(0)
    expect(r.b.ads).toEqual([])
    expect(() => meta.abTest(vault.data.create('nota', {}, { title: 'x' }).id)).toThrow()
    meta.dispose()
    vault.dispose()
  })
})

describe('resumen semanal (fase 14)', () => {
  it('texto con inversión, cambios frente a la semana anterior, objetivo, campañas y ritmo', () => {
    const now = computeMetrics(
      { gasto: 1100, compras: 44, valor_compras: 3300, impresiones: 50_000, clics_enlace: 700 },
      null,
    )
    const prev = computeMetrics(
      { gasto: 1000, compras: 50, valor_compras: 3000, impresiones: 50_000, clics_enlace: 600 },
      null,
    )
    const raw = weeklySummaryText({
      client: 'Acme',
      since: '2026-09-27',
      until: '2026-10-03',
      currency: 'EUR',
      now,
      prev,
      targetCpa: 22,
      targetRoas: null,
      campaigns: [{ name: 'Prospecting', values: now }],
      pacing: {
        clientId: 'x',
        client: 'Acme',
        currency: 'EUR',
        budget: 5000,
        spent: 1000,
        projected: 4500,
        day: 4,
        days: 31,
        status: 'ok',
        partial: false,
      },
    })
    // Los importes llevan un espacio duro antes del símbolo.
    const text = raw.replace(/\u00a0/g, ' ')
    expect(text).toContain('Resumen semanal · Acme (27/09/2026 – 03/10/2026)')
    expect(text).toContain('Inversión: 1.100,00 € (+10 % frente a la semana anterior)')
    expect(text).toContain('Compras: 44 (−12 % frente a la semana anterior)')
    expect(text).toContain('CPA: 25,00 € (+25 % frente a la semana anterior) · objetivo 22,00 €')
    expect(text).toContain('• Prospecting: 1.100,00 € · CPA 25,00 € · ROAS 3,00')
    expect(text).toContain(
      'Ritmo del mes: 1.000,00 € de 5.000,00 €; a este ritmo, 4.500,00 € a fin de mes.',
    )
  })
})
