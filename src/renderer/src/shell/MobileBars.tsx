import { Lock, Menu, Search } from 'lucide-react'
import { t } from '@shared/i18n'
import { SectionIcon } from '../ui/section-icons'
import type { Section } from './sections'
import { SyncProgressBar, useSyncStatus } from './sync'
import { TimerItem } from './TimerItem'

/** Secciones de serie de la barra inferior en el móvil; el resto, en el menú. */
export const TAB_SECTIONS = ['inicio', 'clientes', 'tareas', 'campanas'] as const

/** Las que se ven: las elegidas en Ajustes (D-129) o las de serie; sin las que ya no existen. */
export function tabSections(sections: Section[], chosen: readonly string[]): Section[] {
  const ids = chosen.length ? chosen : TAB_SECTIONS
  return ids
    .map((id) => sections.find((s) => s.id === id))
    .filter((s): s is Section => s !== undefined)
}

/**
 * Barra superior del móvil (D-101): menú, sección actual, búsqueda (la paleta de comandos),
 * cronómetro y bloquear.
 */
export function MobileTopBar({
  title,
  onMenu,
  onSearch,
  onLock,
}: {
  title: string
  onMenu: () => void
  onSearch: () => void
  onLock: () => void
}) {
  const sync = useSyncStatus()
  return (
    <header className="m-topbar" data-testid="mobile-topbar">
      {/* Sincronizando (D-124): una línea fina debajo de la barra, en cualquier pantalla. */}
      <SyncProgressBar s={sync} className="m-topbar-sync" />
      <button
        type="button"
        className="m-icon-btn"
        onClick={onMenu}
        aria-label={t('Abrir el menú')}
        data-testid="mobile-menu"
      >
        <Menu size={22} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <h1 className="m-title">{title}</h1>
      <TimerItem />
      <button
        type="button"
        className="m-icon-btn"
        onClick={onSearch}
        aria-label={t('Buscar y comandos')}
        data-testid="mobile-search"
      >
        <Search size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="m-icon-btn"
        onClick={onLock}
        aria-label={t('Bloquear bóveda')}
        data-testid="mobile-lock"
      >
        <Lock size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </header>
  )
}

/** Barra inferior del móvil con las secciones más usadas y «Más» (el menú completo). */
export function MobileTabBar({
  sections,
  tabs: chosen,
  current,
  onSelect,
  onMore,
  icons,
}: {
  sections: Section[]
  tabs: readonly string[]
  current: string
  onSelect: (id: string) => void
  onMore: () => void
  icons: (id: string) => string
}) {
  const tabs = tabSections(sections, chosen)
  const inMore = !tabs.some((s) => s.id === current)
  return (
    <nav className="m-tabbar" aria-label={t('Secciones principales')} data-testid="mobile-tabbar">
      {tabs.map((s) => (
        <button
          key={s.id}
          type="button"
          className="m-tab"
          aria-current={current === s.id ? 'page' : undefined}
          onClick={() => onSelect(s.id)}
          data-testid={`tab-${s.id}`}
        >
          <SectionIcon name={icons(s.id)} size={22} />
          <span>{t(s.label)}</span>
        </button>
      ))}
      <button
        type="button"
        className="m-tab"
        aria-current={inMore ? 'page' : undefined}
        onClick={onMore}
        data-testid="tab-more"
      >
        <Menu size={22} strokeWidth={1.75} aria-hidden="true" />
        <span>{t('Más')}</span>
      </button>
    </nav>
  )
}
