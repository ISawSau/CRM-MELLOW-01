import { SECTION_GROUPS, SETTINGS_SECTION, TRASH_SECTION, type Section } from './sections'
import { useQuery } from '@tanstack/react-query'
import { call } from '../lib/ipc'
import { BrandEye } from '../ui/BrandEye'
import { useUnseenAlerts } from '../analysis/AnalysisPage'

function NavItem({
  section,
  current,
  onSelect,
  badge,
}: {
  section: Section
  current: string
  onSelect: (id: string) => void
  badge?: { count: number; urgent: boolean; label: string } | undefined
}) {
  return (
    <button
      type="button"
      className="nav-item"
      aria-current={current === section.id ? 'page' : undefined}
      onClick={() => onSelect(section.id)}
      title={section.label}
      data-testid={`nav-${section.id}`}
    >
      <span className="nav-letter" aria-hidden="true">
        {section.letter}
      </span>
      <span className="nav-label">{section.label}</span>
      {badge && badge.count > 0 && (
        <span
          className="nav-badge num"
          data-urgent={badge.urgent}
          title={badge.label}
          aria-label={badge.label}
          data-testid={`badge-${section.id}`}
        >
          {badge.count}
        </span>
      )}
    </button>
  )
}

export function Sidebar({
  current,
  onSelect,
  collapsed,
  onToggle,
  onLock,
}: {
  current: string
  onSelect: (id: string) => void
  collapsed: boolean
  onToggle: () => void
  onLock: () => void
}) {
  const tasks = useQuery({
    queryKey: ['data', 'tasks-summary'],
    queryFn: () => call('tasks:summary'),
    refetchInterval: 5 * 60_000,
  })
  const unseen = useUnseenAlerts()
  const alertBadge = { count: unseen, urgent: true, label: `${unseen} avisos de alertas sin ver` }
  const t = tasks.data
  const taskBadge = t
    ? {
        count: t.today + t.overdue,
        urgent: t.overdue > 0,
        label: `${t.today} para hoy, ${t.overdue} atrasadas`,
      }
    : undefined
  return (
    <aside className="sidebar" aria-label="Navegación">
      <div className="sidebar-head">
        <span className="brand">
          <BrandEye />
          <span className="sidebar-brand-text">CRM Mellow</span>
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggle}
          aria-label={collapsed ? 'Desplegar barra lateral' : 'Plegar barra lateral'}
          title={collapsed ? 'Desplegar barra lateral' : 'Plegar barra lateral'}
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>
      <nav className="nav">
        {SECTION_GROUPS.map((g) => (
          <div className="nav-group" key={g.num}>
            <div className="nav-group-title">
              <span className="num">{g.num}</span>
              {g.title}
            </div>
            {g.sections.map((s) => (
              <NavItem
                key={s.id}
                section={s}
                current={current}
                onSelect={onSelect}
                badge={s.id === 'tareas' ? taskBadge : s.id === 'analisis' ? alertBadge : undefined}
              />
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <NavItem section={TRASH_SECTION} current={current} onSelect={onSelect} />
        <NavItem section={SETTINGS_SECTION} current={current} onSelect={onSelect} />
        <button
          type="button"
          className="nav-item"
          onClick={onLock}
          title="Bloquear bóveda"
          data-testid="sidebar-lock"
        >
          <span className="nav-letter" aria-hidden="true">
            ▪
          </span>
          <span className="nav-label">Bloquear</span>
        </button>
      </div>
    </aside>
  )
}
