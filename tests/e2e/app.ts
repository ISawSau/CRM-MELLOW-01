import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Launched {
  app: ElectronApplication
  page: Page
  userData: string
  close: () => Promise<void>
}

/** Arranca la app compilada (out/) con una carpeta de datos temporal. */
export async function launchApp(
  extraArgs: string[] = [],
  existingUserData?: string,
): Promise<Launched> {
  const userData = existingUserData ?? mkdtempSync(join(tmpdir(), 'crm-e2e-'))
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RENDERER_URL',
    ),
  )
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, ...extraArgs],
    env,
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return {
    app,
    page,
    userData,
    close: async () => {
      await app.close()
      if (!existingUserData) rmSync(userData, { recursive: true, force: true })
    },
  }
}

/** Sustituye el selector nativo de carpetas por uno que devuelve `dir`. */
export async function stubFolderPicker(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as never
  }, dir)
}

/** Recoge errores de consola (incluidas las violaciones de la CSP) de la interfaz. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /Content Security Policy/i.test(msg.text()))
      errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}
