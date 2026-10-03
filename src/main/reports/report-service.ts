import { closeSync, openSync, writeSync } from 'node:fs'
import { todayIn } from '@shared/data/dates'
import type { FileRef } from '@shared/data/fields'
import { AppError } from '@shared/errors'
import { safeFileName } from '@shared/files'
import { computeMetrics, type MetaTableSettings } from '@shared/meta-metrics'
import { metricDefs } from '@shared/metric-format'
import { PLATFORMS, type Platform } from '@shared/platforms'
import {
  DEFAULT_TEMPLATE,
  reportTemplatesSchema,
  type reportGenerateSchema,
  type ReportResult,
  type ReportTemplate,
} from '@shared/reports'
import type { z } from 'zod'
import type { SqliteDb } from '../db/connection'
import { analyze } from '../analysis/query'
import { clientCurrency } from '../meta/sums'
import { CHANGES_KEY } from '../sync/sync-service'
import type { VaultService } from '../vault/vault-service'
import { buildReportHtml, type ReportFonts } from './report-html'

/**
 * Informes para clientes (SPEC §7.10): plantillas editables guardadas en los ajustes
 * cifrados de la bóveda; el PDF generado se guarda como Documento del cliente.
 */

const TEMPLATES_KEY = 'reports.templates'

export interface ReportDeps {
  /** HTML → PDF (print.ts; en los tests, un sustituto). */
  print: (html: string) => Promise<Buffer>
  savePath: (name: string) => Promise<string | null>
  fonts: () => ReportFonts
  displayCurrency: () => string
  tableSettings: () => MetaTableSettings
  actionTypes: () => string[]
  addDocument: (name: string, file: FileRef, tipo: 'informe', clientId: string | null) => string
  now?: () => Date
}

export class ReportService {
  constructor(
    private readonly vault: VaultService,
    private readonly deps: ReportDeps,
  ) {}

  private get db(): SqliteDb {
    return this.vault.sqlite
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  templates(): ReportTemplate[] {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(TEMPLATES_KEY) as
      { value: string } | undefined
    const parsed = reportTemplatesSchema.safeParse(r ? JSON.parse(r.value) : undefined)
    return parsed.success ? parsed.data : [DEFAULT_TEMPLATE]
  }

  setTemplates(list: ReportTemplate[]): ReportTemplate[] {
    const parsed = reportTemplatesSchema.parse(list)
    if (new Set(parsed.map((t) => t.id)).size !== parsed.length)
      throw new AppError('INVALID_INPUT', undefined, 'Hay dos plantillas con el mismo id.')
    const at = this.now().toISOString()
    const put = this.db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    const changes = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(CHANGES_KEY) as
      { value: string } | undefined
    const n = changes ? Number(JSON.parse(changes.value)) || 0 : 0
    this.db.transaction(() => {
      put.run(TEMPLATES_KEY, JSON.stringify(parsed), at)
      // Cambio pendiente de sincronizar.
      put.run(CHANGES_KEY, JSON.stringify(n + 1), at)
    })()
    return parsed
  }

  async generate(input: z.output<typeof reportGenerateSchema>): Promise<ReportResult> {
    const template = this.templates().find((t) => t.id === input.templateId)
    if (!template) throw new AppError('INVALID_INPUT', undefined, 'Esa plantilla no existe.')
    if (input.since > input.until)
      throw new AppError('INVALID_INPUT', undefined, 'La fecha de inicio va después del final.')
    const data = this.vault.data
    const client = input.clientId ? data.get(input.clientId) : null
    if (input.clientId && (!client || client.entity !== 'cliente'))
      throw new AppError('INVALID_INPUT', undefined, 'Ese cliente no existe.')
    const currency =
      input.currency ?? clientCurrency(this.db, input.clientId) ?? this.deps.displayCurrency()

    const settings = this.deps.tableSettings()
    const types = this.deps.actionTypes()
    const profile = data.getProfile()
    const today = todayIn(profile.timeZone, this.now())
    // Plataformas con métricas en el periodo, para la portada.
    const platforms = (
      this.db
        .prepare(
          `SELECT DISTINCT a.platform FROM ad_accounts a
           WHERE a.enabled = 1 AND (? IS NULL OR a.client_id = ?) AND EXISTS (
             SELECT 1 FROM ad_insights_daily d
             WHERE d.account_id = a.id AND d.level = 'account' AND d.date BETWEEN ? AND ?)`,
        )
        .all(client?.id ?? null, client?.id ?? null, input.since, input.until) as {
        platform: string
      }[]
    )
      .map((r) => r.platform)
      .filter((p): p is Platform => p in PLATFORMS)
      .sort((a, b) => Object.keys(PLATFORMS).indexOf(a) - Object.keys(PLATFORMS).indexOf(b))
      .map((p) => `${PLATFORMS[p]} Ads`)
    const html = buildReportHtml({
      template,
      since: input.since,
      until: input.until,
      currency,
      filter: client ? { type: 'client', id: client.id } : { type: 'all' },
      clientName: client?.title ?? null,
      author: profile.company || profile.name,
      logo: profile.photo,
      today,
      platforms,
      comments: input.comments,
      defs: metricDefs(settings.metrics, types),
      compute: (base) =>
        computeMetrics(base, null, {
          custom: settings.metrics,
          holdRate: settings.holdRate,
          actionTypes: types,
        }),
      query: (q) => analyze(this.db, data, q, currency),
      fonts: this.deps.fonts(),
    })
    const pdf = await this.deps.print(html)

    const es = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
    const name = safeFileName(
      `Informe ${client?.title ?? 'general'} ${es(input.since)} a ${es(input.until)}.pdf`,
    )
    const file = data.importBuffer(name, pdf)
    const recordId = this.deps.addDocument(name, file, 'informe', client?.id ?? null)

    let exportedTo: string | null = null
    if (input.export) {
      exportedTo = await this.deps.savePath(name)
      if (exportedTo) {
        const fd = openSync(exportedTo, 'w')
        try {
          writeSync(fd, pdf)
        } finally {
          closeSync(fd)
        }
      }
    }
    return { recordId, fileId: file.id, name, data: new Uint8Array(pdf), exportedTo }
  }
}
