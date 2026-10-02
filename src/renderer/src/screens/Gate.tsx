import type { ReactNode } from 'react'
import { useAppInfo } from '../lib/hooks'
import { BrandEye } from '../ui/BrandEye'

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
        <span>{step}</span>
      </header>
      <main className="gate-body">
        <div className={`gate-inner${wide ? ' gate-inner-wide' : ''}`}>{children}</div>
      </main>
      <footer className="gate-foot">
        Local y cifrado. Los datos solo viven en la carpeta de tu bóveda.
        {info.data && <span className="num"> · v{info.data.version}</span>}
      </footer>
    </div>
  )
}
