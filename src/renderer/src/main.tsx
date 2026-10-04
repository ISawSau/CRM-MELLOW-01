import '@fontsource-variable/archivo'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'
import './styles/data.css'
import './styles/meta.css'
import './styles/analysis.css'
import './styles/tools.css'
import './styles/gmail.css'
import './styles/hypr.css'
import './styles/mobile.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getLocale, setLocale } from '@shared/i18n'
import { App } from './App'
import { call } from './lib/ipc'
import { installMobileBridge } from './lib/mobile-bridge'

// En Android no hay preload: la interfaz habla con el motor por el servidor local (D-101).
if (!('api' in window)) installMobileBridge()

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

/** El idioma se fija antes de pintar nada (al cambiarlo, la ventana se recarga). */
async function start() {
  try {
    setLocale(await call('app:locale'))
  } catch {
    // Sin respuesta del proceso principal: español.
  }
  document.documentElement.lang = getLocale()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}
void start()
