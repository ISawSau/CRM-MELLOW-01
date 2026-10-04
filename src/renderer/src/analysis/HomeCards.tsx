import { useQuery } from '@tanstack/react-query'
import { rangeFor } from '@shared/analysis'
import { formatDateTime } from '@shared/format'
import { t } from '@shared/i18n'
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
