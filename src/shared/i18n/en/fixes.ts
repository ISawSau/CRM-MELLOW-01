/**
 * Traducciones que mandan sobre las demás: unifican claves que se tradujeron distinto en
 * varias partes y dan las de contexto («contexto|texto», ver `tc()`). Va la última al unir.
 */
export const fixes: Record<string, string> = {
  'Enviar a la papelera': 'Move to trash',
  Periodo: 'Period',
  Fin: 'End',
  Datos: 'Data',
  'perfil|Datos': 'Details',
  'Sin nombre': 'Untitled',
  'Sin fecha': 'No date',
  'meta|Sin fecha': 'No end date',
  'No se ha podido guardar.': 'Could not save.',
  'No se pudo completar.': 'Could not complete the action.',
  'No se ha podido importar.': 'Could not import.',
  Formato: 'Format',
  'texto|Formato': 'Formatting',
  Título: 'Title',
  'texto|Título': 'Heading',
  Otros: 'Other',
  'NIF / CIF': 'Tax ID (NIF / CIF)',
  Media: 'Medium',
  'resumen|Media': 'Average',
  Repetición: 'Recurrence',
  Entrega: 'Delivery',
  Beneficio: 'Benefit',
  'facturacion|Beneficio': 'Profit',
  'No se pudo.': 'That didn’t work.',
  // Móvil (D-101)
  'No hay ninguna bóveda de CRM Mellow en este Google Drive. Activa antes la sincronización con Google Drive en el ordenador (con el mismo id de cliente).':
    'There is no CRM Mellow vault in this Google Drive. First turn on Google Drive sync on your computer (with the same client ID).',
  '«{name}» es demasiado grande para el móvil (máximo 200 MB).':
    '“{name}” is too large for the phone (200 MB maximum).',
  '02 · traer bóveda': '02 · bring vault',
  'desde Google Drive': 'from Google Drive',
  'Traer mi bóveda': 'Bring my vault',
  'Usa el mismo id de cliente y secreto de Google que en el ordenador (Ajustes → Sincronización). Se abrirá el navegador para entrar en Google; al terminar, vuelve aquí y desbloquea con tu contraseña de siempre.':
    'Use the same Google client ID and secret as on your computer (Settings → Sync). Your browser will open so you can sign in to Google; when you are done, come back here and unlock with your usual password.',
  'Id de cliente de Google': 'Google client ID',
  'Secreto del cliente': 'Client secret',
  'Esperando a Google… Completa el acceso en el navegador y vuelve aquí.':
    'Waiting for Google… Finish signing in in your browser and come back here.',
  'Conectar y traer': 'Connect and bring',
  'en otro dispositivo': 'on another device',
  'Traer desde Google Drive': 'Bring from Google Drive',
  'Si ya sincronizas la bóveda con Google Drive en el ordenador.':
    'If you already sync the vault with Google Drive on your computer.',
  'Abrir el menú': 'Open the menu',
  'Buscar y comandos': 'Search and commands',
  'Secciones principales': 'Main sections',
}
