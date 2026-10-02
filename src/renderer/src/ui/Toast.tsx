import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastApi {
  show: (message: string, kind?: 'info' | 'error') => void
}

const ToastContext = createContext<ToastApi>({ show: () => {} })

/** Avisos breves abajo a la derecha («Deshecho: …», errores al guardar). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: 'info' | 'error'; n: number } | null>(
    null,
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    if (timer.current) clearTimeout(timer.current)
    setToast((t) => ({ message, kind, n: (t?.n ?? 0) + 1 }))
    timer.current = setTimeout(() => setToast(null), kind === 'error' ? 6000 : 3000)
  }, [])
  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          key={toast.n}
          className="toast"
          data-kind={toast.kind}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          data-testid="toast"
        >
          <span className="marker" />
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
