import { Command } from 'cmdk'
import { useEffect, useRef } from 'react'
import type { Density } from '@shared/appearance'
import { BUILT_IN_THEMES } from '../theme/themes'
import { ALL_SECTIONS } from './sections'

export interface PaletteActions {
  navigate: (sectionId: string) => void
  lock: () => void
  setTheme: (themeId: string) => void
  setDensity: (density: Density) => void
  toggleSidebar: () => void
}

/**
 * Paleta de comandos (Ctrl+K). Modal propio en lugar de Command.Dialog: el diálogo
 * de Radix inyecta una etiqueta <style>, que la CSP de la app (sin 'unsafe-inline')
 * bloquearía.
 */
export function CommandPalette({
  open,
  onClose,
  actions,
}: {
  open: boolean
  onClose: () => void
  actions: PaletteActions
}) {
  const previousFocus = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        data-testid="palette"
      >
        <Command label="Paleta de comandos" loop>
          <Command.Input autoFocus placeholder="Escribe un comando o una sección…" />
          <Command.List>
            <Command.Empty>No hay nada con ese nombre.</Command.Empty>
            <Command.Group heading="Ir a">
              {ALL_SECTIONS.map((s) => (
                <Command.Item
                  key={s.id}
                  value={`ir a ${s.label}`}
                  onSelect={run(() => actions.navigate(s.id))}
                >
                  <span>{s.label}</span>
                  {s.phase !== null && <span className="faint">fase {s.phase}</span>}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Acciones">
              <Command.Item value="bloquear bóveda" onSelect={run(actions.lock)}>
                <span>Bloquear bóveda</span>
              </Command.Item>
              <Command.Item
                value="plegar desplegar barra lateral"
                onSelect={run(actions.toggleSidebar)}
              >
                <span>Plegar o desplegar la barra lateral</span>
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Apariencia">
              {BUILT_IN_THEMES.map((t) => (
                <Command.Item
                  key={t.id}
                  value={`tema ${t.name}`}
                  onSelect={run(() => actions.setTheme(t.id))}
                >
                  <span>Tema {t.name.toLowerCase()}</span>
                </Command.Item>
              ))}
              <Command.Item
                value="densidad compacta"
                onSelect={run(() => actions.setDensity('compacta'))}
              >
                <span>Densidad compacta</span>
              </Command.Item>
              <Command.Item
                value="densidad cómoda"
                onSelect={run(() => actions.setDensity('comoda'))}
              >
                <span>Densidad cómoda</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </>
  )
}
