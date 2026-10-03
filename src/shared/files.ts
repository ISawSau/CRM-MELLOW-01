import { intlLocale } from './i18n'
/** Utilidades de archivos compartidas por el proceso principal y la interfaz. */

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  psd: 'image/vnd.adobe.photoshop',
  ai: 'application/postscript',
}

export function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

/** Imágenes que Chromium muestra (el SVG no: podría llevar scripts). */
export function isPreviewImage(mime: string): boolean {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(mime)
}

export function isVideo(mime: string): boolean {
  return mime.startsWith('video/')
}

/** 1.536 → "1,5 KB" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toLocaleString(intlLocale(), { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`
}

/** Nombre de archivo seguro (sin rutas ni caracteres prohibidos en Windows). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'archivo'
  // eslint-disable-next-line no-control-regex -- se quitan a propósito los caracteres de control
  const clean = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim()
  return (clean || 'archivo').slice(0, 255)
}
