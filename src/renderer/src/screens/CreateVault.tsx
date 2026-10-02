import { useState, type FormEvent } from 'react'
import { MIN_PASSWORD_LENGTH } from '@shared/ipc'
import { call } from '../lib/ipc'
import { useAction } from '../lib/hooks'
import { Alert } from '../ui/Alert'
import { PasswordField } from '../ui/PasswordField'
import { Gate } from './Gate'

const DEFAULT_NAME = 'CRM-Boveda'

function joinPath(parent: string, name: string): string {
  const sep = parent.includes('\\') ? '\\' : '/'
  return parent.endsWith(sep) ? parent + name : parent + sep + name
}

export function CreateVault({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (recoveryKey: string) => void
}) {
  const [parent, setParent] = useState<string | null>(null)
  const [name, setName] = useState(DEFAULT_NAME)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [tried, setTried] = useState(false)

  const pick = useAction(async () => {
    const p = await call('vault:pickFolder', { purpose: 'create' })
    if (p) setParent(p)
  })
  const create = useAction(async () => {
    const result = await call('vault:create', { parentPath: parent!, name: name.trim(), password })
    onCreated(result.recoveryKey)
  })

  const tooShort = password.length < MIN_PASSWORD_LENGTH
  const mismatch = confirm !== password
  const nameEmpty = name.trim().length === 0
  const valid = parent !== null && !tooShort && !mismatch && !nameEmpty

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (valid) void create.run()
  }

  return (
    <Gate step="02 · crear bóveda">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">02</span> nueva bóveda
        </span>
        <h1 className="title">Crear bóveda</h1>
      </div>

      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label>Dónde guardarla</label>
          <div className="path-box">
            <span data-testid="create-parent">{parent ?? 'Ninguna carpeta elegida'}</span>
            <button
              type="button"
              className="btn"
              onClick={() => void pick.run()}
              disabled={pick.pending}
              data-testid="create-pick"
            >
              Elegir carpeta…
            </button>
          </div>
          {tried && parent === null && <span className="hint">Elige una carpeta.</span>}
        </div>

        <div className="field">
          <label htmlFor="vault-name">Nombre de la carpeta de la bóveda</label>
          <input
            id="vault-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
          />
          {parent && !nameEmpty && (
            <span className="hint mono" data-testid="create-target">
              {joinPath(parent, name.trim())}
            </span>
          )}
        </div>

        <PasswordField
          label="Contraseña"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`Como mínimo ${MIN_PASSWORD_LENGTH} caracteres. Cuanto más larga, más segura.`}
          testId="create-password"
        />
        <PasswordField
          label="Repite la contraseña"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          testId="create-confirm"
        />

        {tried && tooShort && (
          <Alert>La contraseña debe tener al menos {MIN_PASSWORD_LENGTH} caracteres.</Alert>
        )}
        {tried && !tooShort && mismatch && <Alert>Las contraseñas no coinciden.</Alert>}
        {create.error && <Alert>{create.error.message}</Alert>}

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary btn-large"
            disabled={create.pending}
            data-testid="create-submit"
          >
            {create.pending ? 'Creando bóveda…' : 'Crear bóveda'}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Volver
          </button>
        </div>
      </form>
    </Gate>
  )
}
