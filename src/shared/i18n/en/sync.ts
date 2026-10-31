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
  'Con datos móviles, bajar también libros y archivos':
    'On mobile data, also download books and files',
  'Con datos móviles solo viajan los cambios, las miniaturas y el archivo o libro que abras; lo demás se baja con wifi. Meta tampoco se actualiza sola con datos móviles (sí con el botón).':
    'On mobile data only changes, thumbnails and the file or book you open are transferred; everything else downloads on Wi-Fi. Meta does not update on its own on mobile data either (the button still works).',
  'la base de datos entera': 'the whole database',
  'un archivo': 'a file',
  'Subir también las copias a la nube': 'Also upload backups to the cloud',
  'Cada copia es la base de datos entera. La nube ya guarda tu bóveda al sincronizar, así que de serie las copias se quedan solo en este equipo. Si lo activas, nunca se suben con datos móviles.':
    'Each backup is the whole database. The cloud already keeps your vault when syncing, so by default backups stay on this device only. If you turn this on, they are never uploaded on mobile data.',
}
