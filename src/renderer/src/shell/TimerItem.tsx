import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@shared/i18n'
import type { RunningTimer } from '@shared/timer'
import { useRecords } from '../data/hooks'
import { call, IpcCallError } from '../lib/ipc'
import { SectionIcon } from '../ui/section-icons'
import { useToast } from '../ui/Toast'

const ALL = { filters: [], match: 'all' as const, sorts: [] }

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/**
 * Cronómetro del registro de horas en la barra inferior (D-099). Se arranca con una
 * descripción y, si se quiere, un cliente; al pararlo se crea el registro en Horas.
 */
export function TimerItem() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['data', 'timer'], queryFn: () => call('timer:get') })
  const timer = q.data ?? null
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!timer) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timer])

  const set = (v: RunningTimer | null) => qc.setQueryData(['data', 'timer'], v)
  const stop = async (discard: boolean) => {
    try {
      const rec = await call('timer:stop', { discard })
      set(null)
      setOpen(false)
      if (rec) toast.show(t('Guardado en Horas: «{name}».', { name: rec.title }))
    } catch (e) {
      toast.show(e instanceof IpcCallError ? e.message : t('No se ha podido guardar.'), 'error')
    }
  }

  return (
    <span className="timer-item">
      <button
        type="button"
        className="statusbar-item btn btn-link"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="timer-button"
        data-running={timer ? 'true' : undefined}
      >
        <SectionIcon name="timer" size={13} />
        {timer ? (
          <span className="num">{clock(now - Date.parse(timer.startedAt))}</span>
        ) : (
          t('cronómetro')
        )}
      </button>
      {open &&
        createPortal(
          <TimerPopover
            timer={timer}
            onStart={(v) => {
              set(v)
              setOpen(false)
            }}
            onStop={(discard) => void stop(discard)}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </span>
  )
}

function TimerPopover({
  timer,
  onStart,
  onStop,
  onClose,
}: {
  timer: RunningTimer | null
  onStart: (t: RunningTimer) => void
  onStop: (discard: boolean) => void
  onClose: () => void
}) {
  const clients = useRecords('cliente', ALL).data ?? []
  const [description, setDescription] = useState('')
  const [clientId, setClientId] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <div
      className="timer-popover"
      role="dialog"
      aria-label={t('Cronómetro')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      data-testid="timer-popover"
    >
      {timer ? (
        <>
          <p>
            <strong>{timer.description}</strong>
            {timer.clientId && (
              <span className="faint">
                {' · '}
                {clients.find((c) => c.id === timer.clientId)?.title ?? ''}
              </span>
            )}
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={() => onStop(false)}>
              {t('Parar y guardar')}
            </button>
            <button type="button" className="btn" onClick={() => onStop(true)}>
              {t('Descartar')}
            </button>
          </div>
        </>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            void call('timer:start', {
              description: description.trim(),
              clientId: clientId || null,
            })
              .then(onStart)
              .catch((err) =>
                setError(err instanceof IpcCallError ? err.message : t('No se ha podido guardar.')),
              )
          }}
        >
          <div className="field">
            <label htmlFor="timer-desc">{t('¿En qué trabajas?')}</label>
            <input
              id="timer-desc"
              className="input"
              autoFocus
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="timer-client">{t('Cliente')}</label>
            <select
              id="timer-client"
              className="input"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">{t('Sin cliente')}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!description.trim()}>
              {t('Empezar')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
