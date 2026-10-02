import type { VaultStatus } from '@shared/ipc'
import { useAppInfo } from '../lib/hooks'

export function StatusBar({
  status,
  onOpenPalette,
}: {
  status: VaultStatus
  onOpenPalette: () => void
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
      <span
        className="statusbar-item"
        title="La sincronización con Google Drive llega en la fase 5"
      >
        <span className="marker marker-off" aria-hidden="true" />
        sincronización no configurada
      </span>
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
