import { useMemo, useState } from 'react'
import {
  DIMENSION_LABELS,
  RANGE_LABELS,
  RANGE_PRESETS,
  rangeFor,
  TIME_DIMENSIONS,
  WIDGET_LABELS,
  WIDGET_TYPES,
  type AnalysisFilter,
  type Dimension,
  type RangePreset,
  type Widget,
  type WidgetType,
} from '@shared/analysis'
import { useFields } from '../data/hooks'
import { delta, formatMetric } from '../meta/metrics'
import { isoToEs } from '../meta/meta'
import { Chart } from './Chart'
import { MetricSelect, useAnalysis, useFormatter, useMetricKit, useToday } from './kit'

const DIMS_FOR: Record<WidgetType, readonly Dimension[]> = {
  kpi: [],
  line: TIME_DIMENSIONS,
  bar: ['cliente', 'cuenta', 'campana', 'creatividad', 'etiqueta', 'mes', 'semana'],
  table: ['cliente', 'cuenta', 'campana', 'creatividad', 'etiqueta', 'mes', 'semana', 'dia'],
  ranking: ['cliente', 'cuenta', 'campana', 'creatividad', 'etiqueta'],
}

export function widgetTitle(w: Widget, label: (k: string) => string): string {
  if (w.title) return w.title
  const m = label(w.metric)
  if (w.type === 'kpi') return m
  if (w.type === 'line') return `${m} por ${DIMENSION_LABELS[w.groupBy ?? 'dia'].toLowerCase()}`
  if (w.type === 'table') return `Por ${DIMENSION_LABELS[w.groupBy ?? 'cuenta'].toLowerCase()}`
  return `${m} por ${DIMENSION_LABELS[w.groupBy ?? 'cliente'].toLowerCase()}`
}

