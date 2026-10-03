import { useQueryClient } from '@tanstack/react-query'
import { t } from '@shared/i18n'
import { call } from '../lib/ipc'
import { useAction } from '../lib/hooks'
import { Alert } from '../ui/Alert'
import { useLinkedInStatus } from './platforms'

/** Ajustes → Integraciones: LinkedIn es opcional y viene desactivado. */
export function LinkedInToggle() {
  const qc = useQueryClient()
  const s = useLinkedInStatus().data
  const save = useAction(async (enabled: boolean) => {
    const r = await call('linkedin:setEnabled', { enabled })
    qc.setQueryData(['data', 'platforms', 'linkedin'], r)
    return r
  })
  if (!s) return null
  return (
    <section className="settings-block" data-testid="integrations-settings">
      <div>
        <h2>{t('Integraciones opcionales')}</h2>
        <p className="desc">
          {t(
            'Plataformas que no todo el mundo usa. Desactivadas no aparecen en la app ni se sincronizan; los datos que ya tengas se conservan.',
          )}
        </p>
      </div>
      <div className="settings-body">
        <label className="check">
          <input
            type="checkbox"
            checked={s.enabled}
            disabled={save.pending}
            onChange={(e) => void save.run(e.target.checked)}
          />
          <span>
            <strong>LinkedIn Ads</strong>
            <span className="faint">
              {' · '}
              {t(
                'API de publicidad en solo lectura y CSV de Campaign Manager, en la sección «LinkedIn y X».',
              )}
            </span>
          </span>
        </label>
        {save.error && <Alert>{save.error.message}</Alert>}
      </div>
    </section>
  )
}
