import { themeToCssVars, type Theme } from './themes'

/** Aplica el tema y la densidad en <html>. */
export function applyAppearance(theme: Theme, density: string, root = document.documentElement) {
  for (const [name, value] of Object.entries(themeToCssVars(theme))) {
    root.style.setProperty(name, value)
  }
  root.dataset['theme'] = theme.id
  root.dataset['scheme'] = theme.scheme
  root.dataset['density'] = density
  root.style.colorScheme = theme.scheme
}
