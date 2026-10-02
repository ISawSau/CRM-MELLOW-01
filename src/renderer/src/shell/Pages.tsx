import type { Section } from './sections'

export function Home({
  onOpenPalette,
  onSettings,
}: {
  onOpenPalette: () => void
  onSettings: () => void
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
          Los cimientos están en marcha: la bóveda está cifrada y se bloquea sola si no la usas. El
          resumen de gasto, ROAS, alertas y tareas del día llega en la fase 2.
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={onOpenPalette}>
            Abrir la paleta de comandos <kbd>Ctrl K</kbd>
          </button>
          <button type="button" className="btn" onClick={onSettings}>
            Revisar los ajustes →
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
