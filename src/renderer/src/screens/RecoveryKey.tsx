import { useState } from 'react'
import { call } from '../lib/ipc'
import { Alert } from '../ui/Alert'

/**
 * Muestra la clave de recuperación una sola vez. No se puede continuar sin
 * confirmar que se ha guardado.
 */
export function RecoveryKeyPanel({
  recoveryKey,
  onDone,
  doneLabel = 'Continuar',
}: {
  recoveryKey: string
  onDone: () => void
  doneLabel?: string
}) {
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  const copy = async () => {
    await call('clipboard:writeSecret', { text: recoveryKey })
    setCopied(true)
  }

  return (
    <div className="form">
      {/* Dos líneas de 4 grupos; el texto (y lo que se copia) sigue siendo la clave entera. */}
      <p className="recovery-key" data-testid="recovery-key">
        <span className="recovery-key-line">{recoveryKey.slice(0, 20)}</span>
        <span className="recovery-key-line">{recoveryKey.slice(20)}</span>
      </p>
      <Alert tone="warning">
        Guárdala fuera del ordenador (en papel o en un gestor de contraseñas). Si olvidas la
        contraseña y pierdes esta clave, los datos de la bóveda{' '}
        <strong>no se pueden recuperar</strong>: nadie puede, ni siquiera tú. Esta clave no se
        volverá a mostrar.
      </Alert>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => void copy()}>
          Copiar clave
        </button>
        {copied && (
          <span className="faint">Copiada. Se borrará del portapapeles en un minuto.</span>
        )}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          data-testid="recovery-saved"
        />
        <span>He guardado la clave de recuperación en un lugar seguro.</span>
      </label>
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary btn-large"
          disabled={!saved}
          onClick={onDone}
          data-testid="recovery-continue"
        >
          {doneLabel}
        </button>
      </div>
    </div>
  )
}
