import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Menú desplegable propio (sin librerías que inyecten estilos, por la CSP).
 * Se cierra con Escape o al pulsar fuera.
 */
export function Popover({
  label,
  button,
  children,
  align = 'start',
  className = 'btn',
  testId,
  title,
}: {
  label: string
  button: ReactNode
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  className?: string
  testId?: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <span className="popover-anchor" ref={root}>
      <button
        type="button"
        className={className}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        title={title ?? label}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        {button}
      </button>
      {open && (
        <div className="popover" data-align={align} role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  )
}
