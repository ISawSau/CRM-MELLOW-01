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
}: {
  children: ReactNode
  step?: string
  wide?: boolean
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
      <main className="gate-body">
        <div className={`gate-inner${wide ? ' gate-inner-wide' : ''}`}>{children}</div>
      </main>
      <footer className="gate-foot">
        {t('Local y cifrado. Los datos solo viven en la carpeta de tu bóveda.')}
        {info.data && <span className="num"> · v{info.data.version}</span>}
      </footer>
    </div>
  )
}
