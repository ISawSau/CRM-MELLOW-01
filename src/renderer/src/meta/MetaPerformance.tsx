import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { todayIn } from '@shared/data/dates'
import {
  BREAKDOWNS,
  type AdAccountInfo,
  type BreakdownKey,
  type PerfLevel,
  type TableResult,
} from '@shared/meta'
import {
  BUILT_IN_PRESETS,
  computeMetrics,
  DEFAULT_HOLD_RATE,
  RANGE_KEYS,
  type ColumnPreset,
  type MetricValues,
} from '@shared/meta-metrics'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { AdsTable, type TableOptions } from './AdsTable'
import { ColumnsDialog } from './ColumnsDialog'
import { isoToEs, RANGE_LABELS, rangeFor, useMetaAccounts, type RangePreset } from './meta'
import {
  delta,
  formatMetric,
  metricDefs,
  useActionTypes,
  useSaveTableSettings,
  useTableSettings,
} from './metrics'

interface Crumb {
  level: PerfLevel
  parentId: string | null
  label: string
}

const NEXT: Partial<Record<PerfLevel, PerfLevel>> = { campaign: 'adset', adset: 'ad' }
const KPI_KEYS = ['gasto', 'compras', 'valor_compras', 'roas', 'cpa', 'ctr_enlace', 'cpm']

