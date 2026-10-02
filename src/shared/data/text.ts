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

/** Colator español para ordenar (ñ después de n, sin distinguir mayúsculas). */
export const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })
