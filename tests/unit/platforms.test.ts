import { afterEach, describe, expect, it } from 'vitest'
import {
  detectTable,
  guessFormats,
  parseAmount,
  parseCsv,
  parseCsvDate,
  type CsvMapping,
} from '../../src/shared/platforms'
import { analyze } from '../../src/main/analysis/query'
import { PlatformsService } from '../../src/main/platforms/platforms-service'
import { liDate } from '../../src/main/platforms/linkedin'
import type { VaultService } from '../../src/main/vault/vault-service'
import { FakeLinkedIn, FAKE_LI, LI_TOKEN_OK } from './linkedin-fake'
import { GOOD_TOKEN } from './meta-fake'
import { setup } from './meta-setup'

const LINKEDIN_CSV = `Campaign Performance Report (in UTC)
Report Start: 09/01/2026, Report End: 09/02/2026

Start Date (in UTC),Account Name,Campaign Name,Campaign ID,Total Spent,Impressions,Clicks,Clicks to Landing Page,Conversions,Total Conversion Value,Currency
09/01/2026,Acme,"Leads, directivos",11,"1,234.50",10000,200,150,3,300.00,USD
09/01/2026,Acme,Marca,12,10.25,500,4,2,0,0,USD
09/02/2026,Acme,"Leads, directivos",11,100.00,2000,40,30,1,100.00,USD
Total,,,,"1,344.75",12500,244,182,4,400.00,USD
`

const X_CSV = `Fecha;Nombre de la campaña;Importe gastado;Impresiones;Clics en el enlace;Conversiones
01/09/2026;Retargeting;12,50 €;3.000;45;2
02/09/2026;Retargeting;7,50 €;2.000;30;1
02/09/2026;Prospecting;20,00 €;8.000;60;0
`

describe('lectura de CSV de otras plataformas', () => {
  it('separa celdas con comillas, punto y coma y BOM', () => {
    expect(parseCsv('﻿a;b;"c;d"\n1;"2 ""x""";3\n\n')).toEqual([
      ['a', 'b', 'c;d'],
      ['1', '2 "x"', '3'],
    ])
    expect(parseCsv('x,y\r\n"línea\nnueva",2')).toEqual([
      ['x', 'y'],
      ['línea\nnueva', '2'],
    ])
  })

  it('encuentra la cabecera tras el preámbulo de LinkedIn y propone el mapeo', () => {
    const rows = parseCsv(LINKEDIN_CSV)
    const t = detectTable(rows)
    expect(t.headerRow).toBe(2)
    expect(t.columns).toMatchObject({
      date: 0,
      campaign: 2,
      campaignId: 3,
      spend: 4,
      impressions: 5,
      clicks: 6,
      linkClicks: 7,
      conversions: 8,
      value: 9,
    })
    expect(guessFormats(rows.slice(3), t.columns)).toEqual({ dateFormat: 'dmy', decimal: '.' })
    const x = parseCsv(X_CSV)
    const tx = detectTable(x)
    expect(tx.columns).toMatchObject({
      date: 0,
      campaign: 1,
      spend: 2,
      impressions: 3,
      linkClicks: 4,
    })
    expect(guessFormats(x.slice(1), tx.columns)).toEqual({ dateFormat: 'dmy', decimal: ',' })
  })

  it('importes y fechas en varios formatos', () => {
    expect(parseAmount('1.234,56 €', ',')).toBe(1234.56)
    expect(parseAmount('$1,234.56', '.')).toBe(1234.56)
    expect(parseAmount('3.000', ',')).toBe(3000)
    expect(parseAmount('-', '.')).toBeNull()
    expect(parseCsvDate('09/01/2026', 'mdy')).toBe('2026-09-01')
    expect(parseCsvDate('09/01/2026', 'dmy')).toBe('2026-01-09')
    expect(parseCsvDate('2026-09-01 00:00:00', 'dmy')).toBe('2026-09-01')
    expect(parseCsvDate('Sep 3, 2026 - Sep 3, 2026', 'dmy')).toBe('2026-09-03')
    expect(parseCsvDate('31/02/2026', 'dmy')).toBeNull()
    expect(parseCsvDate('Total', 'dmy')).toBeNull()
    expect(liDate('2026-09-01')).toBe('(year:2026,month:9,day:1)')
  })
})

