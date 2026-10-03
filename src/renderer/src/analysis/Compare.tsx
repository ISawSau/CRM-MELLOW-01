import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  RANGE_LABELS,
  RANGE_PRESETS,
  rangeFor,
  type AnalysisFilter,
  type AnalysisResult,
  type RangePreset,
} from '@shared/analysis'
import { call } from '../lib/ipc'
import { useFields } from '../data/hooks'
import { isoToEs, useMetaAccounts } from '../meta/meta'
import { delta, formatMetric } from '../meta/metrics'
import { Chart } from './Chart'
import { MetricSelect, useAnalysis, useFormatter, useMetricKit, useToday } from './kit'

type Mode = 'periodos' | 'cliente' | 'cuenta' | 'campana' | 'creatividad' | 'etiqueta'

const MODE_LABELS: Record<Mode, string> = {
  periodos: 'Periodo frente a periodo',
  cliente: 'Cliente frente a cliente',
  cuenta: 'Cuenta frente a cuenta',
  campana: 'Campaña frente a campaña',
  creatividad: 'Creatividad frente a creatividad',
  etiqueta: 'Etiqueta frente a etiqueta',
}

const ROWS = [
  'gasto',
  'impresiones',
  'clics_enlace',
  'ctr_enlace',
  'cpc',
  'cpm',
  'compras',
  'valor_compras',
  'roas',
  'cpa',
  'ticket_medio',
  'hook_rate',
  'hold_rate',
]

interface Option {
  key: string
  label: string
}

/** Opciones de A y B según el modo. */
function useOptions(mode: Mode, since: string, until: string, tagFieldId: string | null): Option[] {
  const clients = useQuery({
    queryKey: ['data', 'meta', 'clients'],
    queryFn: () => call('data:query', { entity: 'cliente' }),
    enabled: mode === 'cliente',
  })
  const accounts = useMetaAccounts()
  const fields = useFields('creatividad')
  const byDim = useAnalysis(
    mode === 'campana' || mode === 'creatividad'
      ? { since, until, groupBy: mode, limit: 50 }
      : null,
  )
  if (mode === 'cliente') return (clients.data ?? []).map((c) => ({ key: c.id, label: c.title }))
  if (mode === 'cuenta')
    return (accounts.data ?? []).filter((a) => a.enabled).map((a) => ({ key: a.id, label: a.name }))
  if (mode === 'etiqueta') {
    const f = (fields.data ?? []).find((x) => x.id === tagFieldId)
    return ((f?.config['options'] as { id: string; label: string }[] | undefined) ?? []).map(
      (o) => ({ key: o.id, label: o.label }),
    )
  }
  if (mode === 'campana' || mode === 'creatividad')
    return (byDim.data?.groups ?? [])
      .filter((g) => !g.key.startsWith('__'))
      .map((g) => ({ key: g.key, label: g.label }))
  return []
}

function filterFor(mode: Mode, key: string, tagFieldId: string | null): AnalysisFilter {
  switch (mode) {
    case 'cliente':
      return { type: 'client', id: key }
    case 'cuenta':
      return { type: 'account', id: key }
    case 'campana':
      return { type: 'campaign', id: key }
    case 'creatividad':
      return { type: 'creative', id: key }
    case 'etiqueta':
      return { type: 'tag', fieldId: tagFieldId ?? '', optionId: key }
    default:
      return { type: 'all' }
  }
}

