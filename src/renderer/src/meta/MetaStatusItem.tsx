import { useMetaStatus } from './meta'

/** Elemento de la barra de estado: progreso de la sincronización con Meta. */
export function MetaStatusItem({ onOpen }: { onOpen: () => void }) {
  const s = useMetaStatus()
  if (!s?.connected) return null
  const tone = s.phase === 'error' ? 'error' : s.phase === 'syncing' ? 'warn' : 'ok'
  const text =
    s.phase === 'error'
      ? 'Meta: error'
      : s.progress
        ? `Meta: ${s.progress.label.toLowerCase()}${
            s.progress.total > 1 ? ` ${s.progress.done}/${s.progress.total}` : ''
          }`
        : s.phase === 'syncing'
          ? 'Meta: sincronizando…'
          : 'Meta al día'
  return (
    <button
      type="button"
      className="statusbar-item btn-link btn"
      title={s.error ?? 'Abrir Campañas'}
      onClick={onOpen}
      data-testid="meta-status"
    >
      <span className={`marker marker-${tone}`} aria-hidden="true" />
      {text}
    </button>
  )
}
