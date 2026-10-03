/** Traducciones al inglés: platforms. Clave: el texto en español tal y como aparece en `t()`. */
export const platforms: Record<string, string> = {
  // Página y pestañas
  'LinkedIn y X': 'LinkedIn and X',
  'X Ads': 'X Ads',
  'Las cuentas de LinkedIn y X entran en Análisis, Facturación e Informes junto a las de Meta. LinkedIn se puede conectar por su API (gratis, con aprobación de LinkedIn) o con los CSV de Campaign Manager; X, con los CSV de X Ads (su API es de pago).':
    'LinkedIn and X accounts feed into Analytics, Billing and Reports alongside your Meta ones. LinkedIn can be connected through its API (free, with LinkedIn’s approval) or with Campaign Manager CSVs; X, with X Ads CSVs (its API is paid).',
  'Las cuentas de X entran en Análisis, Facturación e Informes junto a las de Meta, importando los CSV de X Ads (su API es de pago). LinkedIn es opcional: actívalo en Ajustes → Integraciones.':
    'X accounts feed into Analytics, Billing and Reports alongside your Meta ones by importing X Ads CSVs (its API is paid). LinkedIn is optional: turn it on in Settings → Integrations.',
  'Otras plataformas': 'Other platforms',
  Cuentas: 'Accounts',
  'Importar CSV': 'Import CSV',
  'API de LinkedIn': 'LinkedIn API',
  // Cuentas
  'No se pudo guardar.': 'Could not save.',
  'Sin cuentas todavía': 'No accounts yet',
  'Importa un CSV de LinkedIn Campaign Manager o de X Ads, o conecta la API de LinkedIn.':
    'Import a CSV from LinkedIn Campaign Manager or X Ads, or connect the LinkedIn API.',
  'Importar un CSV': 'Import a CSV',
  Plataforma: 'Platform',
  Cuenta: 'Account',
  'En Análisis': 'In Analytics',
  'Cliente de {name}': 'Client of {name}',
  'Usar {name}': 'Use {name}',
  'Borrar {name}': 'Delete {name}',
  'Las cuentas de la API de LinkedIn se descargan al activarlas y cada tres horas. Las de CSV se actualizan importando el archivo de nuevo (sustituye los días que trae).':
    'LinkedIn API accounts are downloaded when you turn them on and every three hours. CSV accounts are updated by importing the file again (it replaces the days it contains).',
  'Borrar cuenta': 'Delete account',
  '¿Borrar «{name}»?': 'Delete “{name}”?',
  'Se borran la cuenta y todas sus métricas de la bóveda. Si es de la API, volverá a aparecer al reconectar LinkedIn, sin activar.':
    'The account and all its metrics are deleted from the vault. If it comes from the API, it will reappear (turned off) when you reconnect LinkedIn.',
  'Borrar cuenta y datos': 'Delete account and data',
  // Importar CSV
  'El archivo no parece un CSV con datos.': "The file doesn't look like a CSV with data.",
  'No se ha podido importar.': 'Could not import.',
  'En Campaign Manager: Analizar → Exportar → informe de rendimiento de campañas, por día.':
    'In Campaign Manager: Analyze → Export → campaign performance report, by day.',
  'En X Ads: Exportar → por campaña y por día.': 'In X Ads: Export → by campaign and by day.',
  'Arrastra aquí el CSV exportado.': 'Drag the exported CSV here.',
  'Importados {rows} días de {campaigns} campañas, del {since} al {until}':
    'Imported {rows} days of {campaigns} campaigns, from {since} to {until}',
  '({n} filas sin fecha o de totales)': '({n} rows without a date or with totals)',
  'Ver cuentas': 'View accounts',
  '{n} filas': '{n} rows',
  'mapeo recordado de la última vez': 'mapping remembered from last time',
  Columnas: 'Columns',
  'Columna {n}': 'Column {n}',
  'Formato de fecha': 'Date format',
  Decimales: 'Decimals',
  'Coma (1.234,56)': 'Comma (1.234,56)',
  'Punto (1,234.56)': 'Point (1,234.56)',
  'Las conversiones son': 'Conversions are',
  'Compras (cuentan en ROAS y CPA)': 'Purchases (count towards ROAS and CPA)',
  'Otras conversiones (leads…)': 'Other conversions (leads…)',
  'Falta asignar: {fields}.': 'Still to assign: {fields}.',
  Fecha: 'Date',
  Campaña: 'Campaign',
  Importe: 'Amount',
  Impresiones: 'Impressions',
  'sin fecha': 'no date',
  'Importar en': 'Import into',
  'Una cuenta nueva': 'A new account',
  'Nombre de la cuenta': 'Account name',
  'Moneda de los importes': 'Currency of the amounts',
  'Importando…': 'Importing…',
  'Importar en {platform}': 'Import into {platform}',
  'Si ya habías importado esas fechas, se sustituyen (no se duplican).':
    'If you had already imported those dates, they are replaced (not duplicated).',
  // API de LinkedIn
  'No se pudo.': 'It could not be done.',
  'LinkedIn conectado': 'LinkedIn connected',
  'Sin conectar': 'Not connected',
  '· solo lectura · el acceso caduca el {date}': '· read-only · access expires on {date}',
  '(queda {n} día)': '({n} day left)',
  '(quedan {n} días)': '({n} days left)',
  'LinkedIn da accesos de 60 días: vuelve a conectar antes de que caduque para no perder días.':
    'LinkedIn grants 60-day access: reconnect before it expires so you don’t miss any days.',
  'Descargando campañas y métricas…': 'Downloading campaigns and metrics…',
  'Última sincronización: {date}.': 'Last sync: {date}.',
  'Activa las cuentas en la pestaña Cuentas para empezar a descargar.':
    'Turn on the accounts in the Accounts tab to start downloading.',
  En: 'In',
  y: 'and',
  'crea una app (gratis) asociada a la página de tu empresa.':
    'create an app (free) linked to your company page.',
  solicita: 'request',
  'LinkedIn revisa la solicitud; con el nivel de desarrollo ya puedes leer las cuentas que administras.':
    'LinkedIn reviews the request; with the development tier you can already read the accounts you manage.',
  'añade la dirección de vuelta': 'add the redirect URL',
  'y copia el ID y el secreto de cliente. La app solo pide':
    'and copy the client ID and client secret. The app only requests',
  '(lectura).': '(read-only).',
  'LinkedIn da accesos de 60 días: cuando caduque, vuelve a conectar. Mientras tanto (o sin aprobación) puedes importar los CSV de Campaign Manager.':
    'LinkedIn grants 60-day access: when it expires, reconnect. Meanwhile (or without approval) you can import Campaign Manager CSVs.',
  'Cómo conectar': 'How to connect',
  'Iniciar sesión': 'Sign in',
  'Pegar un token': 'Paste a token',
  'Token de acceso': 'Access token',
  'Genéralo en el portal de desarrolladores (OAuth token tools) con los permisos':
    'Generate it in the developer portal (OAuth token tools) with the permissions',
  'Dura 60 días.': 'It lasts 60 days.',
  'Conectando…': 'Connecting…',
  // Ajustes → Integraciones
  'Integraciones opcionales': 'Optional integrations',
  'Plataformas que no todo el mundo usa. Desactivadas no aparecen en la app ni se sincronizan; los datos que ya tengas se conservan.':
    'Platforms not everyone uses. When turned off they don’t appear in the app and aren’t synced; any data you already have is kept.',
  'API de publicidad en solo lectura y CSV de Campaign Manager, en la sección «LinkedIn y X».':
    'Read-only advertising API and Campaign Manager CSVs, in the “LinkedIn and X” section.',
}
