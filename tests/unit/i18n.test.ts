import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatCurrency, formatDate, formatNumber, parseNumberEs } from '../../src/shared/format'
import { hasTranslation, setLocale, t, tc, tn } from '../../src/shared/i18n'

/** Todos los .ts y .tsx de una carpeta. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'i18n' ? [] : files(p)
    return /\.tsx?$/.test(n) ? [p] : []
  })
}

/** Textos literales que se pasan a t() y tn() en el código. */
function keys(): { file: string; key: string }[] {
  const out: { file: string; key: string }[] = []
  const lit = String.raw`(['"\x60])((?:\\.|(?!\1)[^\\])*)\1`
  const one = new RegExp(String.raw`\bt\(\s*` + lit, 'g')
  // tc('contexto', 'texto'): basta con que exista el texto (el contexto es opcional).
  const ctx = new RegExp(String.raw`\btc\(\s*'[^']+',\s*` + lit, 'g')
  const plural = new RegExp(String.raw`\btn\([^,()]+,\s*` + lit + String.raw`\s*,\s*` + lit, 'g')
  for (const file of files('src')) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(one)) out.push({ file, key: m[2]! })
    for (const m of src.matchAll(plural)) out.push({ file, key: m[2]! }, { file, key: m[4]! })
    for (const m of src.matchAll(ctx)) out.push({ file, key: m[2]! })
  }
  return out.map((k) => ({ ...k, key: k.key.replace(/\\'/g, "'").replace(/\\"/g, '"') }))
}

describe('traducciones', () => {
  afterEach(() => setLocale('es'))

  it('t() deja el español, traduce al inglés y pone las variables', () => {
    expect(t('Idioma')).toBe('Idioma')
    setLocale('en')
    expect(t('Idioma')).toBe('Language')
    expect(t('Texto que no está en el diccionario')).toBe('Texto que no está en el diccionario')
    expect(t('{n} de {total} pasos', { n: 2, total: 5 })).toBe('2 of 5 steps')
    expect(tn(1, '{n} cuenta', '{n} cuentas')).toBe('1 account')
    expect(tn(3, '{n} cuenta', '{n} cuentas')).toBe('3 accounts')
    expect(tc('facturacion', 'Beneficio')).toBe('Profit')
    expect(tc('otro', 'Beneficio')).toBe('Benefit')
  })

  it('formatos: España o británico según el idioma', () => {
    expect(formatNumber(1234.5, 2)).toBe('1.234,50')
    expect(formatDate(new Date('2026-10-03T12:00:00Z'))).toBe('03/10/2026')
    setLocale('en')
    expect(formatNumber(1234.5, 2)).toBe('1,234.50')
    expect(formatCurrency(1234.5, 'EUR')).toBe('€1,234.50')
    expect(formatDate(new Date('2026-10-03T12:00:00Z'))).toBe('03/10/2026')
    expect(parseNumberEs('1,234.56')).toBe(1234.56)
  })

  it('cada texto de t() tiene su traducción y ninguno usa ${} (van como variables)', () => {
    const found = keys()
    expect(found.length).toBeGreaterThan(1300)
    const dynamic = found.filter((k) => k.key.includes('${'))
    expect(dynamic.map((k) => `${k.file}: ${k.key}`)).toEqual([])
    const missing = [
      ...new Set(found.filter((k) => !hasTranslation(k.key)).map((k) => `${k.file}: ${k.key}`)),
    ]
    expect(missing).toEqual([])
  })
})
