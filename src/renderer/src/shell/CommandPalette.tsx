import { useQuery } from '@tanstack/react-query'
import { Command, defaultFilter } from 'cmdk'
import { useEffect, useRef, useState } from 'react'
import type { Density } from '@shared/appearance'
import { call } from '../lib/ipc'
import { useEntityLookup } from '../data/hooks'
import type { Theme } from '@shared/themes'
import type { Section } from './sections'
import { t } from '@shared/i18n'

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
  themes,
  sections,
}: {
  open: boolean
  onClose: () => void
  actions: PaletteActions
  /** Temas predefinidos y propios. */
  themes: readonly Theme[]
  /** Secciones fijas y colecciones del usuario. */
  sections: Section[]
}) {
  const previousFocus = useRef<Element | null>(null)
  const entityOf = useEntityLookup()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 150)
    return () => clearTimeout(timer)
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
        aria-label={t('Paleta de comandos')}
        data-testid="palette"
      >
        <Command
          label={t('Paleta de comandos')}
          loop
          filter={filter}
          value={selected}
          onValueChange={setSelected}
        >
          <Command.Input
            autoFocus
            placeholder={t('Busca notas, secciones o comandos…')}
            value={search}
            onValueChange={setSearch}
          />
          <Command.List>
            <Command.Empty>{t('No hay nada con ese nombre.')}</Command.Empty>
            {debounced.length >= 2 && (hits.data?.length ?? 0) > 0 && (
              <Command.Group heading={t('Registros')}>
                {hits.data!.map((h) => {
                  const section = sections.find((s) => s.entity === h.entity)
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
                      <span className="faint">{t(entityOf(h.entity)?.singular ?? '')}</span>
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}
            <Command.Group heading={t('Ir a')}>
              {sections.map((s) => (
                <Command.Item
                  key={s.id}
                  value={`ir a ${s.label}`}
                  keywords={[t('ir a'), t(s.label)]}
                  onSelect={run(() => actions.navigate(s.id))}
                >
                  <span>{t(s.label)}</span>
                  {s.phase !== null && (
                    <span className="faint">{t('fase {n}', { n: String(s.phase) })}</span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading={t('Acciones')}>
              <Command.Item
                value="deshacer"
                keywords={[t('Deshacer')]}
                onSelect={run(actions.undo)}
              >
                <span>{t('Deshacer')}</span>
                <kbd>Ctrl Z</kbd>
              </Command.Item>
              <Command.Item value="rehacer" keywords={[t('Rehacer')]} onSelect={run(actions.redo)}>
                <span>{t('Rehacer')}</span>
                <kbd>{t('Ctrl Mayús Z')}</kbd>
              </Command.Item>
              <Command.Item
                value="bloquear bóveda"
                keywords={[t('Bloquear bóveda')]}
                onSelect={run(actions.lock)}
              >
                <span>{t('Bloquear bóveda')}</span>
              </Command.Item>
              <Command.Item
                value="plegar desplegar barra lateral"
                keywords={[t('Plegar o desplegar la barra lateral')]}
                onSelect={run(actions.toggleSidebar)}
              >
                <span>{t('Plegar o desplegar la barra lateral')}</span>
              </Command.Item>
            </Command.Group>
            <Command.Group heading={t('Apariencia')}>
              {themes.map((th) => (
                <Command.Item
                  key={th.id}
                  value={`tema ${th.name}`}
                  keywords={[t('Tema {name}', { name: t(th.name) })]}
                  onSelect={run(() => actions.setTheme(th.id))}
                >
                  <span>{t('Tema {name}', { name: t(th.name) })}</span>
                </Command.Item>
              ))}
              <Command.Item
                value="densidad compacta"
                keywords={[t('Densidad compacta')]}
                onSelect={run(() => actions.setDensity('compacta'))}
              >
                <span>{t('Densidad compacta')}</span>
              </Command.Item>
              <Command.Item
                value="densidad cómoda"
                keywords={[t('Densidad cómoda')]}
                onSelect={run(() => actions.setDensity('comoda'))}
              >
                <span>{t('Densidad cómoda')}</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </>
  )
}
