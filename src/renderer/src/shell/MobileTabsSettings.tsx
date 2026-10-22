import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { DEFAULT_APPEARANCE, MAX_MOBILE_TABS } from '@shared/appearance'
import type { VaultStatus } from '@shared/ipc'
import { t } from '@shared/i18n'
import { useSections } from '../data/hooks'
import { call } from '../lib/ipc'
import { useAction } from '../lib/hooks'
import { Alert } from '../ui/Alert'
import { SectionIcon, sectionIconName } from '../ui/section-icons'
import { tabSections } from './MobileBars'

/**
 * Ajustes → Barra inferior (D-129): qué secciones van en la barra de abajo del móvil y en
 * qué orden. «Más» (el menú completo) va siempre al final.
 */
export function MobileTabsSettings({ status }: { status: VaultStatus }) {
  const appearance = status.appearance ?? DEFAULT_APPEARANCE
  const sections = useSections()
  const current = tabSections(sections.all, appearance.tabs)
  const ids = current.map((s) => s.id)
  const save = useAction((tabs: string[]) => call('settings:setAppearance', { tabs }))
  const set = (next: string[]) => void save.run(next)
  const move = (i: number, by: -1 | 1) => {
    const next = [...ids]
    const [s] = next.splice(i, 1)
    next.splice(i + by, 0, s!)
    set(next)
  }
  const rest = sections.all.filter((s) => !ids.includes(s.id))

  return (
    <section className="settings-block" data-testid="mobile-tabs-settings">
      <div>
        <h2>{t('Barra inferior')}</h2>
        <p className="desc">
          {t(
            'Las secciones que tienes a mano abajo, en el orden que quieras (hasta {n}). Las demás siguen en «Más».',
            { n: MAX_MOBILE_TABS },
          )}
        </p>
      </div>
      <div className="settings-body">
        <ol className="tab-order">
          {current.map((s, i) => (
            <li key={s.id} data-testid={`tab-order-${s.id}`}>
              <SectionIcon name={sectionIconName(s.id, appearance.icons)} size={18} />
              <span>{t(s.label)}</span>
              <button
                type="button"
                className="icon-btn"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label={t('Subir {section}', { section: t(s.label) })}
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={i === current.length - 1}
                onClick={() => move(i, 1)}
                aria-label={t('Bajar {section}', { section: t(s.label) })}
              >
                <ArrowDown size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={current.length <= 1}
                onClick={() => set(ids.filter((id) => id !== s.id))}
                aria-label={t('Quitar {section} de la barra', { section: t(s.label) })}
                data-testid={`tab-remove-${s.id}`}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
        <div className="field">
          <label htmlFor="tab-add">{t('Añadir a la barra')}</label>
          <select
            id="tab-add"
            className="input"
            value=""
            disabled={current.length >= MAX_MOBILE_TABS}
            onChange={(e) => {
              if (e.target.value) set([...ids, e.target.value])
            }}
            data-testid="tab-add"
          >
            <option value="">
              {current.length >= MAX_MOBILE_TABS
                ? t('La barra está llena: quita una para añadir otra')
                : t('Elige una sección…')}
            </option>
            {rest.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.label)}
              </option>
            ))}
          </select>
        </div>
        {appearance.tabs.length > 0 && (
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => set([])}>
              {t('Volver a las de serie')}
            </button>
          </div>
        )}
        {save.error && <Alert>{save.error.message}</Alert>}
      </div>
    </section>
  )
}
