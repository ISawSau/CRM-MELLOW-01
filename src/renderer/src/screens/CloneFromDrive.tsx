import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { cloneActive, type ClonePhase, type CloneStatus } from '@shared/google'
import { formatNumber } from '@shared/format'
import { t } from '@shared/i18n'
import { useAction } from '../lib/hooks'
import { call, subscribe } from '../lib/ipc'
import { isMobile } from '../lib/platform'
import { Alert } from '../ui/Alert'
import { GoogleLoginHelp } from '../ui/GoogleLoginHelp'
import { Gate } from './Gate'

const KEY = ['vault', 'clone']

const mb = (bytes: number) => formatNumber(bytes / (1024 * 1024), 1)

/** Pasos que ve el usuario, en orden. */
const STEPS: { phase: ClonePhase; label: () => string }[] = [
  { phase: 'login', label: () => t('Inicia sesión en Google en el navegador') },
  { phase: 'token', label: () => t('Google ha respondido: conectando') },
  { phase: 'search', label: () => t('Buscando tu bóveda en Google Drive') },
  { phase: 'download', label: () => t('Descargando la bóveda') },
]

/**
 * Traer la bóveda desde Google Drive a un móvil u ordenador nuevo (D-101). Hace falta el
 * mismo cliente de Google que en el ordenador; al terminar se pide la contraseña de siempre.
 *
 * El trabajo lo hace el motor (D-118): aquí se arranca y se sigue su estado, así que no se
 * pierde si la app pasa a segundo plano o se vuelve a abrir esta pantalla.
 */
export function CloneFromDrive({ onDone }: { onDone: () => void }) {
  const mobile = isMobile()
  const qc = useQueryClient()
  const [parent, setParent] = useState<string | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const status = useQuery({
    queryKey: KEY,
    queryFn: () => call('vault:cloneStatus'),
    // Siempre lo que diga el motor al abrir la pantalla, nunca lo de una vez anterior.
    refetchOnMount: 'always',
    // Por si se pierde un evento (la app de Android vuelve de segundo plano).
    refetchInterval: (q) => (cloneActive(q.state.data) ? 1_500 : false),
  })
  useEffect(
    () => subscribe('vault:cloneChanged', (s: CloneStatus) => qc.setQueryData(KEY, s)),
    [qc],
  )
  const s = status.isFetchedAfterMount ? status.data : undefined
  const reset = () =>
    call('vault:cloneCancel')
      .then((idle) => qc.setQueryData(KEY, idle))
      .catch(() => {})
  const pick = useAction(async () => {
    const p = await call('vault:pickFolder', { purpose: 'create' })
    if (p) setParent(p)
  })
  // En el móvil la bóveda va siempre a la carpeta privada de la app.
  useEffect(() => {
    if (mobile) void pick.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile])
  const start = useAction(async () => {
    qc.setQueryData(
      KEY,
      await call('vault:cloneStart', { parentPath: parent!, clientId, clientSecret }),
    )
  })
  const cancel = useAction(async () => {
    qc.setQueryData(KEY, await call('vault:cloneCancel'))
  })
  // Bóveda traída: queda abierta y bloqueada, la app pasa a pedir la contraseña.
  const finished = useRef(false)
  useEffect(() => {
    if (s?.phase !== 'done' || finished.current) return
    finished.current = true
    void reset().finally(onDone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.phase, onDone])

  const active = cloneActive(s) || s?.phase === 'done'
  const ready = parent !== null && clientId.trim().length > 0 && !start.pending && !active
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ready) void start.run()
  }
  // Al salir se olvida el último error.
  const back = () => {
    if (s && s.phase !== 'idle') void reset()
    onDone()
  }
  const current = STEPS.findIndex((x) => x.phase === s?.phase)

  return (
    <Gate step={t('02 · traer bóveda')}>
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">02</span> {t('desde Google Drive')}
        </span>
        <h1 className="title">{t('Traer mi bóveda')}</h1>
        <p className="muted">
          {t(
            'Usa el mismo id de cliente y secreto de Google que en el ordenador (Ajustes → Sincronización). Se abrirá el navegador para entrar en Google; al terminar, vuelve aquí y desbloquea con tu contraseña de siempre.',
          )}
        </p>
      </div>
      {active ? (
        <div className="form" data-testid="clone-progress">
          <ol className="clone-steps">
            {STEPS.map((step, i) => (
              <li
                key={step.phase}
                data-state={
                  i < current || s?.phase === 'done' ? 'done' : i === current ? 'now' : 'next'
                }
                aria-current={i === current ? 'step' : undefined}
              >
                <span className="marker" aria-hidden="true" />
                <span>
                  {step.label()}
                  {step.phase === 'download' && s?.phase === 'download' && s.received > 0 && (
                    <span className="muted">
                      {' · '}
                      {s.total
                        ? t('{done} de {total} MB', { done: mb(s.received), total: mb(s.total) })
                        : t('{done} MB', { done: mb(s.received) })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {s?.phase === 'login' && (
            <>
              <p className="muted" role="status" data-testid="clone-waiting">
                {t(
                  'Esperando a Google… Completa el acceso en el navegador y vuelve aquí (o pulsa «Volver a CRM Mellow» en la página de Google).',
                )}
              </p>
              <GoogleLoginHelp />
            </>
          )}
          {cancel.error && <Alert>{cancel.error.message}</Alert>}
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => void cancel.run()}
              disabled={cancel.pending || s?.phase === 'done'}
              data-testid="clone-cancel"
            >
              {t('Cancelar')}
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={submit} noValidate data-testid="clone-form">
          {!mobile && (
            <div className="field">
              <label>{t('Dónde guardarla')}</label>
              <div className="path-box">
                <span>{parent ?? t('Ninguna carpeta elegida')}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void pick.run()}
                  disabled={pick.pending}
                >
                  {t('Elegir carpeta…')}
                </button>
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="clone-id">{t('Id de cliente de Google')}</label>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              id="clone-id"
              className="input mono"
              autoComplete="off"
              placeholder="1234…apps.googleusercontent.com"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              data-testid="clone-client-id"
            />
          </div>
          <div className="field">
            <label htmlFor="clone-secret">{t('Secreto del cliente')}</label>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              id="clone-secret"
              className="input"
              type="password"
              autoComplete="off"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              data-testid="clone-client-secret"
            />
          </div>
          {s?.phase === 'error' && s.error && (
            <div data-testid="clone-error">
              <Alert>{s.error.message}</Alert>
            </div>
          )}
          {(start.error ?? pick.error) && <Alert>{(start.error ?? pick.error)!.message}</Alert>}
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!ready}
              data-testid="clone-submit"
            >
              {s?.phase === 'error' ? t('Volver a intentarlo') : t('Conectar y traer')}
            </button>
            <button type="button" className="btn btn-link" onClick={back}>
              {t('Volver')}
            </button>
          </div>
        </form>
      )}
    </Gate>
  )
}
