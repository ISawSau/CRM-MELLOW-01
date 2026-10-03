import { describe, expect, it } from 'vitest'
import type { MetaProgress } from '../../src/shared/meta'
import { GOOD_TOKEN, FakeMeta } from './meta-fake'
import { setup } from './meta-setup'

/**
 * Cuentas grandes con el acceso de desarrollo de Meta (60 consultas cada 5 minutos):
 * antes, pedir las creatividades una a una agotaba el límite y la cuenta se quedaba con
 * la estructura (nombres, presupuestos) pero sin ninguna métrica.
 */

/** Cuenta con muchos anuncios, cada uno con su creatividad. */
function heavy(opts: ConstructorParameters<typeof FakeMeta>[0] = {}) {
  const fake = new FakeMeta(opts)
  for (let i = 2; i <= 60; i++) {
    fake.ads.push({
      id: `a${i}`,
      name: `Anuncio ${i}`,
      campaign_id: 'c1',
      adset_id: 's1',
      status: 'ACTIVE',
      effective_status: 'ACTIVE',
      creative: { id: `cr${i}` },
      updated_time: '2026-09-01T10:00:00-0400',
    })
    fake.creatives[`cr${i}`] = {
      id: `cr${i}`,
      name: `Creatividad ${i}`,
      thumbnail_url: '',
      object_type: 'SHARE',
    }
  }
  return fake
}

const campaignSpend = (meta: Awaited<ReturnType<typeof setup>>['meta']) =>
  meta.table({ accountId: 'act_111', since: '2026-09-24', until: '2026-10-02', level: 'campaign' })
    .rows[0]?.base['gasto'] ?? 0

describe('cuentas grandes de Meta', () => {
  it('las métricas llegan aunque Meta limite las creatividades, que se leen por páginas', async () => {
    const { vault, meta, fake } = await setup(heavy({ throttleCreatives: true }))
    const seen: MetaProgress[] = []
    const status = meta.status.bind(meta)
    meta.status = () => {
      const s = status()
      if (s.progress) seen.push(s.progress)
      return s
    }
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()

    const acc = meta.listAccounts()[0]!
    expect(acc.lastError).toBeNull()
    expect(acc.dataFrom).not.toBeNull()
    expect(campaignSpend(meta)).toBeGreaterThan(0)
    // Las 60 creatividades por el listado de la cuenta, sin pedirlas una a una.
    expect(fake.urls.filter((u) => u.startsWith('GET /v26.0/act_111/adcreatives'))).toHaveLength(1)
    expect(fake.urls.filter((u) => /^GET \/v26\.0\/cr\d+\?/.test(u))).toHaveLength(0)
    const creatives = vault.sqlite
      .prepare('SELECT COUNT(*) AS n FROM ad_creatives WHERE account_id = ?')
      .get('act_111') as { n: number }
    expect(creatives.n).toBe(60)
    // Las métricas se piden antes que las creatividades.
    const firstInsights = fake.urls.findIndex((u) => u.includes('/act_111/insights'))
    const firstCreatives = fake.urls.findIndex((u) => u.includes('/adcreatives'))
    expect(firstInsights).toBeGreaterThan(-1)
    expect(firstInsights).toBeLessThan(firstCreatives)

    // Barra de progreso: pasos que suben hasta el total, con etiqueta de qué se descarga.
    const sync = seen.filter((p) => !p.label.startsWith('Histórico'))
    expect(sync.length).toBeGreaterThan(5)
    const total = sync[0]!.total
    expect(total).toBe(1 + 3 * 4 + 2)
    expect(sync.map((p) => p.done)).toEqual([...sync.map((p) => p.done)].sort((a, b) => a - b))
    expect(sync.some((p) => p.label.includes('métricas por campaña'))).toBe(true)
    expect(sync.at(-1)!.done).toBe(total)
    meta.dispose()
    vault.dispose()
  })

  it('si Meta pide menos datos, se parte el trozo en días hasta poder leerlo', async () => {
    const { vault, meta, fake } = await setup(heavy({ maxSyncDays: { level: 'ad', days: 2 } }))
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()
    const acc = meta.listAccounts()[0]!
    expect(acc.lastError).toBeNull()
    // Los anuncios tienen métricas de todos los días descargados.
    const days = vault.sqlite
      .prepare(
        "SELECT COUNT(DISTINCT date) AS n FROM ad_insights_daily WHERE account_id = 'act_111' AND level = 'ad' AND date >= '2026-09-04'",
      )
      .get() as { n: number }
    expect(days.n).toBe(30)
    const adCalls = fake.urls.filter((u) => /act_111\/insights\?.*level=ad(&|$)/.test(u))
    expect(adCalls.length).toBeGreaterThan(3)
    meta.dispose()
    vault.dispose()
  })

  it('si un nivel falla, las campañas se ven igual y ese nivel se recupera en segundo plano', async () => {
    const { vault, meta } = await setup(heavy({ failSyncLevel: 'ad' }))
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    meta.updateAccount({ id: 'act_111', enabled: true })
    await meta.idle()
    // Campañas con gasto; los anuncios llegan por informes asíncronos (el histórico).
    expect(campaignSpend(meta)).toBeGreaterThan(0)
    const ads = vault.sqlite
      .prepare(
        "SELECT COUNT(DISTINCT date) AS n FROM ad_insights_daily WHERE account_id = 'act_111' AND level = 'ad' AND date >= '2026-09-04'",
      )
      .get() as { n: number }
    expect(ads.n).toBe(30)
    // El aviso se queda en la cuenta hasta la próxima sincronización.
    expect(meta.listAccounts()[0]!.lastError).toMatch(/Faltan métricas por anuncio/)
    meta.dispose()
    vault.dispose()
  })
})
