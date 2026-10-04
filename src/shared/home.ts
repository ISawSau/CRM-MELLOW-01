import { z } from 'zod'
import { widgetSchema } from './analysis'

/**
 * Inicio configurable (SPEC §7.1, fase 12): qué tarjetas se ven y en qué orden, más
 * widgets de Análisis (cifras, gráficas, tablas y rankings de todas las cuentas).
 */
export const HOME_CARDS = [
  'kpis',
  'etapas',
  'notas',
  'gasto',
  'ritmo',
  'tareas',
  'alertas',
] as const
/** Las que había antes de la fase 14: las nuevas se añaden solas a un Inicio ya personalizado. */
export const LEGACY_HOME_CARDS: readonly HomeCard[] = [
  'kpis',
  'etapas',
  'notas',
  'gasto',
  'tareas',
  'alertas',
]
export type HomeCard = (typeof HOME_CARDS)[number]
export const HOME_CARD_LABELS: Record<HomeCard, string> = {
  kpis: 'Cifras clave (clientes, fees, contactos y notas)',
  etapas: 'Clientes por etapa',
  notas: 'Notas recientes y fijadas',
  gasto: 'Gasto y ROAS',
  ritmo: 'Ritmo de gasto del mes',
  tareas: 'Tareas de hoy y atrasadas',
  alertas: 'Alertas',
}

export const homeItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('card'), id: z.enum(HOME_CARDS) }),
  z.object({ kind: z.literal('widget'), widget: widgetSchema }),
])
export type HomeItem = z.infer<typeof homeItemSchema>

export const homeLayoutSchema = z.object({
  items: z
    .array(homeItemSchema)
    .max(30)
    .refine(
      (items) => {
        const keys = items.map((i) => (i.kind === 'card' ? i.id : i.widget.id))
        return new Set(keys).size === keys.length
      },
      { message: 'Hay elementos repetidos en Inicio.' },
    ),
})
export type HomeLayout = z.infer<typeof homeLayoutSchema>

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  items: HOME_CARDS.map((id) => ({ kind: 'card', id })),
}

/** Clave estable de un elemento (para listas y para moverlo). */
export function homeItemKey(i: HomeItem): string {
  return i.kind === 'card' ? i.id : i.widget.id
}
