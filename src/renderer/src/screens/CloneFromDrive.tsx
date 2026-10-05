import { useEffect, useState, type FormEvent } from 'react'
import { t } from '@shared/i18n'
import { useAction } from '../lib/hooks'
import { call } from '../lib/ipc'
import { isMobile } from '../lib/platform'
import { Alert } from '../ui/Alert'
import { Gate } from './Gate'

/**
 * Traer la bóveda desde Google Drive a un móvil u ordenador nuevo (D-101). Hace falta el
 * mismo cliente de Google que en el ordenador; al terminar se pide la contraseña de siempre.
 */
export function CloneFromDrive({ onDone }: { onDone: () => void }) {
  const mobile = isMobile()
  const [parent, setParent] = useState<string | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const pick = useAction(async () => {
    const p = await call('vault:pickFolder', { purpose: 'create' })
    if (p) setParent(p)
  })
  // En el móvil la bóveda va siempre a la carpeta privada de la app.
  useEffect(() => {
    if (mobile) void pick.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile])
  const clone = useAction(async () => {
    await call('vault:cloneFromDrive', { parentPath: parent!, clientId, clientSecret })
    // La bóveda queda abierta y bloqueada: la app pasa a pedir la contraseña.
    onDone()
  })
  const ready = parent !== null && clientId.trim().length > 0 && !clone.pending
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ready) void clone.run()
  }

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
          />
        </div>
        {clone.pending && (
          <p className="muted" role="status">
            {t('Esperando a Google… Completa el acceso en el navegador y vuelve aquí.')}
          </p>
        )}
        {(clone.error ?? pick.error) && <Alert>{(clone.error ?? pick.error)!.message}</Alert>}
        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!ready}
            data-testid="clone-submit"
          >
            {t('Conectar y traer')}
          </button>
          <button type="button" className="btn btn-link" onClick={onDone}>
            {t('Volver')}
          </button>
        </div>
      </form>
    </Gate>
  )
}
