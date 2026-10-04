import { themeToCssVars, type Theme } from '@shared/themes'

/** Aplica el tema y la densidad en <html>. */
export function applyAppearance(theme: Theme, density: string, root = document.documentElement) {
  for (const [name, value] of Object.entries(themeToCssVars(theme))) {
    root.style.setProperty(name, value)
  }
  root.dataset['theme'] = theme.id
  root.dataset['scheme'] = theme.scheme
  root.dataset['density'] = density
  root.dataset['layout'] = theme.style.layout
  root.dataset['transparency'] = theme.style.transparency
  root.dataset['motion'] = theme.style.motion
  root.dataset['titles'] = theme.style.titles
  root.dataset['gradient'] = String(theme.style.gradient)
  // Con fondo de imagen o vídeo, el fondo de la página se vuelve transparente.
  if (theme.background) root.dataset['bg'] = theme.background.kind
  else delete root.dataset['bg']
  root.style.colorScheme = theme.scheme
}
