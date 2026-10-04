import type { ReactNode } from 'react'
import { useAppInfo } from '../lib/hooks'
import { t } from '@shared/i18n'
import { BrandEye } from '../ui/BrandEye'
import { LanguageSwitch } from '../ui/LanguageSwitch'

/** Marco común de las pantallas previas al desbloqueo. */
export function Gate({
  children,
  step,
  wide,
  art,
}: {
  children: ReactNode
  step?: string
  wide?: boolean
  /** Animación a la derecha (pantalla de contraseña). */
  art?: ReactNode
}) {
  const info = useAppInfo()
  return (
    <div className="gate">
      <header className="gate-top">
        <span className="brand">
          <BrandEye />
          CRM Mellow
        </span>
        <span className="gate-top-right">
          <span>{step}</span>
          <LanguageSwitch compact />
        </span>
      </header>
      <main className={`gate-body${art ? ' gate-body-art' : ''}`}>
        <div className={`gate-inner${wide ? ' gate-inner-wide' : ''}`}>{children}</div>
        {art && <div className="gate-art">{art}</div>}
      </main>
      <footer className="gate-foot">
        {t('Local y cifrado. Los datos solo viven en la carpeta de tu bóveda.')}
        {info.data && <span className="num"> · v{info.data.version}</span>}
      </footer>
    </div>
  )
}
