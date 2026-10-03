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
  // Sin plural en español: en inglés se redacta para que valga con 1.
  'Importados {rows} días de {campaigns} campañas, del {since} al {until}':
    'Imported — days: {rows}, campaigns: {campaigns}, from {since} to {until}',
}
