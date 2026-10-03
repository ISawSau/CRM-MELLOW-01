import { call } from '../lib/ipc'
import { useAction } from '../lib/hooks'
import { Alert } from '../ui/Alert'
import { Gate } from './Gate'
import { t } from '@shared/i18n'

export function Welcome({ onCreate }: { onCreate: () => void }) {
  const open = useAction(async () => {
    const path = await call('vault:pickFolder', { purpose: 'open' })
    if (path) await call('vault:open', { path })
  })

  return (
    <Gate step={t('01 · empezar')} wide>
      <h1 className="title-hero">
        {t('Todo tu trabajo,')}
        <br />
        <span className="shift">{t('en una carpeta.')}</span>
      </h1>
      <p className="muted">
        {t(
          'La bóveda es la carpeta donde se guardan tus datos, cifrados. Puedes copiarla a otro ordenador o a un USB y seguir trabajando allí.',
        )}
      </p>
      <div className="choices">
        <button type="button" className="choice" onClick={onCreate} data-testid="welcome-create">
          <span className="eyebrow">
            <span className="num">A</span> {t('primera vez')}
          </span>
          <h2>
            {t('Crear bóveda nueva')} <span className="arrow">→</span>
          </h2>
          <span className="muted">{t('Eliges dónde guardarla y una contraseña.')}</span>
        </button>
        <button
          type="button"
          className="choice"
          onClick={() => void open.run()}
          disabled={open.pending}
          data-testid="welcome-open"
        >
          <span className="eyebrow">
            <span className="num">B</span> {t('ya tengo una')}
          </span>
          <h2>
            {t('Abrir bóveda existente')} <span className="arrow">→</span>
          </h2>
          <span className="muted">{t('Elige la carpeta que contiene vault.json.')}</span>
        </button>
      </div>
      {open.error && <Alert>{open.error.message}</Alert>}
    </Gate>
  )
}
