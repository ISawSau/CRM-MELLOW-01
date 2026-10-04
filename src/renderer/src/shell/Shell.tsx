import { useNarrow } from '../lib/use-narrow'
import { MobileTabBar, MobileTopBar } from './MobileBars'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_APPEARANCE, type Density } from '@shared/appearance'
import { sectionIconName } from '../ui/section-icons'
import { BUILT_IN_THEMES } from '@shared/themes'
import type { VaultStatus } from '@shared/ipc'
import { MetaPage } from '../meta/MetaPage'
import { AnalysisPage } from '../analysis/AnalysisPage'
import { BillingPage } from '../billing/BillingPage'
import { ToolsPage } from '../tools/ToolsPage'
import { ReportsPage } from '../reports/ReportsPage'
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
  // Móvil (D-101): la barra lateral es un menú que se abre encima.
  const narrow = useNarrow()
  const [drawer, setDrawer] = useState(false)
  // Al abrir la bóveda los paneles entran como ventanas; después ya no se repite.
  const [intro, setIntro] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), 900)
    return () => clearTimeout(timer)
  }, [])
  useActivityPing()

  const appearance = status.appearance ?? DEFAULT_APPEARANCE
  // Secciones fijas más las colecciones del usuario; la referencia sirve a openRecord.
  const sections = useSections()
  // Iconos de la barra lateral: los elegidos en Ajustes → Apariencia o los de serie.
  const icons = appearance.icons
  const groups = useMemo(
    () =>
      sections.groups.map((g) => ({
        ...g,
        sections: g.sections.map((s) => ({ ...s, icon: sectionIconName(s.id, icons) })),
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
    setDrawer(false)
  }, [])

  // Botón «atrás» de Android: cierra lo que esté abierto encima o vuelve a Inicio; si no
  // queda nada, la app pasa a segundo plano (lo decide el lado nativo con la respuesta).
  useEffect(() => {
    if (!narrow) return
    const w = window as { __crmBack?: () => boolean }
    w.__crmBack = () => {
      if (paletteOpen) {
        setPaletteOpen(false)
        return true
      }
      if (drawer) {
        setDrawer(false)
        return true
      }
      if (document.querySelector('[role="dialog"], .overlay')) {
        const target = document.activeElement ?? document.body
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return true
      }
      if (openRecord) {
        setOpenRecord(null)
        return true
      }
      if (section !== 'inicio') {
        navigate('inicio')
        return true
      }
      return false
    }
    return () => {
      delete w.__crmBack
    }
  }, [narrow, paletteOpen, drawer, openRecord, section, navigate])

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
      <div
        className="shell"
        data-collapsed={!narrow && collapsed}
        data-narrow={narrow || undefined}
        data-drawer={(narrow && drawer) || undefined}
        data-intro={intro || undefined}
        data-testid="shell"
      >
        {narrow && (
          <MobileTopBar
            title={t(current.label)}
            onMenu={() => setDrawer(true)}
            onSearch={openPalette}
            onLock={lock}
          />
        )}
        <Sidebar
          groups={groups}
          current={section}
          onSelect={navigate}
          collapsed={!narrow && collapsed}
          onToggle={() => (narrow ? setDrawer(false) : setCollapsed((c) => !c))}
          onLock={lock}
          icons={icons}
        />
        {narrow && drawer && (
          <div className="m-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
        )}
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
        {narrow ? (
          <MobileTabBar
            sections={sections.all}
            current={section}
            onSelect={navigate}
            onMore={() => setDrawer(true)}
            icons={(id) => sectionIconName(id, icons)}
          />
        ) : (
          <StatusBar
            status={status}
            onOpenPalette={openPalette}
            onSettings={goSettings}
            onMeta={() => navigate('campanas')}
          />
        )}
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
