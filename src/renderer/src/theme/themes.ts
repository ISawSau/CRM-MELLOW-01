import { z } from 'zod'
import { themeIdSchema } from '@shared/appearance'
import { OPTION_COLORS, type OptionColor } from '@shared/data/fields'

/**
 * Temas de la interfaz (docs/DESIGN.md §3).
 *
 * Un tema es un conjunto de valores para los tokens semánticos. Se aplican como
 * variables CSS en <html>, así que cambiar de tema no recarga nada. El esquema
 * valida cada color, para que en el futuro los temas creados por el usuario
 * (SPEC §7.14) se puedan guardar y cargar sin riesgo.
 */

const color = z
  .string()
  .regex(/^(#[0-9a-f]{6}|rgba\(\d{1,3}, ?\d{1,3}, ?\d{1,3}, ?(0|1|0?\.\d+)\))$/i, 'Color no válido')

export const themeColorsSchema = z.object({
  bg: color,
  bgRaised: color,
  bgHover: color,
  text: color,
  textMuted: color,
  textFaint: color,
  line: color,
  lineStrong: color,
  accent: color,
  onAccent: color,
  accentText: color,
  index: color,
  marker: color,
  success: color,
  danger: color,
  warning: color,
  focus: color,
  shadow: color,
})
export type ThemeColors = z.infer<typeof themeColorsSchema>

/** Colores de las etiquetas de opciones (fondo y texto), con contraste AA. */
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'Color no válido')
const chip = z.object({ bg: hex, text: hex })
export const themeOptionsSchema = z.object(
  Object.fromEntries(OPTION_COLORS.map((c) => [c, chip])) as Record<OptionColor, typeof chip>,
)
export type ThemeOptions = z.infer<typeof themeOptionsSchema>

export const themeSchema = z.object({
  id: themeIdSchema,
  name: z.string().min(1).max(60),
  scheme: z.enum(['dark', 'light']),
  colors: themeColorsSchema,
  options: themeOptionsSchema,
})
export type Theme = z.infer<typeof themeSchema>

const PALETTE = {
  ink: '#0d0908',
  inkSoft: '#17100e',
  inkRaised: '#211815',
  inkMuted: '#5a4a43',
  paper: '#fdf6ee',
  paperSunken: '#f4ebe1',
  paperMuted: '#cbbeb5',
  peach: '#e0a47c',
  terracotta: '#bc6b4a',
  terracottaDeep: '#9c4f30',
  wine: '#7a2e27',
  ok: '#9fbf7a',
  okDeep: '#4f6b2e',
  danger: '#e8806a',
  dangerDeep: '#a3322a',
  warn: '#e6c06a',
  warnDeep: '#8a5a12',
} as const

export const BUILT_IN_THEMES: readonly Theme[] = [
  {
    id: 'oscuro',
    name: 'Oscuro',
    scheme: 'dark',
    colors: {
      bg: PALETTE.ink,
      bgRaised: PALETTE.inkSoft,
      bgHover: PALETTE.inkRaised,
      text: PALETTE.paper,
      textMuted: PALETTE.paperMuted,
      textFaint: '#a8978d',
      line: 'rgba(224, 164, 124, 0.22)',
      lineStrong: 'rgba(224, 164, 124, 0.45)',
      accent: PALETTE.peach,
      onAccent: PALETTE.ink,
      accentText: PALETTE.peach,
      index: PALETTE.terracotta,
      marker: PALETTE.terracotta,
      success: PALETTE.ok,
      danger: PALETTE.danger,
      warning: PALETTE.warn,
      focus: PALETTE.peach,
      shadow: 'rgba(0, 0, 0, 0.35)',
    },
    options: {
      gris: { bg: '#2a2422', text: '#d9cec7' },
      melocoton: { bg: '#3a2619', text: '#f0c3a3' },
      terracota: { bg: '#3d1f15', text: '#eb9c7d' },
      vino: { bg: '#3a1614', text: '#f0a39b' },
      ambar: { bg: '#3a2e12', text: '#ecd08a' },
      verde: { bg: '#1f2c17', text: '#b9d69a' },
      azul: { bg: '#16253a', text: '#9fc2ea' },
      lila: { bg: '#2b1d3a', text: '#cfb2ee' },
    },
  },
  {
    id: 'claro',
    name: 'Claro',
    scheme: 'light',
    colors: {
      bg: PALETTE.paper,
      bgRaised: PALETTE.paperSunken,
      bgHover: '#efe4d8',
      text: PALETTE.ink,
      textMuted: PALETTE.inkMuted,
      textFaint: '#6b5a52',
      line: 'rgba(13, 9, 8, 0.16)',
      lineStrong: 'rgba(13, 9, 8, 0.32)',
      accent: PALETTE.peach,
      onAccent: PALETTE.ink,
      accentText: PALETTE.terracottaDeep,
      index: PALETTE.terracottaDeep,
      marker: PALETTE.wine,
      success: PALETTE.okDeep,
      danger: PALETTE.dangerDeep,
      warning: PALETTE.warnDeep,
      focus: PALETTE.wine,
      shadow: 'rgba(13, 9, 8, 0.12)',
    },
    options: {
      gris: { bg: '#ece4dc', text: '#4a3f39' },
      melocoton: { bg: '#f7dcc7', text: '#7a3f1c' },
      terracota: { bg: '#f3d0c2', text: '#85361b' },
      vino: { bg: '#f0cfcb', text: '#7a2e27' },
      ambar: { bg: '#f5e5b8', text: '#6b4a0c' },
      verde: { bg: '#dcebc9', text: '#3b5321' },
      azul: { bg: '#d3e3f5', text: '#1f4470' },
      lila: { bg: '#e6daf3', text: '#4f2f78' },
    },
  },
]

export const DEFAULT_THEME = BUILT_IN_THEMES[0]!

export function findTheme(id: string, themes: readonly Theme[] = BUILT_IN_THEMES): Theme {
  return themes.find((t) => t.id === id) ?? DEFAULT_THEME
}

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** Variables CSS de un tema: { '--bg': '#0d0908', … } */
export function themeToCssVars(theme: Theme): Record<string, string> {
  return Object.fromEntries([
    ...Object.entries(theme.colors).map(([k, v]) => [`--${kebab(k)}`, v]),
    ...Object.entries(theme.options).flatMap(([k, v]) => [
      [`--opt-${k}-bg`, v.bg],
      [`--opt-${k}-text`, v.text],
    ]),
  ])
}
