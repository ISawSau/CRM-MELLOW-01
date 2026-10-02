import { SECTION_GROUPS, SETTINGS_SECTION, type Section } from './sections'

function NavItem({
  section,
  current,
  onSelect,
}: {
  section: Section
  current: string
  onSelect: (id: string) => void
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
  return (
    <aside className="sidebar" aria-label="Navegación">
      <div className="sidebar-head">
        <span className="brand">
          <span className="marker" aria-hidden="true" />
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
              <NavItem key={s.id} section={s} current={current} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
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
