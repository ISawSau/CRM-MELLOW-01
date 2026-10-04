import { useSyncExternalStore } from 'react'

/** Ancho a partir del cual la interfaz pasa a la disposición de móvil (D-101). */
export const NARROW_QUERY = '(max-width: 760px)'

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(NARROW_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** ¿Pantalla estrecha (móvil, o ventana de escritorio muy estrecha)? */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW_QUERY).matches)
}
