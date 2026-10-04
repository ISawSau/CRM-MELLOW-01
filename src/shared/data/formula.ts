/**
 * Fórmulas de usuario (SPEC §6, CLAUDE.md: «parser seguro, nunca eval»).
 *
 * Parser y evaluador propios, sin dependencias. Seguridad por diseño:
 * - no existe acceso a propiedades (no hay `.` ni `[]`), así que no se puede llegar
 *   a `constructor`, `__proto__` ni a nada del entorno de JavaScript;
 * - los campos y las funciones se buscan en `Map` (nunca en objetos), así que
 *   nombres como `toString` o `constructor` simplemente no existen;
 * - las funciones son una lista cerrada; no se pueden definir ni pasar funciones;
 * - límites de longitud, de tokens y de profundidad contra fórmulas abusivas.
 *
 * Sintaxis (como Excel en español):
 *   importe * 1,21            ← no: los decimales van con punto: importe * 1.21
 *   SI(gasto > 0; valor / gasto; 0)    argumentos separados por ; o ,
 *   "Hola " & nombre                   & concatena texto
 *   = <> != < <= > >=                  comparaciones
 *   VERDADERO, FALSO
 */

import { t } from '../i18n'
import { isDigit, isLetter } from './text'

export type FormulaValue = number | string | boolean | null

export class FormulaError extends Error {
  /** `message` va en español; se traduce al idioma de la interfaz (variables entre llaves). */
  constructor(message: string, vars?: Record<string, string | number>) {
    super(t(message, vars))
    this.name = 'FormulaError'
  }
}

const MAX_LENGTH = 2000
const MAX_TOKENS = 1000
const MAX_DEPTH = 64

// --- Lexer ----------------------------------------------------------------------

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: '('; v: '(' }
  | { t: ')'; v: ')' }
  | { t: ','; v: ',' }
  | { t: 'end'; v: '' }

const OPERATORS = ['<=', '>=', '<>', '!=', '+', '-', '*', '/', '%', '^', '&', '=', '<', '>']

function tokenize(src: string): Token[] {
  if (src.length > MAX_LENGTH)
    throw new FormulaError('La fórmula es demasiado larga (máximo {max} caracteres).', {
      max: MAX_LENGTH,
    })
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|^[0-9]+\.?/.exec(src.slice(i))!
      out.push({ t: 'num', v: Number(m[0]) })
      i += m[0].length
    } else if (c === '"') {
      let s = ''
      i++
      while (true) {
        if (i >= src.length) throw new FormulaError('Falta cerrar unas comillas.')
        const ch = src[i]!
        if (ch === '"') {
          if (src[i + 1] === '"') {
            s += '"'
            i += 2
            continue
          }
          i++
          break
        }
        s += ch
        i++
      }
      out.push({ t: 'str', v: s })
    } else if (c === '_' || isLetter(c)) {
      let j = i + 1
      while (j < src.length && (src[j] === '_' || isLetter(src[j]!) || isDigit(src[j]!))) j++
      out.push({ t: 'id', v: src.slice(i, j) })
      i = j
    } else if (c === '(') {
      out.push({ t: '(', v: '(' })
      i++
    } else if (c === ')') {
      out.push({ t: ')', v: ')' })
      i++
    } else if (c === ',' || c === ';') {
      out.push({ t: ',', v: ',' })
      i++
    } else {
      const op = OPERATORS.find((o) => src.startsWith(o, i))
      if (!op) throw new FormulaError('Carácter no válido: «{c}».', { c })
      out.push({ t: 'op', v: op })
      i += op.length
    }
    if (out.length > MAX_TOKENS) throw new FormulaError('La fórmula es demasiado compleja.')
  }
  out.push({ t: 'end', v: '' })
  return out
}

// --- Parser ---------------------------------------------------------------------

export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'field'; key: string }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'unary'; op: string; x: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }

/** Quita tildes y pasa a mayúsculas: «Promedio» y «PROMEDIO» son la misma función. */
function canonical(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
}

