import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { localeSchema, type Locale } from '@shared/i18n'
import { writeFileAtomic } from './fs-utils'

/**
 * Única información que la app guarda fuera de la bóveda (CLAUDE.md): qué bóveda
 * abrir al arrancar y en qué idioma mostrar la pantalla de contraseña (hace falta antes
 * de abrir la bóveda; no es un dato del usuario, D-090). Vive en la carpeta de datos de la
 * app del sistema (Linux: ~/.config/CRM-Mellow, Windows: %APPDATA%\CRM-Mellow).
 */
const configSchema = z.object({
  lastVaultPath: z.string().nullable().default(null),
  locale: localeSchema.default('es'),
})
export type AppConfig = z.infer<typeof configSchema>

const FILE = 'config.json'

export class ConfigStore {
  private readonly file: string
  private data: AppConfig

  constructor(dir: string) {
    this.file = join(dir, FILE)
    this.data = this.read()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  private read(): AppConfig {
    try {
      const parsed = configSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')))
      if (parsed.success) return parsed.data
    } catch {
      // Sin archivo o ilegible: se empieza de cero.
    }
    return { lastVaultPath: null, locale: 'es' }
  }

  get(): AppConfig {
    return { ...this.data }
  }

  setLastVaultPath(path: string | null): void {
    this.data = { ...this.data, lastVaultPath: path }
    writeFileAtomic(this.file, JSON.stringify(this.data, null, 2) + '\n')
  }

  setLocale(locale: Locale): void {
    this.data = { ...this.data, locale }
    writeFileAtomic(this.file, JSON.stringify(this.data, null, 2) + '\n')
  }
}
