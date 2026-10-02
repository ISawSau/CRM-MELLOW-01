import { useEffect, useState } from 'react'
import { DEFAULT_APPEARANCE } from '@shared/appearance'
import { useVaultStatus } from './lib/hooks'
import { CreateVault } from './screens/CreateVault'
import { Gate } from './screens/Gate'
import { RecoveryKeyPanel } from './screens/RecoveryKey'
import { Unlock } from './screens/Unlock'
import { Welcome } from './screens/Welcome'
import { Shell } from './shell/Shell'
import { applyAppearance } from './theme/apply'
import { findTheme } from './theme/themes'

export function App() {
  const status = useVaultStatus()
  const [creating, setCreating] = useState(false)
  /** Clave de recuperación recién creada: se muestra antes de entrar. */
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null)

  // Antes de desbloquear se usa la apariencia por defecto (tema oscuro, densidad compacta).
  const appearance = status.data?.appearance ?? DEFAULT_APPEARANCE
  useEffect(() => {
    applyAppearance(findTheme(appearance.theme), appearance.density)
  }, [appearance.theme, appearance.density])

  if (!status.data) return null
  const s = status.data

  if (newRecoveryKey && s.state === 'unlocked') {
    return (
      <Gate step="03 · clave de recuperación">
        <div className="section-head">
          <span className="eyebrow">
            <span className="num">03</span> imprescindible
          </span>
          <h1 className="title">Tu clave de recuperación</h1>
          <p className="muted">
            Sirve para entrar si olvidas la contraseña. Cópiala y guárdala ahora.
          </p>
        </div>
        <RecoveryKeyPanel
          recoveryKey={newRecoveryKey}
          onDone={() => {
            setNewRecoveryKey(null)
            setCreating(false)
          }}
          doneLabel="Entrar en la bóveda"
        />
      </Gate>
    )
  }

  if (s.state === 'unlocked') return <Shell status={s} />
  if (s.state === 'locked') return <Unlock status={s} />
  if (creating) {
    return <CreateVault onCancel={() => setCreating(false)} onCreated={setNewRecoveryKey} />
  }
  return <Welcome onCreate={() => setCreating(true)} />
}
