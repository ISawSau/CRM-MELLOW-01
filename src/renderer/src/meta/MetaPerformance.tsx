import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { todayIn } from '@shared/data/dates'
import { formatCurrency, formatNumber, formatPercent } from '@shared/format'
import {
  derived,
  type AdAccountInfo,
  type PerfLevel,
  type PerfMetrics,
  type PerfResult,
  type PerfRow,
} from '@shared/meta'
import { call } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { fileUrl } from '../data/files'
import {
  DELIVERY_LABELS,
  deliveryTone,
  isoToEs,
  RANGE_LABELS,
  rangeFor,
  useMetaAccounts,
  type RangePreset,
} from './meta'

interface Crumb {
  level: PerfLevel
  parentId: string | null
  label: string
}

const LEVEL_NAMES: Record<PerfLevel, string> = {
  campaign: 'Campaña',
  adset: 'Conjunto de anuncios',
  ad: 'Anuncio',
}
const NEXT: Partial<Record<PerfLevel, PerfLevel>> = { campaign: 'adset', adset: 'ad' }

const money = (v: number | null, c: string) => (v === null ? '—' : formatCurrency(v, c))
const int = (v: number) => formatNumber(v, 0)
const pct = (v: number | null) => (v === null ? '—' : formatPercent(v / 100, 2))
const ratio = (v: number | null) => (v === null ? '—' : formatNumber(v, 2))

function change(now: number | null, before: number | null): { text: string; up: boolean } | null {
  if (now === null || before === null || before === 0) return null
  const d = (now - before) / Math.abs(before)
  return { text: `${d >= 0 ? '+' : ''}${formatPercent(d, 1)}`, up: d >= 0 }
}

function Kpi({
  label,
  value,
  now,
  before,
  goodWhenUp = true,
}: {
  label: string
  value: string
  now: number | null
  before: number | null
  goodWhenUp?: boolean
}) {
  const c = change(now, before)
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value num">{value}</span>
      <span className="kpi-hint faint">
        {c ? (
          <span className={c.up === goodWhenUp ? 'trend-good' : 'trend-bad'}>
            {c.text} vs. periodo anterior
          </span>
        ) : (
          'sin periodo anterior'
        )}
      </span>
    </div>
  )
}

function Kpis({ r }: { r: PerfResult }) {
  const d = derived(r.totals)
  const p = derived(r.previous)
  const c = r.currency
  return (
    <div className="kpis" data-testid="meta-kpis">
      <Kpi
        label="Importe gastado"
        value={money(r.totals.spend, c)}
        now={r.totals.spend}
        before={r.previous.spend}
        goodWhenUp={false}
      />
      <Kpi
        label="Compras"
        value={int(r.totals.purchases)}
        now={r.totals.purchases}
        before={r.previous.purchases}
      />
      <Kpi
        label="Valor de compras"
        value={money(r.totals.purchaseValue, c)}
        now={r.totals.purchaseValue}
        before={r.previous.purchaseValue}
      />
      <Kpi label="ROAS de compra" value={ratio(d.roas)} now={d.roas} before={p.roas} />
      <Kpi
        label="Coste por compra"
        value={money(d.cpa, c)}
        now={d.cpa}
        before={p.cpa}
        goodWhenUp={false}
      />
      <Kpi label="CTR de enlace" value={pct(d.linkCtr)} now={d.linkCtr} before={p.linkCtr} />
      <Kpi label="CPM" value={money(d.cpm, c)} now={d.cpm} before={p.cpm} goodWhenUp={false} />
    </div>
  )
}

function Cells({ m, c }: { m: PerfMetrics; c: string }) {
  const d = derived(m)
  return (
    <>
      <td className="num">{money(m.spend, c)}</td>
      <td className="num">{int(m.impressions)}</td>
      <td className="num">{int(m.linkClicks)}</td>
      <td className="num">{pct(d.linkCtr)}</td>
      <td className="num">{money(d.cpc, c)}</td>
      <td className="num">{money(d.cpm, c)}</td>
      <td className="num">{int(m.purchases)}</td>
      <td className="num">{money(m.purchaseValue, c)}</td>
      <td className="num">{ratio(d.roas)}</td>
      <td className="num">{money(d.cpa, c)}</td>
      <td className="num">{pct(d.hookRate)}</td>
    </>
  )
}

function budget(r: PerfRow, c: string): string {
  if (r.dailyBudget !== null) return `${formatCurrency(r.dailyBudget, c)}/día`
  if (r.lifetimeBudget !== null) return `${formatCurrency(r.lifetimeBudget, c)} total`
  return '—'
}

