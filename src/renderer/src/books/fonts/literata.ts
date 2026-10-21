// Literata (SIL Open Font License 1.1), solo el juego latino: el lector la carga cuando se elige.
import r from '@fontsource/literata/files/literata-latin-400-normal.woff2?inline'
import i from '@fontsource/literata/files/literata-latin-400-italic.woff2?inline'
import b from '@fontsource/literata/files/literata-latin-700-normal.woff2?inline'
import bi from '@fontsource/literata/files/literata-latin-700-italic.woff2?inline'
import type { FontFaceData } from '../fonts'

const faces: FontFaceData[] = [
  { weight: 400, style: 'normal', data: r },
  { weight: 400, style: 'italic', data: i },
  { weight: 700, style: 'normal', data: b },
  { weight: 700, style: 'italic', data: bi },
]
export default faces
