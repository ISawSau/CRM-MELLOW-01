import { useState } from 'react'
import { rangeFor, RANGE_LABELS, type RangePreset } from '@shared/analysis'
import type { ReportResult } from '@shared/reports'
import { t } from '@shared/i18n'
import { call, IpcCallError } from '../lib/ipc'
import { useNav } from '../data/nav'
import { useToday } from '../analysis/kit'
import { isoToEs } from '../meta/meta'
import { useClients } from '../tools/kit'
import { useReportTemplates } from './hooks'
import { PdfPreview } from './PdfPreview'
import { TemplateEditor } from './TemplateEditor'

const PERIODS: RangePreset[] = ['lastMonth', 'month', '7d', '30d', '90d']
const CURRENCIES = ['EUR', 'USD', 'GBP', 'MXN', 'CHF']

/** Informes para clientes en PDF (SPEC §7.10, fase 9). */
export function ReportsPage({ num }: { num: string }) {
  const [tab, setTab] = useState<'generar' | 'plantillas'>('generar')
  return (
    <div className="page page-wide" data-testid="page-informes">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">{num}</span> {t('negocio')}
        </span>
        <h1 className="title">{t('Informes')}</h1>
        <p className="muted">
          {t(
            'Informes de resultados en PDF para tus clientes, a partir de las métricas de Meta. El PDF se guarda en los Documentos del cliente y puedes exportarlo para enviarlo.',
          )}
        </p>
      </div>
      <div className="tabs" role="tablist" aria-label={t('Informes')}>
        {(
          [
            ['generar', t('Generar')],
            ['plantillas', t('Plantillas')],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            data-testid={`reports-tab-${id}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'generar' ? <Generate /> : <TemplateEditor />}
    </div>
  )
}

function Generate() {
  const today = useToday()
  const nav = useNav()
  const templates = useReportTemplates().data ?? []
  const clients = useClients()
  const [templateId, setTemplateId] = useState('')
  const [clientId, setClientId] = useState('')
  const [period, setPeriod] = useState<RangePreset | 'custom'>('lastMonth')
  const [custom, setCustom] = useState(() => rangeFor('lastMonth', today))
  const [currency, setCurrency] = useState('')
  const [comments, setComments] = useState('')
  const [exportToo, setExportToo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ReportResult | null>(null)

  const range = period === 'custom' ? custom : rangeFor(period, today)
  const rangeOk = range.since !== '' && range.until !== '' && range.since <= range.until
  const template = templates.find((x) => x.id === templateId) ?? templates[0]

  const run = async () => {
    if (!template) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(
        await call('reports:generate', {
          templateId: template.id,
          clientId: clientId || null,
          since: range.since,
          until: range.until,
          currency: currency || null,
          comments,
          export: exportToo,
        }),
      )
    } catch (e) {
      setError(e instanceof IpcCallError ? e.message : t('No se ha podido generar el informe.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="report-generate">
      <form
        className="form report-form"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <div className="field">
          <label htmlFor="rep-template">{t('Plantilla')}</label>
          <select
            id="rep-template"
            className="input"
            value={template?.id ?? ''}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {templates.map((x) => (
              <option key={x.id} value={x.id}>
                {t(x.name)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rep-client">{t('Cliente')}</label>
          <select
            id="rep-client"
            className="input"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">{t('Todas las cuentas')}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rep-period">{t('Periodo')}</label>
          <select
            id="rep-period"
            className="input"
            value={period}
            onChange={(e) => setPeriod(e.target.value as RangePreset | 'custom')}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(RANGE_LABELS[p])}
              </option>
            ))}
            <option value="custom">{t('Personalizado')}</option>
          </select>
          {period === 'custom' ? (
            <span className="report-dates">
              <input
                type="date"
                className="input"
                aria-label={t('Desde')}
                value={custom.since}
                onChange={(e) => setCustom({ ...custom, since: e.target.value })}
              />
              <input
                type="date"
                className="input"
                aria-label={t('Hasta')}
                value={custom.until}
                onChange={(e) => setCustom({ ...custom, until: e.target.value })}
              />
            </span>
          ) : (
            <span className="hint num">
              {isoToEs(range.since)} – {isoToEs(range.until)}
            </span>
          )}
          {!rangeOk && <span className="hint danger-text">{t('Revisa las fechas.')}</span>}
        </div>
        <div className="field">
          <label htmlFor="rep-currency">{t('Moneda')}</label>
          <select
            id="rep-currency"
            className="input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="">{t('La del cliente')}</option>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rep-comments">{t('Comentarios del periodo')}</label>
          <textarea
            id="rep-comments"
            className="input textarea"
            rows={6}
            maxLength={10_000}
            placeholder={t('Qué ha pasado este mes, qué se ha probado y próximos pasos.')}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={exportToo}
            onChange={(e) => setExportToo(e.target.checked)}
          />
          <span>{t('Exportar también a una carpeta')}</span>
        </label>
        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !template || !rangeOk}
          >
            {busy ? t('Generando…') : t('Generar informe')}
          </button>
        </div>
        {error && <p className="danger-text">{error}</p>}
      </form>
      <div className="report-result" data-testid="report-result">
        {result ? (
          <>
            <p className="report-saved">
              <span className="marker" aria-hidden="true" />
              <span>
                <strong>{result.name}</strong>{' '}
                {result.exportedTo
                  ? t('guardado en Documentos y exportado.')
                  : t('guardado en Documentos.')}
              </span>
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => nav.openRecord('documento', result.recordId)}
              >
                {t('Ver documento')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void call('files:export', { id: result.fileId, name: result.name }).catch(
                    () => {},
                  )
                }
              >
                {t('Exportar PDF…')}
              </button>
            </div>
            <PdfPreview key={result.recordId} data={result.data} />
          </>
        ) : (
          <p className="muted report-empty">
            {busy
              ? t('Preparando las cifras y las gráficas…')
              : t('Elige cliente y periodo y genera el informe: aquí verás la vista previa.')}
          </p>
        )}
      </div>
    </div>
  )
}
