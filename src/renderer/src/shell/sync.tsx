import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { SyncStatus } from '@shared/ipc'
import { formatDateTime } from '@shared/format'
import { call, IpcCallError, subscribe } from '../lib/ipc'
import { useToast } from '../ui/Toast'

/** Estado de la sincronización, al día con los avisos del proceso principal. */
export function useSyncStatus() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['data', 'sync'], queryFn: () => call('sync:status') })
  useEffect(
    () =>
      subscribe('sync:changed', (s: SyncStatus) => {
        qc.setQueryData(['data', 'sync'], s)
        // Tras descargar o restaurar, todo lo que hay en pantalla puede haber cambiado.
        if (s.phase === 'idle') void qc.invalidateQueries({ queryKey: ['data'] })
      }),
    [qc],
  )
  return q.data
}

function ago(iso: string | null): string {
  if (!iso) return 'nunca'
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'hace un momento'
  if (mins < 60) return `hace ${mins} min`
  if (mins < 24 * 60) return `hace ${Math.round(mins / 60)} h`
  return formatDateTime(new Date(iso))
}

/** Texto y color del estado (barra de estado y Ajustes). */
export function syncSummary(s: SyncStatus | undefined): {
  text: string
  tone: 'ok' | 'off' | 'warn' | 'error'
} {
  if (!s || !s.kind) return { text: 'sincronización no configurada', tone: 'off' }
  if (s.phase === 'syncing') return { text: 'sincronizando…', tone: 'warn' }
  if (s.phase === 'conflict') return { text: 'conflicto: elige una versión', tone: 'error' }
  if (s.phase === 'error') return { text: 'error de sincronización', tone: 'error' }
  if (s.pending) return { text: 'cambios sin subir', tone: 'warn' }
  return { text: `sincronizado ${ago(s.lastSyncAt)}`, tone: 'ok' }
}

/** Elemento de la barra de estado: estado y «Sincronizar ahora». */
export function SyncStatusItem({ onSettings }: { onSettings: () => void }) {
  const s = useSyncStatus()
  const toast = useToast()
  const { text, tone } = syncSummary(s)
  if (!s?.kind)
    return (
      <button
        type="button"
        className="statusbar-item btn-link btn"
        onClick={onSettings}
        data-testid="sync-status"
      >
        <span className="marker marker-off" aria-hidden="true" />
        {text}
      </button>
    )
  return (
    <button
      type="button"
      className="statusbar-item btn-link btn"
      title={s.error ?? `${s.label} · pulsa para sincronizar ahora`}
      disabled={s.phase === 'syncing'}
      data-testid="sync-status"
      onClick={() =>
        void call('sync:now').catch((e: unknown) =>
          toast.show(e instanceof IpcCallError ? e.message : 'No se pudo sincronizar.', 'error'),
        )
      }
    >
      <span className={`marker marker-${tone}`} aria-hidden="true" />
      {text}
    </button>
  )
}

/** Diálogo de conflicto: los dos equipos cambiaron la bóveda desde la última vez. */
export function ConflictDialog() {
  const s = useSyncStatus()
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  if (s?.phase !== 'conflict' || !s.conflict) return null
  const resolve = (keep: 'local' | 'remote') => {
    setBusy(true)
    void call('sync:resolve', { keep })
      .catch((e: unknown) =>
        toast.show(e instanceof IpcCallError ? e.message : 'No se pudo resolver.', 'error'),
      )
      .finally(() => setBusy(false))
  }
  return (
    <>
      <div className="overlay" />
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="conflict-t"
        data-testid="sync-conflict"
      >
        <h2 id="conflict-t">Los dos equipos han cambiado la bóveda</h2>
        <p className="muted">
          «{s.conflict.device}» subió una versión el{' '}
          {formatDateTime(new Date(s.conflict.uploadedAt))} y aquí también hay cambios sin subir.
          Elige con cuál te quedas: la otra se guarda como copia de seguridad y podrás recuperarla
          desde Ajustes.
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => resolve('local')}
          >
            Quedarme con la de este equipo
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => resolve('remote')}>
            Usar la de «{s.conflict.device}»
          </button>
        </div>
      </div>
    </>
  )
}
