import type { ReactNode } from 'react'

export function Alert({
  children,
  tone = 'danger',
}: {
  children: ReactNode
  tone?: 'danger' | 'warning'
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="marker" aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}
