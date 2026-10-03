import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { todayIn } from '@shared/data/dates'
import type { GroupPerf } from '@shared/meta'
import { computeMetrics, DEFAULT_HOLD_RATE } from '@shared/meta-metrics'
import { call } from '../lib/ipc'
import { useFields } from '../data/hooks'
import { useNav, useTimeZone } from '../data/nav'
import { isoToEs, RANGE_LABELS, rangeFor, type RangePreset } from './meta'
import { formatMetric, metricDefs, useActionTypes, useTableSettings } from './metrics'

const COLUMNS = [
  'gasto',
  'compras',
  'valor_compras',
  'roas',
  'cpa',
  'ctr_enlace',
  'cpm',
  'hook_rate',
  'hold_rate',
]

function Ranking({
  title,
  groups,
  currency,
  onOpen,
  testId,
}: {
  title: string
  groups: GroupPerf[]
  currency: string
  onOpen?: (id: string) => void
  testId: string
}) {
  const settings = useTableSettings()
  const actionTypes = useActionTypes()
  const defs = useMemo(
    () => metricDefs(settings.data?.metrics ?? [], actionTypes.data ?? []),
    [settings.data?.metrics, actionTypes.data],
  )
  const opts = {
    custom: settings.data?.metrics ?? [],
    holdRate: settings.data?.holdRate ?? DEFAULT_HOLD_RATE,
    actionTypes: actionTypes.data ?? [],
  }
  return (
    <div className="meta-table-scroll">
      <table className="meta-table" data-testid={testId}>
        <thead>
          <tr>
            <th>{title}</th>
            <th className="num">Creatividades</th>
            <th className="num">Anuncios</th>
            {COLUMNS.map((c) => (
              <th key={c} className="num">
                {defs.get(c)?.label ?? c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const v = computeMetrics(g.base, null, opts)
            return (
              <tr key={g.id} data-testid="ranking-row">
                <td>
                  {onOpen ? (
                    <button type="button" className="btn-link" onClick={() => onOpen(g.id)}>
                      {g.label}
                    </button>
                  ) : g.color ? (
                    <span className="chip" data-color={g.color}>
                      {g.label}
                    </span>
                  ) : (
                    <span>{g.label}</span>
                  )}
                </td>
                <td className="num">{g.creatives}</td>
                <td className="num">{g.ads}</td>
                {COLUMNS.map((c) => (
                  <td key={c} className="num">
                    {formatMetric(v[c], defs.get(c), currency)}
                  </td>
                ))}
              </tr>
            )
          })}
          {groups.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length + 3} className="faint">
                Ninguna creatividad con anuncios vinculados en este periodo.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/** Rendimiento por etiqueta (ángulo, hook, formato…) y ranking de creatividades. */
export function MetaCreatives() {
  const nav = useNav()
  const tz = useTimeZone()
  const fields = useFields('creatividad')
  const tagFields = (fields.data ?? []).filter(
    (f) => (f.type === 'select' || f.type === 'multiselect') && f.key !== 'estado',
  )
  const [fieldId, setFieldId] = useState<string | null>(null)
  const field =
    tagFields.find((f) => f.id === fieldId) ??
    tagFields.find((f) => f.key === 'angulo') ??
    tagFields[0]
  const [preset, setPreset] = useState<RangePreset>('30d')
  const range = rangeFor(preset, todayIn(tz))
  const clients = useQuery({
    queryKey: ['data', 'meta', 'clients'],
    queryFn: () => call('data:query', { entity: 'cliente' }),
  })
  const [clientId, setClientId] = useState<string | null>(null)
  const perf = useQuery({
    queryKey: ['data', 'meta', 'tags', field?.id, range.since, range.until, clientId],
    queryFn: () =>
      call('meta:tagPerf', {
        fieldId: field!.id,
        since: range.since,
        until: range.until,
        clientId,
      }),
    enabled: !!field,
    placeholderData: (prev) => prev,
  })
  return (
    <div className="meta-perf" data-testid="meta-creatives">
      <p className="muted">
        Métricas de los anuncios vinculados a cada creatividad (Biblioteca de creatividades → ficha
        → Anuncios). Una creatividad con dos etiquetas cuenta en las dos.
      </p>
      <div className="meta-toolbar">
        <div className="field">
          <label htmlFor="tag-field">Agrupar por</label>
          <select
            id="tag-field"
            className="input"
            value={field?.id ?? ''}
            onChange={(e) => setFieldId(e.target.value)}
          >
            {tagFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tag-range">Periodo</label>
          <select
            id="tag-range"
            className="input"
            value={preset}
            onChange={(e) => setPreset(e.target.value as RangePreset)}
          >
            {(Object.keys(RANGE_LABELS) as RangePreset[]).map((p) => (
              <option key={p} value={p}>
                {RANGE_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tag-client">Cliente</label>
          <select
            id="tag-client"
            className="input"
            value={clientId ?? ''}
            onChange={(e) => setClientId(e.target.value || null)}
          >
            <option value="">Todos</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <span className="faint meta-range-text num">
          {isoToEs(range.since)} – {isoToEs(range.until)}
        </span>
      </div>
      {perf.data && field && (
        <>
          {perf.data.partial && (
            <p className="hint danger-text">
              Faltan tipos de cambio de alguna moneda: esos importes no se han sumado.
            </p>
          )}
          <Ranking
            title={field.label}
            groups={perf.data.groups}
            currency={perf.data.currency}
            testId="tag-ranking"
          />
          <h3 className="panel-subtitle">Creatividades</h3>
          <Ranking
            title="Creatividad"
            groups={perf.data.creatives}
            currency={perf.data.currency}
            onOpen={(id) => nav.openRecord('creatividad', id)}
            testId="creative-ranking"
          />
        </>
      )}
    </div>
  )
}
