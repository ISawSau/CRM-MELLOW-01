import { useState, type FormEvent } from 'react'
import { DEFAULT_APPEARANCE, type Density } from '@shared/appearance'
import { MIN_PASSWORD_LENGTH, type VaultStatus } from '@shared/ipc'
import { call } from '../lib/ipc'
import { useAction } from '../lib/hooks'
import { RecoveryKeyPanel } from '../screens/RecoveryKey'
import { BUILT_IN_THEMES, findTheme, type Theme } from '@shared/themes'
import { BriefTemplatesSettings } from '../data/BriefTemplatesSettings'
import { CollectionsSettings } from '../data/CollectionsSettings'
import { DataSettings, FieldsSettings } from '../data/FieldsSettings'
import { ProfileSettings } from './ProfileSettings'
import { SyncSettings } from './SyncSettings'
import { GmailSettings } from '../gmail/GmailSettings'
import { Alert } from '../ui/Alert'
import { PasswordField } from '../ui/PasswordField'
import { newThemeFrom, ThemeEditor } from '../theme/ThemeEditor'

const AUTO_LOCK_OPTIONS = [5, 10, 15, 30, 60, 120]

function Block({
  title,
  desc,
  children,
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <section className="settings-block">
      <div>
        <h2>{title}</h2>
        <p className="desc">{desc}</p>
      </div>
      <div className="settings-body">{children}</div>
    </section>
  )
}

