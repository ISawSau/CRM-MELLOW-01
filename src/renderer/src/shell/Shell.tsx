import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_APPEARANCE, type Density } from '@shared/appearance'
import type { VaultStatus } from '@shared/ipc'
import { call } from '../lib/ipc'
import { useActivityPing } from '../lib/hooks'
import { CommandPalette, type PaletteActions } from './CommandPalette'
import { Home, Upcoming } from './Pages'
import { ALL_SECTIONS } from './sections'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'

export function Shell({ status }: { status: VaultStatus }) {
  const [section, setSection] = useState('inicio')
  const [collapsed, setCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  useActivityPing()

  const appearance = status.appearance ?? DEFAULT_APPEARANCE
  const lock = useCallback(() => void call('vault:lock').catch(() => {}), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  const openPalette = useCallback(() => setPaletteOpen(true), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const actions: PaletteActions = useMemo(
    () => ({
      navigate: setSection,
      lock,
      toggleSidebar: () => setCollapsed((c) => !c),
      setTheme: (theme: string) =>
        void call('settings:setAppearance', { theme, density: appearance.density }),
      setDensity: (density: Density) =>
        void call('settings:setAppearance', { theme: appearance.theme, density }),
    }),
    [lock, appearance.density, appearance.theme],
  )

  const current = ALL_SECTIONS.find((s) => s.id === section) ?? ALL_SECTIONS[0]!
  const goSettings = () => setSection('ajustes')

  return (
    <div className="shell" data-collapsed={collapsed} data-testid="shell">
      <Sidebar
        current={section}
        onSelect={setSection}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onLock={lock}
      />
      <main className="main">
        {current.id === 'inicio' ? (
          <Home onOpenPalette={openPalette} onSettings={goSettings} />
        ) : current.id === 'ajustes' ? (
          <Settings status={status} />
        ) : (
          <Upcoming section={current} onSettings={goSettings} />
        )}
      </main>
      <StatusBar status={status} onOpenPalette={openPalette} />
      <CommandPalette open={paletteOpen} onClose={closePalette} actions={actions} />
    </div>
  )
}
