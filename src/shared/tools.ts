import { z } from 'zod'

/**
 * Herramientas de archivos (SPEC §7.11, fase 9). Las imágenes y los PDF se procesan en
 * la interfaz (canvas y pdf-lib); el vídeo, con FFmpeg en el proceso principal.
 */

export const TOOL_TARGETS = ['boveda', 'exportar'] as const
export type ToolTarget = (typeof TOOL_TARGETS)[number]

/** Tipo del documento que se crea al guardar un resultado en la bóveda. */
export const DOC_TIPOS = ['informe', 'herramienta', 'contrato', 'otro'] as const

const recordId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

/** Resultado de bytes (imagen o PDF ya procesados en la interfaz). */
export const saveResultSchema = z.object({
  name: z.string().trim().min(1).max(200),
  data: z.instanceof(Uint8Array).refine((d) => d.byteLength <= 512 * 1024 * 1024),
  target: z.enum(TOOL_TARGETS),
  clientId: recordId.nullable().default(null),
  tipo: z.enum(DOC_TIPOS).default('herramienta'),
})

export interface SavedResult {
  /** Nombre del archivo resultante. */
  name: string
  /** Documento creado en la bóveda, si se guardó allí. */
  recordId: string | null
  /** Ruta del archivo exportado, si se exportó. */
  path: string | null
}

// --- Vídeo -------------------------------------------------------------------------

export const VIDEO_PRESETS = {
  comprimir: { label: 'Comprimir (mismo formato)', size: null },
  vertical: { label: 'Vertical 9:16 (historias y reels)', size: [1080, 1920] },
  cuadrado: { label: 'Cuadrado 1:1 (feed)', size: [1080, 1080] },
  feed: { label: 'Feed 4:5', size: [1080, 1350] },
} as const satisfies Record<string, { label: string; size: readonly [number, number] | null }>
export type VideoPreset = keyof typeof VIDEO_PRESETS

export const VIDEO_FITS = {
  recortar: 'Recortar para llenar',
  bandas: 'Añadir bandas negras',
} as const
export type VideoFit = keyof typeof VIDEO_FITS

/** Calidad → CRF de x264 (más alto, más compresión). */
export const VIDEO_QUALITY = {
  alta: { label: 'Alta', crf: 20 },
  media: { label: 'Media', crf: 24 },
  baja: { label: 'Baja (archivo pequeño)', crf: 28 },
} as const
export type VideoQuality = keyof typeof VIDEO_QUALITY

/** Lado mayor máximo al comprimir sin cambiar el formato. */
export const MAX_SIDE = 1920

export const videoJobSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{16}$/),
  preset: z.enum(Object.keys(VIDEO_PRESETS) as [VideoPreset, ...VideoPreset[]]),
  fit: z.enum(Object.keys(VIDEO_FITS) as [VideoFit, ...VideoFit[]]).default('recortar'),
  quality: z.enum(Object.keys(VIDEO_QUALITY) as [VideoQuality, ...VideoQuality[]]).default('media'),
  /** Quitar el sonido. */
  mute: z.boolean().default(false),
  target: z.enum(TOOL_TARGETS),
  clientId: recordId.nullable().default(null),
})
export type VideoJob = z.infer<typeof videoJobSchema>

export interface VideoInfo {
  token: string
  name: string
  size: number
  duration: number | null
  width: number | null
  height: number | null
}

export interface ToolsProgress {
  token: string
  /** 0 a 1. */
  ratio: number
}

