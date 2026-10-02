import { useQuery } from '@tanstack/react-query'
import { Command, defaultFilter } from 'cmdk'
import { useEffect, useRef, useState } from 'react'
import type { Density } from '@shared/appearance'
import { findEntity } from '@shared/data/entities'
import { call } from '../lib/ipc'
import { BUILT_IN_THEMES } from '../theme/themes'
import { ALL_SECTIONS } from './sections'

export interface PaletteActions {
  navigate: (sectionId: string) => void
  openRecord: (sectionId: string, recordId: string) => void
  undo: () => void
  redo: () => void
  lock: () => void
  setTheme: (themeId: string) => void
  setDensity: (density: Density) => void
  toggleSidebar: () => void
}

/**
 * Paleta de comandos (Ctrl+K). Modal propio en lugar de Command.Dialog: el diálogo
 * de Radix inyecta una etiqueta <style>, que la CSP de la app (sin 'unsafe-inline')
 * bloquearía. Se monta solo mientras está abierta, así cada vez empieza vacía.
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
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 150)
    return () => clearTimeout(t)
  }, [search])
  const hits = useQuery({
    queryKey: ['data', 'search', debounced],
    queryFn: () => call('data:search', { text: debounced, limit: 12 }),
    enabled: open && debounced.length >= 2,
  })
  // Al llegar resultados, se selecciona el primero (cmdk mantendría el anterior).
  const [selected, setSelected] = useState('')
  const firstHit = debounced.length >= 2 ? hits.data?.[0]?.id : undefined
  const [prevHit, setPrevHit] = useState<string | undefined>(undefined)
  if (firstHit !== prevHit) {
    setPrevHit(firstHit)
    if (firstHit) setSelected(`registro ${firstHit}`)
  }

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

  // Los registros ya vienen filtrados por el motor (sin tildes, por prefijo): van
  // siempre arriba. Secciones y comandos se filtran con el criterio de cmdk.
  const filter = (value: string, query: string, keywords?: string[]) =>
    value.startsWith('registro ') ? 1 : defaultFilter(value, query, keywords) * 0.99

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
        <Command
          label="Paleta de comandos"
          loop
          filter={filter}
          value={selected}
          onValueChange={setSelected}
        >
          <Command.Input
            autoFocus
            placeholder="Busca notas, secciones o comandos…"
            value={search}
            onValueChange={setSearch}
          />
          <Command.List>
            <Command.Empty>No hay nada con ese nombre.</Command.Empty>
            {debounced.length >= 2 && (hits.data?.length ?? 0) > 0 && (
              <Command.Group heading="Registros">
                {hits.data!.map((h) => {
                  const section = ALL_SECTIONS.find((s) => s.entity === h.entity)
                  return (
                    <Command.Item
                      key={h.id}
                      value={`registro ${h.id}`}
                      onSelect={run(() => section && actions.openRecord(section.id, h.id))}
                      data-testid="search-hit"
                    >
                      <span className="hit">
                        <span>{h.title}</span>
                        {h.snippet && <span className="faint hit-snippet">{h.snippet}</span>}
                      </span>
                      <span className="faint">{findEntity(h.entity)?.singular}</span>
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}
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
              <Command.Item value="deshacer" onSelect={run(actions.undo)}>
                <span>Deshacer</span>
                <kbd>Ctrl Z</kbd>
              </Command.Item>
              <Command.Item value="rehacer" onSelect={run(actions.redo)}>
                <span>Rehacer</span>
                <kbd>Ctrl Mayús Z</kbd>
              </Command.Item>
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
