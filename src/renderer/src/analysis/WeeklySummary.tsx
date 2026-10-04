import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { shiftDate } from '@shared/data/dates'
import type { RecordRow } from '@shared/data/records'
import { weeklySummaryText } from '@shared/growth'
import { t } from '@shared/i18n'
import { useFields } from '../data/hooks'
import { call, IpcCallError } from '../lib/ipc'
import { useHasAdData } from '../meta/meta'
import { useToast } from '../ui/Toast'
import { useAnalysis, useMetricKit, useToday } from './kit'

/**
 * Resumen de la última semana de un cliente en texto, para copiar y pegar en un correo o en
 * WhatsApp (fase 14, D-109). Semana: los 7 días completos hasta ayer.
 */
export function WeeklySummary({ record }: { record: RecordRow }) {
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const hasData = useHasAdData() === true
  const today = useToday()
  const kit = useMetricKit()
  const fields = useFields('cliente')
  const until = shiftDate(today, -1)
  const since = shiftDate(until, -6)
  const filter = { type: 'client' as const, id: record.id }
  const week = useAnalysis(open ? { since, until, filter, compare: 'previous' } : null)
  const campaigns = useAnalysis(
    open ? { since, until, filter, groupBy: 'campana', limit: 3 } : null,
  )
  const pacing = useQuery({
    queryKey: ['data', 'analysis', 'pacing'],
    queryFn: () => call('analysis:pacing'),
    enabled: open,
  })
  if (!hasData) return null
  const value = (key: string) => {
    const f = fields.data?.find((x) => x.key === key)
    const v = f ? record.values[f.id] : undefined
    return typeof v === 'number' && v > 0 ? v : null
  }
  const text =
    week.data && campaigns.data
      ? weeklySummaryText({
          client: record.title,
          since,
          until,
          currency: week.data.currency,
          now: kit.compute(week.data.totals),
          prev: week.data.compareTotals ? kit.compute(week.data.compareTotals) : null,
          targetCpa: value('cpa_objetivo'),
          targetRoas: value('roas_objetivo'),
          campaigns: campaigns.data.groups
            .filter((g) => !g.key.startsWith('__'))
            .map((g) => ({ name: g.label, values: kit.compute(g.base) })),
          pacing: pacing.data?.find((p) => p.clientId === record.id) ?? null,
        })
      : null

  return (
    <section className="panel-rich" data-testid="weekly-summary">
      <h3 className="panel-subtitle">{t('Resumen semanal')}</h3>
      {!open ? (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {t('Preparar el resumen de la última semana')}
        </button>
      ) : !text ? (
        <p className="faint">{t('Preparando…')}</p>
      ) : (
        <>
          <textarea
            className="input weekly-summary-text"
            readOnly
            rows={Math.min(18, text.split('\n').length + 1)}
            value={text}
            aria-label={t('Resumen semanal')}
            data-testid="weekly-summary-text"
          />
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                void call('clipboard:writeText', { text })
                  .then(() => toast.show(t('Resumen copiado.')))
                  .catch((e: unknown) =>
                    toast.show(
                      e instanceof IpcCallError ? e.message : t('No se pudo copiar.'),
                      'error',
                    ),
                  )
              }
            >
              {t('Copiar')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
