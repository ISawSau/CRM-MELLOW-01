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
export async function launchApp(extraArgs: string[] = []): Promise<Launched> {
  const userData = mkdtempSync(join(tmpdir(), 'crm-e2e-'))
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
      rmSync(userData, { recursive: true, force: true })
    },
  }
}
