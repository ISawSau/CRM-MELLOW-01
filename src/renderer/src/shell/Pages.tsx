import type { Section } from './sections'
import { t } from '@shared/i18n'

export function Upcoming({ section, onSettings }: { section: Section; onSettings: () => void }) {
  return (
    <div className="page" data-testid={`page-${section.id}`}>
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">{String(section.phase).padStart(2, '0')}</span>{' '}
          {t('fase {n}', { n: String(section.phase) })}
        </span>
        <h1 className="title">{t(section.label)}</h1>
      </div>
      <div className="empty">
        <h2>{t('Todavía no está')}</h2>
        <p className="muted">
          {t('Esta sección llega en la fase {n}: {summary}.', {
            n: String(section.phase),
            summary: section.summary,
          })}
        </p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onSettings}>
            {t('Mientras tanto, ajustar la apariencia y la seguridad →')}
          </button>
        </div>
      </div>
    </div>
  )
}
