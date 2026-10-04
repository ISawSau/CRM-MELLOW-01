/**
 * Lo que el motor de la app necesita del sistema y que cambia entre escritorio (Electron)
 * y móvil (Android con nodejs-mobile, D-101): diálogos de archivos, portapapeles y abrir
 * enlaces. El resto del proceso principal no importa `electron`, así el mismo código
 * corre en los dos sitios.
 */

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface SaveOptions {
  title: string
  /** Nombre propuesto (ya saneado con safeFileName). */
  defaultName: string
  /** Carpeta propuesta en escritorio. */
  folder: 'downloads' | 'documents'
  buttonLabel: string
  filters?: FileFilter[]
}

export interface Platform {
  readonly name: 'desktop' | 'android'
  version(): string
  isPackaged(): boolean
  /** Carpeta elegida por el usuario (o null si cancela). */
  pickFolder(o: { title: string; buttonLabel: string }): Promise<string | null>
  /** Archivos elegidos por el usuario (vacío si cancela). */
  pickFiles(o: { title: string; buttonLabel: string }): Promise<string[]>
  /**
   * Ruta donde escribir un archivo que el usuario quiere guardar. En Android es un archivo
   * temporal: tras escribirlo hay que llamar a `delivered`, que pide al sistema dónde
   * guardarlo y borra el temporal.
   */
  saveAs(o: SaveOptions): Promise<string | null>
  /** El archivo de `saveAs` ya está escrito. Devuelve lo que se muestra al usuario, o null. */
  delivered(path: string): Promise<string | null>
  writeClipboard(text: string, secret: boolean): Promise<void>
  /** Solo https y mailto (comprobado aquí y en cada implementación). */
  openExternal(url: string): void
  /**
   * Aviso del sistema (fase 14, D-107). Solo recuentos genéricos: el sistema guarda un
   * historial de avisos fuera de la bóveda, así que nunca nombres de clientes ni anuncios.
   */
  notify(title: string, body: string): void
}

/** ¿Se puede abrir fuera de la app? Solo https y mailto. */
export function externalUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'mailto:' ? url.toString() : null
  } catch {
    return null
  }
}
