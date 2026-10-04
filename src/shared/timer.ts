import { z } from 'zod'

/** Cronómetro del registro de horas (D-099): solo puede haber uno en marcha. */
export const timerStartSchema = z.object({
  description: z.string().trim().min(1).max(200),
  clientId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .nullable(),
})
export type TimerStart = z.infer<typeof timerStartSchema>

export const runningTimerSchema = timerStartSchema.extend({ startedAt: z.iso.datetime() })
export type RunningTimer = z.infer<typeof runningTimerSchema>

/** Horas entre dos instantes, con dos decimales y al menos 0,01 (36 s). */
export function elapsedHours(startedAt: string, now: Date): number {
  const h = (now.getTime() - Date.parse(startedAt)) / 3_600_000
  return Math.max(0.01, Math.round(h * 100) / 100)
}
