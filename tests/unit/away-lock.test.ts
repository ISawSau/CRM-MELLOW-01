import { afterEach, describe, expect, it, vi } from 'vitest'
import { AwayLock } from '../../src/main/away-lock'

/** Bloqueo al salir de la app en el móvil (D-130). */
describe('AwayLock', () => {
  afterEach(() => vi.useRealTimers())

  function setup(minutes = 15) {
    vi.useFakeTimers()
    let now = 1_000_000
    let unlocked = true
    const events: string[] = []
    const away = new AwayLock({
      minutes: () => minutes,
      unlocked: () => unlocked,
      lock: () => {
        unlocked = false
        events.push('lock')
      },
      onAway: (a) => events.push(a ? 'fuera' : 'vuelta'),
      now: () => now,
    })
    return {
      away,
      events,
      advance: (ms: number) => {
        now += ms
        vi.advanceTimersByTime(ms)
      },
      sleep: (ms: number) => {
        // Móvil dormido: el reloj avanza pero el temporizador no salta.
        now += ms
      },
      isUnlocked: () => unlocked,
    }
  }

  it('al volver antes de tiempo sigue desbloqueada', () => {
    const s = setup()
    s.away.leave()
    s.advance(14 * 60_000)
    expect(s.away.back()).toBe(false)
    expect(s.isUnlocked()).toBe(true)
    expect(s.events).toEqual(['fuera', 'vuelta'])
    // Y el plazo empieza de nuevo la próxima vez.
    s.away.leave()
    s.advance(14 * 60_000)
    expect(s.isUnlocked()).toBe(true)
  })

  it('pasado el tiempo se bloquea sola', () => {
    const s = setup()
    s.away.leave()
    s.advance(15 * 60_000)
    expect(s.isUnlocked()).toBe(false)
    expect(s.events).toEqual(['fuera', 'lock'])
    expect(s.away.back()).toBe(false)
  })

  it('si el temporizador no saltó (móvil dormido), se bloquea al volver', () => {
    const s = setup()
    s.away.leave()
    s.sleep(40 * 60_000)
    expect(s.isUnlocked()).toBe(true)
    expect(s.away.back()).toBe(true)
    expect(s.isUnlocked()).toBe(false)
  })

  it('con 0 minutos se bloquea al salir, como antes', () => {
    const s = setup(0)
    s.away.leave()
    expect(s.isUnlocked()).toBe(false)
    expect(s.events).toEqual(['lock'])
  })

  it('apagar la pantalla y pasar a segundo plano cuentan como una sola salida', () => {
    const s = setup()
    s.away.leave()
    s.advance(10 * 60_000)
    s.away.leave()
    s.advance(5 * 60_000)
    expect(s.isUnlocked()).toBe(false)
  })

  it('bloqueada por otro motivo, no hace nada más', () => {
    const s = setup()
    s.away.leave()
    s.away.reset()
    s.advance(60 * 60_000)
    expect(s.events).toEqual(['fuera'])
    expect(s.away.back()).toBe(false)
  })
})
