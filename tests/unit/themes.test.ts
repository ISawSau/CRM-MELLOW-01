import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_THEMES,
  findTheme,
  themeSchema,
  themeToCssVars,
  contrastIssues,
  parseColor,
  contrast as sharedContrast,
  exportTheme,
  importTheme,
  aiThemePrompt,
} from '../../src/shared/themes'

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

  it('el tema por defecto es Mellow y un id desconocido vuelve a él', () => {
    expect(BUILT_IN_THEMES[0]!.id).toBe('mellow')
    expect(findTheme('no-existe').id).toBe('mellow')
    // Mellow es flotante (estilo Hyprland); los clásicos siguen como antes.
    const m = themeToCssVars(findTheme('mellow'))
    expect(m).toMatchObject({ '--gap': '10px', '--radius-panel': '14px', '--panel-border': '2px' })
    expect(themeToCssVars(findTheme('oscuro'))).toMatchObject({
      '--gap': '0px',
      '--panel-blur': '0px',
    })
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

  it('contraste con opacidad y avisos de un tema propio', () => {
    expect(contrastIssues(findTheme('oscuro'))).toEqual([])
    expect(contrastIssues(findTheme('claro'))).toEqual([])
    expect(contrastIssues(findTheme('mellow'))).toEqual([])
    // Un amarillo de marca como texto sobre blanco no llega a AA.
    const t = findTheme('claro')
    const amarillo = { ...t, colors: { ...t.colors, bg: '#ffffff', accentText: '#f5d000' } }
    expect(contrastIssues(amarillo).map((i) => i.label)).toEqual(['Texto de acento sobre el fondo'])
    // Negro al 50 % sobre blanco se ve gris medio.
    expect(sharedContrast('rgba(0, 0, 0, 0.5)', '#ffffff')).toBeCloseTo(3.95, 1)
    expect(parseColor('rgba(10, 20, 30, 0.4)')).toEqual({ r: 10, g: 20, b: 30, a: 0.4 })
  })

  it('exportar e importar un tema (archivo o JSON de una IA), sin su fondo', () => {
    const t = {
      ...findTheme('claro'),
      id: 'propio-x',
      name: 'Marca',
      radius: 8,
      colors: { ...findTheme('claro').colors, icon: '#123456' },
      background: {
        fileId: 'a'.repeat(64),
        kind: 'image' as const,
        fit: 'cover' as const,
        dim: 0.5,
        blur: 4,
      },
    }
    const json = exportTheme(t)
    expect(json).not.toContain('propio-x')
    expect(json).not.toContain('a'.repeat(64))
    const r = importTheme(json, 'propio-nuevo')
    expect(r.ok && r.theme).toMatchObject({
      id: 'propio-nuevo',
      name: 'Marca',
      radius: 8,
      background: null,
    })
    expect(r.ok && r.theme.colors.icon).toBe('#123456')
    // Lo que responde una IA: solo el objeto del tema y dentro de un bloque de código.
    const solo = JSON.parse(json).tema
    expect(importTheme('```json\n' + JSON.stringify(solo) + '\n```', 'p2').ok).toBe(true)
    // Un color que no lo es se rechaza con un mensaje claro.
    const malo = importTheme(
      JSON.stringify({ ...solo, colors: { ...solo.colors, bg: 'red' } }),
      'p3',
    )
    expect(malo.ok ? '' : malo.error).toMatch(/colors\.bg/)
    // Los iconos de sección de los temas de la 0.13.1 y 0.13.2 (letras) se ignoran.
    const conLetras = importTheme(JSON.stringify({ ...solo, icons: { inicio: 'I' } }), 'p4')
    expect(conLetras.ok && 'icons' in conLetras.theme).toBe(false)
    expect(importTheme('esto no es json', 'p5')).toEqual({
      ok: false,
      error: 'No es un JSON válido.',
    })
    // Los temas guardados antes siguen valiendo (sin radio, fondo ni color de iconos).
    const viejo = { ...findTheme('oscuro'), id: 'propio-viejo' } as Record<string, unknown>
    delete viejo['radius']
    delete viejo['background']
    viejo['colors'] = { ...findTheme('oscuro').colors, icon: undefined, iconActive: undefined }
    expect(themeSchema.parse(viejo)).toMatchObject({ radius: 0, background: null })
    expect(themeToCssVars(themeSchema.parse(viejo))).not.toHaveProperty('--icon')
    expect(themeToCssVars(t)['--radius']).toBe('8px')
  })

  it('las instrucciones para la IA llevan la estructura y las reglas de contraste', () => {
    const p = aiThemePrompt(findTheme('oscuro'), 'amarillo y negro')
    expect(p).toContain('amarillo y negro')
    expect(p).toContain('"formato": "crm-mellow-tema"')
    expect(p).toContain('4,5:1')
  })
})
