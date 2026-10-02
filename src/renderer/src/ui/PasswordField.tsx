import { useId, useState } from 'react'

interface Props {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  autoFocus?: boolean
  large?: boolean
  autoComplete?: 'current-password' | 'new-password'
  testId?: string
}

export function PasswordField({
  label,
  value,
  onChange,
  hint,
  autoFocus,
  large,
  autoComplete = 'current-password',
  testId,
}: Props) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        <button
          type="button"
          className="btn btn-link"
          onClick={() => setVisible((v) => !v)}
          aria-controls={id}
        >
          {visible ? 'ocultar' : 'mostrar'}
        </button>
      </div>
      <input
        id={id}
        data-testid={testId}
        className={`input${large ? ' input-large' : ''}`}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
        autoCapitalize="off"
      />
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}
