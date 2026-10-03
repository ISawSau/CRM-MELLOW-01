import { t } from '@shared/i18n'
import { useMetaStatus } from './meta'
import { progressSummary } from './SyncProgress'

/** Elemento de la barra de estado: progreso de la sincronización con Meta. */
export function MetaStatusItem({ onOpen }: { onOpen: () => void }) {
  const s = useMetaStatus()
  if (!s?.connected) return null
  const tone = s.phase === 'error' ? 'error' : s.phase === 'syncing' ? 'warn' : 'ok'
  const text =
    s.phase === 'error'
      ? t('Meta: error')
      : s.progress
        ? t('Meta: sincronizando {progress}', { progress: progressSummary(s.progress) })
        : s.phase === 'syncing'
          ? t('Meta: sincronizando…')
          : t('Meta al día')
  return (
    <button
      type="button"
      className="statusbar-item btn-link btn"
      title={s.error ?? s.progress?.label ?? t('Abrir Campañas')}
      onClick={onOpen}
      data-testid="meta-status"
    >
      <span className={`marker marker-${tone}`} aria-hidden="true" />
      {text}
    </button>
  )
}
