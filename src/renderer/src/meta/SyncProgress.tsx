import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { MetaProgress } from '@shared/meta'

/** «3 min», «45 s», «1 h 10 min». */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return t('{s} s', { s })
  const m = Math.round(s / 60)
  if (m < 60) return t('{m} min', { m })
  const h = Math.floor(m / 60)
  return m % 60 ? t('{h} h {m} min', { h, m: m % 60 }) : t('{h} h', { h })
}

/** Segundos que quedan hasta una hora (se actualiza cada segundo). */
function useCountdown(until: string | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [until])
  return until ? Math.max(0, (Date.parse(until) - now) / 1000) : null
}

/** Porcentaje y texto corto del progreso (barra de estado). */
export function progressSummary(p: MetaProgress): string {
  const pct = Math.floor((p.done / Math.max(1, p.total)) * 100)
  const eta =
    p.etaSeconds !== null ? t(' · quedan ~{time}', { time: formatDuration(p.etaSeconds) }) : ''
  return `${t('{n} %', { n: pct })}${eta}`
}

/**
 * Barra de progreso de la sincronización con Meta: qué se está descargando, cuánto lleva,
 * cuánto falta (estimado con el ritmo real) y si Meta ha pedido esperar por sus límites.
 */
export function SyncProgress({ progress }: { progress: MetaProgress }) {
  const wait = useCountdown(progress.waitingUntil)
  const pct = Math.min(100, (progress.done / Math.max(1, progress.total)) * 100)
  return (
    <div className="sync-progress" data-testid="meta-progress">
      <div className="sync-progress-head">
        <span className="sync-progress-label">{progress.label}</span>
        <span className="num faint">
          {t('{n} de {total} pasos', { n: progress.done, total: progress.total })}
          {progress.etaSeconds !== null && progress.done < progress.total
            ? t(' · quedan ~{time}', { time: formatDuration(progress.etaSeconds) })
            : ''}
        </span>
      </div>
      <div
        className="sync-progress-track"
        role="progressbar"
        aria-label={t('Progreso de la sincronización con Meta')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <span className="sync-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {wait !== null && wait > 0 && (
        <p className="hint">
          {t(
            'Meta limita las consultas de las apps en desarrollo (unas 60 cada 5 minutos): se sigue en {time}. No hace falta hacer nada.',
            { time: formatDuration(wait) },
          )}
        </p>
      )}
    </div>
  )
}