/** Duración y dimensiones a partir de la salida de `ffmpeg -i`. */
export function parseProbe(stderr: string): {
  duration: number | null
  width: number | null
  height: number | null
  audio: boolean
} {
  const d = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr)
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null
  const videoLine = stderr.split('\n').find((l) => /Stream #.*Video:/.test(l)) ?? ''
  const s = /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(videoLine)
  let width = s ? Number(s[1]) : null
  let height = s ? Number(s[2]) : null
  // Vídeos de móvil: guardados en horizontal con una rotación de 90°.
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(stderr)
  if (rot && Math.abs(Number(rot[1])) % 180 === 90 && width && height)
    [width, height] = [height, width]
  return { duration, width, height, audio: /Stream #.*Audio:/.test(stderr) }
}

/** Dimensiones pares que caben en MAX_SIDE manteniendo la proporción. */
export function fitWithin(w: number, h: number, max = MAX_SIDE): [number, number] {
  const k = Math.min(1, max / Math.max(w, h))
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2)
  return [even(w), even(h)]
}

/** Filtro de vídeo de un preset. */
export function videoFilter(
  preset: VideoPreset,
  fit: VideoFit,
  source: { width: number | null; height: number | null },
): string {
  const size = VIDEO_PRESETS[preset].size
  if (!size) {
    const [w, h] =
      source.width && source.height ? fitWithin(source.width, source.height) : [-2, MAX_SIDE]
    // Sin dimensiones conocidas: se limita la altura y el ancho se deduce (par).
    return `scale=${w}:${h},setsar=1`
  }
  const [w, h] = size
  return fit === 'recortar'
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`
    : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
}

/** Argumentos de FFmpeg para un trabajo (sin shell: cada argumento va por separado). */
export function videoArgs(
  input: string,
  output: string,
  job: Pick<VideoJob, 'preset' | 'fit' | 'quality' | 'mute'>,
  source: { width: number | null; height: number | null },
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    input,
    '-map',
    '0:v:0',
    ...(job.mute ? ['-an'] : ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k']),
    '-vf',
    videoFilter(job.preset, job.fit, source),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    String(VIDEO_QUALITY[job.quality].crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-map_metadata',
    '-1',
    '-progress',
    'pipe:1',
    '-nostats',
    output,
  ]
}

/** Nombre del resultado: «anuncio.mov» + vertical → «anuncio-9x16.mp4». */
export function videoOutputName(name: string, preset: VideoPreset): string {
  const base = name.replace(/\.[^.]+$/, '') || 'video'
  const suffix = {
    comprimir: 'comprimido',
    vertical: '9x16',
    cuadrado: '1x1',
    feed: '4x5',
  }[preset]
  return `${base}-${suffix}.mp4`
}

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']

// --- PDF ---------------------------------------------------------------------------

/**
 * «1-3, 5, 8-» → [[0,1,2],[4],[7…n-1]] (índices desde 0). Cada grupo es un PDF.
 * «cada» (o vacío) → una página por PDF. Devuelve un mensaje si algo no es válido.
 */
export function parseRanges(text: string, pages: number): number[][] | string {
  const t = text.trim().toLowerCase()
  if (t === '' || t === 'cada' || t === 'todas') return Array.from({ length: pages }, (_, i) => [i])
  const groups: number[][] = []
  for (const part of t.split(/[,;]/)) {
    const p = part.trim()
    if (!p) continue
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(p)
    if (!m || (!m[1] && !m[3])) return `«${p}» no es un rango válido (ejemplo: 1-3, 5, 8-).`
    const from = m[1] ? Number(m[1]) : 1
    const to = m[2] ? (m[3] ? Number(m[3]) : pages) : from
    if (from < 1 || to > pages || from > to)
      return `«${p}» no cabe en el documento (tiene ${pages} páginas).`
    groups.push(Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i))
  }
  return groups.length ? groups : 'Indica al menos un rango.'
}

export const PDF_LEVELS = {
  ligera: { label: 'Ligera (sin pérdida)', dpi: null, quality: null },
  media: { label: 'Media (150 ppp)', dpi: 150, quality: 0.75 },
  fuerte: { label: 'Fuerte (100 ppp)', dpi: 100, quality: 0.6 },
} as const
export type PdfLevel = keyof typeof PDF_LEVELS
