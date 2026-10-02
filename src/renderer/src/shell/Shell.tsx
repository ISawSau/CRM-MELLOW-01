import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_APPEARANCE, type Density } from '@shared/appearance'
import type { VaultStatus } from '@shared/ipc'
import { DataPage } from '../data/DataPage'
import { useDataEvents } from '../data/hooks'
import { TrashPage } from '../data/TrashPage'
import { call, IpcCallError } from '../lib/ipc'
import { useActivityPing } from '../lib/hooks'
import { ToastProvider, useToast } from '../ui/Toast'
import { CommandPalette, type PaletteActions } from './CommandPalette'
import { Home, Upcoming } from './Pages'
import { ALL_SECTIONS } from './sections'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'

export function Shell({ status }: { status: VaultStatus }) {
  return (
    <ToastProvider>
      <ShellInner status={status} />
    </ToastProvider>
  )
}

/** ¿El foco está en un sitio donde Ctrl+Z debe deshacer el texto y no los datos? */
function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return (
    t.isContentEditable ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    (t instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(t.type))
  )
}

function ShellInner({ status }: { status: VaultStatus }) {
  const [section, setSection] = useState('inicio')
  const [openRecord, setOpenRecord] = useState<string | null>(null)
  const toast = useToast()
  useDataEvents()
  const [collapsed, setCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  useActivityPing()

  const appearance = status.appearance ?? DEFAULT_APPEARANCE
  const lock = useCallback(() => void call('vault:lock').catch(() => {}), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  const openPalette = useCallback(() => setPaletteOpen(true), [])

  const undo = useCallback(
    async (redo: boolean) => {
      try {
        const label = await call(redo ? 'data:redo' : 'data:undo')
        if (label) toast.show(`${redo ? 'Rehecho' : 'Deshecho'}: ${label}`)
        else toast.show(redo ? 'No hay nada que rehacer.' : 'No hay nada que deshacer.')
      } catch (e) {
        toast.show(e instanceof IpcCallError ? e.message : 'No se pudo deshacer.', 'error')
      }
    },
    [toast],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && !e.shiftKey && !e.altKey && key === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      // Ctrl+Z / Ctrl+Mayús+Z (o Ctrl+Y) deshacen acciones sobre los datos, salvo
      // mientras se escribe en un campo de texto, donde deshacen el texto.
      if (mod && !e.altKey && (key === 'z' || key === 'y') && !isTextTarget(e.target)) {
        e.preventDefault()
        void undo(key === 'y' || e.shiftKey)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  const navigate = useCallback((id: string) => {
    setSection(id)
    setOpenRecord(null)
  }, [])

  const actions: PaletteActions = useMemo(
    () => ({
      navigate,
      openRecord: (sectionId: string, id: string) => {
        setSection(sectionId)
        setOpenRecord(id)
      },
      undo: () => void undo(false),
      redo: () => void undo(true),
      lock,
      toggleSidebar: () => setCollapsed((c) => !c),
      setTheme: (theme: string) =>
        void call('settings:setAppearance', { theme, density: appearance.density }),
      setDensity: (density: Density) =>
        void call('settings:setAppearance', { theme: appearance.theme, density }),
    }),
    [lock, navigate, undo, appearance.density, appearance.theme],
  )

  const current = ALL_SECTIONS.find((s) => s.id === section) ?? ALL_SECTIONS[0]!
  const goSettings = () => navigate('ajustes')

  return (
    <div className="shell" data-collapsed={collapsed} data-testid="shell">
      <Sidebar
        current={section}
        onSelect={navigate}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onLock={lock}
      />
      <main className="main">
        {current.entity ? (
          <DataPage
            key={current.entity}
            entity={current.entity}
            num="01"
            openRecordId={openRecord}
            onOpenRecord={setOpenRecord}
          />
        ) : current.id === 'inicio' ? (
          <Home onOpenPalette={openPalette} onNotes={() => navigate('notas')} />
        ) : current.id === 'papelera' ? (
          <TrashPage />
        ) : current.id === 'ajustes' ? (
          <Settings status={status} />
        ) : (
          <Upcoming section={current} onSettings={goSettings} />
        )}
      </main>
      <StatusBar status={status} onOpenPalette={openPalette} />
      {paletteOpen && <CommandPalette open onClose={closePalette} actions={actions} />}
    </div>
  )
}
