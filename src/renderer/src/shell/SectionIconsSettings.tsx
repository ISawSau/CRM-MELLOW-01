import { useMemo, useState } from 'react'
import { DEFAULT_APPEARANCE } from '@shared/appearance'
import type { VaultStatus } from '@shared/ipc'
import { t } from '@shared/i18n'
import { useSections } from '../data/hooks'
import { call } from '../lib/ipc'
import { useAction } from '../lib/hooks'
import { Alert } from '../ui/Alert'
import { DEFAULT_SECTION_ICONS, ICONS, SectionIcon, sectionIconName } from '../ui/section-icons'
import { SETTINGS_SECTION, TRASH_SECTION } from './sections'

const NAMES = Object.keys(ICONS)

/**
 * Ajustes → Iconos de las secciones (D-094): el icono de cada sección de la barra lateral.
 * Se guardan en la bóveda con la apariencia; el color va en el tema.
 */
export function SectionIconsSettings({ status }: { status: VaultStatus }) {
  const chosen = (status.appearance ?? DEFAULT_APPEARANCE).icons
  const sections = useSections()
  const list = useMemo(
    () => [...sections.groups.flatMap((g) => g.sections), TRASH_SECTION, SETTINGS_SECTION],
    [sections.groups],
  )
  const [open, setOpen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const save = useAction((icons: Record<string, string>) =>
    call('settings:setAppearance', { icons }),
  )
  const pick = (id: string, name: string | null) => {
    const next = { ...chosen }
    if (name === null || name === (DEFAULT_SECTION_ICONS[id] ?? null)) delete next[id]
    else next[id] = name
    setOpen(null)
    setQuery('')
    void save.run(next)
  }
  const q = query.trim().toLowerCase()
  const found = q ? NAMES.filter((n) => n.includes(q)) : NAMES

  return (
    <section className="settings-block" data-testid="section-icons-settings">
      <div>
        <h2>{t('Iconos de las secciones')}</h2>
        <p className="desc">
          {t(
            'Elige el icono de cada sección de la barra lateral. Su color se cambia en el tema (Apariencia → editar tema → Iconos).',
          )}
        </p>
      </div>
      <div className="settings-body settings-body-wide">
        <ul className="section-icon-list">
          {list.map((s) => {
            const name = sectionIconName(s.id, chosen)
            const custom = s.id in chosen
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="section-icon-btn"
                  aria-expanded={open === s.id}
                  aria-label={t('Cambiar el icono de {section}', { section: t(s.label) })}
                  onClick={() => {
                    setOpen(open === s.id ? null : s.id)
                    setQuery('')
                  }}
                  data-testid={`section-icon-${s.id}`}
                >
                  <SectionIcon name={name} size={18} />
                </button>
                <span>{t(s.label)}</span>
                {custom && (
                  <button type="button" className="btn btn-link" onClick={() => pick(s.id, null)}>
                    {t('De serie')}
                  </button>
                )}
                {open === s.id && (
                  <div
                    className="icon-picker"
                    role="dialog"
                    aria-label={t('Iconos para {section}', { section: t(s.label) })}
                  >
                    <input
                      className="input"
                      autoFocus
                      placeholder={t('Buscar (en inglés: chart, user, mail…)')}
                      aria-label={t('Buscar icono')}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setOpen(null)
                      }}
                    />
                    <div className="icon-grid">
                      {found.map((n) => (
                        <button
                          key={n}
                          type="button"
                          title={n}
                          aria-label={n}
                          aria-pressed={n === name}
                          onClick={() => pick(s.id, n)}
                          data-testid={`icon-${n}`}
                        >
                          <SectionIcon name={n} size={18} />
                        </button>
                      ))}
                      {found.length === 0 && <p className="faint">{t('Ningún icono.')}</p>}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {save.error && <Alert>{save.error.message}</Alert>}
      </div>
    </section>
  )
}
