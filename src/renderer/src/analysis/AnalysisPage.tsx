import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { call, subscribe } from '../lib/ipc'
import { useHasAdData, useMetaStatus } from '../meta/meta'
import { Alerts } from './Alerts'
import { Compare } from './Compare'
import { Dashboards } from './Dashboards'

/** Avisos de alertas sin ver (barra lateral e Inicio). */
export function useUnseenAlerts(): number {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['data', 'analysis', 'unseen'],
    queryFn: () => call('analysis:unseen'),
  })
  useEffect(
    () =>
      subscribe('analysis:changed', () => {
        void qc.invalidateQueries({ queryKey: ['data', 'analysis'] })
      }),
    [qc],
  )
  return q.data ?? 0
}

type Tab = 'dashboards' | 'comparar' | 'alertas'

/** Análisis: dashboards, comparativas y alertas (SPEC §7.13, fase 8). */
export function AnalysisPage({ num, onMeta }: { num: string; onMeta: () => void }) {
  const status = useMetaStatus()
  const hasData = useHasAdData()
  const unseen = useUnseenAlerts()
  const [tab, setTab] = useState<Tab>(unseen > 0 ? 'alertas' : 'dashboards')
  return (
    <div className="page page-wide" data-testid="page-analisis">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">{num}</span> {t('media buying')}
        </span>
        <h1 className="title">{t('Análisis')}</h1>
        <p className="muted">
          {t(
            'Dashboards, comparativas y alertas sobre las métricas de las cuentas activadas de Meta. Importes en {currency}; fechas de cada cuenta.',
            { currency: status?.settings.displayCurrency ?? 'EUR' },
          )}
        </p>
      </div>
      {hasData === false ? (
        <div className="empty">
          <h2>{t('Sin datos publicitarios')}</h2>
          <p className="muted">
            {t(
              'Conecta Meta en Campañas para ver dashboards y alertas.',
            )}
          </p>
          <button type="button" className="btn btn-primary" onClick={onMeta}>
            {t('Ir a Campañas')}
          </button>
        </div>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label={t('Análisis')}>
            {(
              [
                ['dashboards', t('Dashboards')],
                ['comparar', t('Comparar')],
                ['alertas', unseen > 0 ? t('Alertas ({n})', { n: unseen }) : t('Alertas')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                data-testid={`analysis-tab-${id}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'dashboards' && <Dashboards />}
          {tab === 'comparar' && <Compare />}
          {tab === 'alertas' && <Alerts />}
        </>
      )}
    </div>
  )
}