/** Comparativas: dos periodos, dos clientes, dos campañas… (SPEC §7.13). */
export function Compare() {
  const today = useToday()
  const kit = useMetricKit()
  const fields = useFields('creatividad')
  const tagFields = (fields.data ?? []).filter(
    (f) => f.type === 'select' || f.type === 'multiselect',
  )
  const [mode, setMode] = useState<Mode>('periodos')
  const [preset, setPreset] = useState<RangePreset>('30d')
  const [against, setAgainst] = useState<'previous' | 'year'>('previous')
  const [tagFieldId, setTagFieldId] = useState<string | null>(null)
  const tagField =
    tagFieldId ?? tagFields.find((f) => f.key === 'angulo')?.id ?? tagFields[0]?.id ?? null
  const [a, setA] = useState<string | null>(null)
  const [b, setB] = useState<string | null>(null)
  const [metric, setMetric] = useState('gasto')
  const range = rangeFor(preset, today)
  const options = useOptions(mode, range.since, range.until, tagField)
  const keyA = options.find((o) => o.key === a)?.key ?? options[0]?.key ?? null
  const keyB = options.find((o) => o.key === b)?.key ?? options[1]?.key ?? options[0]?.key ?? null

  const isPeriods = mode === 'periodos'
  const qa = useAnalysis(
    isPeriods
      ? { ...range, groupBy: 'dia', compare: against }
      : keyA
        ? { ...range, groupBy: 'dia', filter: filterFor(mode, keyA, tagField) }
        : null,
  )
  const qb = useAnalysis(
    !isPeriods && keyB
      ? { ...range, groupBy: 'dia', filter: filterFor(mode, keyB, tagField) }
      : null,
  )

  const labelOf = (k: string | null) => options.find((o) => o.key === k)?.label ?? '—'
  const sides = useMemo(() => {
    const ra: AnalysisResult | undefined = qa.data
    if (!ra) return null
    if (isPeriods) {
      if (!ra.compareTotals || !ra.compareGroups) return null
      return {
        nameA: `${isoToEs(ra.since)} – ${isoToEs(ra.until)}`,
        nameB: `${isoToEs(ra.compareSince)} – ${isoToEs(ra.compareUntil)}`,
        totalsA: ra.totals,
        totalsB: ra.compareTotals,
        daysA: ra.groups,
        daysB: ra.compareGroups,
        currency: ra.currency,
      }
    }
    const rb = qb.data
    if (!rb) return null
    return {
      nameA: labelOf(keyA),
      nameB: labelOf(keyB),
      totalsA: ra.totals,
      totalsB: rb.totals,
      daysA: ra.groups,
      daysB: rb.groups,
      currency: ra.currency,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qa.data, qb.data, isPeriods, keyA, keyB, options])

  const def = kit.defs.get(metric)
  const currency = sides?.currency ?? 'EUR'
  const format = useFormatter(def, currency)
  const series = useMemo(() => {
    if (!sides) return null
    return [
      {
        name: sides.nameA,
        slot: 0,
        values: sides.daysA.map((g) => kit.compute(g.base)[metric] ?? null),
      },
      {
        name: sides.nameB,
        slot: 1,
        dashed: isPeriods,
        values: sides.daysA.map((_, i) => {
          const g = sides.daysB[i]
          return g ? (kit.compute(g.base)[metric] ?? null) : null
        }),
      },
    ]
  }, [sides, kit, metric, isPeriods])

  const va = sides ? kit.compute(sides.totalsA) : null
  const vb = sides ? kit.compute(sides.totalsB) : null
  const customRows = [...kit.defs.values()]
    .filter((d) => d.group === 'Personalizadas')
    .map((d) => d.key)

  return (
    <div className="meta-perf" data-testid="compare">
      <div className="meta-toolbar">
        <div className="field">
          <label htmlFor="cmp-mode">Comparar</label>
          <select
            id="cmp-mode"
            className="input"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Mode)
              setA(null)
              setB(null)
            }}
          >
            {Object.entries(MODE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cmp-range">Periodo</label>
          <select
            id="cmp-range"
            className="input"
            value={preset}
            onChange={(e) => setPreset(e.target.value as RangePreset)}
          >
            {RANGE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {RANGE_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        {isPeriods ? (
          <div className="field">
            <label htmlFor="cmp-against">Frente a</label>
            <select
              id="cmp-against"
              className="input"
              value={against}
              onChange={(e) => setAgainst(e.target.value as 'previous' | 'year')}
            >
              <option value="previous">El periodo anterior</option>
              <option value="year">El mismo periodo del año anterior</option>
            </select>
          </div>
        ) : (
          <>
            {mode === 'etiqueta' && (
              <div className="field">
                <label htmlFor="cmp-tag">Etiqueta</label>
                <select
                  id="cmp-tag"
                  className="input"
                  value={tagField ?? ''}
                  onChange={(e) => {
                    setTagFieldId(e.target.value)
                    setA(null)
                    setB(null)
                  }}
                >
                  {tagFields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(['A', 'B'] as const).map((side) => (
              <div className="field" key={side}>
                <label htmlFor={`cmp-${side}`}>{side}</label>
                <select
                  id={`cmp-${side}`}
                  className="input"
                  value={(side === 'A' ? keyA : keyB) ?? ''}
                  onChange={(e) => (side === 'A' ? setA : setB)(e.target.value)}
                >
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </>
        )}
      </div>
      {!isPeriods && options.length < 2 && (
        <p className="hint">Hacen falta al menos dos con datos en este periodo para comparar.</p>
      )}
      {sides && va && vb && (
        <>
          <div className="meta-table-scroll">
            <table className="meta-table" data-testid="compare-table">
              <thead>
                <tr>
                  <th>Métrica</th>
                  <th className="num">{sides.nameA}</th>
                  <th className="num">{sides.nameB}</th>
                  <th className="num">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {[...ROWS, ...customRows].map((k) => {
                  const d = kit.defs.get(k)
                  const diff = delta(va[k], vb[k], d)
                  return (
                    <tr key={k}>
                      <td>{d?.label ?? k}</td>
                      <td className="num">{formatMetric(va[k], d, sides.currency)}</td>
                      <td className="num">{formatMetric(vb[k], d, sides.currency)}</td>
                      <td className="num">
                        {diff ? (
                          <span
                            className={
                              diff.good === null ? '' : diff.good ? 'trend-good' : 'trend-bad'
                            }
                          >
                            {diff.text}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="meta-toolbar">
            <MetricSelect
              id="cmp-metric"
              label="Evolución de"
              value={metric}
              defs={kit.defs}
              onChange={setMetric}
            />
          </div>
          {series && (
            <Chart
              kind="line"
              labels={sides.daysA.map((g) => g.label)}
              series={series}
              format={format}
              title={`${def?.label ?? metric}: ${sides.nameA} frente a ${sides.nameB}`}
            />
          )}
          <p className="hint">
            La diferencia es de A frente a B. En verde lo que mejora; en rojo lo que empeora.
          </p>
        </>
      )}
    </div>
  )
}
