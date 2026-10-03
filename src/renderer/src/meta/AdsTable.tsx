import { Fragment, useMemo, useState } from 'react'
import { formatCurrency, formatDate, formatDateTime } from '@shared/format'
import type { PerfLevel, TableResult, TableRow } from '@shared/meta'
import {
  computeMetrics,
  ruleColor,
  type ConditionalRule,
  type CustomMetric,
  type MetricDef,
  type MetricValues,
} from '@shared/meta-metrics'
import { fileUrl } from '../data/files'
import { useNav } from '../data/nav'
import { DELIVERY_LABELS, deliveryTone } from './meta'
import { columnLabel, delta, formatMetric, isConfigColumn } from './metrics'

const LEVEL_NAMES: Record<PerfLevel, string> = {
  campaign: 'Campaña',
  adset: 'Conjunto de anuncios',
  ad: 'Anuncio',
}

const BID_LABELS: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: 'Volumen más alto',
  LOWEST_COST_WITH_BID_CAP: 'Límite de puja',
  COST_CAP: 'Límite de coste',
  LOWEST_COST_WITH_MIN_ROAS: 'ROAS mínimo',
}

const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: 'Ventas',
  OUTCOME_LEADS: 'Clientes potenciales',
  OUTCOME_TRAFFIC: 'Tráfico',
  OUTCOME_ENGAGEMENT: 'Interacción',
  OUTCOME_AWARENESS: 'Reconocimiento',
  OUTCOME_APP_PROMOTION: 'Promoción de la app',
  OFFSITE_CONVERSIONS: 'Conversiones',
  VALUE: 'Valor de conversiones',
  LINK_CLICKS: 'Clics en el enlace',
  LANDING_PAGE_VIEWS: 'Visitas a la página de destino',
  REACH: 'Alcance',
  IMPRESSIONS: 'Impresiones',
  THRUPLAY: 'ThruPlay',
  LEAD_GENERATION: 'Clientes potenciales',
}

const RANKING_LABELS: Record<string, string> = {
  ABOVE_AVERAGE: 'Superior a la media',
  AVERAGE: 'En la media',
  BELOW_AVERAGE_35: 'Inferior (35 % más bajo)',
  BELOW_AVERAGE_20: 'Inferior (20 % más bajo)',
  BELOW_AVERAGE_10: 'Inferior (10 % más bajo)',
}

const rankingTone = (r: string | null) =>
  r === 'ABOVE_AVERAGE' ? 'verde' : r === 'AVERAGE' ? 'gris' : r ? 'vino' : null

const humanize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')

export interface TableOptions {
  columns: string[]
  rules: ConditionalRule[]
  custom: CustomMetric[]
  holdRate: string
  actionTypes: string[]
  defs: Map<string, MetricDef>
  compare: boolean
}

type Sort = { key: string; dir: 1 | -1 } | null

function ConfigCell({ k, row, currency }: { k: string; row: TableRow; currency: string }) {
  const nav = useNav()
  const fmtMoney = (v: number) => formatCurrency(v, currency)
  switch (k) {
    case 'entrega':
      return row.effectiveStatus ? (
        <span className="chip" data-color={deliveryTone(row.effectiveStatus)}>
          {DELIVERY_LABELS[row.effectiveStatus] ?? humanize(row.effectiveStatus)}
        </span>
      ) : (
        <span className="faint">—</span>
      )
    case 'presupuesto':
      return (
        <span className="faint num">
          {row.dailyBudget !== null
            ? `${fmtMoney(row.dailyBudget)}/día`
            : row.lifetimeBudget !== null
              ? `${fmtMoney(row.lifetimeBudget)} total`
              : '—'}
        </span>
      )
    case 'puja':
      return (
        <span>
          {row.bidStrategy ? (BID_LABELS[row.bidStrategy] ?? humanize(row.bidStrategy)) : '—'}
        </span>
      )
    case 'objetivo':
      return (
        <span>
          {row.objective ? (OBJECTIVE_LABELS[row.objective] ?? humanize(row.objective)) : '—'}
        </span>
      )
    case 'atribucion':
      return <span>{row.attribution ?? '—'}</span>
    case 'inicio':
      return (
        <span className="num">{row.startTime ? formatDate(new Date(row.startTime)) : '—'}</span>
      )
    case 'fin':
      return (
        <span className="num">{row.endTime ? formatDate(new Date(row.endTime)) : 'Sin fecha'}</span>
      )
    case 'ultima_edicion':
      return row.lastEdit ? (
        <span
          className="num"
          title={
            row.lastEditExact
              ? 'Según el historial de actividad de la cuenta'
              : 'Aproximada: última actualización del objeto (el historial de Meta solo guarda 7 días al conectar)'
          }
        >
          {formatDateTime(new Date(row.lastEdit))}
          {!row.lastEditExact && <span className="faint"> (aprox.)</span>}
        </span>
      ) : (
        <span className="faint">—</span>
      )
    case 'calidad':
    case 'interaccion':
    case 'conversion': {
      const r =
        k === 'calidad'
          ? row.rankings.quality
          : k === 'interaccion'
            ? row.rankings.engagement
            : row.rankings.conversion
      const tone = rankingTone(r)
      return tone ? (
        <span className="chip" data-color={tone}>
          {RANKING_LABELS[r!] ?? humanize(r!)}
        </span>
      ) : (
        <span className="faint">—</span>
      )
    }
    case 'creatividad':
      return row.creatives.length ? (
        <span className="chips">
          {row.creatives.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip chip-link"
              onClick={() => nav.openRecord('creatividad', c.id)}
            >
              {c.title}
            </button>
          ))}
        </span>
      ) : (
        <span className="faint">—</span>
      )
  }
  return null
}

