import type { VaultStatus } from '@shared/ipc'
import { useAppInfo } from '../lib/hooks'
import { MetaStatusItem } from '../meta/MetaStatusItem'
import { SyncStatusItem } from './sync'
import { t } from '@shared/i18n'

export function StatusBar({
  status,
  onOpenPalette,
  onSettings,
  onMeta,
}: {
  status: VaultStatus
  onOpenPalette: () => void
  onSettings: () => void
  onMeta: () => void
}) {
  const info = useAppInfo()
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="statusbar-item">
        <span className="marker marker-ok" aria-hidden="true" />
        <span>{status.name}</span>
      </span>
      <span className="statusbar-item path mono faint" title={status.path ?? ''}>
        {status.path}
      </span>
      <span className="statusbar-spacer" />
      <MetaStatusItem onOpen={onMeta} />
      <SyncStatusItem onSettings={onSettings} />
      {status.autoLockMinutes !== null && (
        <span className="statusbar-item">
          {t('autobloqueo')} <span className="num">{status.autoLockMinutes}</span> min
        </span>
      )}
      {info.data && <span className="statusbar-item num">v{info.data.version}</span>}
      <button type="button" className="statusbar-item btn-link btn" onClick={onOpenPalette}>
        <kbd>Ctrl K</kbd> {t('comandos')}
      </button>
    </footer>
  )
}
