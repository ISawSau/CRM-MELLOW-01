/** Traducciones al inglés: analysis. Clave: el texto en español tal y como aparece en `t()`. */
export const analysis: Record<string, string> = {
  // --- analysis/AnalysisPage.tsx ---
  'Dashboards, comparativas y alertas sobre las métricas de las cuentas activadas de Meta. Importes en {currency}; fechas de cada cuenta.':
    'Dashboards, comparisons and alerts on the metrics of your enabled Meta accounts. Amounts in {currency}; dates in each account’s time zone.',
  'Sin datos publicitarios': 'No ad data',
  'Conecta Meta en Campañas para ver dashboards y alertas.':
    'Connect Meta in Campaigns to see dashboards and alerts.',
  'Ir a Campañas': 'Go to Campaigns',
  Dashboards: 'Dashboards',
  Comparar: 'Compare',
  'Alertas ({n})': 'Alerts ({n})',

  // --- analysis/Dashboards.tsx ---
  Dashboard: 'Dashboard',
  'Datos de': 'Data from',
  '+ Widget': '+ Widget',
  'Borrar dashboard': 'Delete dashboard',
  'Nuevo dashboard': 'New dashboard',
  '← Antes': '← Earlier',
  'Después →': 'Later →',
  'Este dashboard está vacío. Pulsa Editar → + Widget.':
    'This dashboard is empty. Click Edit → + Widget.',
  'Nombre del dashboard': 'Dashboard name',

  // --- analysis/Widget.tsx ---
  '{metric} por {dim}': '{metric} by {dim}',
  'Por {dim}': 'By {dim}',
  'Periodo anterior': 'Previous period',
  'Ver gráfica': 'View chart',
  'Ver tabla': 'View table',
  'Editar {title}': 'Edit {title}',
  'Faltan tipos de cambio: hay importes fuera.':
    'Exchange rates are missing: some amounts are left out.',
  'Editar widget': 'Edit widget',
  'Nuevo widget': 'New widget',
  'Título (opcional)': 'Title (optional)',
  Etiqueta: 'Tag',
  Ancho: 'Wide',
  Estrecho: 'Narrow',
  Medio: 'Medium',

  // --- analysis/Compare.tsx (MODE_LABELS y textos) ---
  'Periodo frente a periodo': 'Period vs. period',
  'Cliente frente a cliente': 'Client vs. client',
  'Cuenta frente a cuenta': 'Account vs. account',
  'Campaña frente a campaña': 'Campaign vs. campaign',
  'Creatividad frente a creatividad': 'Creative vs. creative',
  'Etiqueta frente a etiqueta': 'Tag vs. tag',
  'Frente a': 'Compared with',
  'El periodo anterior': 'The previous period',
  'El mismo periodo del año anterior': 'The same period last year',
  'Hacen falta al menos dos con datos en este periodo para comparar.':
    'You need at least two with data in this period to compare.',
  Diferencia: 'Difference',
  'Evolución de': 'Trend of',
  '{metric}: {a} frente a {b}': '{metric}: {a} vs. {b}',
  'La diferencia es de A frente a B. En verde lo que mejora; en rojo lo que empeora.':
    'The difference is A compared with B. Improvements in green; declines in red.',

  // --- analysis/Alerts.tsx ---
  'Editar alerta': 'Edit alert',
  'Nueva alerta': 'New alert',
  'CPA alto en Acme': 'High CPA at Acme',
  'Avisar si es': 'Alert if it is',
  Umbral: 'Threshold',
  'Escribe un número, p. ej. 30 o 1,5.': 'Enter a number, e.g. 30 or 1.5.',
  'En los últimos': 'Over the last',
  'Días completos, sin contar hoy.': 'Full days, not counting today.',
  'Las alertas se comprueban después de cada sincronización con Meta, y solo avisan dentro de la app: en la barra lateral, en Inicio y aquí.':
    'Alerts are checked after every sync with Meta, and they only notify you inside the app: in the sidebar, on Home and here.',
  'Activar {name}': 'Enable {name}',
  'últimos {n} día': 'last {n} day',
  'últimos {n} días': 'last {n} days',
  'ahora: {value}': 'now: {value}',
  'Aún no hay alertas. Ejemplo: «CPA mayor que 30 en los últimos 3 días».':
    'No alerts yet. Example: “CPA greater than 30 over the last 3 days”.',
  '+ Alerta': '+ Alert',
  Avisos: 'Notifications',
  '{metric}: {value} (más de {threshold})': '{metric}: {value} (more than {threshold})',
  '{metric}: {value} (menos de {threshold})': '{metric}: {value} (less than {threshold})',
  'del {since} al {until}': 'from {since} to {until}',
  'Ningún aviso.': 'No notifications.',

  // --- analysis/HomeCards.tsx ---
  'Ver análisis →': 'View analytics →',
  'Conectar Meta →': 'Connect Meta →',
  'Conecta Meta en Campañas para ver el gasto aquí.':
    'Connect Meta in Campaigns to see your spend here.',
  'ROAS 30 días': 'ROAS 30 days',
  'Alertas · {n} sin ver': 'Alerts · {n} unseen',
  'Ver alertas →': 'View alerts →',
  'Ningún aviso. Crea alertas en Análisis → Alertas.':
    'No notifications. Create alerts in Analytics → Alerts.',

  // --- billing/BillingPage.tsx (PERIOD_LABELS, COLUMNS y textos) ---
  'Este trimestre': 'This quarter',
  'Este año': 'This year',
  'Año pasado': 'Last year',
  Facturado: 'Invoiced',
  Cobrado: 'Collected',
  Pendiente: 'Pending',
  Vencido: 'Overdue',
  Gastos: 'Expenses',
  'Inversión publicitaria': 'Ad spend',
  'Fee previsto': 'Expected fee',
  '% del gasto previsto': 'Expected % of spend',
  'Beneficio por cliente: lo facturado y cobrado, los gastos asociados, la inversión publicitaria en Meta y lo previsto por el acuerdo de cada cliente. Las facturas se emiten con tu programa de facturación (que cumpla Verifactu) y aquí se registran.':
    'Profit by client: what was invoiced and collected, related expenses, Meta ad spend and what each client’s agreement provides for. Invoices are issued with your invoicing software (Verifactu compliant) and recorded here.',
  'Faltan tipos de cambio de alguna moneda: esos importes no se han sumado.':
    'Exchange rates are missing for some currency: those amounts have not been added.',
  '{n} factura': '{n} invoice',
  '{n} facturas': '{n} invoices',
  '{amount} vencido': '{amount} overdue',
  'cobrado − gastos': 'collected − expenses',
  'Nada en este periodo. Registra facturas y gastos en sus secciones.':
    'Nothing in this period. Record invoices and expenses in their sections.',
  'Facturas vencidas': 'Overdue invoices',
  'venció el {date} (hace {n} día)': 'due on {date} ({n} day ago)',
  'venció el {date} (hace {n} días)': 'due on {date} ({n} days ago)',
  'Ninguna factura vencida.': 'No overdue invoices.',
  'Importes en {currency}, convertidos con el tipo del BCE de cada fecha. El fee se prorratea por los días del periodo y el porcentaje se calcula sobre la inversión en las cuentas publicitarias asignadas al cliente.':
    'Amounts in {currency}, converted at the ECB rate for each date. The fee is prorated by the days in the period and the percentage is calculated on the spend in the ad accounts assigned to the client.',

  // --- gmail/GmailSettings.tsx ---
  'Muestra en la ficha de cada cliente y contacto los hilos de correo con sus direcciones. Solo lectura: la app no envía, borra ni guarda correo.':
    'Shows the email threads with their addresses on each client’s and contact’s record. Read-only: the app does not send, delete or store email.',
  'Gmail conectado': 'Gmail connected',
  'solo lectura': 'read-only',
  'Desconectar Gmail': 'Disconnect Gmail',
  'Conectar Gmail…': 'Connect Gmail…',
  'En tu proyecto de': 'In your project at',
  '(el mismo de Google Drive, si lo usas), entra en':
    '(the same one as for Google Drive, if you use it), go to',
  'y activa': 'and enable',
  '(leer el correo).': '(read email).',
  'la app debe estar publicada (en producción). Al conectar, Google avisará de que la app no está verificada: es tu propia app, así que pulsa':
    'the app must be published (in production). When you connect, Google will warn you that the app is not verified: it is your own app, so click',
  'Configuración avanzada → Ir a …': 'Advanced → Go to …',
  'Para uso personal (menos de 100 usuarios) Google no exige verificarla, y publicada el acceso no caduca cada 7 días.':
    'For personal use (fewer than 100 users) Google does not require verification, and once published the access does not expire every 7 days.',
  'Se usará el mismo ID de cliente que Google Drive. Si prefieres otro, escríbelo abajo.':
    'The same client ID as Google Drive will be used. If you prefer another one, enter it below.',
  'Copia aquí el ID de cliente (tipo app de escritorio) y, si lo hay, el secreto.':
    'Paste the client ID (desktop app type) here and, if there is one, the secret.',
  ': se abrirá tu navegador para dar permiso.': ': your browser will open so you can grant access.',
  'ID de cliente (opcional)': 'Client ID (optional)',

  // --- gmail/GmailThreads.tsx ---
  Correo: 'Email',
  'Actualizando…': 'Refreshing…',
  Actualizar: 'Refresh',
  'Conecta Gmail en Ajustes para ver aquí los correos.':
    'Connect Gmail in Settings to see emails here.',
  'No se ha podido leer el correo.': 'Could not read email.',
  'Buscando en Gmail…': 'Searching Gmail…',
  'Añade un email al cliente o a sus contactos para ver aquí sus correos.':
    'Add an email address to the client or their contacts to see their emails here.',
  'Añade un email para ver aquí sus correos.': 'Add an email address to see their emails here.',
  'Con {addresses}': 'With {addresses}',
  'No hay correos con estas direcciones.': 'There are no emails with these addresses.',
  'Cargando…': 'Loading…',
  'Cargar más': 'Load more',
  'sin leer': 'unread',
  'Abrir en Gmail': 'Open in Gmail',
}
