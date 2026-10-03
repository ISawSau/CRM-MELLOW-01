import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import type { AnalysisQuery } from '@shared/analysis'
import { todayIn } from '@shared/data/dates'
import type { BaseSums } from '@shared/meta'
import { computeMetrics, DEFAULT_HOLD_RATE, RANGE_KEYS, type MetricDef } from '@shared/meta-metrics'
import { call } from '../lib/ipc'
import { useTimeZone } from '../data/nav'
import { formatMetric, metricDefs, useActionTypes, useTableSettings } from '../meta/metrics'

/** Definiciones de métricas (con las propias) y cálculo de una fila de sumas. */
export function useMetricKit() {
  const settings = useTableSettings()
  const actionTypes = useActionTypes()
  const custom = settings.data?.metrics
  const holdRate = settings.data?.holdRate ?? DEFAULT_HOLD_RATE
  const types = actionTypes.data
  const defs = useMemo(() => metricDefs(custom ?? [], types ?? []), [custom, types])
  const compute = useCallback(
    (base: BaseSums) =>
      computeMetrics(base, null, { custom: custom ?? [], holdRate, actionTypes: types ?? [] }),
    [custom, holdRate, types],
  )
  return { defs, compute, ready: !!settings.data && !!actionTypes.data }
}

export function useToday(): string {
  return todayIn(useTimeZone())
}

export function useAnalysis(q: AnalysisQuery | null) {
  return useQuery({
    queryKey: ['data', 'meta', 'analysis', q],
    queryFn: () => call('analysis:query', q!),
    enabled: q !== null,
    placeholderData: (prev) => prev,
  })
}

/** Formateador estable para las gráficas de una métrica. */
export function useFormatter(def: MetricDef | undefined, currency: string) {
  return useCallback((v: number) => formatMetric(v, def, currency), [def, currency])
}

/** Selector de métrica agrupado (sin las acciones, que son cientos). */
export function MetricSelect({
  id,
  value,
  onChange,
  defs,
  label = 'Métrica',
}: {
  id: string
  value: string
  onChange: (v: string) => void
  defs: Map<string, MetricDef>
  label?: string
}) {
  const groups = new Map<string, MetricDef[]>()
  for (const d of defs.values()) {
    // Las acciones son cientos y el alcance no se puede sumar entre días ni cuentas.
    if (d.group === 'Acciones' || RANGE_KEYS.has(d.key)) continue
    groups.set(d.group, [...(groups.get(d.group) ?? []), d])
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {[...groups.entries()].map(([g, list]) => (
          <optgroup key={g} label={g}>
            {list.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
