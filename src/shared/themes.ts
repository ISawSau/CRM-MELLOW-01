import { z } from 'zod'
import { themeIdSchema } from './appearance'
import { OPTION_COLORS, type OptionColor } from './data/fields'
import { t } from './i18n'

/**
 * Temas de la interfaz (docs/DESIGN.md §3).
 *
 * Un tema es un conjunto de valores para los tokens semánticos. Se aplican como
 * variables CSS en <html>, así que cambiar de tema no recarga nada. El esquema
 * valida cada color, para que los temas creados por el usuario (SPEC §7.14, fase 12)
 * se puedan guardar y cargar sin riesgo.
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

/**
 * Fondo del tema: una imagen o un vídeo guardado (cifrado) en la bóveda, con un velo del
 * color de fondo encima para que el texto se siga leyendo.
 */
export const themeBackgroundSchema = z.object({
  fileId: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(['image', 'video']),
  fit: z.enum(['cover', 'contain']).default('cover'),
  /** Opacidad del velo del color de fondo (0: solo la imagen; 1: no se ve). */
  dim: z.number().min(0).max(1).default(0.7),
  /** Desenfoque en píxeles. */
  blur: z.number().int().min(0).max(30).default(0),
})
export type ThemeBackground = z.infer<typeof themeBackgroundSchema>

/** Icono de una sección: una o dos letras, una cifra o un emoji (sin controles). */
const iconSchema = z
  .string()
  .trim()
  .min(1)
  .max(8)
  .refine((s) => [...s].length <= 2 && !/[\p{Cc}<>]/u.test(s), 'Icono no válido')

export const themeSchema = z.object({
  id: themeIdSchema,
  name: z.string().min(1).max(60),
  scheme: z.enum(['dark', 'light']),
  colors: themeColorsSchema,
  options: themeOptionsSchema,
  /** Redondeo de esquinas de botones, campos, tarjetas y ventanas (px). */
  radius: z.number().int().min(0).max(24).default(0),
  background: themeBackgroundSchema.nullable().default(null),
  /** Iconos de la barra lateral por sección (id de sección → icono). */
  icons: z.record(z.string().regex(/^[a-z0-9-]{1,48}$/), iconSchema).default({}),
})
export type Theme = z.infer<typeof themeSchema>
export type ThemeInput = z.input<typeof themeSchema>

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
    radius: 0,
    background: null,
    icons: {},
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
    radius: 0,
    background: null,
    icons: {},
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
  return themes.find((th) => th.id === id) ?? DEFAULT_THEME
}

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** Variables CSS de un tema: { '--bg': '#0d0908', … } */
export function themeToCssVars(theme: Theme): Record<string, string> {
  return Object.fromEntries([
    ['--radius', `${theme.radius ?? 0}px`],
    ...Object.entries(theme.colors).map(([k, v]) => [`--${kebab(k)}`, v]),
    ...Object.entries(theme.options).flatMap(([k, v]) => [
      [`--opt-${k}-bg`, v.bg],
      [`--opt-${k}-text`, v.text],
    ]),
  ])
}

/** Temas propios del usuario (se guardan en la bóveda). */
export const MAX_CUSTOM_THEMES = 30
export const customThemesSchema = z
  .array(themeSchema)
  .max(MAX_CUSTOM_THEMES)
  .refine((list) => new Set(list.map((th) => th.id)).size === list.length, 'Hay temas repetidos.')
  .refine(
    (list) => list.every((th) => !BUILT_IN_THEMES.some((b) => b.id === th.id)),
    'Un tema propio no puede usar el id de uno predefinido.',
  )

// --- Contraste (WCAG 2.x) ---------------------------------------------------------------

