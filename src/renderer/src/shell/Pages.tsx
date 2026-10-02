import type { Section } from './sections'

export function Home({
  onOpenPalette,
  onNotes,
}: {
  onOpenPalette: () => void
  onNotes: () => void
}) {
  return (
    <div className="page" data-testid="page-inicio">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">00</span> inicio
        </span>
        <h1 className="title">Bóveda lista</h1>
      </div>
      <div className="empty">
        <p className="muted">
          La bóveda está cifrada y se bloquea sola si no la usas. Ya puedes trabajar con Notas:
          tabla, kanban, calendario y galería, con filtros, búsqueda (<kbd>Ctrl K</kbd>) y deshacer
          (<kbd>Ctrl Z</kbd>). El resumen de gasto, ROAS, alertas y tareas del día llega en la fase
          2.
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={onNotes}>
            Ir a Notas →
          </button>
          <button type="button" className="btn" onClick={onOpenPalette}>
            Buscar o ejecutar un comando <kbd>Ctrl K</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

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
