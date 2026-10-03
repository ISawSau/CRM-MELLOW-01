import { useState } from 'react'
import type { Density } from '@shared/appearance'
import {
  BUILT_IN_THEMES,
  MAX_CUSTOM_THEMES,
  aiThemePrompt,
  exportTheme,
  importTheme,
  type Theme,
} from '@shared/themes'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { useToast } from '../ui/Toast'

/** Nombre que no choque con los temas que ya hay. */
function uniqueName(name: string, all: Theme[]): string {
  const taken = new Set(all.map((t) => t.name))
  if (!taken.has(name)) return name
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`.slice(0, 60)
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Compartir temas: exportar el tema en uso a un archivo, importar uno (archivo o JSON pegado)
 * y pedírselo a una IA. No hay IA dentro de la app (cero costes): se copian unas
 * instrucciones para cualquier chat de IA y se pega su respuesta.
 */
export function ThemeShare({
  current,
  custom,
  density,
}: {
  current: Theme
  custom: Theme[]
  density: Density
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [wish, setWish] = useState('')
  const [error, setError] = useState<string | null>(null)

  const exportCurrent = async () => {
    try {
      const saved = await call('settings:exportTheme', {
        name: current.name,
        json: exportTheme(current),
      })
      if (saved) toast.show(`Tema «${current.name}» exportado.`)
    } catch (e) {
      toast.show(e instanceof IpcCallError ? e.message : 'No se ha podido exportar.', 'error')
    }
  }

  const doImport = async () => {
    setError(null)
    if (custom.length >= MAX_CUSTOM_THEMES)
      return setError(`Como mucho puede haber ${MAX_CUSTOM_THEMES} temas propios.`)
    const r = importTheme(text, `propio-${Date.now().toString(36)}`)
    if (!r.ok) return setError(r.error)
    const theme = { ...r.theme, name: uniqueName(r.theme.name, [...BUILT_IN_THEMES, ...custom]) }
    try {
      await call('settings:setThemes', { themes: [...custom, theme] })
      await call('settings:setAppearance', { theme: theme.id, density })
      toast.show(`Tema «${theme.name}» importado y aplicado.`)
      setOpen(false)
      setText('')
    } catch (e) {
      setError(e instanceof IpcCallError ? e.message : 'No se ha podido importar.')
    }
  }

  return (
    <>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => void exportCurrent()}>
          Exportar «{current.name}»
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setOpen(true)}
          data-testid="theme-import-open"
        >
          Importar o crear con IA…
        </button>
      </div>
      {open && (
        <>
          <div className="overlay" onClick={() => setOpen(false)} />
          <div
            className="dialog dialog-wide"
            role="dialog"
            aria-label="Importar un tema"
            data-testid="theme-import"
          >
            <h2>Importar un tema</h2>
            <div className="field">
              <label htmlFor="theme-file">Desde un archivo exportado</label>
              <input
                id="theme-file"
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f && f.size < 200_000) void f.text().then(setText)
                  else if (f) setError('El archivo es demasiado grande para ser un tema.')
                }}
              />
            </div>
            <details className="theme-ai">
              <summary>Crear con IA (ChatGPT, Claude, Gemini…)</summary>
              <ol className="steps">
                <li>
                  <label htmlFor="theme-wish">Describe el tema que quieres</label>
                  <input
                    id="theme-wish"
                    className="input"
                    maxLength={300}
                    placeholder="Colores de mi marca: amarillo y negro, con esquinas redondeadas"
                    value={wish}
                    onChange={(e) => setWish(e.target.value)}
                  />
                </li>
                <li>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void call('clipboard:writeText', { text: aiThemePrompt(current, wish) })
                        .then(() => toast.show('Instrucciones copiadas.'))
                        .catch(() => toast.show('No se han podido copiar.', 'error'))
                    }
                  >
                    Copiar instrucciones para la IA
                  </button>{' '}
                  y pégalas en el chat de IA que uses.
                </li>
                <li>Copia su respuesta y pégala abajo.</li>
              </ol>
            </details>
            <div className="field">
              <label htmlFor="theme-json">JSON del tema</label>
              <textarea
                id="theme-json"
                className="input mono theme-json"
                rows={8}
                spellCheck={false}
                placeholder='{ "formato": "crm-mellow-tema", "version": 1, "tema": { … } }'
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <p className="hint">
                Se comprueba antes de guardarlo: solo colores válidos, y la app avisa si algún texto
                queda con poco contraste.
              </p>
            </div>
            {error && <Alert>{error}</Alert>}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!text.trim()}
                onClick={() => void doImport()}
              >
                Importar y aplicar
              </button>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
