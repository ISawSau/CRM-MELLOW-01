import { useEffect, useState } from 'react'
import type { MetaProgress } from '@shared/meta'

/** «3 min», «45 s», «1 h 10 min». */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

/** Segundos que quedan hasta una hora (se actualiza cada segundo). */
function useCountdown(until: string | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])
  return until ? Math.max(0, (Date.parse(until) - now) / 1000) : null
}

/** Porcentaje y texto corto del progreso (barra de estado). */
export function progressSummary(p: MetaProgress): string {
  const pct = Math.floor((p.done / Math.max(1, p.total)) * 100)
  return `${pct} %${p.etaSeconds !== null ? ` · quedan ~${formatDuration(p.etaSeconds)}` : ''}`
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
          {progress.done} de {progress.total} pasos
          {progress.etaSeconds !== null && progress.done < progress.total
            ? ` · quedan ~${formatDuration(progress.etaSeconds)}`
            : ''}
        </span>
      </div>
      <div
        className="sync-progress-track"
        role="progressbar"
        aria-label="Progreso de la sincronización con Meta"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <span className="sync-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {wait !== null && wait > 0 && (
        <p className="hint">
          Meta limita las consultas de las apps en desarrollo (unas 60 cada 5 minutos): se sigue en{' '}
          {formatDuration(wait)}. No hace falta hacer nada.
        </p>
      )}
    </div>
  )
}
