import { getLocale, LOCALE_NAMES, LOCALES, t, type Locale } from '@shared/i18n'
import { call } from '../lib/ipc'

/** Cambia el idioma de la interfaz: se guarda y la ventana se vuelve a pintar. */
export async function changeLocale(locale: Locale): Promise<void> {
  if (locale === getLocale()) return
  await call('app:setLocale', { locale })
  window.location.reload()
}

/** Selector de idioma (pantalla de contraseña y Ajustes). */
export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`segmented${compact ? ' segmented-compact' : ''}`}
      role="group"
      aria-label={t('Idioma')}
      data-testid="language-switch"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={getLocale() === l}
          onClick={() => void changeLocale(l)}
          data-testid={`language-${l}`}
        >
          {compact ? l.toUpperCase() : LOCALE_NAMES[l]}
        </button>
      ))}
    </div>
  )
}
