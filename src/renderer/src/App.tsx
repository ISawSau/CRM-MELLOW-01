import { useEffect, useState } from 'react'
import { DEFAULT_APPEARANCE } from '@shared/appearance'
import { useVaultStatus } from './lib/hooks'
import { call } from './lib/ipc'
import { CreateVault } from './screens/CreateVault'
import { Gate } from './screens/Gate'
import { RecoveryKeyPanel } from './screens/RecoveryKey'
import { Unlock } from './screens/Unlock'
import { Welcome } from './screens/Welcome'
import { Shell } from './shell/Shell'
import { applyAppearance } from './theme/apply'
import { BUILT_IN_THEMES, findTheme } from '@shared/themes'
import { ThemeBackground } from './theme/ThemeBackground'
import { t } from '@shared/i18n'

export function App() {
  const status = useVaultStatus()
  const [creating, setCreating] = useState(false)
  /** Clave de recuperación recién creada: se muestra antes de entrar. */
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null)

  // Antes de desbloquear se usa la apariencia por defecto (tema Mellow, densidad compacta).
  const appearance = status.data?.appearance ?? DEFAULT_APPEARANCE
  const themes = status.data?.themes
  useEffect(() => {
    applyAppearance(
      findTheme(appearance.theme, [...BUILT_IN_THEMES, ...(themes ?? [])]),
      appearance.density,
    )
  }, [appearance.theme, appearance.density, themes])

  // Ventana transparente (D-097): se recuerda fuera de la bóveda y se aplica al reabrir la app.
  const wantsWindow =
    status.data?.state === 'unlocked' &&
    findTheme(appearance.theme, [...BUILT_IN_THEMES, ...(themes ?? [])]).style.transparency ===
      'ventana'
  const unlocked = status.data?.state === 'unlocked'
  useEffect(() => {
    if (unlocked) void call('app:windowTransparent', { value: wantsWindow }).catch(() => {})
  }, [unlocked, wantsWindow])

  if (!status.data) return null
  const s = status.data

  if (newRecoveryKey && s.state === 'unlocked') {
    return (
      <Gate step={t('03 · clave de recuperación')}>
        <div className="section-head">
          <span className="eyebrow">
            <span className="num">03</span> {t('imprescindible')}
          </span>
          <h1 className="title">{t('Tu clave de recuperación')}</h1>
          <p className="muted">
            {t('Sirve para entrar si olvidas la contraseña. Cópiala y guárdala ahora.')}
          </p>
        </div>
        <RecoveryKeyPanel
          recoveryKey={newRecoveryKey}
          onDone={() => {
            setNewRecoveryKey(null)
            setCreating(false)
          }}
          doneLabel={t('Entrar en la bóveda')}
        />
      </Gate>
    )
  }

  if (s.state === 'unlocked') {
    const bg = findTheme(appearance.theme, [...BUILT_IN_THEMES, ...(themes ?? [])]).background
    return (
      <>
        {bg && <ThemeBackground key={bg.fileId} bg={bg} />}
        <Shell status={s} />
      </>
    )
  }
  if (s.state === 'locked') return <Unlock status={s} />
  if (creating) {
    return <CreateVault onCancel={() => setCreating(false)} onCreated={setNewRecoveryKey} />
  }
  return <Welcome onCreate={() => setCreating(true)} />
}