function Kpis({ r, o }: { r: TableResult; o: TableOptions }) {
  const opts = { custom: o.custom, holdRate: o.holdRate, actionTypes: o.actionTypes }
  const now: MetricValues = computeMetrics(r.totals, r.totalsRange, opts)
  const before: MetricValues = computeMetrics(r.previous, null, opts)
  return (
    <div className="kpis" data-testid="meta-kpis">
      {KPI_KEYS.map((k) => {
        const def = o.defs.get(k)
        const d = delta(now[k], before[k], def)
        return (
          <div key={k} className="kpi">
            <span className="kpi-label">{def?.label ?? k}</span>
            <span className="kpi-value num">{formatMetric(now[k], def, r.currency)}</span>
            <span className="kpi-hint faint">
              {d ? (
                <span className={d.good === null ? '' : d.good ? 'trend-good' : 'trend-bad'}>
                  {d.text} vs. periodo anterior
                </span>
              ) : (
                'sin periodo anterior'
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function useRange(account: AdAccountInfo | undefined) {
  const [preset, setPreset] = useState<RangePreset | 'custom'>('7d')
  const today = todayIn(account?.timezone ?? 'Europe/Madrid')
  const [custom, setCustom] = useState(() => rangeFor('7d', today))
  const range = preset === 'custom' ? custom : rangeFor(preset, today)
  return { preset, setPreset, range, setCustom }
}

export function MetaPerformance({ onAccounts }: { onAccounts: () => void }) {
  const qc = useQueryClient()
  const accounts = useMetaAccounts()
  const settings = useTableSettings()
  const saveSettings = useSaveTableSettings()
  const actionTypes = useActionTypes()
  const enabled = (accounts.data ?? []).filter((a) => a.enabled)
  const [accountId, setAccountId] = useState<string | null>(null)
  const account = enabled.find((a) => a.id === accountId) ?? enabled[0]
  const [path, setPath] = useState<Crumb[]>([])
  const { preset, setPreset, range, setCustom } = useRange(account)
  const [presetId, setPresetId] = useState('rendimiento')
  const [compare, setCompare] = useState(false)
  const [breakdown, setBreakdown] = useState<BreakdownKey | null>(null)
  const [editing, setEditing] = useState(false)
  const [rangeState, setRangeState] = useState<{ key: string; error: string | null } | null>(null)
  const crumb: Crumb = path.at(-1) ?? { level: 'campaign', parentId: null, label: 'Campañas' }

  const custom = useMemo(() => settings.data?.presets ?? [], [settings.data?.presets])
  const presets: ColumnPreset[] = [...BUILT_IN_PRESETS, ...custom]
  const current = presets.find((p) => p.id === presetId) ?? BUILT_IN_PRESETS[0]!
  const isBuiltIn = BUILT_IN_PRESETS.some((p) => p.id === current.id)
  const defs = useMemo(
    () => metricDefs(settings.data?.metrics ?? [], actionTypes.data ?? []),
    [settings.data?.metrics, actionTypes.data],
  )
  const options: TableOptions = {
    columns: current.columns,
    rules: current.rules,
    custom: settings.data?.metrics ?? [],
    holdRate: settings.data?.holdRate ?? DEFAULT_HOLD_RATE,
    actionTypes: actionTypes.data ?? [],
    defs,
    compare,
  }
  const availableBreakdowns = account?.breakdowns[crumb.level] ?? []
  const activeBreakdown = breakdown && availableBreakdowns.includes(breakdown) ? breakdown : null

  const tableKey = [account?.id, crumb.level, crumb.parentId, range.since, range.until]
  const table = useQuery({
    queryKey: ['data', 'meta', 'table', ...tableKey, compare, activeBreakdown],
    queryFn: () =>
      call('meta:table', {
        accountId: account!.id,
        level: crumb.level,
        parentId: crumb.parentId,
        since: range.since,
        until: range.until,
        compare,
        breakdown: activeBreakdown,
      }),
    enabled: !!account,
    placeholderData: (prev) => prev,
  })

  // Alcance y frecuencia del periodo: se piden a Meta si alguna columna los usa.
  const wantsRange = current.columns.some((c) => RANGE_KEYS.has(c))
  const asked = useRef(new Set<string>())
  const rangeKey = tableKey.join('|')
  const { level, parentId } = crumb
  const { since, until } = range
  useEffect(() => {
    if (!account || !wantsRange || !table.data?.rangeMissing || asked.current.has(rangeKey)) return
    asked.current.add(rangeKey)
    void Promise.resolve()
      .then(() => setRangeState({ key: rangeKey, error: null }))
      .then(() =>
        call('meta:fetchRange', {
          accountId: account.id,
          level,
          parentId,
          since,
          until,
        }),
      )
      .then(() => {
        setRangeState(null)
        return qc.invalidateQueries({ queryKey: ['data', 'meta', 'table'] })
      })
      .catch((e: unknown) =>
        setRangeState({
          key: rangeKey,
          error: e instanceof IpcCallError ? e.message : 'No se pudo pedir el alcance a Meta.',
        }),
      )
  }, [account, wantsRange, table.data?.rangeMissing, rangeKey, level, parentId, since, until, qc])

  if (accounts.data && enabled.length === 0)
    return (
      <div className="empty">
        <h2>Ninguna cuenta activada</h2>
        <p className="muted">Elige qué cuentas publicitarias sincronizar.</p>
        <button type="button" className="btn btn-primary" onClick={onAccounts}>
          Elegir cuentas
        </button>
      </div>
    )
  if (!account) return null

  const savePreset = (p: ColumnPreset, asNew: boolean) => {
    const list = asNew
      ? [...custom, { ...p, id: `p-${Date.now().toString(36)}` }]
      : custom.map((x) => (x.id === p.id ? p : x))
    void saveSettings({ presets: list })
    setPresetId(asNew ? list.at(-1)!.id : p.id)
    setEditing(false)
  }

  return (
    <div className="meta-perf">
      <div className="meta-toolbar">
        <div className="field">
          <label htmlFor="meta-account">Cuenta</label>
          <select
            id="meta-account"
            className="input"
            value={account.id}
            onChange={(e) => {
              setAccountId(e.target.value)
              setPath([])
            }}
          >
            {enabled.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="meta-range">Periodo</label>
          <select
            id="meta-range"
            className="input"
            value={preset}
            onChange={(e) => {
              const p = e.target.value as RangePreset | 'custom'
              if (p === 'custom') setCustom(range)
              setPreset(p)
            }}
          >
            {(Object.keys(RANGE_LABELS) as RangePreset[]).map((p) => (
              <option key={p} value={p}>
                {RANGE_LABELS[p]}
              </option>
            ))}
            <option value="custom">Personalizado</option>
          </select>
        </div>
        {preset === 'custom' ? (
          <>
            <div className="field">
              <label htmlFor="meta-since">Desde</label>
              <input
                id="meta-since"
                type="date"
                className="input"
                value={range.since}
                max={range.until}
                onChange={(e) => e.target.value && setCustom({ ...range, since: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="meta-until">Hasta</label>
              <input
                id="meta-until"
                type="date"
                className="input"
                value={range.until}
                min={range.since}
                onChange={(e) => e.target.value && setCustom({ ...range, until: e.target.value })}
              />
            </div>
          </>
        ) : (
          <span className="faint meta-range-text num">
            {isoToEs(range.since)} – {isoToEs(range.until)}
          </span>
        )}
      </div>

      <div className="meta-toolbar">
        <div className="field">
          <label htmlFor="meta-preset">Columnas</label>
          <span className="inline-add">
            <select
              id="meta-preset"
              className="input"
              value={current.id}
              onChange={(e) => setPresetId(e.target.value)}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              data-testid="edit-columns"
              disabled={!settings.data}
              onClick={() => setEditing(true)}
            >
              Personalizar…
            </button>
          </span>
        </div>
        <div className="field">
          <label htmlFor="meta-breakdown">Desglose</label>
          <select
            id="meta-breakdown"
            className="input"
            value={activeBreakdown ?? ''}
            disabled={availableBreakdowns.length === 0}
            title={
              availableBreakdowns.length === 0
                ? 'Actívalos en Campañas → Cuentas para este nivel'
                : undefined
            }
            onChange={(e) => setBreakdown((e.target.value || null) as BreakdownKey | null)}
          >
            <option value="">Ninguno</option>
            {availableBreakdowns.map((b) => (
              <option key={b} value={b}>
                {BREAKDOWNS[b].label}
              </option>
            ))}
          </select>
        </div>
        <label className="check meta-compare">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          <span>Comparar con el periodo anterior</span>
        </label>
      </div>

      <nav className="crumbs" aria-label="Nivel">
        <button type="button" className="btn-link" onClick={() => setPath([])}>
          Campañas
        </button>
        {path.map((p, i) => (
          <span key={p.parentId}>
            <span className="faint"> › </span>
            <button
              type="button"
              className="btn-link"
              onClick={() => setPath(path.slice(0, i + 1))}
            >
              {p.label}
            </button>
          </span>
        ))}
      </nav>

      {table.data && (
        <>
          {table.data.unconverted && (
            <Alert>
              Faltan tipos de cambio para {table.data.accountCurrency}: los importes se muestran en
              la moneda de la cuenta.
            </Alert>
          )}
          {rangeState?.key === rangeKey &&
            (rangeState.error ? (
              <p className="hint danger-text">{rangeState.error}</p>
            ) : (
              <p className="hint">Pidiendo a Meta el alcance y la frecuencia del periodo…</p>
            ))}
          <Kpis r={table.data} o={options} />
          <AdsTable
            r={table.data}
            level={crumb.level}
            o={options}
            onOpen={
              NEXT[crumb.level]
                ? (row) =>
                    setPath([
                      ...path,
                      { level: NEXT[crumb.level]!, parentId: row.id, label: row.name },
                    ])
                : null
            }
          />
          <p className="hint">
            Fechas en la zona horaria de la cuenta ({account.timezone}). Importes en{' '}
            {table.data.currency}
            {table.data.currency !== table.data.accountCurrency &&
              `, convertidos desde ${table.data.accountCurrency} con el tipo del BCE de cada día`}
            . Atribución: la configurada en cada conjunto de anuncios, como en Ads Manager.
          </p>
        </>
      )}
      {editing && (
        <ColumnsDialog
          preset={current}
          builtIn={isBuiltIn}
          defs={defs}
          onClose={() => setEditing(false)}
          onSave={savePreset}
          onDelete={
            isBuiltIn
              ? null
              : () => {
                  void saveSettings({ presets: custom.filter((p) => p.id !== current.id) })
                  setPresetId('rendimiento')
                  setEditing(false)
                }
          }
        />
      )}
    </div>
  )
}
