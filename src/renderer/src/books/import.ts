import { BOOK_ENTITY, bookFormat, isBookName } from '@shared/books'
import type { FieldDef, FileRef } from '@shared/data/fields'
import type { RecordRow } from '@shared/data/records'
import { call } from '../lib/ipc'
import { fileUrl } from '../data/files'
import { pickFiles } from '../data/pick-files'
import { inspectEbook } from './frame'
import { inspectPdf } from './pdf'

/**
 * Añadir libros (D-123): el archivo entra cifrado en la bóveda y se lee de él el título, el
 * autor y la portada (que se guarda como miniatura del archivo). Todo en la interfaz: el
 * PDF con pdf.js y el ebook en el marco aislado del lector.
 */

const COVER_SIDE = 600

async function coverThumb(
  blob: Blob,
): Promise<{ thumb: Uint8Array<ArrayBuffer>; width: number; height: number }> {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, COVER_SIDE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
  if (!out) throw new Error('portada')
  return {
    thumb: new Uint8Array(await out.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  }
}

export function bookFieldIds(fields: FieldDef[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, f.id]))
}

/** Archivo del libro (el primero del campo «Archivo»). */
export function bookFile(r: RecordRow, archivoId: string | undefined): FileRef | null {
  const v = archivoId ? r.values[archivoId] : undefined
  return Array.isArray(v) && v[0] ? (v[0] as FileRef) : null
}

export interface AddResult {
  added: string[]
  skipped: string[]
  duplicated: string[]
}

export async function addBookFiles(
  refs: FileRef[],
  readerUrl: string,
  onStep?: (name: string) => void,
): Promise<AddResult> {
  const fields = bookFieldIds(await call('data:fields', { entity: BOOK_ENTITY }))
  const existing = new Set(
    (await call('data:query', { entity: BOOK_ENTITY }))
      .map((r) => bookFile(r, fields['archivo'])?.id)
      .filter(Boolean),
  )
  const result: AddResult = { added: [], skipped: [], duplicated: [] }
  for (const ref of refs) {
    if (!isBookName(ref.name)) {
      result.skipped.push(ref.name)
      continue
    }
    if (existing.has(ref.id)) {
      result.duplicated.push(ref.name)
      continue
    }
    onStep?.(ref.name)
    let title: string | null = null
    let author: string | null = null
    let pages: number | null = null
    let cover: Blob | null = null
    try {
      if (bookFormat(ref.name) === 'pdf') {
        const info = await inspectPdf(ref.id, ref.size)
        ;({ title, author, cover } = info)
        pages = info.pages
      } else {
        const data = await (await fetch(fileUrl(ref.id))).arrayBuffer()
        const info = await inspectEbook(readerUrl, ref.name, data)
        title = info.title
        author = info.author
        cover = info.cover ? new Blob([info.cover], { type: info.coverType ?? 'image/jpeg' }) : null
      }
    } catch {
      // Sin metadatos legibles: se añade igual, con el nombre del archivo.
    }
    if (cover) {
      try {
        await call('files:setMeta', { id: ref.id, ...(await coverThumb(cover)) })
      } catch {
        // Sin portada: se ve la tapa de serie.
      }
    }
    const fallback =
      ref.name
        .replace(/\.[^.]+$/, '')
        .replace(/[_]+/g, ' ')
        .trim() || ref.name
    const values: Record<string, unknown> = {}
    if (fields['autor'] && author) values[fields['autor']] = author.slice(0, 300)
    if (fields['estado']) values[fields['estado']] = 'por-leer'
    if (fields['archivo']) values[fields['archivo']] = [ref]
    if (fields['paginas'] && pages) values[fields['paginas']] = pages
    await call('data:create', {
      entity: BOOK_ENTITY,
      title: (title ?? fallback).slice(0, 500),
      values,
    })
    existing.add(ref.id)
    result.added.push(title ?? fallback)
  }
  return result
}

/** «Añadir libros»: el selector del sistema y después lo anterior. */
export async function addBooks(
  readerUrl: string,
  onStep?: (name: string) => void,
): Promise<AddResult> {
  const refs = await pickFiles()
  return addBookFiles(refs, readerUrl, onStep)
}
