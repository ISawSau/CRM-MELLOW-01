import { describe, expect, it } from 'vitest'
import {
  formulaReferences,
  parseFormula,
  runFormula,
  type FormulaValue,
} from '../../src/shared/data/formula'
import { words } from '../../src/shared/data/text'

const ctx = (fields: Record<string, FormulaValue> = {}) => ({
  fields: new Map(Object.entries(fields)),
  today: '2026-10-02',
})
const run = (src: string, fields: Record<string, FormulaValue> = {}) => runFormula(src, ctx(fields))
const value = (src: string, fields: Record<string, FormulaValue> = {}) => {
  const r = run(src, fields)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('fórmulas: aritmética y prioridad', () => {
  it('respeta la prioridad de operadores', () => {
    expect(value('2 + 3 * 4')).toBe(14)
    expect(value('(2 + 3) * 4')).toBe(20)
    expect(value('2 ^ 3 ^ 2')).toBe(512)
    expect(value('-2 ^ 2')).toBe(4)
    expect(value('10 % 3')).toBe(1)
  })

  it('usa los campos por su clave', () => {
    expect(
      value('valor_compras - gasto - fee', { valor_compras: 1000, gasto: 400, fee: 100 }),
    ).toBe(500)
  })

  it('un campo vacío cuenta como 0 en operaciones', () => {
    expect(value('gasto + 1', { gasto: null })).toBe(1)
  })

  it('la división entre cero es un error, no Infinity', () => {
    expect(run('1 / 0')).toEqual({ ok: false, error: 'División entre cero.' })
  })
})

describe('fórmulas: funciones en español', () => {
  it('SI, Y, O, NO', () => {
    expect(value('SI(gasto > 0; valor / gasto; 0)', { gasto: 50, valor: 200 })).toBe(4)
    expect(value('SI(gasto > 0, valor / gasto, 0)', { gasto: 0, valor: 200 })).toBe(0)
    expect(value('Y(1 > 0; 2 > 1)')).toBe(true)
    expect(value('O(1 > 2; FALSO)')).toBe(false)
    expect(value('NO(VERDADERO)')).toBe(false)
  })

  it('SI no evalúa la rama que no se usa (no hay división entre cero)', () => {
    expect(value('SI(gasto = 0; 0; valor / gasto)', { gasto: 0, valor: 1 })).toBe(0)
  })

  it('números, texto y fechas', () => {
    expect(value('REDONDEAR(2.345; 2)')).toBe(2.35)
    expect(value('SUMA(1; 2; 3)')).toBe(6)
    expect(value('PROMEDIO(2; 4)')).toBe(3)
    expect(value('MIN(3; 1; 2)')).toBe(1)
    expect(value('"ROAS: " & 2.5')).toBe('ROAS: 2.5')
    expect(value('MAYUSC("campaña")')).toBe('CAMPAÑA')
    expect(value('LARGO("hola")')).toBe(4)
    expect(value('DIAS(HOY(); "2026-09-30")')).toBe(2)
    expect(value('ESBLANCO(x)', { x: null })).toBe(true)
  })

  it('los nombres de función no distinguen mayúsculas ni tildes', () => {
    expect(value('suma(1; 1)')).toBe(2)
    expect(value('Días("2026-01-02"; "2026-01-01")')).toBe(1)
  })

  it('compara texto sin distinguir mayúsculas', () => {
    expect(value('tipo = "idea"', { tipo: 'Idea' })).toBe(true)
  })
})

describe('fórmulas: errores claros', () => {
  it.each([
    ['1 +', 'La fórmula está incompleta.'],
    ['(1 + 2', 'Falta cerrar un paréntesis.'],
    ['"hola', 'Falta cerrar unas comillas.'],
    ['FOO(1)', 'La función FOO no existe.'],
    ['noexiste + 1', 'No existe ningún campo «noexiste».'],
    ['1 $ 2', 'Carácter no válido: «$».'],
    ['SI(1)', 'SI necesita entre 2 y 3 argumentos.'],
  ])('%s', (src, error) => {
    expect(run(src)).toEqual({ ok: false, error })
  })

  it('texto donde se espera un número', () => {
    const r = run('nombre * 2', { nombre: 'Ana' })
    expect(r.ok).toBe(false)
  })
})

describe('fórmulas: seguridad', () => {
  it.each([
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'process',
    'globalThis',
    'require',
    'window',
  ])('«%s» no da acceso a nada de JavaScript', (name) => {
    expect(run(name)).toEqual({ ok: false, error: `No existe ningún campo «${name}».` })
    expect(run(`${name}()`).ok).toBe(false)
  })

  it('no hay acceso a propiedades ni índices', () => {
    expect(run('x.constructor').ok).toBe(false)
    expect(run('x["constructor"]').ok).toBe(false)
    expect(run('SI.constructor(1)').ok).toBe(false)
  })

  it('no se pueden escribir funciones ni código', () => {
    for (const src of [
      'function(){}',
      '() => 1',
      '`${1}`',
      'eval("1")',
      'new Function("return 1")',
      '1; process.exit()',
    ]) {
      expect(run(src).ok, src).toBe(false)
    }
  })

  it('una fórmula enorme o muy anidada se rechaza sin colgarse', () => {
    expect(run('1+'.repeat(1500) + '1').ok).toBe(false)
    expect(run('('.repeat(200) + '1' + ')'.repeat(200)).ok).toBe(false)
  })

  it('el valor de un campo nunca se interpreta como fórmula', () => {
    expect(value('x & ""', { x: 'SUMA(1;2)' })).toBe('SUMA(1;2)')
  })
})

describe('referencias', () => {
  it('lista los campos que usa la fórmula', () => {
    const refs = formulaReferences(parseFormula('SI(a > 0; b * c; a)'))
    expect([...refs].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('nombres de campo con letras de cualquier idioma', () => {
  // Sin `\p{L}` en las expresiones regulares: el Node de Android no las entiende (D-101).
  it('admite tildes, eñes, guiones bajos y cifras', () => {
    expect(value('campaña_2 + Δx + _ñu', { campaña_2: 1, Δx: 2, _ñu: 3 })).toBe(6)
    const refs = formulaReferences(parseFormula('año1 * 名前'))
    expect([...refs].sort()).toEqual(['año1', '名前'])
  })

  it('separa las palabras de un texto para buscar', () => {
    expect(words('hola, Ñandú 2026-10 «café»')).toEqual(['hola', 'Ñandú', '2026', '10', 'café'])
  })
})