/** Componentes RGB (0-255) y opacidad de un color «#rrggbb» o «rgba(r, g, b, a)». */
export function parseColor(c: string): { r: number; g: number; b: number; a: number } {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const [r = 0, g = 0, b = 0, a = 1] = (c.match(/[\d.]+/g) ?? []).map(Number)
  return { r, g, b, a }
}

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`
}

/** Un color con opacidad sobre un fondo opaco: el color que se ve. */
function over(c: string, bg: string): string {
  const f = parseColor(c)
  const b = parseColor(bg)
  return toHex(
    f.r * f.a + b.r * (1 - f.a),
    f.g * f.a + b.g * (1 - f.a),
    f.b * f.a + b.b * (1 - f.a),
  )
}

function luminance(hex: string): number {
  const { r, g, b } = parseColor(hex)
  const lin = (x: number) => {
    const c = x / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Relación de contraste entre un color (puede llevar opacidad) y un fondo opaco. */
export function contrast(fg: string, bg: string): number {
  const [x, y] = [luminance(over(fg, bg)), luminance(bg)].sort((m, n) => n - m)
  return (x! + 0.05) / (y! + 0.05)
}

export interface ContrastIssue {
  label: string
  ratio: number
  min: number
}

const OPTION_LABELS: Record<OptionColor, string> = {
  gris: 'gris',
  melocoton: 'melocotón',
  terracota: 'terracota',
  vino: 'vino',
  ambar: 'ámbar',
  verde: 'verde',
  azul: 'azul',
  lila: 'lila',
}

/** Parejas de texto y fondo que no llegan al contraste AA (4,5:1). */
export function contrastIssues(theme: Theme): ContrastIssue[] {
  const c = theme.colors
  const pairs: [string, string, string][] = [
    [t('Texto sobre el fondo'), c.text, c.bg],
    [t('Texto sobre las superficies'), c.text, c.bgRaised],
    [t('Texto secundario sobre el fondo'), c.textMuted, c.bg],
    [t('Texto secundario sobre las superficies'), c.textMuted, c.bgRaised],
    [t('Texto tenue sobre el fondo'), c.textFaint, c.bg],
    [t('Texto de acento sobre el fondo'), c.accentText, c.bg],
    [t('Texto sobre el botón de acento'), c.onAccent, c.accent],
    [t('Numeración sobre el fondo'), c.index, c.bg],
    [t('Correcto sobre el fondo'), c.success, c.bg],
    [t('Error sobre el fondo'), c.danger, c.bg],
    [t('Aviso sobre el fondo'), c.warning, c.bg],
    ...OPTION_COLORS.map((o): [string, string, string] => [
      t('Etiqueta {color}', { color: t(OPTION_LABELS[o]) }),
      theme.options[o].text,
      theme.options[o].bg,
    ]),
  ]
  return pairs
    .map(([label, fg, bg]) => ({ label, ratio: contrast(fg, bg), min: 4.5 }))
    .filter((p) => p.ratio < p.min)
}

// --- Importar y exportar --------------------------------------------------------------

export const THEME_FILE_FORMAT = 'crm-mellow-tema'

/** Tema listo para compartir: sin id ni fondo (el fondo es un archivo de esta bóveda). */
export function exportTheme(theme: Theme): string {
  const tema: Partial<Theme> = { ...theme }
  delete tema.id
  delete tema.background
  return JSON.stringify({ formato: THEME_FILE_FORMAT, version: 1, tema }, null, 2)
}

/**
 * Lee un tema exportado (o el JSON que haya escrito una IA): admite el archivo completo o
 * solo el objeto del tema. Devuelve el tema con un id nuevo o un error en español.
 */
export function importTheme(
  text: string,
  newId: string,
): { ok: true; theme: Theme } | { ok: false; error: string } {
  let raw: unknown
  try {
    // Una IA suele envolverlo en un bloque de código: se quita.
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return { ok: false, error: t('No es un JSON válido.') }
  }
  const obj = raw as Record<string, unknown> | null
  const candidate = obj && typeof obj === 'object' && 'tema' in obj ? (obj['tema'] as unknown) : raw
  const r = themeSchema.safeParse({
    ...(candidate as object),
    id: newId,
    background: null,
  })
  if (!r.success) {
    const first = r.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || t('tema')}: ${t(i.message)}`)
      .join('; ')
    return { ok: false, error: t('El tema no es válido ({detail}).', { detail: first }) }
  }
  return { ok: true, theme: r.data }
}

/** Instrucciones para pedir un tema a cualquier IA y pegarlo después en «Importar». */
export function aiThemePrompt(example: Theme, wish: string): string {
  return [
    t('Crea un tema de colores para mi app de escritorio CRM Mellow.'),
    wish.trim() ? t('Lo que quiero: {wish}', { wish: wish.trim() }) : '',
    t('Responde SOLO con un JSON con exactamente esta estructura (mismas claves):'),
    exportTheme(example),
    t('Reglas:'),
    t(
      '- Colores en formato #rrggbb (minúsculas). Solo "line", "lineStrong" y "shadow" pueden ser rgba(r, g, b, a).',
    ),
    t('- "scheme" es "dark" o "light" según el fondo.'),
    t(
      '- Contraste mínimo 4,5:1 entre cada texto y su fondo: text, textMuted, textFaint, accentText, index, success, danger y warning sobre bg; onAccent sobre accent; y en "options", text sobre bg.',
    ),
    t('- "radius" son píxeles de redondeo de esquinas (0 a 24).'),
    t(
      '- "icons" puede quedar vacío o dar 1-2 caracteres (letra o emoji) por sección, con estas claves: perfil, inicio, notas, clientes, contactos, tareas, briefs, campanas, plataformas, creatividades, analisis, facturacion, facturas, gastos, informes, documentos, herramientas.',
    ),
  ]
    .filter(Boolean)
    .join('\n')
}
