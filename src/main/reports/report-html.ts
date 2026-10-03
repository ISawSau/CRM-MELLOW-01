import type { AnalysisFilter, AnalysisQuery, AnalysisResult } from '@shared/analysis'
import { TIME_DIMENSIONS } from '@shared/analysis'
import type { BaseSums } from '@shared/meta'
import type { MetricDef, MetricValues } from '@shared/meta-metrics'
import { delta, formatMetric } from '@shared/metric-format'
import { BLOCK_LABELS, type ReportBlock, type ReportTemplate } from '@shared/reports'
import { barChartSvg, lineChartSvg } from './charts'

/**
 * HTML de un informe para clientes (SPEC §7.10). Se imprime a PDF en una ventana oculta
 * sin JavaScript ni red (print.ts): todo va dentro del documento (estilos, fuentes en
 * base64 y gráficas en SVG).
 */

export interface ReportFonts {
  /** woff2 en base64 de Archivo (títulos y cifras) y DM Sans (texto). */
  display: string | null
  body: string | null
}

export interface ReportContext {
  template: ReportTemplate
  since: string
  until: string
  currency: string
  filter: AnalysisFilter
  clientName: string | null
  /** Empresa o nombre del perfil. */
  author: string
  /** Foto o logo del perfil (data:image/…;base64). */
  logo: string | null
  today: string
  /** Plataformas con datos en el periodo («Meta Ads», «LinkedIn Ads»…). */
  platforms: string[]
  comments: string
  defs: Map<string, MetricDef>
  compute: (base: BaseSums) => MetricValues
  query: (q: AnalysisQuery) => AnalysisResult
  fonts: ReportFonts
}

const FONT_DISPLAY = "'Archivo', 'Arial Narrow', Arial, sans-serif"
const FONT_BODY = "'DM Sans', 'Helvetica Neue', Arial, sans-serif"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Texto libre → párrafos (línea en blanco) y saltos de línea. */
function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

const es = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const short = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

function hasData(r: AnalysisResult): boolean {
  return (r.totals['impresiones'] ?? 0) > 0 || (r.totals['gasto'] ?? 0) > 0
}

const EMPTY = '<p class="empty">Sin datos publicitarios en este periodo.</p>'

function section(b: ReportBlock, inner: string): string {
  const title = 'title' in b && b.title ? b.title : BLOCK_LABELS[b.kind]
  return `<section class="block block-${b.kind}"><h2>${escapeHtml(title)}</h2>${inner}</section>`
}

