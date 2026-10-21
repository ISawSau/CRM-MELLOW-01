import { z } from 'zod'
import { idSchema } from './data/fields'

/**
 * Biblioteca y lector (fase 15, D-123). Los libros son registros de la entidad `libro`
 * con su archivo en el almacén cifrado; la posición y los ratos de lectura van en tablas
 * propias (no en el historial de cambios del registro: cada página pasada no es un
 * cambio que deshacer).
 */

export const BOOK_ENTITY = 'libro'

/** Formatos que se abren: PDF con pdf.js; el resto con foliate-js. */
export const BOOK_EXTENSIONS = ['pdf', 'epub', 'mobi', 'azw3', 'azw', 'fb2', 'fbz', 'cbz'] as const
export type BookFormat = 'pdf' | 'ebook'

export function bookExtension(name: string): string {
  return name.toLowerCase().split('.').pop() ?? ''
}

export function isBookName(name: string): boolean {
  return (BOOK_EXTENSIONS as readonly string[]).includes(bookExtension(name))
}

export function bookFormat(name: string): BookFormat {
  return bookExtension(name) === 'pdf' ? 'pdf' : 'ebook'
}

/** Estados del libro (opciones del campo `estado`). */
export const BOOK_STATES = ['por-leer', 'leyendo', 'leido', 'abandonado'] as const
export type BookState = (typeof BOOK_STATES)[number]

/** A partir de aquí se da por terminado (los créditos y el índice final no cuentan). */
export const FINISHED_FRACTION = 0.985

// --- Posición ---------------------------------------------------------------------

export const bookProgressSchema = z.object({
  recordId: idSchema,
  /** CFI del ebook o número de página del PDF (como texto). */
  location: z.string().min(1).max(2000),
  fraction: z.number().min(0).max(1),
  page: z.number().int().min(0).max(1_000_000).nullable(),
  pages: z.number().int().min(0).max(1_000_000).nullable(),
  chapter: z.string().max(300).nullable(),
})
export type BookProgressInput = z.infer<typeof bookProgressSchema>
export interface BookProgress extends BookProgressInput {
  updatedAt: string
}

// --- Ratos de lectura ---------------------------------------------------------------

/** Un rato de lectura (se guarda mientras se lee y al cerrar). */
export const readingSessionSchema = z.object({
  /** Lo genera la interfaz: así guardar varias veces el mismo rato no lo duplica. */
  id: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/),
  recordId: idSchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  /** Tiempo leyendo de verdad (sin los ratos sin pasar página). */
  seconds: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600),
  fromFraction: z.number().min(0).max(1),
  toFraction: z.number().min(0).max(1),
  /** Páginas pasadas. */
  pages: z.number().int().min(0).max(100_000),
})
export type ReadingSession = z.infer<typeof readingSessionSchema>

/** Sin pasar página en este tiempo, el rato deja de contar (te has ido a otra cosa). */
export const IDLE_LIMIT_SECONDS = 3 * 60
/** Un rato de menos de esto no se guarda (abrir y cerrar). */
export const MIN_SESSION_SECONDS = 20

export interface ReadingDay {
  /** AAAA-MM-DD en la zona horaria del perfil. */
  day: string
  seconds: number
  pages: number
}

export interface BookStats {
  recordId: string
  seconds: number
  sessions: number
  /** Fracción del libro leída por hora, con los ratos de este libro (null: sin datos). */
  fractionPerHour: number | null
}

export interface ReadingStats {
  today: ReadingDay
  /** Días seguidos leyendo (al menos un minuto), contando hoy o, si hoy aún no, ayer. */
  streak: number
  bestStreak: number
  /** Últimos 365 días, del más antiguo al más reciente (con ceros). */
  days: ReadingDay[]
  /** Libros terminados por año de la fecha «Terminado». */
  finishedByYear: Record<string, number>
  year: { year: number; finished: number; goal: number | null }
  totalSeconds: number
  /** Por libro, para el tiempo que queda. */
  books: BookStats[]
}

