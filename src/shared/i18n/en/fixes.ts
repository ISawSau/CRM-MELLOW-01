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
  'No hay ninguna bóveda de CRM Mellow en este Google Drive. Comprueba que has entrado con la misma cuenta de Google que en el ordenador y que allí está activada la sincronización con Google Drive (con un id de cliente del mismo proyecto de Google Cloud).':
    'There is no CRM Mellow vault in this Google Drive. Check that you signed in with the same Google account as on your computer and that Google Drive sync is turned on there (with a client ID from the same Google Cloud project).',
  '«{name}» es demasiado grande para el móvil (máximo 200 MB).':
    '“{name}” is too large for the phone (200 MB maximum).',
  '02 · traer bóveda': '02 · bring vault',
  'desde Google Drive': 'from Google Drive',
  'Traer mi bóveda': 'Bring my vault',
  'Usa el mismo id de cliente y secreto de Google que en el ordenador (Ajustes → Sincronización). Se abrirá el navegador para entrar en Google; al terminar, vuelve aquí y desbloquea con tu contraseña de siempre.':
    'Use the same Google client ID and secret as on your computer (Settings → Sync). Your browser will open so you can sign in to Google; when you are done, come back here and unlock with your usual password.',
  'Id de cliente de Google': 'Google client ID',
  'Secreto del cliente': 'Client secret',
  'Esperando a Google… Completa el acceso en el navegador y vuelve aquí (o pulsa «Volver a CRM Mellow» en la página de Google).':
    'Waiting for Google… Finish signing in in your browser and come back here (or tap “Back to CRM Mellow” on the Google page).',
  'Conectar y traer': 'Connect and bring',
  'en otro dispositivo': 'on another device',
  'Traer desde Google Drive': 'Bring from Google Drive',
  'Si ya sincronizas la bóveda con Google Drive en el ordenador.':
    'If you already sync the vault with Google Drive on your computer.',
  'Abrir el menú': 'Open the menu',
  'Buscar y comandos': 'Search and commands',
  'Secciones principales': 'Main sections',
  // Google en el móvil (D-118)
  'Google Drive no responde. Comprueba la conexión a internet.':
    'Google Drive is not responding. Check your internet connection.',
  'Trayendo la bóveda desde Google Drive…': 'Bringing the vault from Google Drive…',
  'Volver a CRM Mellow': 'Back to CRM Mellow',
  'No hay ninguna conexión con Google esperando respuesta. Vuelve a empezar.':
    'No Google connection is waiting for a reply. Start again.',
  'Esa dirección no lleva la respuesta de Google. Copia la dirección completa de la barra del navegador, la que empieza por http://127.0.0.1':
    'That address does not contain Google’s reply. Copy the full address from the browser’s address bar, the one that starts with http://127.0.0.1',
  'Google no reconoce el id o el secreto del cliente. Cópialos otra vez desde Google Cloud → Credenciales (cliente de tipo «Aplicación de escritorio»).':
    'Google does not recognise the client ID or secret. Copy them again from Google Cloud → Credentials (a “Desktop app” client).',
  'Google ha rechazado el código de acceso (caduca en pocos minutos y solo vale una vez). Vuelve a intentarlo.':
    'Google rejected the access code (it expires within minutes and works only once). Try again.',
  'Este cliente de Google no se puede usar así: tiene que ser de tipo «Aplicación de escritorio».':
    'This Google client cannot be used this way: it has to be a “Desktop app” client.',
  'Conectando con Google…': 'Connecting to Google…',
  'Esta conexión con Google ya ha terminado.': 'This Google connection has already finished.',
  'Google ha respondido con un error: {error}.': 'Google replied with an error: {error}.',
  'Esa dirección es de otro intento de conexión. Copia la de este intento o vuelve a empezar.':
    'That address is from another connection attempt. Copy the one from this attempt or start again.',
  'Google ha respondido algo que no se entiende (HTTP {status}).':
    'Google sent a reply that could not be understood (HTTP {status}).',
  'La API de Google Drive no está activada en tu proyecto de Google Cloud. Actívala en «APIs y servicios» → «Biblioteca» → «Google Drive API», espera un par de minutos y vuelve a intentarlo.':
    'The Google Drive API is not enabled in your Google Cloud project. Enable it in “APIs & Services” → “Library” → “Google Drive API”, wait a couple of minutes and try again.',
  'Google Drive no ha aceptado el acceso. Vuelve a conectar con Google.':
    'Google Drive did not accept the access. Connect to Google again.',
  'La descarga de Google Drive se ha quedado parada.': 'The Google Drive download has stalled.',
  'Inicia sesión en Google en el navegador': 'Sign in to Google in your browser',
  'Google ha respondido: conectando': 'Google replied: connecting',
  'Buscando tu bóveda en Google Drive': 'Looking for your vault in Google Drive',
  'Descargando la bóveda': 'Downloading the vault',
  '{done} de {total} MB': '{done} of {total} MB',
  '{done} MB': '{done} MB',
  'Volver a intentarlo': 'Try again',
  'Abrir otra vez la página de Google': 'Open the Google page again',
  '¿El navegador no vuelve a CRM Mellow?': 'The browser does not come back to CRM Mellow?',
  'Al terminar en Google, el navegador va a una dirección que empieza por http://127.0.0.1 (puede que diga que no se puede abrir la página). Cópiala entera de la barra de direcciones y pégala aquí.':
    'When you finish on Google, the browser goes to an address that starts with http://127.0.0.1 (it may say the page cannot be opened). Copy the whole address from the address bar and paste it here.',
  'Dirección del navegador': 'Browser address',
  'Usar esta dirección': 'Use this address',
  'No se ha podido llegar a Google. Comprueba la conexión a internet y que CRM Mellow tiene permiso para usar la red (en GrapheneOS: Ajustes → Apps → CRM Mellow → Permisos → Red).':
    'Could not reach Google. Check your internet connection and that CRM Mellow is allowed to use the network (on GrapheneOS: Settings → Apps → CRM Mellow → Permissions → Network).',
  // Actualizar desde la app (D-120)
  'GitHub respondió {status}.': 'GitHub replied {status}.',
  'GitHub no ha dado una versión publicada.': 'GitHub did not return a published version.',
  'La versión nueva no trae su huella SHA-256: no se instala sin comprobarla.':
    'The new version has no SHA-256 checksum: it is not installed without checking it.',
  'El archivo bajado no coincide con su huella SHA-256: no se instala. Vuelve a intentarlo.':
    'The downloaded file does not match its SHA-256 checksum: it is not installed. Try again.',
  'La descarga se ha cortado.': 'The download was interrupted.',
  'Android no ha podido abrir el instalador.': 'Android could not open the installer.',
  'Al abrir la bóveda y cada hora la app mira en GitHub si hay versión nueva, y se puede actualizar desde aquí. No envía ningún dato tuyo.':
    'When you open the vault and every hour, the app checks GitHub for a new version, and you can update from here. It does not send any of your data.',
  'Buscando en GitHub…': 'Checking GitHub…',
  'Hay una versión nueva: {latest}.': 'There is a new version: {latest}.',
  'Es la última (comprobado el {when}).': 'This is the latest (checked on {when}).',
  'No se ha podido consultar GitHub: {message}': 'Could not check GitHub: {message}',
  'Actualizar a la {latest}': 'Update to {latest}',
  'Buscar ahora': 'Check now',
  'Bajando la versión {latest}: {done} de {total} MB…':
    'Downloading version {latest}: {done} of {total} MB…',
  'Bajando la versión {latest}…': 'Downloading version {latest}…',
  Descarga: 'Download',
  'Instalando la versión {latest}: la app se cerrará y se abrirá la nueva.':
    'Installing version {latest}: the app will close and the new one will open.',
  'Android tiene que permitir a CRM Mellow instalar apps: actívalo en el ajuste que se acaba de abrir, vuelve y pulsa otra vez «Actualizar».':
    'Android has to allow CRM Mellow to install apps: turn it on in the setting that just opened, come back and tap “Update” again.',
  'Bajada y comprobada. Para instalarla, abre una terminal y pega:':
    'Downloaded and checked. To install it, open a terminal and paste:',
  'No se ha podido actualizar: {message}': 'Could not update: {message}',
  Reintentar: 'Retry',
  Novedades: 'What’s new',
}