export function buildReportHtml(ctx: ReportContext): string {
  const { since, until, currency, filter, defs, compute } = ctx
  const label = (k: string) => defs.get(k)?.label ?? k
  const fmt = (k: string) => (v: number | null | undefined) =>
    formatMetric(v, defs.get(k), currency)
  const q = (extra: Partial<AnalysisQuery>) => ctx.query({ since, until, filter, ...extra })
  const period = `${es(since)} – ${es(until)}`

  const blocks = ctx.template.blocks.map((b): string => {
    switch (b.kind) {
      case 'portada':
        return `<section class="cover">
          ${ctx.logo ? `<img class="logo" src="${escapeHtml(ctx.logo)}" alt="">` : ''}
          <p class="eyebrow">Informe de resultados</p>
          <h1>${escapeHtml(ctx.clientName ?? 'Todas las cuentas')}</h1>
          <div class="rule"></div>
          <p class="period">${period}</p>
          <p class="meta">Importes en ${escapeHtml(currency)}${ctx.platforms.map((p) => ` · ${escapeHtml(p)}`).join('')}</p>
          ${ctx.author ? `<p class="author">Preparado por ${escapeHtml(ctx.author)}</p>` : ''}
          <p class="date">${es(ctx.today)}</p>
        </section>`

      case 'kpis': {
        const r = q({ compare: b.compare ? 'previous' : 'none' })
        if (!hasData(r)) return section(b, EMPTY)
        const now = compute(r.totals)
        const before = r.compareTotals ? compute(r.compareTotals) : null
        const cards = b.metrics
          .map((k) => {
            const d = before ? delta(now[k], before[k], defs.get(k)) : null
            const cls = d?.good === true ? 'good' : d?.good === false ? 'bad' : ''
            const arrow = d ? (d.text.startsWith('+') ? '▲' : '▼') : ''
            return `<div class="kpi">
              <span class="kpi-label">${escapeHtml(label(k))}</span>
              <span class="kpi-value">${fmt(k)(now[k])}</span>
              ${d ? `<span class="kpi-delta ${cls}">${arrow} ${d.text} vs. periodo anterior</span>` : ''}
            </div>`
          })
          .join('')
        return section(b, `<div class="kpis">${cards}</div>`)
      }

      case 'linea': {
        const r = q({ groupBy: 'dia', compare: b.compare ? 'previous' : 'none', limit: 50 })
        if (!hasData(r)) return section(b, EMPTY)
        const values = r.groups.map((g) => compute(g.base)[b.metric] ?? null)
        const previous = r.compareGroups?.map((g) => compute(g.base)[b.metric] ?? null) ?? null
        const svg = lineChartSvg({
          labels: r.groups.map((g) => short(g.key)),
          values,
          previous,
          name: 'Este periodo',
          previousName: r.compareSince
            ? `Periodo anterior (${short(r.compareSince)} – ${short(r.compareUntil!)})`
            : '',
          format: (v) => fmt(b.metric)(v),
          font: FONT_BODY,
        })
        const total = compute(r.totals)[b.metric]
        return section(
          b,
          `<p class="caption">${escapeHtml(label(b.metric))} en el periodo: <strong>${fmt(b.metric)(total)}</strong></p><div class="chart">${svg}</div>`,
        )
      }

      case 'barras': {
        const r = q({ groupBy: b.groupBy, limit: b.limit })
        if (!hasData(r)) return section(b, EMPTY)
        const rows = r.groups.map((g) => ({
          label: g.label,
          value: compute(g.base)[b.metric] ?? 0,
        }))
        if (!TIME_DIMENSIONS.includes(b.groupBy)) rows.sort((x, y) => y.value - x.value)
        const svg = barChartSvg({
          labels: rows.map((x) => x.label),
          values: rows.map((x) => x.value),
          format: (v) => fmt(b.metric)(v),
          font: FONT_BODY,
        })
        return section(
          b,
          `<p class="caption">${escapeHtml(label(b.metric))}</p><div class="chart">${svg}</div>`,
        )
      }

      case 'tabla': {
        const r = q({ groupBy: b.groupBy, limit: b.limit })
        if (!hasData(r)) return section(b, EMPTY)
        const head = b.metrics.map((k) => `<th class="num">${escapeHtml(label(k))}</th>`).join('')
        const row = (name: string, base: BaseSums, cls = '') => {
          const v = compute(base)
          return `<tr class="${cls}"><td>${escapeHtml(name)}</td>${b.metrics
            .map((k) => `<td class="num">${fmt(k)(v[k])}</td>`)
            .join('')}</tr>`
        }
        return section(
          b,
          `<table><thead><tr><th></th>${head}</tr></thead><tbody>${r.groups
            .map((g) => row(g.label, g.base))
            .join('')}</tbody><tfoot>${row('Total', r.totals, 'total')}</tfoot></table>`,
        )
      }

      case 'comparativa': {
        const r = q({ compare: b.compare })
        if (!hasData(r) || !r.compareTotals) return section(b, EMPTY)
        const now = compute(r.totals)
        const before = compute(r.compareTotals)
        const rows = b.metrics
          .map((k) => {
            const d = delta(now[k], before[k], defs.get(k))
            const cls = d?.good === true ? 'good' : d?.good === false ? 'bad' : ''
            return `<tr><td>${escapeHtml(label(k))}</td><td class="num">${fmt(k)(now[k])}</td><td class="num">${fmt(k)(before[k])}</td><td class="num ${cls}">${d?.text ?? '—'}</td></tr>`
          })
          .join('')
        return section(
          b,
          `<table><thead><tr><th>Métrica</th><th class="num">${period}</th><th class="num">${es(r.compareSince!)} – ${es(r.compareUntil!)}</th><th class="num">Variación</th></tr></thead><tbody>${rows}</tbody></table>`,
        )
      }

      case 'texto':
        return b.text.trim() ? section(b, paragraphs(b.text)) : ''

      case 'comentarios':
        return ctx.comments.trim() ? section(b, paragraphs(ctx.comments)) : ''
    }
  })

  const fontFace = (family: string, data: string | null) =>
    data
      ? `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:100 900;font-style:normal;}`
      : ''

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<title>${escapeHtml(ctx.template.name)} · ${escapeHtml(ctx.clientName ?? 'Todas las cuentas')}</title>
<style>
${fontFace('Archivo', ctx.fonts.display)}
${fontFace('DM Sans', ctx.fonts.body)}
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: ${FONT_BODY}; font-size: 10.5pt; line-height: 1.45; color: #2b211d; background: #fff; }
h1, h2, .eyebrow, .kpi-value, th { font-family: ${FONT_DISPLAY}; }
.cover { height: 245mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; break-after: page; border-left: 10mm solid #e0a47c; padding-left: 12mm; }
.cover .logo { width: 22mm; height: 22mm; object-fit: cover; border-radius: 50%; margin-bottom: 10mm; }
.cover .eyebrow { margin: 0; text-transform: uppercase; letter-spacing: 0.14em; font-size: 10pt; color: #9a4f30; font-weight: 700; }
.cover h1 { margin: 4mm 0 0; font-size: 34pt; line-height: 1.05; text-transform: uppercase; font-weight: 800; }
.cover .rule { width: 40mm; height: 2px; background: #2b211d; margin: 8mm 0; }
.cover .period { margin: 0; font-size: 16pt; font-family: ${FONT_DISPLAY}; font-variant-numeric: tabular-nums; }
.cover .meta, .cover .date { margin: 2mm 0 0; color: #6f625b; }
.cover .author { margin: 14mm 0 0; font-weight: 600; }
.block { margin: 0 0 9mm; break-inside: avoid; page-break-inside: avoid; }
.block-tabla, .block-comentarios, .block-texto { break-inside: auto; page-break-inside: auto; }
h2 { margin: 0 0 3mm; padding-bottom: 1.5mm; border-bottom: 1px solid #e0a47c; font-size: 13pt; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700; }
.caption { margin: 0 0 2mm; color: #6f625b; }
.caption strong { color: #2b211d; }
.empty { color: #6f625b; font-style: italic; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
.kpi { display: flex; flex-direction: column; gap: 1mm; padding: 3mm 4mm; background: #f8f3ef; border-left: 2px solid #e0a47c; }
.kpi-label { font-size: 9pt; color: #6f625b; }
.kpi-value { font-size: 18pt; font-weight: 700; font-variant-numeric: tabular-nums; }
.kpi-delta { font-size: 8.5pt; color: #6f625b; }
.good { color: #1b7a3f; }
.bad { color: #b3261e; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; }
th { text-align: left; font-weight: 600; color: #6f625b; padding: 1.5mm 2mm; border-bottom: 1px solid #2b211d; }
td { padding: 1.5mm 2mm; border-bottom: 1px solid #ece4de; }
tr { break-inside: avoid; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tfoot td { font-weight: 700; border-top: 1px solid #2b211d; border-bottom: 0; }
.chart svg { display: block; width: 100%; height: auto; }
p { margin: 0 0 2.5mm; }
</style>
</head>
<body>
${blocks.join('\n')}
</body>
</html>`
}
