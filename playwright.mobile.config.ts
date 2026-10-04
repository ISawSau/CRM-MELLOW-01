import { defineConfig, devices } from '@playwright/test'

/**
 * Tests de la interfaz de la app de Android (D-101) en Chromium con pantalla de móvil, contra
 * el mismo motor y servidor local que lleva el APK (compilado para el Node del PC).
 * En el emulador de Android solo se comprueba que el APK arranca (CI).
 */
const PORT = 47200
export default defineConfig({
  testDir: 'tests/e2e-mobile',
  workers: 1,
  fullyParallel: false,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
    // Para usar un Chromium ya instalado en lugar del que descarga Playwright.
    ...(process.env['CRM_CHROMIUM']
      ? { launchOptions: { executablePath: process.env['CRM_CHROMIUM'] } }
      : {}),
  },
  webServer: {
    command: 'node tests/e2e-mobile/serve.mjs',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