export const readingGoalSchema = z.object({
  /** Libros al año (null: sin objetivo). */
  booksPerYear: z.number().int().min(1).max(1000).nullable(),
})
export type ReadingGoal = z.infer<typeof readingGoalSchema>

// --- Apariencia del lector ------------------------------------------------------------

export const READER_THEMES = ['app', 'papel', 'sepia', 'noche', 'negro'] as const
export type ReaderTheme = (typeof READER_THEMES)[number]
/**
 * Tipos de letra (D-124): el del libro, los del sistema y tres que van dentro de la app
 * (licencia OFL) para leer mejor: Literata (hecha para leer en pantalla), Atkinson
 * Hyperlegible (letras que no se confunden) y OpenDyslexic (para dislexia o letra cansada).
 */
export const READER_FONTS = ['libro', 'literata', 'serif', 'atkinson', 'sans', 'dislexia'] as const
export type ReaderFont = (typeof READER_FONTS)[number]
export const BUNDLED_FONTS = ['literata', 'atkinson', 'dislexia'] as const
export type BundledFont = (typeof BUNDLED_FONTS)[number]
export function isBundledFont(f: string): f is BundledFont {
  return (BUNDLED_FONTS as readonly string[]).includes(f)
}
/** Tamaño de la letra (%): hasta 400 para quien lo necesite muy grande. */
export const FONT_SIZE_MIN = 60
export const FONT_SIZE_MAX = 400

export const readerPrefsSchema = z.object({
  theme: z.enum(READER_THEMES).default('app'),
  font: z.enum(READER_FONTS).default('libro'),
  /** Tamaño del texto en %. */
  fontSize: z.number().int().min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(100),
  /** Grosor: 0 normal, 1 más gruesa (trazo), 2 negrita. */
  weight: z.number().int().min(0).max(2).default(0),
  /** Espacio entre letras y palabras: 0 normal … 3 mucho más. */
  spacing: z.number().int().min(0).max(3).default(0),
  lineHeight: z.number().min(1).max(2.4).default(1.5),
  /** Márgenes laterales: 0 estrechos … 3 anchos. */
  margin: z.number().int().min(0).max(3).default(1),
  justify: z.boolean().default(true),
  /** Página a página o desplazamiento continuo. */
  flow: z.enum(['paginado', 'continuo']).default('paginado'),
  /** Dos páginas a la vez si caben (ordenador y tableta en horizontal). */
  spread: z.boolean().default(true),
  /** Atenuar la pantalla (0 nada … 70 %). */
  dim: z.number().int().min(0).max(70).default(0),
  /** Android: pasar página con los botones de volumen. */
  volumeKeys: z.boolean().default(true),
  /** PDF: invertir colores con los temas oscuros. */
  pdfInvert: z.boolean().default(true),
  /** PDF escaneado: realzar el texto (gris y más contraste) para páginas gastadas. */
  pdfEnhance: z.enum(['no', 'nitido', 'contraste']).default('no'),
  /** PDF: recortar los márgenes blancos (0 nada … 3 mucho) para que el texto salga mayor. */
  pdfCrop: z.number().int().min(0).max(3).default(0),
})
export type ReaderPrefs = z.infer<typeof readerPrefsSchema>
export const DEFAULT_READER_PREFS: ReaderPrefs = readerPrefsSchema.parse({})

/** Colores de cada tema del lector (el tema «app» usa los de la interfaz). */
export const READER_THEME_COLORS: Record<
  Exclude<ReaderTheme, 'app'>,
  { bg: string; fg: string }
> = {
  papel: { bg: '#ffffff', fg: '#1d1b19' },
  sepia: { bg: '#f4ecd8', fg: '#3b2f22' },
  noche: { bg: '#1f1d1b', fg: '#d8d2c8' },
  negro: { bg: '#000000', fg: '#bdb7ad' },
}

export function isDarkReaderTheme(theme: ReaderTheme, appDark: boolean): boolean {
  return theme === 'app' ? appDark : theme === 'noche' || theme === 'negro'
}
