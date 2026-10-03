import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_APPEARANCE, type Density } from '@shared/appearance'
import { BUILT_IN_THEMES, findTheme } from '@shared/themes'
import type { VaultStatus } from '@shared/ipc'
import { MetaPage } from '../meta/MetaPage'
import { AnalysisPage } from '../analysis/AnalysisPage'
import { BillingPage } from '../billing/BillingPage'
import { ToolsPage } from '../tools/ToolsPage'
import { ReportsPage } from '../reports/ReportsPage'
import { PlatformsPage } from '../platforms/PlatformsPage'
import { DataPage } from '../data/DataPage'
import { useDataEvents, useSections } from '../data/hooks'
import { NavContext } from '../data/nav'
import { TrashPage } from '../data/TrashPage'
import { call, IpcCallError } from '../lib/ipc'
import { useActivityPing } from '../lib/hooks'
import { ToastProvider, useToast } from '../ui/Toast'
import { CommandPalette, type PaletteActions } from './CommandPalette'
import { Home } from './Home'
import { ProfilePage } from './ProfilePage'
import { Upcoming } from './Pages'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { ConflictDialog } from './sync'
import { t } from '@shared/i18n'

export function Shell({ status }: { status: VaultStatus }) {
  return (
    <ToastProvider>
      <ShellInner status={status} />
    </ToastProvider>
  )
}

/** ¿El foco está en un sitio donde Ctrl+Z debe deshacer el texto y no los datos? */
function isTextTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return (
    el.isContentEditable ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type))
  )
}

const SECTION_KEY = 'crm.section'

function ShellInner({ status }: { status: VaultStatus }) {
  // La sección se recuerda en esta ventana: al cambiar de idioma se recarga y vuelve aquí.
  const [section, setSection] = useState(() => {
    try {
      return sessionStorage.getItem(SECTION_KEY) ?? 'inicio'
    } catch {
      return 'inicio'
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(SECTION_KEY, section)
    } catch {
      // Sin almacenamiento de sesión: se empieza en Inicio.
    }
  }, [section])
  const [openRecord, setOpenRecord] = useState<string | null>(null)
  const toast = useToast()
  useDataEvents()
  const [collapsed, setCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  useActivityPing()

  const appearance = status.appearance ?? DEFAULT_APPEARANCE
  // Secciones fijas más las colecciones del usuario; la referencia sirve a openRecord.
  const sections = useSections()
  // Iconos de sección del tema (si los define): sustituyen a las letras de la barra lateral.
  const icons = findTheme(appearance.theme, [...BUILT_IN_THEMES, ...(status.themes ?? [])]).icons
  const groups = useMemo(
    () =>
      sections.groups.map((g) => ({
        ...g,
        sections: g.sections.map((s) => (icons[s.id] ? { ...s, letter: icons[s.id]! } : s)),
      })),
    [sections.groups, icons],
  )
  const sectionsRef = useRef(sections.all)
  useEffect(() => {
    sectionsRef.current = sections.all
  }, [sections.all])
  const lock = useCallback(() => void call('vault:lock').catch(() => {}), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  const openPalette = useCallback(() => setPaletteOpen(true), [])

  const undo = useCallback(
    async (redo: boolean) => {
      try {
        const label = await call(redo ? 'data:redo' : 'data:undo')
        if (label)
          toast.show(redo ? t('Rehecho: {label}', { label }) : t('Deshecho: {label}', { label }))
        else toast.show(redo ? t('No hay nada que rehacer.') : t('No hay nada que deshacer.'))
      } catch (e) {
        toast.show(e instanceof IpcCallError ? e.message : t('No se pudo deshacer.'), 'error')
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

  const nav = useMemo(
    () => ({
      openRecord: (entity: string, id: string) => {
        const target = sectionsRef.current.find((s) => s.entity === entity)
        if (!target) return
        setSection(target.id)
        setOpenRecord(id)
      },
    }),
    [],
  )

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

  const current = sections.all.find((s) => s.id === section) ?? sections.all[0]!
  const goSettings = () => navigate('ajustes')

  return (
    <NavContext.Provider value={nav}>
      <div className="shell" data-collapsed={collapsed} data-testid="shell">
        <Sidebar
          groups={groups}
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
              num={sections.groups.find((g) => g.sections.includes(current))?.num ?? '01'}
              openRecordId={openRecord}
              onOpenRecord={setOpenRecord}
            />
          ) : current.id === 'inicio' ? (
            <Home onNavigate={navigate} />
          ) : current.id === 'perfil' ? (
            <ProfilePage onNavigate={navigate} />
          ) : current.id === 'facturacion' ? (
            <BillingPage num="03" onNavigate={navigate} />
          ) : current.id === 'plataformas' ? (
            <PlatformsPage num="02" />
          ) : current.id === 'informes' ? (
            <ReportsPage num="03" />
          ) : current.id === 'herramientas' ? (
            <ToolsPage num="03" />
          ) : current.id === 'analisis' ? (
            <AnalysisPage num="02" onMeta={() => navigate('campanas')} />
          ) : current.id === 'campanas' ? (
            <MetaPage num="02" />
          ) : current.id === 'papelera' ? (
            <TrashPage />
          ) : current.id === 'ajustes' ? (
            <Settings status={status} />
          ) : (
            <Upcoming section={current} onSettings={goSettings} />
          )}
        </main>
        <StatusBar
          status={status}
          onOpenPalette={openPalette}
          onSettings={goSettings}
          onMeta={() => navigate('campanas')}
        />
        <ConflictDialog />
        {paletteOpen && (
          <CommandPalette
            sections={sections.all}
            open
            onClose={closePalette}
            actions={actions}
            themes={[...BUILT_IN_THEMES, ...(status.themes ?? [])]}
          />
        )}
      </div>
    </NavContext.Provider>
  )
}
