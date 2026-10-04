import { z } from 'zod'

/**
 * Plantillas de correo (D-098). Gmail sigue en solo lectura: la app no envía nada. Rellena
 * la plantilla con los datos del cliente o contacto y la abre en la ventana de redactar de
 * Gmail (en el navegador) o en el programa de correo del equipo (mailto:), para revisarla
 * y enviarla desde allí.
 */

export const mailTemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(80),
  subject: z.string().max(300),
  body: z.string().max(10_000),
})
export type MailTemplate = z.infer<typeof mailTemplateSchema>

export const MAX_MAIL_TEMPLATES = 50
export const mailTemplatesSchema = z
  .array(mailTemplateSchema)
  .max(MAX_MAIL_TEMPLATES)
  .refine((l) => new Set(l.map((x) => x.id)).size === l.length, 'Hay plantillas repetidas.')

/** Variables que se pueden usar en el asunto y en el texto, con su descripción. */
export const MAIL_VARIABLES = {
  nombre: 'Nombre del contacto (o del cliente)',
  cliente: 'Nombre del cliente',
  mi_nombre: 'Tu nombre (Perfil)',
  empresa: 'Tu empresa (Perfil)',
  fecha: 'Fecha de hoy',
  mes: 'Mes actual',
} as const
export type MailVariable = keyof typeof MAIL_VARIABLES

/** Sustituye {variable}; las que no existen o están vacías se dejan como estaban. */
export function fillTemplate(text: string, vars: Partial<Record<MailVariable, string>>): string {
  return text.replace(/\{([a-z_]+)\}/g, (all, name: string) => {
    const v = vars[name as MailVariable]
    return v ? v : all
  })
}

/** Ventana de redactar de Gmail en el navegador, con todo relleno. */
export function gmailComposeUrl(to: string[], subject: string, body: string): string {
  const p = new URLSearchParams({ view: 'cm', fs: '1', to: to.join(','), su: subject, body })
  return `https://mail.google.com/mail/?${p.toString()}`
}

/** El programa de correo del equipo. */
export function mailtoUrl(to: string[], subject: string, body: string): string {
  const p = new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20')
  return `mailto:${to.map(encodeURIComponent).join(',')}?${p}`
}

/** Plantillas de serie (se pueden cambiar o borrar). */
export const DEFAULT_MAIL_TEMPLATES: MailTemplate[] = [
  {
    id: 'seguimiento',
    name: 'Seguimiento de propuesta',
    subject: 'Propuesta de publicidad para {cliente}',
    body: 'Hola, {nombre}:\n\nTe escribo para saber si has podido revisar la propuesta que os envié. Si te parece, podemos hablarlo esta semana y resolver cualquier duda.\n\nUn saludo,\n{mi_nombre}\n{empresa}',
  },
  {
    id: 'informe',
    name: 'Informe mensual',
    subject: 'Informe de resultados de {mes} · {cliente}',
    body: 'Hola, {nombre}:\n\nTe adjunto el informe de resultados de {mes}. En resumen: [qué ha ido bien, qué cambiamos y próximos pasos].\n\nCualquier cosa, me dices.\n\nUn saludo,\n{mi_nombre}',
  },
  {
    id: 'factura',
    name: 'Recordatorio de factura',
    subject: 'Recordatorio: factura pendiente · {empresa}',
    body: 'Hola, {nombre}:\n\nTe recuerdo que tenemos pendiente la factura [número] con vencimiento [fecha]. Si ya está pagada, ignora este mensaje.\n\nGracias,\n{mi_nombre}',
  },
]
