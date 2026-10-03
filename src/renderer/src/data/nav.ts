import { useQuery } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import { DEFAULT_PROFILE } from '@shared/profile'
import { call } from '../lib/ipc'

/** Abrir la ficha de un registro de cualquier entidad (va a su sección). */
export const NavContext = createContext<{ openRecord: (entity: string, id: string) => void }>({
  openRecord: () => {},
})
export const useNav = () => useContext(NavContext)

export function useProfile() {
  return useQuery({ queryKey: ['data', 'profile'], queryFn: () => call('profile:get') })
}

/** Zona horaria del perfil (Europe/Madrid por defecto). */
export function useTimeZone(): string {
  return useProfile().data?.timeZone ?? DEFAULT_PROFILE.timeZone
}
