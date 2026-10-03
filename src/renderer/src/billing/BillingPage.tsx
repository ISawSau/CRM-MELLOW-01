import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { shiftDate } from '@shared/data/dates'
import { formatCurrency, formatNumber } from '@shared/format'
import { call } from '../lib/ipc'
import { useNav } from '../data/nav'
import { useToday } from '../analysis/kit'
import { isoToEs } from '../meta/meta'

type Period = 'mes' | 'mesPasado' | 'trimestre' | 'anio' | 'anioPasado'

const PERIOD_LABELS: Record<Period, string> = {
  mes: 'Este mes',
  mesPasado: 'Mes pasado',
  trimestre: 'Este trimestre',
  anio: 'Este año',
  anioPasado: 'Año pasado',
}

export function periodRange(p: Period, today: string): { since: string; until: string } {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`
  switch (p) {
    case 'mes':
      return { since: first(y, m), until: today }
    case 'mesPasado': {
      const end = shiftDate(first(y, m), -1)
      return { since: `${end.slice(0, 7)}-01`, until: end }
    }
    case 'trimestre':
      return { since: first(y, Math.floor((m - 1) / 3) * 3 + 1), until: today }
    case 'anio':
      return { since: `${y}-01-01`, until: today }
    case 'anioPasado':
      return { since: `${y - 1}-01-01`, until: `${y - 1}-12-31` }
  }
}

const COLUMNS = [
  ['facturado', 'Facturado'],
  ['cobrado', 'Cobrado'],
  ['pendiente', 'Pendiente'],
  ['vencido', 'Vencido'],
  ['gastos', 'Gastos'],
  ['beneficio', 'Beneficio'],
  ['inversion', 'Inversión en Meta'],
  ['feePrevisto', 'Fee previsto'],
  ['porcentajePrevisto', '% del gasto previsto'],
] as const

/** Facturación y beneficio por cliente (SPEC §7.9). */
export function BillingPage({ num, onNavigate }: { num: string; onNavigate: (s: string) => void }) {
  const today = useToday()
  const nav = useNav()
  const [period, setPeriod] = useState<Period>('mes')
  const range = periodRange(period, today)
  const q = useQuery({
    queryKey: ['data', 'billing', range.since, range.until],
    queryFn: () => call('billing:summary', range),
    placeholderData: (prev) => prev,
  })
  const s = q.data
  const money = (v: number) => formatCurrency(v, s?.currency ?? 'EUR')
  return (
    <div className="page page-wide" data-testid="page-facturacion">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">{num}</span> negocio
        </span>
        <h1 className="title">Facturación</h1>
        <p className="muted">
          Beneficio por cliente: lo facturado y cobrado, los gastos asociados, la inversión en Meta
          y lo previsto por el acuerdo de cada cliente. Las facturas se emiten con tu programa de
          facturación (que cumpla Verifactu) y aquí se registran.
        </p>
      </div>
      <div className="meta-toolbar">
        <div className="field">
          <label htmlFor="bill-period">Periodo</label>
          <select
            id="bill-period"
            className="input"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
          >
            {Object.entries(PERIOD_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <span className="faint meta-range-text num">
          {isoToEs(range.since)} – {isoToEs(range.until)}
        </span>
        <span className="form-actions">
          <button type="button" className="btn" onClick={() => onNavigate('facturas')}>
            Facturas
          </button>
          <button type="button" className="btn" onClick={() => onNavigate('gastos')}>
            Gastos
          </button>
        </span>
      </div>
      {s && (
        <>
          {s.partial && (
            <p className="hint danger-text">
              Faltan tipos de cambio de alguna moneda: esos importes no se han sumado.
            </p>
          )}
          <div className="kpis" data-testid="billing-kpis">
            {(['facturado', 'cobrado', 'pendiente', 'beneficio'] as const).map((k) => (
              <div key={k} className="kpi">
                <span className="kpi-label">{COLUMNS.find((c) => c[0] === k)![1]}</span>
                <span className="kpi-value num">{money(s.totals[k])}</span>
                <span className="kpi-hint faint">
                  {k === 'facturado'
                    ? `${formatNumber(s.totals.facturas, 0)} facturas`
                    : k === 'pendiente'
                      ? `${money(s.totals.vencido)} vencido`
                      : k === 'beneficio'
                        ? 'cobrado − gastos'
                        : ''}
                </span>
              </div>
            ))}
          </div>
          <div className="meta-table-scroll">
            <table className="meta-table" data-testid="billing-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  {COLUMNS.map(([k, l]) => (
                    <th key={k} className="num">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.clientId ?? 'none'}>
                    <td>
                      {r.clientId ? (
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => nav.openRecord('cliente', r.clientId!)}
                        >
                          {r.client}
                        </button>
                      ) : (
                        r.client
                      )}
                    </td>
                    {COLUMNS.map(([k]) => (
                      <td
                        key={k}
                        className="num"
                        data-color={k === 'vencido' && r.vencido > 0 ? 'vino' : undefined}
                      >
                        {money(r[k])}
                      </td>
                    ))}
                  </tr>
                ))}
                {s.rows.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="faint">
                      Nada en este periodo. Registra facturas y gastos en sus secciones.
                    </td>
                  </tr>
                )}
              </tbody>
              {s.rows.length > 0 && (
                <tfoot>
                  <tr>
                    <td>Total</td>
                    {COLUMNS.map(([k]) => (
                      <td key={k} className="num">
                        {money(s.totals[k])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <h3 className="panel-subtitle">Facturas vencidas</h3>
          <ul className="event-list" data-testid="overdue">
            {s.overdue.map((o) => (
              <li key={o.id}>
                <span className="marker marker-error" aria-hidden="true" />
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => nav.openRecord('factura', o.id)}
                >
                  {o.numero}
                </button>
                <span>{o.client}</span>
                <span className="num">{formatCurrency(o.total, o.currency)}</span>
                <span className="danger-text num">
                  venció el {isoToEs(o.vencimiento)} (hace {formatNumber(o.days, 0)}{' '}
                  {o.days === 1 ? 'día' : 'días'})
                </span>
              </li>
            ))}
            {s.overdue.length === 0 && <li className="faint">Ninguna factura vencida.</li>}
          </ul>
          <p className="hint">
            Importes en {s.currency}, convertidos con el tipo del BCE de cada fecha. El fee se
            prorratea por los días del periodo y el porcentaje se calcula sobre la inversión en las
            cuentas de Meta asignadas al cliente.
          </p>
        </>
      )}
    </div>
  )
}
