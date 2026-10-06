import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { LockScene } from '@shared/lock-animation'
import { AsciiArt } from './AsciiArt'
import { formatDateTime } from '@shared/format'
import { MIN_PASSWORD_LENGTH, type VaultStatus } from '@shared/ipc'
import { call, type IpcCallError } from '../lib/ipc'
import { useAction } from '../lib/hooks'
import { Alert } from '../ui/Alert'
import { PasswordField } from '../ui/PasswordField'
import { Gate } from './Gate'
import { t } from '@shared/i18n'

/** Datos del lock de otro equipo que devuelve el error VAULT_LOCKED_ELSEWHERE. */
function lockInfo(error: IpcCallError | null): { hostname: string; since: string } | null {
  if (error?.code !== 'VAULT_LOCKED_ELSEWHERE') return null
  const d = error.details ?? {}
  const hostname = typeof d['hostname'] === 'string' ? d['hostname'] : t('otro equipo')
  const at = typeof d['heartbeatAt'] === 'string' ? Date.parse(d['heartbeatAt']) : NaN
  return { hostname, since: Number.isNaN(at) ? '' : formatDateTime(at) }
}

function LockedElsewhere({
  error,
  onForce,
  onCancel,
  pending,
}: {
  error: IpcCallError
  onForce: () => void
  onCancel: () => void
  pending: boolean
}) {
  const info = lockInfo(error)!
  return (
    <>
      <div className="overlay" />
      <div className="dialog" role="alertdialog" aria-labelledby="locked-title">
        <h2 id="locked-title">{t('La bóveda parece abierta en otro equipo')}</h2>
        <p className="muted">
          <span className="mono">{info.hostname}</span> {t('la tenía abierta')}
          {info.since && <> {t('(última señal: {since})', { since: info.since })}</>}
          {t(
            '. Si la abres aquí a la vez, los cambios de un equipo pueden perderse al sincronizar.',
          )}
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={onForce} disabled={pending}>
            {t('Abrir igualmente')}
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            {t('Cancelar')}
          </button>
        </div>
      </div>
    </>
  )
}

function UnlockForm({
  status,
  onForgot,
  onKey,
  onError,
}: {
  status: VaultStatus
  onForgot: () => void
  onKey: () => void
  onError: () => void
}) {
  const [password, setPassword] = useState('')
  const unlock = useAction((force: boolean) => call('vault:unlock', { password, force }))
  const failed = unlock.error
  useEffect(() => {
    if (failed && failed.code !== 'VAULT_LOCKED_ELSEWHERE') onError()
  }, [failed, onError])
  const close = useAction(() => call('vault:close'))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password) void unlock.run(false)
  }
  const elsewhere = lockInfo(unlock.error) !== null

  return (
    <>
      <div className="section-head">
        <span className="eyebrow">
          <span className="marker" aria-hidden="true" /> {t('bóveda bloqueada')}
        </span>
        <h1 className="title" data-testid="unlock-name">
          {status.name}
        </h1>
        <span className="faint mono unlock-path">{status.path}</span>
      </div>
      <form className="form" onSubmit={submit}>
        <PasswordField
          label={t('Contraseña')}
          value={password}
          onChange={(v) => {
            setPassword(v)
            onKey()
          }}
          autoFocus
          large
          testId="unlock-password"
        />
        {unlock.error && !elsewhere && <Alert>{unlock.error.message}</Alert>}
        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary btn-large"
            disabled={unlock.pending || !password}
            data-testid="unlock-submit"
          >
            {unlock.pending ? t('Desbloqueando…') : t('Desbloquear')}
          </button>
          <button type="button" className="btn btn-link" onClick={onForgot}>
            {t('He olvidado la contraseña')}
          </button>
          <button
            type="button"
            className="btn btn-link"
            onClick={() => void close.run()}
            data-testid="unlock-other"
          >
            {t('Abrir otra bóveda')}
          </button>
        </div>
      </form>
      {elsewhere && unlock.error && (
        <LockedElsewhere
          error={unlock.error}
          pending={unlock.pending}
          onForce={() => void unlock.run(true)}
          onCancel={unlock.clearError}
        />
      )}
    </>
  )
}

