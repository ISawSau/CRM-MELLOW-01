import UTIF from 'utif2'
import { call } from '../lib/ipc'

/**
 * Imágenes: comprimir, redimensionar y convertir con el canvas de Chromium (D-074). Chromium
 * lee JPEG, PNG, WebP, GIF, AVIF, BMP, ICO y SVG; TIFF se lee con UTIF (JavaScript puro) y
 * HEIC/HEIF (fotos del iPhone) en el proceso principal con libheif (D-093).
 */

/** Formatos que se aceptan (tipos y extensiones: algunos sistemas no dan el tipo de HEIC). */
export const IMAGE_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/svg+xml',
  'image/tiff',
  'image/heic',
  'image/heif',
  '.jpg',
  '.jpeg',
  '.jfif',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.bmp',
  '.ico',
  '.svg',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
].join(',')

type Kind = 'heic' | 'tiff' | 'svg' | 'navegador'

/** Qué decodificador usar, por el tipo o, si no lo hay, por la extensión. */
export function imageKind(file: { name: string; type: string }): Kind {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (/^image\/hei[cf]/.test(file.type) || ext === 'heic' || ext === 'heif') return 'heic'
  if (file.type === 'image/tiff' || ext === 'tif' || ext === 'tiff') return 'tiff'
  if (file.type === 'image/svg+xml' || ext === 'svg') return 'svg'
  return 'navegador'
}

function bitmapFromPixels(width: number, height: number, rgba: Uint8Array): Promise<ImageBitmap> {
  const pixels = new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength)
  return createImageBitmap(new ImageData(pixels, width, height))
}

/** SVG: se dibuja como imagen (sin scripts) a su tamaño, o a 1024 px si no lo declara. */
async function svgBitmap(file: File): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const w = img.naturalWidth || 1024
    const h = img.naturalHeight || 1024
    return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function tiffBitmap(file: File): Promise<ImageBitmap> {
  const buffer = await file.arrayBuffer()
  const [first] = UTIF.decode(buffer)
  if (!first) throw new Error('TIFF vacío')
  UTIF.decodeImage(buffer, first)
  return bitmapFromPixels(first.width, first.height, UTIF.toRGBA8(first))
}

async function heicBitmap(file: File): Promise<ImageBitmap> {
  const img = await call('tools:decodeHeic', { data: new Uint8Array(await file.arrayBuffer()) })
  return bitmapFromPixels(img.width, img.height, img.data)
}

export function decodeImage(file: File): Promise<ImageBitmap> {
  const kind = imageKind(file)
  if (kind === 'heic') return heicBitmap(file)
  if (kind === 'tiff') return tiffBitmap(file)
  if (kind === 'svg') return svgBitmap(file)
  // createImageBitmap respeta la orientación EXIF de las fotos del móvil.
  return createImageBitmap(file)
}

export const IMAGE_FORMATS = {
  'image/jpeg': { label: 'JPEG', ext: 'jpg' },
  'image/png': { label: 'PNG', ext: 'png' },
  'image/webp': { label: 'WebP', ext: 'webp' },
} as const
export type ImageFormat = keyof typeof IMAGE_FORMATS

export interface ImageOptions {
  /** «mismo» conserva JPEG, PNG o WebP; las fotos HEIC pasan a JPEG y el resto (GIF, AVIF…) a PNG. */
  format: ImageFormat | 'mismo'
  /** 0,1 a 1 (JPEG y WebP). */
  quality: number
  /** Ancho máximo en píxeles (no amplía). */
  maxWidth: number | null
}

export interface ImageResult {
  name: string
  data: Uint8Array
  width: number
  height: number
}

export function outputFormat(
  file: { name: string; type: string },
  format: ImageOptions['format'],
): ImageFormat {
  if (format !== 'mismo') return format
  if (file.type in IMAGE_FORMATS) return file.type as ImageFormat
  return imageKind(file) === 'heic' ? 'image/jpeg' : 'image/png'
}

export async function convertImage(file: File, opts: ImageOptions): Promise<ImageResult> {
  const bmp = await decodeImage(file)
  try {
    const k = opts.maxWidth && bmp.width > opts.maxWidth ? opts.maxWidth / bmp.width : 1
    const width = Math.max(1, Math.round(bmp.width * k))
    const height = Math.max(1, Math.round(bmp.height * k))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Sin canvas')
    const type = outputFormat(file, opts.format)
    // JPEG no tiene transparencia: fondo blanco en lugar de negro.
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, width, height)
    const blob = await canvas.convertToBlob({ type, quality: opts.quality })
    const base = file.name.replace(/\.[^.]+$/, '') || 'imagen'
    return {
      name: `${base}.${IMAGE_FORMATS[type].ext}`,
      data: new Uint8Array(await blob.arrayBuffer()),
      width,
      height,
    }
  } finally {
    bmp.close()
  }
}