export function parseFormula(src: string): Node {
  const tokens = tokenize(src)
  let pos = 0
  let depth = 0
  const peek = () => tokens[pos]!
  const next = () => tokens[pos++]!
  const enter = () => {
    if (++depth > MAX_DEPTH) throw new FormulaError('La fórmula tiene demasiados niveles.')
  }

  const expectOp = (...ops: string[]) => {
    const t = peek()
    return t.t === 'op' && ops.includes(t.v)
  }
  /** Consume el operador que `expectOp` acaba de comprobar. */
  const nextOp = (): string => String(next().v)

  function comparison(): Node {
    let a = concat()
    while (expectOp('=', '<>', '!=', '<', '<=', '>', '>=')) {
      const raw = nextOp()
      a = { k: 'bin', op: raw === '!=' ? '<>' : raw, a, b: concat() }
    }
    return a
  }
  function concat(): Node {
    let a = additive()
    while (expectOp('&')) {
      next()
      a = { k: 'bin', op: '&', a, b: additive() }
    }
    return a
  }
  function additive(): Node {
    let a = multiplicative()
    while (expectOp('+', '-')) {
      const op = nextOp()
      a = { k: 'bin', op, a, b: multiplicative() }
    }
    return a
  }
  function multiplicative(): Node {
    let a = power()
    while (expectOp('*', '/', '%')) {
      const op = nextOp()
      a = { k: 'bin', op, a, b: power() }
    }
    return a
  }
  function power(): Node {
    const a = unary()
    if (expectOp('^')) {
      next()
      return { k: 'bin', op: '^', a, b: power() }
    }
    return a
  }
  function unary(): Node {
    if (expectOp('-', '+')) {
      const op = nextOp()
      enter()
      const x = unary()
      depth--
      return { k: 'unary', op, x }
    }
    return primary()
  }
  function primary(): Node {
    const t = next()
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v }
      case 'str':
        return { k: 'str', v: t.v }
      case '(': {
        enter()
        const e = comparison()
        depth--
        if (next().t !== ')') throw new FormulaError('Falta cerrar un paréntesis.')
        return e
      }
      case 'id': {
        const up = canonical(t.v)
        if (peek().t === '(') {
          next()
          enter()
          const args: Node[] = []
          if (peek().t !== ')') {
            do {
              args.push(comparison())
            } while (peek().t === ',' && next())
          }
          depth--
          if (next().t !== ')')
            throw new FormulaError('Falta cerrar el paréntesis de {name}.', { name: up })
          if (!FUNCTIONS.has(up))
            throw new FormulaError('La función {name} no existe.', { name: t.v })
          return { k: 'call', name: up, args }
        }
        if (up === 'VERDADERO' || up === 'TRUE') return { k: 'bool', v: true }
        if (up === 'FALSO' || up === 'FALSE') return { k: 'bool', v: false }
        return { k: 'field', key: t.v }
      }
      case 'end':
        throw new FormulaError('La fórmula está incompleta.')
      default:
        throw new FormulaError('No se esperaba «{token}».', { token: t.v })
    }
  }

  const ast = comparison()
  if (peek().t !== 'end') throw new FormulaError('No se esperaba «{token}».', { token: peek().v })
  return ast
}

/** Claves de campo que usa la fórmula (para dependencias y ciclos). */
export function formulaReferences(node: Node, out = new Set<string>()): Set<string> {
  switch (node.k) {
    case 'field':
      out.add(node.key)
      break
    case 'call':
      node.args.forEach((a) => formulaReferences(a, out))
      break
    case 'unary':
      formulaReferences(node.x, out)
      break
    case 'bin':
      formulaReferences(node.a, out)
      formulaReferences(node.b, out)
      break
  }
  return out
}

// --- Evaluación -----------------------------------------------------------------

function toNumber(v: FormulaValue): number {
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(v.trim().replace(',', '.'))
  if (v.trim() === '' || !Number.isFinite(n))
    throw new FormulaError('Se esperaba un número y llegó «{value}».', { value: v })
  return n
}

function toText(v: FormulaValue): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO'
  if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10)
  return v
}

function truthy(v: FormulaValue): boolean {
  if (v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return v.length > 0
}

function compare(a: FormulaValue, b: FormulaValue): number {
  if (typeof a === 'number' || typeof b === 'number') {
    if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1
    return toNumber(a) - toNumber(b)
  }
  return toText(a).localeCompare(toText(b), 'es', { sensitivity: 'base' })
}

const DAY_MS = 86_400_000
function dateToDays(v: FormulaValue): number {
  const s = toText(v)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) throw new FormulaError('Se esperaba una fecha y llegó «{value}».', { value: s })
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS
}

function finite(n: number): number {
  if (!Number.isFinite(n)) throw new FormulaError('El resultado no es un número válido.')
  return n
}

export interface EvalContext {
  /** Valores de los campos por clave. */
  fields: ReadonlyMap<string, FormulaValue>
  /** Fecha de hoy (AAAA-MM-DD) en la zona horaria del usuario. */
  today: string
}

type Fn = (args: Node[], ctx: EvalContext, ev: (n: Node) => FormulaValue) => FormulaValue

const all = (args: Node[], ev: (n: Node) => FormulaValue) => args.map(ev)
const arity = (name: string, args: Node[], min: number, max = min) => {
  if (args.length < min || args.length > max) {
    if (min === max)
      throw new FormulaError(
        max === 1 ? '{name} necesita {n} argumento.' : '{name} necesita {n} argumentos.',
        { name, n: min },
      )
    throw new FormulaError(
      max === 1
        ? '{name} necesita entre {min} y {max} argumento.'
        : '{name} necesita entre {min} y {max} argumentos.',
      { name, min, max },
    )
  }
}

