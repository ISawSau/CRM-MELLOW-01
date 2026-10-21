import type { FrameLocation, ReaderTocItem } from '@shared/reader-messages'

/** Lo que el lector pide a la vista del libro (ebook o PDF). */
export interface PaneHandle {
  next(): void
  prev(): void
  goTo(href: string): void
  goToFraction(fraction: number): void
}

export interface PaneEvents {
  onOpened(info: { toc: ReaderTocItem[]; sectionFractions: number[] }): void
  onRelocate(loc: FrameLocation): void
  onTap(zone: 'left' | 'center' | 'right'): void
  onError(message: string): void
  onLink(href: string): void
  onEscape(): void
}
