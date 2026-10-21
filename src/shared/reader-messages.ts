import type { BundledFont } from './books'
/**
 * Mensajes entre la app y el marco aislado del lector de ebooks (D-123). El marco no
 * habla con el motor: recibe el libro y la apariencia y cuenta por dónde va.
 */

export interface ReaderTocItem {
  label: string
  href: string
  subitems?: ReaderTocItem[]
}

/** Apariencia ya resuelta (colores y tipografía concretos) para el marco. */
export interface FrameStyle {
  bg: string
  fg: string
  link: string
  dark: boolean
  /** null: la del libro. */
  fontFamily: string | null
  /** Tipo de letra que va dentro de la app: el marco carga sus archivos (D-124). */
  bundledFont: BundledFont | null
  fontSize: number
  /** 0 normal, 1 más gruesa, 2 negrita. */
  weight: number
  /** 0 normal … 3 mucho más espacio entre letras y palabras. */
  spacing: number
  lineHeight: number
  /** Hueco entre columnas y a los lados, en %. */
  gap: number
  justify: boolean
  flow: 'paginated' | 'scrolled'
  maxColumns: 1 | 2
}

export type ToFrame =
  | {
      type: 'open'
      name: string
      data: ArrayBuffer
      /** CFI guardado (null: desde el principio del texto). */
      location: string | null
      style: FrameStyle
    }
  /** Solo leer título, autor y portada (al añadir un libro). */
  | { type: 'inspect'; name: string; data: ArrayBuffer }
  | { type: 'style'; style: FrameStyle }
  | { type: 'go'; to: 'next' | 'prev' | 'left' | 'right' }
  | { type: 'goTo'; href: string }
  | { type: 'goToFraction'; fraction: number }

export interface FrameLocation {
  cfi: string
  /** Del libro entero (0…1). */
  fraction: number
  chapter: string | null
  /** Posición estable del libro (unos 1.500 caracteres cada una, como las de Kindle). */
  page: number
  pages: number
  /** Página dentro del capítulo (con el tamaño de letra de ahora). */
  sectionPage: number | null
  sectionPages: number | null
}

export interface BookInfo {
  title: string | null
  author: string | null
  language: string | null
  cover: ArrayBuffer | null
  coverType: string | null
}

export type FromFrame =
  | { type: 'ready' }
  | {
      type: 'opened'
      toc: ReaderTocItem[]
      /** Dónde empieza cada capítulo (marcas en la barra de avance). */
      sectionFractions: number[]
      dir: 'ltr' | 'rtl'
      /** Tamaño del texto (bytes), para el tiempo que queda. */
      fixedLayout: boolean
    }
  | ({ type: 'relocate' } & FrameLocation)
  | ({ type: 'inspected' } & BookInfo)
  /** Toque en el libro: izquierda, centro o derecha de la pantalla. */
  | { type: 'tap'; zone: 'left' | 'center' | 'right' }
  | { type: 'key'; key: string }
  | { type: 'link'; href: string }
  | { type: 'error'; message: string }
