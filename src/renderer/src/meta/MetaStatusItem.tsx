import { useMetaStatus } from './meta'
import { progressSummary } from './SyncProgress'

/** Elemento de la barra de estado: progreso de la sincronización con Meta. */
export function MetaStatusItem({ onOpen }: { onOpen: () => void }) {
  const s = useMetaStatus()
  if (!s?.connected) return null
  const tone = s.phase === 'error' ? 'error' : s.phase === 'syncing' ? 'warn' : 'ok'
  const text =
    s.phase === 'error'
      ? 'Meta: error'
      : s.progress
        ? `Meta: sincronizando ${progressSummary(s.progress)}`
        : s.phase === 'syncing'
          ? 'Meta: sincronizando…'
          : 'Meta al día'
  return (
    <button
      type="button"
      className="statusbar-item btn-link btn"
      title={s.error ?? s.progress?.label ?? 'Abrir Campañas'}
      onClick={onOpen}
      data-testid="meta-status"
    >
      <span className={`marker marker-${tone}`} aria-hidden="true" />
      {text}
    </button>
  )
}
