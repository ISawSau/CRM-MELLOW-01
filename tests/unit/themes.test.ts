import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_THEMES,
  findTheme,
  themeSchema,
  themeToCssVars,
} from '../../src/renderer/src/theme/themes'

// Contraste WCAG 2.x entre dos colores hexadecimales.
function luminance(hex: string): number {
  const [r, g, b] = hex
    .slice(1)
    .match(/../g)!
    .map((x) => parseInt(x, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x! + 0.05) / (y! + 0.05)
}

describe('temas', () => {
  it('los temas predefinidos son válidos y tienen ids únicos', () => {
    for (const t of BUILT_IN_THEMES) expect(themeSchema.safeParse(t).success, t.id).toBe(true)
    expect(new Set(BUILT_IN_THEMES.map((t) => t.id)).size).toBe(BUILT_IN_THEMES.length)
  })

  it('el tema por defecto es el oscuro y un id desconocido vuelve a él', () => {
    expect(BUILT_IN_THEMES[0]!.id).toBe('oscuro')
    expect(findTheme('no-existe').id).toBe('oscuro')
  })

  it('genera las variables CSS de DESIGN.md', () => {
    const vars = themeToCssVars(findTheme('oscuro'))
    expect(vars['--bg']).toBe('#0d0908')
    expect(vars['--on-accent']).toBe('#0d0908')
    expect(vars['--accent-text']).toBe('#e0a47c')
    expect(vars['--opt-azul-bg']).toBe('#16253a')
  })

  it('rechaza colores no válidos (los temas propios futuros se validan igual)', () => {
    const bad = { ...findTheme('oscuro'), colors: { ...findTheme('oscuro').colors, bg: 'red' } }
    expect(themeSchema.safeParse(bad).success).toBe(false)
  })

  it.each(BUILT_IN_THEMES.map((t) => [t.id, t] as const))(
    'contraste AA en el tema %s',
    (_id, t) => {
      const c = t.colors
      expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(7)
      expect(contrast(c.textMuted, c.bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.textMuted, c.bgRaised)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.textFaint, c.bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.accentText, c.bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.index, c.bg)).toBeGreaterThanOrEqual(4.5)
      for (const s of [c.success, c.danger, c.warning]) {
        expect(contrast(s, c.bg)).toBeGreaterThanOrEqual(4.5)
      }
      for (const [name, o] of Object.entries(t.options)) {
        expect(contrast(o.text, o.bg), name).toBeGreaterThanOrEqual(4.5)
      }
    },
  )
})