function MetricCell({
  k,
  values,
  previous,
  o,
  currency,
}: {
  k: string
  values: MetricValues
  previous: MetricValues | null
  o: TableOptions
  currency: string
}) {
  const def = o.defs.get(k)
  const v = values[k]
  const color = ruleColor(o.rules, k, v ?? null)
  const d = previous ? delta(v, previous[k], def) : null
  return (
    <td className="num" data-color={color ?? undefined}>
      {formatMetric(v, def, currency)}
      {d && (
        <span
          className={`cell-delta ${d.good === null ? '' : d.good ? 'trend-good' : 'trend-bad'}`}
        >
          {d.text}
        </span>
      )}
    </td>
  )
}

export function AdsTable({
  r,
  level,
  o,
  onOpen,
}: {
  r: TableResult
  level: PerfLevel
  o: TableOptions
  onOpen: ((row: TableRow) => void) | null
}) {
  const [sort, setSort] = useState<Sort>(null)
  const compute = useMemo(
    () => (base: Record<string, number>, range: TableRow['range']) =>
      computeMetrics(base, range, {
        custom: o.custom,
        holdRate: o.holdRate,
        actionTypes: o.actionTypes,
      }),
    [o.custom, o.holdRate, o.actionTypes],
  )
  const rows = useMemo(() => {
    const list = r.rows.map((row) => ({
      row,
      values: compute(row.base, row.range),
      previous: row.previous ? compute(row.previous, null) : null,
    }))
    if (sort) {
      list.sort((a, b) => {
        if (sort.key === 'nombre') return a.row.name.localeCompare(b.row.name) * sort.dir
        const x = a.values[sort.key] ?? -Infinity
        const y = b.values[sort.key] ?? -Infinity
        return (x - y) * sort.dir
      })
    }
    return list
  }, [r.rows, compute, sort])
  const totals = useMemo(() => compute(r.totals, r.totalsRange), [compute, r.totals, r.totalsRange])
  const prevTotals = useMemo(
    () => (o.compare ? compute(r.previous, null) : null),
    [compute, r.previous, o.compare],
  )
  const cols = o.columns.filter((c) => {
    const levels = isConfigColumn(c)
      ? (
          [
            ['atribucion', ['adset']],
            ['calidad', ['ad']],
            ['interaccion', ['ad']],
            ['conversion', ['ad']],
            ['creatividad', ['ad']],
          ] as [string, string[]][]
        ).find(([k]) => k === c)?.[1]
      : undefined
    return !levels || levels.includes(level)
  })

  const header = (key: string, label: string, numeric: boolean) => {
    const active = sort?.key === key
    return (
      <th
        key={key}
        className={numeric ? 'num' : undefined}
        aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          className="th-sort"
          onClick={() =>
            setSort(
              active ? (sort.dir === -1 ? { key, dir: 1 } : null) : { key, dir: numeric ? -1 : 1 },
            )
          }
        >
          {label}
          {active && <span aria-hidden="true">{sort.dir === -1 ? ' ↓' : ' ↑'}</span>}
        </button>
      </th>
    )
  }

  const span = cols.length + 1
  return (
    <div className="meta-table-scroll">
      <table className="meta-table" data-testid="meta-table">
        <thead>
          <tr>
            {header('nombre', LEVEL_NAMES[level], false)}
            {cols.map((c) =>
              isConfigColumn(c) ? (
                <th key={c}>{columnLabel(c, o.defs)}</th>
              ) : (
                header(c, columnLabel(c, o.defs), true)
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, values, previous }) => (
            <Fragment key={row.id}>
              <tr data-testid="meta-row">
                <td>
                  <div className="meta-name">
                    {level === 'ad' &&
                      (row.thumbFileId ? (
                        <img className="meta-thumb" src={fileUrl(row.thumbFileId)} alt="" />
                      ) : (
                        <span className="meta-thumb" aria-hidden="true" />
                      ))}
                    {onOpen ? (
                      <button type="button" className="btn-link" onClick={() => onOpen(row)}>
                        {row.name}
                      </button>
                    ) : (
                      <span>{row.name}</span>
                    )}
                  </div>
                </td>
                {cols.map((c) =>
                  isConfigColumn(c) ? (
                    <td key={c}>
                      <ConfigCell k={c} row={row} currency={r.currency} />
                    </td>
                  ) : (
                    <MetricCell
                      key={c}
                      k={c}
                      values={values}
                      previous={previous}
                      o={o}
                      currency={r.currency}
                    />
                  ),
                )}
              </tr>
              {row.breakdown?.map((b) => {
                const bv = compute(b.base, null)
                return (
                  <tr
                    key={`${row.id}:${b.value}`}
                    className="breakdown-row"
                    data-testid="meta-breakdown-row"
                  >
                    <td>
                      <span className="breakdown-value">{b.value}</span>
                    </td>
                    {cols.map((c) =>
                      isConfigColumn(c) ? (
                        <td key={c} />
                      ) : (
                        <MetricCell
                          key={c}
                          k={c}
                          values={bv}
                          previous={null}
                          o={o}
                          currency={r.currency}
                        />
                      ),
                    )}
                  </tr>
                )
              })}
            </Fragment>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={span} className="faint">
                Sin datos en este periodo.
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr data-testid="meta-totals">
              <td>Total ({rows.length})</td>
              {cols.map((c) =>
                isConfigColumn(c) ? (
                  <td key={c} />
                ) : (
                  <MetricCell
                    key={c}
                    k={c}
                    values={totals}
                    previous={prevTotals}
                    o={{ ...o, rules: [] }}
                    currency={r.currency}
                  />
                ),
              )}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
