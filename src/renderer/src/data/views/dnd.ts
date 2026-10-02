import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core'

/** Textos en español para lectores de pantalla al arrastrar (dnd-kit los trae en inglés). */
export const DND_ACCESSIBILITY: {
  announcements: Announcements
  screenReaderInstructions: ScreenReaderInstructions
} = {
  screenReaderInstructions: {
    draggable:
      'Pulsa Espacio para coger el elemento, las flechas para moverlo y Espacio para soltarlo. Escape cancela.',
  },
  announcements: {
    onDragStart: () => 'Elemento cogido.',
    onDragOver: ({ over }) => (over ? 'Encima de un destino.' : 'Fuera de los destinos.'),
    onDragEnd: ({ over }) => (over ? 'Elemento soltado.' : 'Elemento soltado fuera; no cambia.'),
    onDragCancel: () => 'Movimiento cancelado.',
  },
}
