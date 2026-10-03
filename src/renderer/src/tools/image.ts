/** Imágenes: comprimir, redimensionar y convertir con el canvas de Chromium (D-074). */

export const IMAGE_FORMATS = {
  'image/jpeg': { label: 'JPEG', ext: 'jpg' },
  'image/png': { label: 'PNG', ext: 'png' },
  'image/webp': { label: 'WebP', ext: 'webp' },
} as const
export type ImageFormat = keyof typeof IMAGE_FORMATS

export interface ImageOptions {
  /** «mismo» conserva JPEG, PNG o WebP; el resto (GIF, AVIF…) pasa a PNG. */
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

export function outputFormat(mime: string, format: ImageOptions['format']): ImageFormat {
  if (format !== 'mismo') return format
  return mime in IMAGE_FORMATS ? (mime as ImageFormat) : 'image/png'
}

export async function convertImage(file: File, opts: ImageOptions): Promise<ImageResult> {
  // createImageBitmap respeta la orientación EXIF de las fotos del móvil.
  const bmp = await createImageBitmap(file)
  try {
    const k = opts.maxWidth && bmp.width > opts.maxWidth ? opts.maxWidth / bmp.width : 1
    const width = Math.max(1, Math.round(bmp.width * k))
    const height = Math.max(1, Math.round(bmp.height * k))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Sin canvas')
    const type = outputFormat(file.type, opts.format)
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
