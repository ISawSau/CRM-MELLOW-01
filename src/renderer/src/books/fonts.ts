import type { BundledFont } from '@shared/books'

/**
 * Tipos de letra que van dentro de la app para el lector (D-124). Cada uno es un trozo de
 * código aparte (archivos woff2 en línea) que solo se carga al elegirlo. Sin descargas de
 * internet ni fuentes del sistema que puedan faltar.
 */
export interface FontFaceData {
  weight: 400 | 700
  style: 'normal' | 'italic'
  /** data:font/woff2;base64,… */
  data: string
}

export const BUNDLED_FAMILY: Record<BundledFont, string> = {
  literata: 'CRM Literata',
  atkinson: 'CRM Atkinson Hyperlegible',
  dislexia: 'CRM OpenDyslexic',
}

const cache = new Map<BundledFont, Promise<FontFaceData[]>>()

export function loadFontFaces(font: BundledFont): Promise<FontFaceData[]> {
  let p = cache.get(font)
  if (!p) {
    p = (
      font === 'literata'
        ? import('./fonts/literata')
        : font === 'atkinson'
          ? import('./fonts/atkinson')
          : import('./fonts/dislexia')
    ).then((m) => m.default)
    cache.set(font, p)
  }
  return p
}

/** Los bytes de un data: URL en base64. */
export function dataUrlBytes(url: string): Uint8Array<ArrayBuffer> {
  const b64 = url.slice(url.indexOf(',') + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Registra el tipo de letra en este documento (vista previa en el panel de apariencia).
 * Con los bytes, no con una dirección: así no hace falta abrir la CSP de la app.
 */
const registered = new Set<BundledFont>()
export async function registerFont(font: BundledFont): Promise<void> {
  if (registered.has(font)) return
  registered.add(font)
  const faces = await loadFontFaces(font)
  for (const f of faces) {
    const face = new FontFace(BUNDLED_FAMILY[font], dataUrlBytes(f.data), {
      weight: String(f.weight),
      style: f.style,
    })
    document.fonts.add(await face.load())
  }
}
