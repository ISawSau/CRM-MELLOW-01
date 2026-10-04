import { useQuery } from '@tanstack/react-query'
import { rangeFor } from '@shared/analysis'
import { formatCurrency, formatDateTime } from '@shared/format'
import type { PacingStatus } from '@shared/growth'
import { t } from '@shared/i18n'
import { useNav } from '../data/nav'
import { call } from '../lib/ipc'
import { useHasAdData, useMetaStatus } from '../meta/meta'
import { formatMetric } from '../meta/metrics'
import { useAnalysis, useMetricKit, useToday } from './kit'
import { useUnseenAlerts } from './AnalysisPage'

/** Inicio: gasto de hoy, 7 y 30 días y ROAS de todas las cuentas (SPEC §7.1). */
export function SpendCard({ onNavigate }: { onNavigate: (s: string) => void }) {
  const status = useMetaStatus()
  const today = useToday()
  const kit = useMetricKit()
  const connected = useHasAdData() === true
  const d0 = useAnalysis(connected ? { since: today, until: today } : null)
  const r7 = rangeFor('7d', today)
  const r30 = rangeFor('30d', today)
  const d7 = useAnalysis(connected ? r7 : null)
  const d30 = useAnalysis(connected ? r30 : null)
  const money = kit.defs.get('gasto')
  const roas = kit.defs.get('roas')
  const c = d30.data?.currency ?? status?.settings.displayCurrency ?? 'EUR'
  return (
    <section className="home-card" data-testid="home-spend">
      <div className="home-card-head">
        <h2 className="home-card-title">{t('Gasto y ROAS')}</h2>
        <button
          type="button"
          className="btn-link"
          onClick={() => onNavigate(connected ? 'analisis' : 'campanas')}
        >
          {connected ? t('Ver análisis →') : t('Conectar Meta →')}
        </button>
      </div>
      {!connected ? (
        <p className="faint">{t('Conecta Meta en Campañas para ver el gasto aquí.')}</p>
      ) : (
        <dl className="mini-kpis">
          <div>
            <dt>{t('Hoy')}</dt>
            <dd className="num">
              {formatMetric(kit.compute(d0.data?.totals ?? {})['gasto'], money, c)}
            </dd>
          </div>
          <div>
            <dt>{t('Últimos 7 días')}</dt>
            <dd className="num">
              {formatMetric(kit.compute(d7.data?.totals ?? {})['gasto'], money, c)}
            </dd>
          </div>
          <div>
            <dt>{t('Últimos 30 días')}</dt>
            <dd className="num">
              {formatMetric(kit.compute(d30.data?.totals ?? {})['gasto'], money, c)}
            </dd>
          </div>
          <div>
            <dt>{t('ROAS 30 días')}</dt>
            <dd className="num">
              {formatMetric(kit.compute(d30.data?.totals ?? {})['roas'], roas, c)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  )
}

/** Inicio: últimos avisos de las alertas. */
export function AlertsCard({ onNavigate }: { onNavigate: (s: string) => void }) {
  const unseen = useUnseenAlerts()
  const events = useQuery({
    queryKey: ['data', 'analysis', 'events'],
    queryFn: () => call('analysis:events'),
  })
  const recent = (events.data ?? []).slice(0, 5)
  return (
    <section className="home-card" data-testid="home-alerts">
      <div className="home-card-head">
        <h2 className="home-card-title">
          {unseen > 0 ? t('Alertas · {n} sin ver', { n: unseen }) : t('Alertas')}
        </h2>
        <button type="button" className="btn-link" onClick={() => onNavigate('analisis')}>
          {t('Ver alertas →')}
        </button>
      </div>
      {recent.length === 0 ? (
        <p className="faint">{t('Ningún aviso. Crea alertas en Análisis → Alertas.')}</p>
      ) : (
        <ul className="event-list">
          {recent.map((e) => (
            <li key={e.id} data-seen={e.seen}>
              <span
                className={`marker ${e.seen ? 'marker-off' : 'marker-error'}`}
                aria-hidden="true"
              />
              <strong>{e.name}</strong>
              <span className="faint num">{formatDateTime(new Date(e.createdAt))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const PACING_LABELS: Record<PacingStatus, { label: string; color: string }> = {
  ok: { label: 'A buen ritmo', color: 'verde' },
  under: { label: 'Se queda corto', color: 'ambar' },
  over: { label: 'Se pasa', color: 'vino' },
}

/**
 * Inicio: ritmo de gasto del mes de los clientes con presupuesto publicitario mensual
 * (fase 14, D-105). La raya marca lo que tocaría llevar gastado hoy.
 */
export function PacingCard({ onNavigate }: { onNavigate: (s: string) => void }) {
  const nav = useNav()
  const q = useQuery({
    queryKey: ['data', 'analysis', 'pacing'],
    queryFn: () => call('analysis:pacing'),
  })
  const rows = q.data ?? []
  return (
    <section className="home-card" data-testid="home-pacing">
      <div className="home-card-head">
        <h2 className="home-card-title">{t('Ritmo de gasto del mes')}</h2>
        <button type="button" className="btn-link" onClick={() => onNavigate('clientes')}>
          {t('Ver clientes →')}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="faint">
          {t(
            'Pon un presupuesto publicitario mensual en la ficha de tus clientes para ver aquí cómo va el gasto.',
          )}
        </p>
      ) : (
        <ul className="pacing-list">
          {rows.map((r) => {
            const s = PACING_LABELS[r.status]
            const pct = Math.min(100, (r.spent / r.budget) * 100)
            const expected = Math.min(100, (r.day / r.days) * 100)
            return (
              <li key={r.clientId} className="pacing-item" data-status={r.status}>
                <div className="pacing-head">
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => nav.openRecord('cliente', r.clientId)}
                  >
                    {r.client}
                  </button>
                  <span className="chip" data-color={s.color}>
                    {t(s.label)}
                  </span>
                </div>
                <span
                  className="pacing-bar"
                  role="img"
                  aria-label={t(
                    '{pct} % del presupuesto gastado; hoy tocaría llevar el {expected} %',
                    {
                      pct: Math.round(pct),
                      expected: Math.round(expected),
                    },
                  )}
                >
                  <span className="pacing-fill" style={{ width: `${pct}%` }} />
                  <span className="pacing-mark" style={{ left: `${expected}%` }} />
                </span>
                <span className="faint num pacing-text">
                  {t('{spent} de {budget} · a este ritmo, {projected} a fin de mes', {
                    spent: formatCurrency(r.spent, r.currency),
                    budget: formatCurrency(r.budget, r.currency),
                    projected: formatCurrency(r.projected, r.currency),
                  })}
                  {r.partial && ` · ${t('faltan tipos de cambio')}`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
