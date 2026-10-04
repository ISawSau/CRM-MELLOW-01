/** Utilidades de texto compartidas por el motor de datos. */

/** Minúsculas y sin tildes: para buscar y filtrar («Campaña» = «campana»). */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const BLOCK_NODES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
])

/** Texto plano de un documento de Tiptap (JSON de ProseMirror). */
export function richTextToPlain(doc: unknown, depth = 0): string {
  if (depth > 100 || doc === null || typeof doc !== 'object') return ''
  const node = doc as { type?: unknown; text?: unknown; content?: unknown }
  if (node.type === 'text' && typeof node.text === 'string') return node.text
  if (node.type === 'hardBreak') return '\n'
  if (!Array.isArray(node.content)) return ''
  const inner = node.content.map((c) => richTextToPlain(c, depth + 1))
  const joined = inner.join('')
  return typeof node.type === 'string' && BLOCK_NODES.has(node.type) ? `${joined}\n` : joined
}

// Letras sin acento de mayúsculas (ª, º, hebreo, árabe, devanagari, tailandés, kana, CJK, hangul).
const UNCASED_LETTER =
  /[\u00aa\u00ba\u01bb\u01c0-\u01c3\u0294\u05d0-\u05ea\u0620-\u064a\u0671-\u06d3\u0904-\u0939\u0e01-\u0e30\u3041-\u3096\u30a1-\u30fa\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3]/
const DIGIT = /[0-9\u00b2\u00b3\u00b9\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\uff10-\uff19]/

/**
 * ¿Es una letra? Sin `\p{L}`: el Node de la app de Android no trae ICU y no entiende las
 * propiedades Unicode en las expresiones regulares (D-101).
 */
export function isLetter(c: string): boolean {
  return c.toLowerCase() !== c.toUpperCase() || UNCASED_LETTER.test(c)
}

export function isDigit(c: string): boolean {
  return DIGIT.test(c)
}

/** Las palabras (letras y cifras seguidas) de un texto. */
export function words(s: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of s) {
    if (isLetter(ch) || isDigit(ch)) cur += ch
    else if (cur) {
      out.push(cur)
      cur = ''
    }
  }
  if (cur) out.push(cur)
  return out
}

/** Colator español para ordenar (ñ después de n, sin distinguir mayúsculas). */
export const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })
