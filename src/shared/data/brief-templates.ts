import { z } from 'zod'
import type { RichText } from './fields'

/**
 * Plantillas de brief (SPEC §7.7). La estructura definitiva la definirá el usuario;
 * mientras tanto hay una plantilla de partida editable desde Ajustes. Crear un brief
 * desde una plantilla genera su contenido con un título por sección.
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
    if (s.kind === 'list')
      content.push({ type: 'bulletList', content: [{ type: 'listItem', content: [para()] }] })
    else content.push(para())
  }
  return { doc: { type: 'doc', content }, text: plain.join('\n') }
}