/** Un widget del dashboard: hace su consulta y se pinta según su tipo. */
export function WidgetView({
  w,
  filter,
  onEdit,
  onRemove,
}: {
  w: Widget
  filter: AnalysisFilter
  onEdit: (() => void) | null
  onRemove: (() => void) | null
}) {
  const today = useToday()
  const kit = useMetricKit()
  const [asTable, setAsTable] = useState(false)
  const range = rangeFor(w.range, today)
  const groupBy = w.type === 'kpi' ? null : (w.groupBy ?? DIMS_FOR[w.type][0] ?? null)
  const q = useAnalysis({
    ...range,
    filter,
    groupBy,
    tagFieldId: w.tagFieldId,
    compare: w.compare ? 'previous' : 'none',
    limit: w.type === 'table' ? 20 : 8,
  })
  const def = kit.defs.get(w.metric)
  const currency = q.data?.currency ?? 'EUR'
  const format = useFormatter(def, currency)
  const label = (k: string) => kit.defs.get(k)?.label ?? k
  const title = widgetTitle(w, label)
  const r = q.data

  const rows = useMemo(
    () => (r ? r.groups.map((g) => ({ ...g, v: kit.compute(g.base) })) : []),
    [r, kit],
  )
  const prevRows = useMemo(
    () => (r?.compareGroups ? r.compareGroups.map((g) => kit.compute(g.base)) : null),
    [r, kit],
  )

  let body: React.ReactNode = null
  if (r) {
    if (w.type === 'kpi') {
      const now = kit.compute(r.totals)[w.metric]
      const before = r.compareTotals ? kit.compute(r.compareTotals)[w.metric] : null
      const d = delta(now, before, def)
      body = (
        <div className="widget-kpi">
          <span className="kpi-value num">{formatMetric(now, def, currency)}</span>
          <span className="kpi-hint faint">
            {d ? (
              <span className={d.good === null ? '' : d.good ? 'trend-good' : 'trend-bad'}>
                {d.text} vs. periodo anterior
              </span>
            ) : w.compare ? (
              'sin periodo anterior'
            ) : null}
          </span>
        </div>
      )
    } else if ((w.type === 'line' || w.type === 'bar') && !asTable) {
      const series = [
        {
          name: 'Periodo',
          slot: 0,
          values: rows.map((x) => x.v[w.metric] ?? null),
        },
      ]
      if (prevRows && w.type === 'line')
        series.push({
          name: 'Periodo anterior',
          slot: 1,
          dashed: true,
          values: rows.map((_, i) => prevRows[i]?.[w.metric] ?? null),
        } as (typeof series)[number])
      body = (
        <Chart
          kind={w.type}
          labels={rows.map((x) => x.label)}
          series={series}
          format={format}
          title={title}
          height={w.type === 'bar' ? Math.max(160, rows.length * 34 + 24) : 240}
        />
      )
    } else if (w.type === 'ranking') {
      const better = def?.higherIsBetter !== false
      const sorted = [...rows]
        .filter((x) => x.key !== '__otros__' && x.v[w.metric] !== null)
        .sort((a, b) => ((b.v[w.metric] ?? 0) - (a.v[w.metric] ?? 0)) * (better ? 1 : -1))
      const max = Math.max(...sorted.map((x) => Math.abs(x.v[w.metric] ?? 0)), 0)
      body = (
        <ol className="ranking" data-testid="widget-ranking">
          {sorted.map((x, i) => (
            <li key={x.key}>
              <span className="ranking-pos num">{i + 1}</span>
              <span className="ranking-label">{x.label}</span>
              <span className="bar" aria-hidden="true">
                <span
                  className="bar-fill"
                  data-color="azul"
                  style={{ width: `${max ? (Math.abs(x.v[w.metric] ?? 0) / max) * 100 : 0}%` }}
                />
              </span>
              <span className="num">{format(x.v[w.metric] ?? 0)}</span>
            </li>
          ))}
          {sorted.length === 0 && <li className="faint">Sin datos en este periodo.</li>}
        </ol>
      )
    } else {
      const cols = w.type === 'table' && w.metrics.length ? w.metrics : [w.metric]
      body = (
        <div className="meta-table-scroll">
          <table className="meta-table">
            <thead>
              <tr>
                <th>{DIMENSION_LABELS[groupBy ?? 'cuenta']}</th>
                {cols.map((c) => (
                  <th key={c} className="num">
                    {label(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.key}>
                  <td>{x.label}</td>
                  {cols.map((c) => (
                    <td key={c} className="num">
                      {formatMetric(x.v[c], kit.defs.get(c), currency)}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 1} className="faint">
                    Sin datos en este periodo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )
    }
  }

  return (
    <section className="widget" data-size={w.size} data-testid="widget">
      <div className="widget-head">
        <h3 className="widget-title">{title}</h3>
        <span
          className="faint widget-range num"
          title={`${isoToEs(range.since)} – ${isoToEs(range.until)}`}
        >
          {RANGE_LABELS[w.range]}
        </span>
        {(w.type === 'line' || w.type === 'bar') && (
          <button type="button" className="btn-link" onClick={() => setAsTable((t) => !t)}>
            {asTable ? 'Ver gráfica' : 'Ver tabla'}
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Editar ${title}`}
            onClick={onEdit}
          >
            ✎
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Quitar ${title}`}
            onClick={onRemove}
          >
            ×
          </button>
        )}
      </div>
      {r?.partial && (
        <p className="hint danger-text">Faltan tipos de cambio: hay importes fuera.</p>
      )}
      {body}
    </section>
  )
}

/** Crear o editar un widget. */
export function WidgetDialog({
  widget,
  onSave,
  onClose,
}: {
  widget: Widget | null
  onSave: (w: Widget) => void
  onClose: () => void
}) {
  const kit = useMetricKit()
  const fields = useFields('creatividad')
  const tagFields = (fields.data ?? []).filter(
    (f) => f.type === 'select' || f.type === 'multiselect',
  )
  const [w, setW] = useState<Widget>(
    () =>
      widget ?? {
        id: `w-${Date.now().toString(36)}`,
        type: 'kpi',
        title: '',
        metric: 'gasto',
        metrics: [],
        groupBy: null,
        tagFieldId: null,
        range: '30d',
        compare: true,
        size: 's',
      },
  )
  const set = (patch: Partial<Widget>) => setW((x) => ({ ...x, ...patch }))
  const dims = DIMS_FOR[w.type]
  const groupBy =
    w.type === 'kpi' ? null : w.groupBy && dims.includes(w.groupBy) ? w.groupBy : dims[0]!
  const metricKeys = [...kit.defs.values()].filter((d) => d.group !== 'Acciones')
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="widget-t"
        data-testid="widget-dialog"
      >
        <h2 id="widget-t">{widget ? 'Editar widget' : 'Nuevo widget'}</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="w-type">Tipo</label>
            <select
              id="w-type"
              className="input"
              value={w.type}
              onChange={(e) => {
                const type = e.target.value as WidgetType
                set({
                  type,
                  size: type === 'kpi' ? 's' : type === 'line' || type === 'table' ? 'l' : 'm',
                })
              }}
            >
              {WIDGET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {WIDGET_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="w-title">Título (opcional)</label>
            <input
              id="w-title"
              className="input"
              maxLength={80}
              value={w.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>
        </div>
        <div className="field-row">
          <MetricSelect
            id="w-metric"
            value={w.metric}
            defs={kit.defs}
            onChange={(metric) => set({ metric })}
          />
          {w.type !== 'kpi' && (
            <div className="field">
              <label htmlFor="w-group">Agrupar por</label>
              <select
                id="w-group"
                className="input"
                value={groupBy ?? ''}
                onChange={(e) => set({ groupBy: e.target.value as Dimension })}
              >
                {dims.map((d) => (
                  <option key={d} value={d}>
                    {DIMENSION_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {groupBy === 'etiqueta' && (
          <div className="field">
            <label htmlFor="w-tag">Etiqueta</label>
            <select
              id="w-tag"
              className="input"
              value={w.tagFieldId ?? tagFields[0]?.id ?? ''}
              onChange={(e) => set({ tagFieldId: e.target.value })}
            >
              {tagFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {w.type === 'table' && (
          <fieldset className="field">
            <legend>Columnas</legend>
            <div className="checks-grid">
              {metricKeys.slice(0, 40).map((d) => (
                <label key={d.key} className="check">
                  <input
                    type="checkbox"
                    checked={w.metrics.includes(d.key)}
                    onChange={(e) =>
                      set({
                        metrics: e.target.checked
                          ? [...w.metrics, d.key].slice(0, 12)
                          : w.metrics.filter((x) => x !== d.key),
                      })
                    }
                  />
                  <span>{d.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="field-row">
          <div className="field">
            <label htmlFor="w-range">Periodo</label>
            <select
              id="w-range"
              className="input"
              value={w.range}
              onChange={(e) => set({ range: e.target.value as RangePreset })}
            >
              {RANGE_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {RANGE_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="w-size">Ancho</label>
            <select
              id="w-size"
              className="input"
              value={w.size}
              onChange={(e) => set({ size: e.target.value as Widget['size'] })}
            >
              <option value="s">Estrecho</option>
              <option value="m">Medio</option>
              <option value="l">Ancho</option>
            </select>
          </div>
        </div>
        {(w.type === 'kpi' || w.type === 'line') && (
          <label className="check">
            <input
              type="checkbox"
              checked={w.compare}
              onChange={(e) => set({ compare: e.target.checked })}
            />
            <span>Comparar con el periodo anterior</span>
          </label>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              onSave({
                ...w,
                groupBy,
                tagFieldId:
                  groupBy === 'etiqueta' ? (w.tagFieldId ?? tagFields[0]?.id ?? null) : null,
                metrics: w.type === 'table' && w.metrics.length === 0 ? [w.metric] : w.metrics,
              })
            }
          >
            Guardar
          </button>
        </div>
      </div>
    </>
  )
}
