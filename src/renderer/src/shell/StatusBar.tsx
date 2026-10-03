import type { VaultStatus } from '@shared/ipc'
import { useAppInfo } from '../lib/hooks'
import { SyncStatusItem } from './sync'

export function StatusBar({
  status,
  onOpenPalette,
  onSettings,
}: {
  status: VaultStatus
  onOpenPalette: () => void
  onSettings: () => void
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
      <SyncStatusItem onSettings={onSettings} />
      {status.autoLockMinutes !== null && (
        <span className="statusbar-item">
          autobloqueo <span className="num">{status.autoLockMinutes}</span> min
        </span>
      )}
      {info.data && <span className="statusbar-item num">v{info.data.version}</span>}
      <button type="button" className="statusbar-item btn-link btn" onClick={onOpenPalette}>
        <kbd>Ctrl K</kbd> comandos
      </button>
    </footer>
  )
}
