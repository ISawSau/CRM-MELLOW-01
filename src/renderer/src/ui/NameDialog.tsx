import { useEffect, useState } from 'react'

/** Diálogo pequeño para pedir un nombre (en Electron no existe window.prompt). */
export function NameDialog({
  title,
  label,
  placeholder,
  initial = '',
  onSubmit,
  onCancel,
}: {
  title: string
  label: string
  placeholder?: string
  initial?: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])
  return (
    <>
      <div className="overlay" onClick={onCancel} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="name-dialog-t">
        <h2 id="name-dialog-t">{title}</h2>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) onSubmit(name.trim())
          }}
        >
          <div className="field">
            <label htmlFor="name-dialog-input">{label}</label>
            <input
              id="name-dialog-input"
              className="input"
              autoFocus
              maxLength={120}
              placeholder={placeholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
              Crear
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
