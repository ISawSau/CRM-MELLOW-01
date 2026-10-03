import { z } from 'zod'
import type { RichText } from './fields'

/**
 * Plantillas de brief (SPEC §7.7). Se editan en Ajustes y también se pueden crear a
 * partir de un brief ya escrito. Crear un brief desde una plantilla genera su contenido
 * (un título por sección), pone la fecha de entrega y crea sus tareas ya enlazadas.
 */

export const SECTION_KINDS = ['text', 'list', 'links', 'files'] as const
export type SectionKind = (typeof SECTION_KINDS)[number]
export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  text: 'Texto',
  list: 'Lista',
  links: 'Enlaces a creatividades',
  files: 'Archivos',
}

const id = z.string().regex(/^[a-z0-9-]{1,64}$/)

export const briefTemplateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  sections: z
    .array(
      z.object({
        id,
        title: z.string().trim().min(1).max(120),
        kind: z.enum(SECTION_KINDS),
        hint: z.string().max(300).default(''),
      }),
    )
    .max(40),
  /** Entrega a los N días de crear el brief (null: sin fecha). */
  dueDays: z.number().int().min(0).max(365).nullable().default(null),
  /** Tareas que se crean enlazadas al brief, con su fecha límite relativa. */
  tasks: z
    .array(
      z.object({
        id,
        title: z.string().trim().min(1).max(200),
        dueDays: z.number().int().min(0).max(365).nullable().default(null),
      }),
    )
    .max(30)
    .default([]),
})
export type BriefTemplate = z.infer<typeof briefTemplateSchema>
export const briefTemplatesSchema = z.array(briefTemplateSchema).max(50)

export const DEFAULT_BRIEF_TEMPLATES: BriefTemplate[] = [
  {
    id: 'campana',
    name: 'Brief de campaña',
    sections: [
      {
        id: 'objetivo',
        title: 'Objetivo',
        kind: 'text',
        hint: 'Qué queremos conseguir y cómo lo mediremos.',
      },
      {
        id: 'publico',
        title: 'Público',
        kind: 'text',
        hint: 'A quién nos dirigimos: avatar, nivel de consciencia.',
      },
      {
        id: 'oferta',
        title: 'Oferta',
        kind: 'text',
        hint: 'Producto, precio, garantía, urgencia.',
      },
      {
        id: 'mensajes',
        title: 'Mensajes clave',
        kind: 'list',
        hint: 'Ángulos y hooks que queremos probar.',
      },
      {
        id: 'entregables',
        title: 'Entregables',
        kind: 'list',
        hint: 'Creatividades, formatos y proporciones.',
      },
      {
        id: 'referencias',
        title: 'Referencias',
        kind: 'links',
        hint: 'Anuncios o creatividades de referencia.',
      },
      {
        id: 'archivos',
        title: 'Archivos',
        kind: 'files',
        hint: 'Logos, fotos de producto, guías de marca.',
      },
    ],
    dueDays: 7,
    tasks: [
      { id: 'revisar', title: 'Revisar el brief con el cliente', dueDays: 2 },
      { id: 'creatividades', title: 'Preparar las creatividades', dueDays: 6 },
    ],
  },
]

type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string }

const text = (t: string): PMNode => ({ type: 'text', text: t })
const para = (t?: string): PMNode =>
  t ? { type: 'paragraph', content: [text(t)] } : { type: 'paragraph' }

/** Contenido inicial (documento de Tiptap) de un brief creado desde una plantilla. */
export function briefDocFromTemplate(t: BriefTemplate): RichText {
  const content: PMNode[] = []
  const plain: string[] = []
  for (const s of t.sections) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [text(s.title)] })
    plain.push(s.title)
    if (s.hint) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: s.hint, marks: [{ type: 'italic' }] } as PMNode],
      })
      plain.push(s.hint)
    }
    const where = FIELD_HINT[s.kind]
    if (where) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: where, marks: [{ type: 'italic' }] } as PMNode],
      })
      plain.push(where)
    }
    if (s.kind === 'list')
      content.push({ type: 'bulletList', content: [{ type: 'listItem', content: [para()] }] })
    else content.push(para())
  }
  return { doc: { type: 'doc', content }, text: plain.join('\n') }
}

/** Las secciones de enlaces y archivos se completan en los campos del brief. */
const FIELD_HINT: Partial<Record<SectionKind, string>> = {
  links: 'Enlaza las creatividades en el campo «Creatividades» de este brief.',
  files: 'Adjunta los archivos en el campo «Archivos» de este brief.',
}

const nodeText = (n: PMNode): string => n.text ?? (n.content ?? []).map(nodeText).join('')

const isItalicOnly = (n: PMNode): boolean =>
  n.type === 'paragraph' &&
  !!n.content?.length &&
  n.content.every(
    (c) =>
      c.type === 'text' &&
      ((c as { marks?: { type: string }[] }).marks ?? []).some((m) => m.type === 'italic'),
  )

/**
 * Plantilla a partir del contenido de un brief: cada título (H1-H3) es una sección; un
 * párrafo en cursiva justo debajo es su indicación y una lista la convierte en «Lista».
 */
export function templateFromBriefDoc(
  name: string,
  doc: unknown,
  newId: () => string,
): BriefTemplate {
  const nodes = ((doc as PMNode | null)?.content ?? []) as PMNode[]
  const sections: BriefTemplate['sections'] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!
    if (n.type !== 'heading') continue
    const title = nodeText(n).trim().slice(0, 120)
    if (!title) continue
    let hint = ''
    let kind: SectionKind = 'text'
    let j = i + 1
    // Hasta dos párrafos en cursiva: la indicación y el aviso de enlaces o archivos.
    while (j < i + 3 && nodes[j] && isItalicOnly(nodes[j]!)) {
      const h = nodeText(nodes[j]!).trim()
      const known = Object.entries(FIELD_HINT).find(([, v]) => v === h)
      if (known) kind = known[0] as SectionKind
      else if (!hint) hint = h.slice(0, 300)
      j++
    }
    if (nodes[j]?.type === 'bulletList' || nodes[j]?.type === 'orderedList') kind = 'list'
    sections.push({ id: newId(), title, kind, hint })
    if (sections.length === 40) break
  }
  return {
    id: newId(),
    name: name.trim().slice(0, 80) || 'Plantilla',
    sections,
    dueDays: null,
    tasks: [],
  }
}
