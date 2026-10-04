import { SETTINGS_SECTION, TRASH_SECTION, type Section, type SectionGroup } from './sections'
import { useQuery } from '@tanstack/react-query'
import { call } from '../lib/ipc'
import { BrandEye } from '../ui/BrandEye'
import { SectionIcon, sectionIconName } from '../ui/section-icons'
import { useUnseenAlerts } from '../analysis/AnalysisPage'
import { t } from '@shared/i18n'

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
      title={t(section.label)}
      data-testid={`nav-${section.id}`}
    >
      <span className="nav-icon" aria-hidden="true">
        <SectionIcon name={section.icon ?? sectionIconName(section.id, {})} />
      </span>
      <span className="nav-label">{t(section.label)}</span>
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
  groups,
  current,
  onSelect,
  collapsed,
  onToggle,
  onLock,
  icons,
}: {
  groups: SectionGroup[]
  current: string
  onSelect: (id: string) => void
  collapsed: boolean
  onToggle: () => void
  onLock: () => void
  icons: Record<string, string>
}) {
  const tasks = useQuery({
    queryKey: ['data', 'tasks-summary'],
    queryFn: () => call('tasks:summary'),
    refetchInterval: 5 * 60_000,
  })
  const unseen = useUnseenAlerts()
  const alertBadge = {
    count: unseen,
    urgent: true,
    label: t('{n} avisos de alertas sin ver', { n: unseen }),
  }
  const ts = tasks.data
  const taskBadge = ts
    ? {
        count: ts.today + ts.overdue,
        urgent: ts.overdue > 0,
        label: t('{today} para hoy, {overdue} atrasadas', { today: ts.today, overdue: ts.overdue }),
      }
    : undefined
  return (
    <aside className="sidebar" aria-label={t('Navegación')}>
      <div className="sidebar-head">
        <span className="brand">
          <BrandEye />
          <span className="sidebar-brand-text">CRM Mellow</span>
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggle}
          aria-label={collapsed ? t('Desplegar barra lateral') : t('Plegar barra lateral')}
          title={collapsed ? t('Desplegar barra lateral') : t('Plegar barra lateral')}
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>
      <nav className="nav">
        {groups.map((g) => (
          <div className="nav-group" key={g.num}>
            <div className="nav-group-title">
              <span className="num">{g.num}</span>
              {t(g.title)}
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
        {[TRASH_SECTION, SETTINGS_SECTION].map((s) => (
          <NavItem
            key={s.id}
            section={{ ...s, icon: sectionIconName(s.id, icons) }}
            current={current}
            onSelect={onSelect}
          />
        ))}
        <button
          type="button"
          className="nav-item"
          onClick={onLock}
          title={t('Bloquear bóveda')}
          data-testid="sidebar-lock"
        >
          <span className="nav-icon" aria-hidden="true">
            <SectionIcon name="lock" />
          </span>
          <span className="nav-label">{t('Bloquear')}</span>
        </button>
      </div>
    </aside>
  )
}
