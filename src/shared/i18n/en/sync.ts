/** Sincronización con la nube: límites de tiempo, reintentos y progreso (D-124). */
export const sync: Record<string, string> = {
  'La subida a Google Drive no avanza.': 'The upload to Google Drive is not making progress.',
  'Sincronizando la bóveda…': 'Syncing the vault…',
  'No se pudo bajar {n} archivo de la nube: {error}':
    'Could not download {n} file from the cloud: {error}',
  'No se pudieron bajar {n} archivos de la nube: {error}':
    'Could not download {n} files from the cloud: {error}',
  'comprobando la nube…': 'checking the cloud…',
  subiendo: 'uploading',
  bajando: 'downloading',
  '{done} de {total} archivos': '{done} of {total} files',
  '{bytes} de {total}': '{bytes} of {total}',
  'Progreso de la sincronización': 'Sync progress',
  'sincronizando: {what}': 'syncing: {what}',
  // Sincronización por cambios (D-125)
  'La nube usa un formato más nuevo: actualiza la app en este equipo para sincronizar.':
    'The cloud uses a newer format: update the app on this device to sync.',
  'Otro equipo usa una versión más nueva de la app: actualiza esta para sincronizar.':
    'Another device uses a newer version of the app: update this one to sync.',
}
