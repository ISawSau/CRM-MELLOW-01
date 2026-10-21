import {
  READER_THEME_COLORS,
  isBundledFont,
  isDarkReaderTheme,
  type ReaderPrefs,
} from '@shared/books'
import type { FrameStyle } from '@shared/reader-messages'
import { BUNDLED_FAMILY } from './fonts'

const SERIF = "Georgia, 'Noto Serif', 'Liberation Serif', 'Times New Roman', serif"
const SANS = "system-ui, 'Segoe UI', Roboto, 'Noto Sans', 'Liberation Sans', sans-serif"
/**
 * Tipografías del lector: las del sistema y las que van dentro de la app (D-124), con las
 * del sistema de reserva mientras cargan. Nada se descarga de internet.
 */
export const FONT_FAMILIES: Record<Exclude<ReaderPrefs['font'], 'libro'>, string> = {
  serif: SERIF,
  sans: SANS,
  literata: `'${BUNDLED_FAMILY.literata}', ${SERIF}`,
  atkinson: `'${BUNDLED_FAMILY.atkinson}', ${SANS}`,
  dislexia: `'${BUNDLED_FAMILY.dislexia}', ${SANS}`,
}
/** Márgenes laterales (hueco entre columnas), de estrechos a anchos. */
const GAPS = [3, 6, 9, 13]

function luminance(color: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim())
  if (m) {
    const n = parseInt(m[1]!, 16)
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(color)?.[1]?.split(',').map(Number)
  if (rgb && rgb.length >= 3) return (0.299 * rgb[0]! + 0.587 * rgb[1]! + 0.114 * rgb[2]!) / 255
  return 1
}

/** Colores del tema de la app (para el tema «Como la app»). */
function appColors(): { bg: string; fg: string; link: string; dark: boolean } {
  const css = getComputedStyle(document.documentElement)
  const bg = css.getPropertyValue('--bg').trim() || '#ffffff'
  const fg = css.getPropertyValue('--text').trim() || '#1d1b19'
  const link = css.getPropertyValue('--accent-text').trim() || fg
  return { bg, fg, link, dark: luminance(bg) < 0.5 }
}

export function readerColors(prefs: ReaderPrefs): {
  bg: string
  fg: string
  link: string
  dark: boolean
} {
  if (prefs.theme === 'app') return appColors()
  const c = READER_THEME_COLORS[prefs.theme]
  const dark = isDarkReaderTheme(prefs.theme, false)
  return { ...c, link: dark ? '#9cc4ff' : '#1f5fbf', dark }
}

export function frameStyle(prefs: ReaderPrefs, wide: boolean): FrameStyle {
  const c = readerColors(prefs)
  return {
    ...c,
    fontFamily: prefs.font === 'libro' ? null : FONT_FAMILIES[prefs.font],
    bundledFont: isBundledFont(prefs.font) ? prefs.font : null,
    fontSize: prefs.fontSize,
    weight: prefs.weight,
    spacing: prefs.spacing,
    lineHeight: prefs.lineHeight,
    gap: GAPS[prefs.margin] ?? 6,
    justify: prefs.justify,
    flow: prefs.flow === 'continuo' ? 'scrolled' : 'paginated',
    maxColumns: prefs.spread && wide ? 2 : 1,
  }
}