describe('otras plataformas en la bóveda', () => {
  const opened: { vault: VaultService; dispose: () => void }[] = []
  afterEach(() => {
    for (const o of opened.splice(0)) o.dispose()
  })

  async function ready() {
    const ctx = await setup()
    const li = new FakeLinkedIn()
    const synced = { n: 0 }
    const platforms = new PlatformsService(ctx.vault, {
      updateRates: () => ctx.meta.syncRates(),
      onSynced: () => synced.n++,
      http: li.fetch as typeof fetch,
      openBrowser: () => {},
      apiUrl: FAKE_LI,
      pollMs: 0,
      now: () => new Date('2026-10-03T15:00:00Z'),
    })
    opened.push({
      vault: ctx.vault,
      dispose: () => {
        platforms.dispose()
        ctx.meta.dispose()
        ctx.vault.dispose()
      },
    })
    return { ...ctx, platforms, li, synced }
  }

  const mapping = (text: string, extra: Partial<CsvMapping> = {}): CsvMapping => {
    const rows = parseCsv(text)
    const t = detectTable(rows)
    return {
      columns: t.columns,
      ...guessFormats(rows.slice(t.headerRow + 1), t.columns),
      conversionsAs: 'compras',
      ...extra,
    }
  }
  const total = (
    vault: VaultService,
    filter: { type: 'all' } | { type: 'account'; id: string } = { type: 'all' },
  ) =>
    analyze(vault.sqlite, vault.data, { since: '2026-09-01', until: '2026-09-30', filter }, 'EUR')

  it('importa un CSV de X en una cuenta nueva; reimportarlo no duplica', async () => {
    const { vault, platforms } = await ready()
    const headers = parseCsv(X_CSV)[0]!
    const input = {
      platform: 'x' as const,
      accountId: null,
      newAccount: { name: 'Tienda Demo', currency: 'EUR', timezone: 'Europe/Madrid' },
      text: X_CSV,
      mapping: mapping(X_CSV),
    }
    const r = platforms.importCsv(input, headers)
    expect(r).toMatchObject({
      accountId: 'x_tienda-demo',
      rows: 3,
      campaigns: 2,
      since: '2026-09-01',
      until: '2026-09-02',
    })
    expect(platforms.accounts()).toEqual([
      expect.objectContaining({
        id: 'x_tienda-demo',
        platform: 'x',
        source: 'csv',
        enabled: true,
        dataUntil: '2026-09-02',
      }),
    ])
    const t = total(vault)
    expect(t.totals['gasto']).toBeCloseTo(40)
    expect(t.totals['impresiones']).toBe(13000)
    expect(t.totals['compras']).toBe(3)
    const camps = analyze(
      vault.sqlite,
      vault.data,
      { since: '2026-09-01', until: '2026-09-30', groupBy: 'campana' },
      'EUR',
    )
    expect(camps.groups.map((g) => g.label).sort()).toEqual(['Prospecting', 'Retargeting'])

    // El mapeo queda guardado para la próxima vez y reimportar no duplica.
    expect(platforms.savedMapping('x', headers)).toEqual(input.mapping)
    platforms.importCsv({ ...input, accountId: 'x_tienda-demo', newAccount: null }, headers)
    expect(total(vault).totals['gasto']).toBeCloseTo(40)
    // Una cuenta de otra plataforma no sirve.
    expect(() =>
      platforms.importCsv(
        { ...input, platform: 'linkedin', accountId: 'x_tienda-demo', newAccount: null },
        headers,
      ),
    ).toThrow(/no existe/)
  })

  it('importa el CSV de LinkedIn (cabecera tras el preámbulo, sin la fila de totales)', async () => {
    const { vault, platforms } = await ready()
    const text = LINKEDIN_CSV
    const m = mapping(text, { dateFormat: 'mdy', conversionsAs: 'otras' })
    const r = platforms.importCsv(
      {
        platform: 'linkedin',
        accountId: null,
        newAccount: { name: 'Acme', currency: 'EUR', timezone: 'UTC' },
        text,
        mapping: m,
      },
      parseCsv(text)[2]!,
    )
    expect(r).toMatchObject({
      rows: 3,
      campaigns: 2,
      skipped: 1,
      since: '2026-09-01',
      until: '2026-09-02',
    })
    const t = total(vault, { type: 'account', id: r.accountId })
    expect(t.totals['gasto']).toBeCloseTo(1344.75)
    // Como «otras conversiones» no cuentan como compras.
    expect(t.totals['compras'] ?? 0).toBe(0)
    expect(t.totals['acc_conversion']).toBe(4)
    expect(() =>
      platforms.importCsv(
        { platform: 'linkedin', accountId: null, newAccount: null, text, mapping: m },
        [],
      ),
    ).toThrow(/Elige una cuenta/)
  })

  it('LinkedIn por API: conecta con token, descubre cuentas y sincroniza métricas diarias', async () => {
    const { vault, platforms, li, meta } = await ready()
    await expect(
      platforms.linkedinConnect({ clientId: '', clientSecret: '', token: 'malo' }),
    ).rejects.toThrow(/rechazado el token/)
    const s = await platforms.linkedinConnect({
      clientId: '',
      clientSecret: '',
      token: LI_TOKEN_OK,
    })
    expect(s).toMatchObject({ connected: true, daysLeft: 60 })
    // La cuenta de pruebas no se trae; las demás, sin activar.
    expect(platforms.accounts().map((a) => [a.id, a.enabled, a.source])).toEqual([
      ['li_501', false, 'api'],
      ['li_503', false, 'api'],
    ])
    expect(li.calls.some((c) => c.includes('pageToken=p2'))).toBe(true)

    platforms.updateAccount({ id: 'li_501', enabled: true })
    await platforms.idle()
    const a = platforms.accounts().find((x) => x.id === 'li_501')!
    expect(a).toMatchObject({ dataFrom: '2026-09-01', dataUntil: '2026-10-03', lastError: null })
    // Se pide el último año en trozos de 90 días.
    expect(li.calls.filter((c) => c.startsWith('/adAnalytics')).length).toBe(5)
    const day = FakeLinkedIn.day(11, '2026-09-05')
    const t = analyze(
      vault.sqlite,
      vault.data,
      { since: '2026-09-05', until: '2026-09-05', groupBy: 'campana' },
      'USD',
    )
    expect(t.groups.find((g) => g.label === 'Leads directivos')!.base['gasto']).toBeCloseTo(
      day.cost,
    )
    expect(t.totals['gasto']).toBeCloseTo(day.cost + FakeLinkedIn.day(12, '2026-09-05').cost)

    // La sincronización de Meta no toca las cuentas de LinkedIn.
    await meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    await meta.idle()
    expect(platforms.accounts().find((x) => x.id === 'li_501')!.lastError).toBeNull()
    expect(meta.listAccounts().every((x) => x.id.startsWith('act_'))).toBe(true)

    // Sincronizar otra vez solo pide desde unos días antes del último.
    li.calls.length = 0
    await platforms.syncLinkedIn()
    expect(li.calls.filter((c) => c.startsWith('/adAnalytics'))).toHaveLength(1)
    expect(li.calls.find((c) => c.startsWith('/adAnalytics'))).toContain(
      'start:(year:2026,month:9,day:26)',
    )

    // Borrar la cuenta borra sus datos.
    platforms.deleteAccount('li_501')
    expect(total(vault).totals['gasto'] ?? 0).toBe(0)
    expect(platforms.linkedinDisconnect().connected).toBe(false)
  })

  it('una cuenta en dólares sin Meta conectado trae los tipos del BCE y avisa a las alertas', async () => {
    const { vault, platforms, synced, fake } = await ready()
    const text = LINKEDIN_CSV
    expect(total(vault).partial).toBe(false)
    platforms.importCsv(
      {
        platform: 'linkedin',
        accountId: null,
        newAccount: { name: 'Acme USA', currency: 'USD', timezone: 'UTC' },
        text,
        mapping: mapping(text, { dateFormat: 'mdy' }),
      },
      parseCsv(text)[2]!,
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(synced.n).toBe(1)
    const t = total(vault)
    expect(t.partial).toBe(false)
    expect(t.currency).toBe('EUR')
    // Septiembre usa el tipo publicado más reciente anterior (1 USD = 1 EUR en el BCE falso).
    expect(t.totals['gasto']).toBeCloseTo(1344.75)
    // Solo se ha pedido el histórico del BCE (nada a Meta, que no está conectado).
    expect(fake.urls).toEqual(['GET /eurofxref-hist.xml'])
  })
})
