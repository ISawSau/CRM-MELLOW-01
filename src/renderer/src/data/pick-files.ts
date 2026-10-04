import type { FileRef } from '@shared/data/fields'
import { t } from '@shared/i18n'
import { call, IpcCallError } from '../lib/ipc'
import { isMobile } from '../lib/platform'

/** En el móvil los archivos viajan dentro de la llamada (base64): se limita su tamaño (D-101). */
export const MOBILE_MAX_FILE_BYTES = 200 * 1024 * 1024

/** Abre el selector de archivos del navegador (en Android, el del sistema). */
function chooseFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true })
    input.addEventListener('cancel', () => resolve([]), { once: true })
    input.click()
  })
}

/**
 * «Añadir archivos»: en escritorio, el diálogo del sistema (el proceso principal lee el
 * archivo del disco); en Android, el selector del sistema y la subida al motor.
 */
export async function pickFiles(): Promise<FileRef[]> {
  if (!isMobile()) return call('files:pick')
  const refs: FileRef[] = []
  for (const f of await chooseFiles()) {
    if (f.size > MOBILE_MAX_FILE_BYTES)
      throw new IpcCallError({
        code: 'INVALID_INPUT',
        message: t('«{name}» es demasiado grande para el móvil (máximo 200 MB).', { name: f.name }),
      })
    refs.push(
      await call('files:upload', { name: f.name, data: new Uint8Array(await f.arrayBuffer()) }),
    )
  }
  return refs
}
