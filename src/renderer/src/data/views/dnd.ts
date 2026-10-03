import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core'
import { t } from '@shared/i18n'

/**
 * Textos para lectores de pantalla al arrastrar (dnd-kit los trae en inglés), en el idioma
 * de la interfaz. Es una función porque el idioma se elige después de cargar los módulos.
 */
export function dndAccessibility(): {
  announcements: Announcements
  screenReaderInstructions: ScreenReaderInstructions
} {
  return {
    screenReaderInstructions: {
      draggable: t(
        'Pulsa Espacio para coger el elemento, las flechas para moverlo y Espacio para soltarlo. Escape cancela.',
      ),
    },
    announcements: {
      onDragStart: () => t('Elemento cogido.'),
      onDragOver: ({ over }) => (over ? t('Encima de un destino.') : t('Fuera de los destinos.')),
      onDragEnd: ({ over }) =>
        over ? t('Elemento soltado.') : t('Elemento soltado fuera; no cambia.'),
      onDragCancel: () => t('Movimiento cancelado.'),
    },
  }
}