function Table({
  r,
  level,
  onOpen,
}: {
  r: PerfResult
  level: PerfLevel
  onOpen: (row: PerfRow) => void
}) {
  const c = r.currency
  const canOpen = NEXT[level] !== undefined
  return (
    <div className="meta-table-scroll">
      <table className="meta-table" data-testid="meta-table">
        <thead>
          <tr>
            <th>{LEVEL_NAMES[level]}</th>
            <th>Entrega</th>
            <th>Presupuesto</th>
            <th className="num">Importe gastado</th>
            <th className="num">Impresiones</th>
            <th className="num">Clics en el enlace</th>
            <th className="num">CTR de enlace</th>
            <th className="num">CPC</th>
            <th className="num">CPM</th>
            <th className="num">Compras</th>
            <th className="num">Valor de compras</th>
            <th className="num">ROAS</th>
            <th className="num">Coste por compra</th>
            <th className="num" title="Reproducciones de 3 segundos / impresiones">
              Hook rate
            </th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row) => (
            <tr key={row.id} data-testid="meta-row">
              <td>
                <div className="meta-name">
                  {level === 'ad' &&
                    (row.thumbFileId ? (
                      <img className="meta-thumb" src={fileUrl(row.thumbFileId)} alt="" />
                    ) : (
                      <span className="meta-thumb" aria-hidden="true" />
                    ))}
                  {canOpen ? (
                    <button type="button" className="btn-link" onClick={() => onOpen(row)}>
                      {row.name}
                    </button>
                  ) : (
                    <span>{row.name}</span>
                  )}
                </div>
              </td>
              <td>
                {row.effectiveStatus ? (
                  <span className="chip" data-color={deliveryTone(row.effectiveStatus)}>
                    {DELIVERY_LABELS[row.effectiveStatus] ?? row.effectiveStatus}
                  </span>
                ) : (
                  <span className="faint">—</span>
                )}
              </td>
              <td className="num faint">{budget(row, c)}</td>
              <Cells m={row} c={c} />
            </tr>
          ))}
          {r.rows.length === 0 && (
            <tr>
              <td colSpan={14} className="faint">
                Sin datos en este periodo.
              </td>
            </tr>
          )}
        </tbody>
        {r.rows.length > 0 && (
          <tfoot>
            <tr data-testid="meta-totals">
              <td>Total ({r.rows.length})</td>
              <td />
              <td />
              <Cells m={r.totals} c={c} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function useRange(account: AdAccountInfo | undefined) {
  const [preset, setPreset] = useState<RangePreset | 'custom'>('7d')
  const today = todayIn(account?.timezone ?? 'Europe/Madrid')
  const [custom, setCustom] = useState(() => rangeFor('7d', today))
  const range = preset === 'custom' ? custom : rangeFor(preset, today)
  return { preset, setPreset, range, setCustom: (r: typeof custom) => setCustom(r) }
}

export function MetaPerformance({ onAccounts }: { onAccounts: () => void }) {
  const accounts = useMetaAccounts()
  const enabled = (accounts.data ?? []).filter((a) => a.enabled)
  const [accountId, setAccountId] = useState<string | null>(null)
  const account = enabled.find((a) => a.id === accountId) ?? enabled[0]
  const [path, setPath] = useState<Crumb[]>([])
  const { preset, setPreset, range, setCustom } = useRange(account)
  const crumb: Crumb = path.at(-1) ?? { level: 'campaign', parentId: null, label: 'Campañas' }

  const perf = useQuery({
    queryKey: [
      'data',
      'meta',
      'perf',
      account?.id,
      crumb.level,
      crumb.parentId,
      range.since,
      range.until,
    ],
    queryFn: () =>
      call('meta:performance', {
        accountId: account!.id,
        level: crumb.level,
        parentId: crumb.parentId,
        since: range.since,
        until: range.until,
      }),
    enabled: !!account,
    placeholderData: (prev) => prev,
  })

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

      {perf.data && (
        <>
          {perf.data.unconverted && (
            <Alert>
              Faltan tipos de cambio para {perf.data.accountCurrency}: los importes se muestran en
              la moneda de la cuenta.
            </Alert>
          )}
          <Kpis r={perf.data} />
          <Table
            r={perf.data}
            level={crumb.level}
            onOpen={(row) => {
              const next = NEXT[crumb.level]
              if (next) setPath([...path, { level: next, parentId: row.id, label: row.name }])
            }}
          />
          <p className="hint">
            Fechas en la zona horaria de la cuenta ({account.timezone}). Importes en{' '}
            {perf.data.currency}
            {perf.data.currency !== perf.data.accountCurrency &&
              `, convertidos desde ${perf.data.accountCurrency} con el tipo del BCE de cada día`}
            . Atribución: la configurada en cada conjunto de anuncios, como en Ads Manager.
          </p>
        </>
      )}
    </div>
  )
}