/** Funciones disponibles (lista cerrada). Nombres como en Excel en español. */
const FUNCTIONS = new Map<string, Fn>([
  [
    'SI',
    (a, _c, ev) => {
      arity('SI', a, 2, 3)
      return truthy(ev(a[0]!)) ? ev(a[1]!) : a[2] ? ev(a[2]) : null
    },
  ],
  ['Y', (a, _c, ev) => a.length > 0 && a.every((x) => truthy(ev(x)))],
  ['O', (a, _c, ev) => a.some((x) => truthy(ev(x)))],
  [
    'NO',
    (a, _c, ev) => {
      arity('NO', a, 1)
      return !truthy(ev(a[0]!))
    },
  ],
  [
    'REDONDEAR',
    (a, _c, ev) => {
      arity('REDONDEAR', a, 1, 2)
      const d = a[1] ? Math.trunc(toNumber(ev(a[1]))) : 0
      if (d < 0 || d > 10) throw new FormulaError('REDONDEAR admite de 0 a 10 decimales.')
      const f = 10 ** d
      return Math.round(toNumber(ev(a[0]!)) * f) / f
    },
  ],
  [
    'ABS',
    (a, _c, ev) => {
      arity('ABS', a, 1)
      return Math.abs(toNumber(ev(a[0]!)))
    },
  ],
  ['MIN', (a, _c, ev) => (a.length ? Math.min(...all(a, ev).map(toNumber)) : null)],
  ['MAX', (a, _c, ev) => (a.length ? Math.max(...all(a, ev).map(toNumber)) : null)],
  ['SUMA', (a, _c, ev) => all(a, ev).reduce<number>((s, v) => s + toNumber(v), 0)],
  [
    'PROMEDIO',
    (a, _c, ev) => {
      const vs = all(a, ev).filter((v) => v !== null)
      return vs.length ? vs.reduce<number>((s, v) => s + toNumber(v), 0) / vs.length : null
    },
  ],
  [
    'LARGO',
    (a, _c, ev) => {
      arity('LARGO', a, 1)
      return toText(ev(a[0]!)).length
    },
  ],
  ['CONCATENAR', (a, _c, ev) => all(a, ev).map(toText).join('')],
  [
    'MAYUSC',
    (a, _c, ev) => {
      arity('MAYUSC', a, 1)
      return toText(ev(a[0]!)).toLocaleUpperCase('es')
    },
  ],
  [
    'MINUSC',
    (a, _c, ev) => {
      arity('MINUSC', a, 1)
      return toText(ev(a[0]!)).toLocaleLowerCase('es')
    },
  ],
  [
    'HOY',
    (a, c) => {
      arity('HOY', a, 0)
      return c.today
    },
  ],
  [
    'DIAS',
    (a, _c, ev) => {
      arity('DIAS', a, 2)
      const fin = ev(a[0]!)
      const ini = ev(a[1]!)
      if (fin === null || ini === null) return null
      return dateToDays(fin) - dateToDays(ini)
    },
  ],
  [
    'ESBLANCO',
    (a, _c, ev) => {
      arity('ESBLANCO', a, 1)
      const v = ev(a[0]!)
      return v === null || v === ''
    },
  ],
])

/** Nombres de las funciones, para la ayuda del editor. */
export const FORMULA_FUNCTIONS = [...FUNCTIONS.keys()]

export function evaluate(node: Node, ctx: EvalContext): FormulaValue {
  const ev = (n: Node): FormulaValue => {
    switch (n.k) {
      case 'num':
        return n.v
      case 'str':
        return n.v
      case 'bool':
        return n.v
      case 'field': {
        if (!ctx.fields.has(n.key))
          throw new FormulaError('No existe ningún campo «{key}».', { key: n.key })
        return ctx.fields.get(n.key) ?? null
      }
      case 'call':
        return FUNCTIONS.get(n.name)!(n.args, ctx, ev)
      case 'unary': {
        const x = toNumber(ev(n.x))
        return n.op === '-' ? -x : x
      }
      case 'bin': {
        const a = ev(n.a)
        const b = ev(n.b)
        switch (n.op) {
          case '+':
            return finite(toNumber(a) + toNumber(b))
          case '-':
            return finite(toNumber(a) - toNumber(b))
          case '*':
            return finite(toNumber(a) * toNumber(b))
          case '/': {
            const d = toNumber(b)
            if (d === 0) throw new FormulaError('División entre cero.')
            return finite(toNumber(a) / d)
          }
          case '%': {
            const d = toNumber(b)
            if (d === 0) throw new FormulaError('División entre cero.')
            return finite(toNumber(a) % d)
          }
          case '^':
            return finite(toNumber(a) ** toNumber(b))
          case '&':
            return toText(a) + toText(b)
          case '=':
            return compare(a, b) === 0
          case '<>':
            return compare(a, b) !== 0
          case '<':
            return compare(a, b) < 0
          case '<=':
            return compare(a, b) <= 0
          case '>':
            return compare(a, b) > 0
          case '>=':
            return compare(a, b) >= 0
        }
        throw new FormulaError('Operador desconocido «{op}».', { op: n.op })
      }
    }
  }
  return ev(node)
}

export type FormulaResult = { ok: true; value: FormulaValue } | { ok: false; error: string }

/** Analiza y evalúa en un paso; nunca lanza. */
export function runFormula(src: string, ctx: EvalContext): FormulaResult {
  try {
    if (src.trim() === '') return { ok: true, value: null }
    return { ok: true, value: evaluate(parseFormula(src), ctx) }
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message }
    return { ok: false, error: t('Error en la fórmula.') }
  }
}
