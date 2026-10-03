import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReportFonts } from './report-html'

/**
 * Fuentes de la app para los informes, en base64. Empaquetada, están entre los recursos
 * de la interfaz (out/renderer/assets, con hash en el nombre); en desarrollo, también en
 * node_modules. Si no aparecen, el informe usa las fuentes del sistema.
 */
export function reportFonts(outDir: string): ReportFonts {
  const dirs = [
    join(outDir, 'renderer', 'assets'),
    join(outDir, '..', 'node_modules', '@fontsource-variable', 'archivo', 'files'),
    join(outDir, '..', 'node_modules', '@fontsource-variable', 'dm-sans', 'files'),
  ]
  const find = (prefix: string): string | null => {
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      const f = readdirSync(dir).find((n) => n.startsWith(prefix) && n.endsWith('.woff2'))
      if (f) return readFileSync(join(dir, f)).toString('base64')
    }
    return null
  }
  return { display: find('archivo-latin-wght-normal'), body: find('dm-sans-latin-wght-normal') }
}