function Appearance({ status }: { status: VaultStatus }) {
  const appearance = status.appearance ?? DEFAULT_APPEARANCE
  const custom = status.themes ?? []
  const all = [...BUILT_IN_THEMES, ...custom]
  const current = findTheme(appearance.theme, all)
  const [editing, setEditing] = useState<{ theme: Theme; isNew: boolean } | null>(null)
  const save = useAction((theme: string, density: Density) =>
    call('settings:setAppearance', { theme, density }),
  )
  return (
    <Block
      title="Apariencia"
      desc="Elige un tema o crea el tuyo: parte de uno existente y cambia sus colores. Los cambios se ven al momento y la app avisa si algún texto queda con poco contraste."
    >
      <div className="field">
        <label>Tema</label>
        <div className="segmented segmented-wrap" role="group" aria-label="Tema">
          {all.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={appearance.theme === t.id}
              disabled={editing !== null}
              onClick={() => void save.run(t.id, appearance.density)}
              data-testid={`theme-${t.id}`}
            >
              {t.name}
            </button>
          ))}
        </div>
        {!editing && (
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setEditing({ theme: newThemeFrom(current, custom), isNew: true })}
            >
              Nuevo tema a partir de «{current.name}»
            </button>
            {custom.some((t) => t.id === current.id) && (
              <button
                type="button"
                className="btn"
                onClick={() => setEditing({ theme: current, isNew: false })}
              >
                Editar «{current.name}»
              </button>
            )}
          </div>
        )}
      </div>
      {editing && (
        <ThemeEditor
          key={editing.theme.id}
          initial={editing.theme}
          isNew={editing.isNew}
          themes={custom}
          current={appearance.theme}
          density={appearance.density}
          onClose={() => setEditing(null)}
        />
      )}
      <div className="field">
        <label>Densidad</label>
        <div className="segmented" role="group" aria-label="Densidad">
          {(
            [
              ['compacta', 'Compacta'],
              ['comoda', 'Cómoda'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={appearance.density === id}
              disabled={editing !== null}
              onClick={() => void save.run(appearance.theme, id)}
              data-testid={`density-${id}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {save.error && <Alert>{save.error.message}</Alert>}
    </Block>
  )
}

function AutoLock({ status }: { status: VaultStatus }) {
  const save = useAction((minutes: number) => call('settings:setAutoLock', { minutes }))
  const lock = useAction(() => call('vault:lock'))
  return (
    <Block
      title="Bloqueo automático"
      desc="La bóveda también se bloquea al suspender el equipo o bloquear la sesión."
    >
      <div className="field">
        <label htmlFor="autolock">Bloquear tras este tiempo sin usar la app</label>
        <select
          id="autolock"
          className="input"
          value={status.autoLockMinutes ?? 15}
          onChange={(e) => void save.run(Number(e.target.value))}
        >
          {AUTO_LOCK_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m < 60 ? `${m} minutos` : `${m / 60} ${m === 60 ? 'hora' : 'horas'}`}
            </option>
          ))}
        </select>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => void lock.run()}>
          Bloquear ahora
        </button>
      </div>
    </Block>
  )
}

function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [tried, setTried] = useState(false)
  const [done, setDone] = useState(false)
  const change = useAction(async () => {
    await call('vault:changePassword', { currentPassword: current, newPassword: next })
    setCurrent('')
    setNext('')
    setConfirm('')
    setTried(false)
    setDone(true)
  })
  const tooShort = next.length < MIN_PASSWORD_LENGTH
  const mismatch = next !== confirm
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    setDone(false)
    if (current && !tooShort && !mismatch) void change.run()
  }
  return (
    <Block
      title="Contraseña"
      desc="Cambiarla es instantáneo: los datos no se vuelven a cifrar. La clave de recuperación sigue sirviendo."
    >
      <form className="form" onSubmit={submit} noValidate>
        <PasswordField label="Contraseña actual" value={current} onChange={setCurrent} />
        <PasswordField
          label="Contraseña nueva"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint={`Como mínimo ${MIN_PASSWORD_LENGTH} caracteres.`}
        />
        <PasswordField
          label="Repite la contraseña nueva"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        {tried && tooShort && (
          <Alert>La contraseña debe tener al menos {MIN_PASSWORD_LENGTH} caracteres.</Alert>
        )}
        {tried && !tooShort && mismatch && <Alert>Las contraseñas no coinciden.</Alert>}
        {change.error && <Alert>{change.error.message}</Alert>}
        {done && <p className="muted">Contraseña cambiada.</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={change.pending}>
            {change.pending ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </div>
      </form>
    </Block>
  )
}

function RotateKey() {
  const [password, setPassword] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const rotate = useAction(async () => {
    const r = await call('vault:rotateKey', { password })
    setPassword('')
    setNewKey(r.recoveryKey)
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password) void rotate.run()
  }
  return (
    <Block
      title="Rotar la clave de cifrado"
      desc="Genera una clave nueva y vuelve a cifrar la base de datos. La clave de recuperación anterior deja de servir. Antes se hace una copia en backups/."
    >
      {newKey ? (
        <RecoveryKeyPanel recoveryKey={newKey} doneLabel="Hecho" onDone={() => setNewKey(null)} />
      ) : (
        <form className="form" onSubmit={submit}>
          <PasswordField label="Contraseña actual" value={password} onChange={setPassword} />
          {rotate.error && <Alert>{rotate.error.message}</Alert>}
          <div className="form-actions">
            <button type="submit" className="btn btn-danger" disabled={rotate.pending || !password}>
              {rotate.pending ? 'Rotando…' : 'Rotar clave'}
            </button>
          </div>
        </form>
      )}
    </Block>
  )
}

function VaultBlock({ status }: { status: VaultStatus }) {
  const close = useAction(() => call('vault:close'))
  return (
    <Block
      title="Bóveda"
      desc="Para llevarla a otro equipo, cierra la app y copia la carpeta entera."
    >
      <div className="path-box">
        <span>{status.path}</span>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => void close.run()}>
          Cerrar esta bóveda y abrir otra
        </button>
      </div>
    </Block>
  )
}

export function Settings({ status }: { status: VaultStatus }) {
  return (
    <div className="page" data-testid="page-ajustes">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">⚙</span> ajustes
        </span>
        <h1 className="title">Ajustes</h1>
      </div>
      <div>
        <ProfileSettings />
        <Appearance status={status} />
        <CollectionsSettings />
        <FieldsSettings />
        <BriefTemplatesSettings />
        <DataSettings />
        <SyncSettings />
        <GmailSettings />
        <AutoLock status={status} />
        <ChangePassword />
        <RotateKey />
        <VaultBlock status={status} />
      </div>
    </div>
  )
}
