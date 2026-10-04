import { z } from 'zod'

/** Animación ASCII de la pantalla de contraseña (D-096). «aleatoria» elige una cada vez. */
export const LOCK_ANIMATIONS = ['gravedad', 'ojo', 'cerradura', 'aleatoria', 'ninguna'] as const
export const lockAnimationSchema = z.enum(LOCK_ANIMATIONS)
export type LockAnimation = (typeof LOCK_ANIMATIONS)[number]
export type LockScene = Exclude<LockAnimation, 'aleatoria' | 'ninguna'>

export const LOCK_ANIMATION_LABELS: Record<LockAnimation, string> = {
  gravedad: 'Gravedad (la de yellowmellow.cc)',
  ojo: 'El ojo',
  cerradura: 'Cerradura de la bóveda',
  aleatoria: 'Una distinta cada vez',
  ninguna: 'Ninguna',
}
