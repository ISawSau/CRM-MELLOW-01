import { useState, type FormEvent } from 'react'
import { DEFAULT_APPEARANCE, type Density } from '@shared/appearance'
import { MIN_PASSWORD_LENGTH, type VaultStatus } from '@shared/ipc'
import { call } from '../lib/ipc'
import { useAction } from '../lib/hooks'
import { RecoveryKeyPanel } from '../screens/RecoveryKey'
import { BUILT_IN_THEMES, findTheme, type Theme } from '@shared/themes'
import { CollectionsSettings } from '../data/CollectionsSettings'
import { DataSettings } from '../data/FieldsSettings'
import { SyncSettings } from './SyncSettings'
import { Alert } from '../ui/Alert'
import { PasswordField } from '../ui/PasswordField'
import { newThemeFrom, ThemeEditor } from '../theme/ThemeEditor'
import { ThemeShare } from '../theme/ThemeShare'
import { LanguageSwitch } from '../ui/LanguageSwitch'
import { t, tn } from '@shared/i18n'

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
      title={t('Apariencia')}
      desc={t(
        'Elige un tema o crea el tuyo: parte de uno existente y cambia colores, esquinas, fondo (imagen o vídeo) e iconos. Los temas se exportan e importan como archivo, y una IA te puede crear uno.',
      )}
    >
      <div className="field">
        <label>{t('Idioma')}</label>
        <LanguageSwitch />
        <span className="hint">
          {t('En inglés, los números y las fechas se escriben al estilo británico (1,234.56).')}
        </span>
      </div>
      <div className="field">
        <label>{t('Tema')}</label>
        <div className="segmented segmented-wrap" role="group" aria-label={t('Tema')}>
          {all.map((th) => (
            <button
              key={th.id}
              type="button"
              aria-pressed={appearance.theme === th.id}
              disabled={editing !== null}
              onClick={() => void save.run(th.id, appearance.density)}
              data-testid={`theme-${th.id}`}
            >
              {t(th.name)}
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
              {t('Nuevo tema a partir de «{name}»', { name: t(current.name) })}
            </button>
            {custom.some((th) => th.id === current.id) && (
              <button
                type="button"
                className="btn"
                onClick={() => setEditing({ theme: current, isNew: false })}
              >
                {t('Editar «{name}»', { name: t(current.name) })}
              </button>
            )}
          </div>
        )}
        {!editing && <ThemeShare current={current} custom={custom} density={appearance.density} />}
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
        <label>{t('Densidad')}</label>
        <div className="segmented" role="group" aria-label={t('Densidad')}>
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
              {t(label)}
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
      title={t('Bloqueo automático')}
      desc={t('La bóveda también se bloquea al suspender el equipo o bloquear la sesión.')}
    >
      <div className="field">
        <label htmlFor="autolock">{t('Bloquear tras este tiempo sin usar la app')}</label>
        <select
          id="autolock"
          className="input"
          value={status.autoLockMinutes ?? 15}
          onChange={(e) => void save.run(Number(e.target.value))}
        >
          {AUTO_LOCK_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m < 60 ? t('{n} minutos', { n: m }) : tn(m / 60, '{n} hora', '{n} horas')}
            </option>
          ))}
        </select>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => void lock.run()}>
          {t('Bloquear ahora')}
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
      title={t('Contraseña')}
      desc={t(
        'Cambiarla es instantáneo: los datos no se vuelven a cifrar. La clave de recuperación sigue sirviendo.',
      )}
    >
      <form className="form" onSubmit={submit} noValidate>
        <PasswordField label={t('Contraseña actual')} value={current} onChange={setCurrent} />
        <PasswordField
          label={t('Contraseña nueva')}
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          hint={t('Como mínimo {n} caracteres.', { n: MIN_PASSWORD_LENGTH })}
        />
        <PasswordField
          label={t('Repite la contraseña nueva')}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        {tried && tooShort && (
          <Alert>
            {t('La contraseña debe tener al menos {n} caracteres.', { n: MIN_PASSWORD_LENGTH })}
          </Alert>
        )}
        {tried && !tooShort && mismatch && <Alert>{t('Las contraseñas no coinciden.')}</Alert>}
        {change.error && <Alert>{change.error.message}</Alert>}
        {done && <p className="muted">{t('Contraseña cambiada.')}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={change.pending}>
            {change.pending ? t('Guardando…') : t('Cambiar contraseña')}
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
      title={t('Rotar la clave de cifrado')}
      desc={t(
        'Genera una clave nueva y vuelve a cifrar la base de datos. La clave de recuperación anterior deja de servir. Antes se hace una copia en backups/.',
      )}
    >
      {newKey ? (
        <RecoveryKeyPanel
          recoveryKey={newKey}
          doneLabel={t('Hecho')}
          onDone={() => setNewKey(null)}
        />
      ) : (
        <form className="form" onSubmit={submit}>
          <PasswordField label={t('Contraseña actual')} value={password} onChange={setPassword} />
          {rotate.error && <Alert>{rotate.error.message}</Alert>}
          <div className="form-actions">
            <button type="submit" className="btn btn-danger" disabled={rotate.pending || !password}>
              {rotate.pending ? t('Rotando…') : t('Rotar clave')}
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
      title={t('Bóveda')}
      desc={t('Para llevarla a otro equipo, cierra la app y copia la carpeta entera.')}
    >
      <div className="path-box">
        <span>{status.path}</span>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => void close.run()}>
          {t('Cerrar esta bóveda y abrir otra')}
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
          <span className="num">⚙</span> {t('ajustes')}
        </span>
        <h1 className="title">{t('Ajustes')}</h1>
      </div>
      <div>
        <Appearance status={status} />
        <CollectionsSettings />
        <DataSettings />
        <SyncSettings />
        <AutoLock status={status} />
        <ChangePassword />
        <RotateKey />
        <VaultBlock status={status} />
      </div>
    </div>
  )
}