function RecoverForm({ onBack }: { onBack: () => void }) {
  const [key, setKey] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [tried, setTried] = useState(false)
  const recover = useAction((force: boolean) =>
    call('vault:recover', { recoveryKey: key, newPassword: password, force }),
  )
  const tooShort = password.length < MIN_PASSWORD_LENGTH
  const mismatch = password !== confirm

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (key && !tooShort && !mismatch) void recover.run(false)
  }
  const elsewhere = lockInfo(recover.error) !== null

  return (
    <>
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">!</span> {t('recuperar acceso')}
        </span>
        <h1 className="title">{t('Nueva contraseña')}</h1>
        <p className="muted">
          {t(
            'Escribe la clave de recuperación que guardaste al crear la bóveda y elige una contraseña nueva.',
          )}
        </p>
      </div>
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="recovery-input">{t('Clave de recuperación')}</label>
          <input
            id="recovery-input"
            className="input input-large mono"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            spellCheck={false}
            autoCapitalize="characters"
            autoComplete="off"
            data-testid="recover-key"
          />
        </div>
        <PasswordField
          label={t('Contraseña nueva')}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={t('Como mínimo {n} caracteres.', { n: MIN_PASSWORD_LENGTH })}
          testId="recover-password"
        />
        <PasswordField
          label={t('Repite la contraseña nueva')}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          testId="recover-confirm"
        />
        {tried && tooShort && (
          <Alert>
            {t('La contraseña debe tener al menos {n} caracteres.', { n: MIN_PASSWORD_LENGTH })}
          </Alert>
        )}
        {tried && !tooShort && mismatch && <Alert>{t('Las contraseñas no coinciden.')}</Alert>}
        {recover.error && !elsewhere && <Alert>{recover.error.message}</Alert>}
        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary btn-large"
            disabled={recover.pending}
            data-testid="recover-submit"
          >
            {recover.pending ? t('Comprobando…') : t('Guardar contraseña y desbloquear')}
          </button>
          <button type="button" className="btn btn-link" onClick={onBack}>
            {t('Volver')}
          </button>
        </div>
      </form>
      {elsewhere && recover.error && (
        <LockedElsewhere
          error={recover.error}
          pending={recover.pending}
          onForce={() => void recover.run(true)}
          onCancel={recover.clearError}
        />
      )}
    </>
  )
}

/** Animación elegida en Ajustes; «aleatoria» se sortea una vez al abrir la pantalla. */
function useLockScene(): LockScene | null {
  const q = useQuery({
    queryKey: ['app', 'lockAnimation'],
    queryFn: () => call('app:lockAnimation'),
  })
  const [random] = useState<LockScene>(
    () => (['gravedad', 'ojo', 'cerradura'] as const)[Math.floor(Math.random() * 3)]!,
  )
  if (!q.data || q.data === 'ninguna') return null
  return q.data === 'aleatoria' ? random : q.data
}

export function Unlock({ status }: { status: VaultStatus }) {
  const [mode, setMode] = useState<'unlock' | 'recover'>('unlock')
  const scene = useLockScene()
  const [keys, setKeys] = useState(0)
  const [errors, setErrors] = useState(0)
  const onKey = useCallback(() => setKeys((k) => k + 1), [])
  const onError = useCallback(() => setErrors((e) => e + 1), [])
  return (
    <Gate
      step={mode === 'unlock' ? t('desbloquear') : t('recuperar acceso')}
      art={scene && <AsciiArt kind={scene} keys={keys} errors={errors} />}
    >
      {mode === 'unlock' ? (
        <UnlockForm
          status={status}
          onForgot={() => setMode('recover')}
          onKey={onKey}
          onError={onError}
        />
      ) : (
        <RecoverForm onBack={() => setMode('unlock')} />
      )}
    </Gate>
  )
}
