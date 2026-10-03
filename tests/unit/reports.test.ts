import { describe, expect, it } from 'vitest'
import type { FileRef } from '../../src/shared/data/fields'
import { DEFAULT_TEMPLATE, reportGenerateSchema } from '../../src/shared/reports'
import { escapeHtml } from '../../src/main/reports/report-html'
import { ReportService } from '../../src/main/reports/report-service'
import { ToolsService } from '../../src/main/tools/tools-service'
import { GOOD_TOKEN } from './meta-fake'
import { setup } from './meta-setup'

async function ready() {
  const ctx = await setup()
  await ctx.meta.connect({ token: GOOD_TOKEN, appSecret: '' })
  ctx.meta.updateAccount({ id: 'act_111', enabled: true })
  await ctx.meta.idle()
  const tools = new ToolsService(ctx.vault, {
    ffmpeg: () => '/no/existe',
    savePath: async () => null,
    now: () => new Date('2026-10-03T10:00:00Z'),
  })
  const printed: string[] = []
  const reports = new ReportService(ctx.vault, {
    print: async (html) => {
      printed.push(html)
      return Buffer.from('%PDF-1.7 informe')
    },
    savePath: async () => null,
    fonts: () => ({ display: null, body: null }),
    displayCurrency: () => ctx.meta.settings().displayCurrency,
    tableSettings: () => ctx.meta.tableSettings(),
    actionTypes: () => ctx.meta.actionTypes(),
    addDocument: (name, file, tipo, clientId) => tools.addDocument(name, file, tipo, clientId),
    now: () => new Date('2026-10-03T15:00:00Z'),
  })
  return { ...ctx, reports, printed }
}

const gen = (extra: Record<string, unknown>) =>
  reportGenerateSchema.parse({
    templateId: 'mensual',
    clientId: null,
    since: '2026-09-01',
    until: '2026-09-30',
    ...extra,
  })

describe('informes para clientes', () => {
  it('plantillas: la de serie y validación al guardar', async () => {
    const { reports, meta, vault } = await ready()
    expect(reports.templates()).toEqual([DEFAULT_TEMPLATE])
    const copy = {
      ...DEFAULT_TEMPLATE,
      id: 'corto',
      name: 'Corto',
      blocks: [{ id: 'p', kind: 'portada' as const }],
    }
    expect(reports.setTemplates([DEFAULT_TEMPLATE, copy]).map((t) => t.id)).toEqual([
      'mensual',
      'corto',
    ])
    expect(reports.templates()).toHaveLength(2)
    expect(() => reports.setTemplates([copy, copy])).toThrow(/mismo id/)
    meta.dispose()
    vault.dispose()
  })

  it('genera el PDF del cliente con cifras, gráficas, tabla y comentarios, y lo guarda', async () => {
    const { vault, meta, reports, printed } = await ready()
    const d = vault.data
    const fid = (e: string, k: string) => d.listFields(e).find((f) => f.key === k)!.id
    const acme = d.create('cliente', { [fid('cliente', 'nombre')]: 'Acme & Co <S.L.>' })
    meta.updateAccount({ id: 'act_111', clientId: acme.id })

    const r = await reports.generate(
      gen({ clientId: acme.id, comments: 'Buen mes.\n\n<script>alert(1)</script>' }),
    )
    const html = printed[0]!
    expect(html).toContain('Acme &amp; Co &lt;S.L.&gt;')
    expect(html).toContain('01/09/2026 – 30/09/2026')
    expect(html).toContain('Importe gastado')
    expect(html).toContain('vs. periodo anterior')
    expect(html.match(/<svg /g)).toHaveLength(2)
    expect(html).toContain('Prospecting')
    expect(html).toContain('<p>Buen mes.</p>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain("default-src 'none'")

    expect(r.name).toBe('Informe Acme & Co _S.L._ 01-09-2026 a 30-09-2026.pdf')
    expect(r.exportedTo).toBeNull()
    expect(Buffer.from(r.data).toString()).toBe('%PDF-1.7 informe')
    const doc = d.get(r.recordId)!
    expect(doc.entity).toBe('documento')
    expect(doc.values[fid('documento', 'tipo')]).toBe('informe')
    const files = doc.values[fid('documento', 'archivos')] as FileRef[]
    expect(d.files.read(files[0]!.id).toString()).toBe('%PDF-1.7 informe')
    expect((doc.values[fid('documento', 'cliente')] as { id: string }[])[0]!.id).toBe(acme.id)

    // En dólares y sin comentarios: el bloque de comentarios no sale.
    await reports.generate(gen({ clientId: acme.id, currency: 'USD' }))
    expect(printed[1]).toContain('US$')
    expect(printed[1]).not.toContain('<h2>Comentarios</h2>')
    meta.dispose()
    vault.dispose()
  })

  it('un cliente sin cuentas da un informe sin datos; un cliente inexistente, error', async () => {
    const { vault, meta, reports, printed } = await ready()
    const nombre = vault.data.listFields('cliente').find((f) => f.key === 'nombre')!.id
    const otro = vault.data.create('cliente', { [nombre]: 'Sin cuentas' })
    await reports.generate(gen({ clientId: otro.id }))
    expect(printed[0]).toContain('Sin datos de Meta en este periodo.')
    await expect(reports.generate(gen({ clientId: 'no-existe' }))).rejects.toThrow(/no existe/)
    await expect(
      reports.generate(gen({ since: '2026-10-01', until: '2026-09-01' })),
    ).rejects.toThrow(/después/)
    meta.dispose()
    vault.dispose()
  })

  it('escapa el HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })
})
