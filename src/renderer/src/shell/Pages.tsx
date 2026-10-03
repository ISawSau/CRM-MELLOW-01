import type { Section } from './sections'

export function Upcoming({ section, onSettings }: { section: Section; onSettings: () => void }) {
  return (
    <div className="page" data-testid={`page-${section.id}`}>
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">{String(section.phase).padStart(2, '0')}</span> fase {section.phase}
        </span>
        <h1 className="title">{section.label}</h1>
      </div>
      <div className="empty">
        <h2>Todavía no está</h2>
        <p className="muted">
          Esta sección llega en la fase {section.phase}: {section.summary}.
        </p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onSettings}>
            Mientras tanto, ajustar la apariencia y la seguridad →
          </button>
        </div>
      </div>
    </div>
  )
}
