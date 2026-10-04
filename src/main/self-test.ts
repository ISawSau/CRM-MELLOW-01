import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lineChartSvg } from './reports/charts'
import { htmlToPdf } from './reports/print'
import { ffmpegPath } from './tools/dialogs'
import { heicWorkerLoads } from './tools/heic'
import { VaultService } from './vault/vault-service'

/**
 * Autoprueba de la instalación: `crm-mellow --autoprueba`.
 *
 * Crea una bóveda de prueba en la carpeta temporal del sistema (con los parámetros
 * reales de Argon2id y el módulo nativo de SQLite cifrado), la bloquea, la vuelve a
 * desbloquear, comprueba que no quedan -wal ni -shm y la borra. Después comprueba las
 * piezas de la fase 9: FFmpeg (con x264), el lector de fotos HEIC, las gráficas en SVG y
 * la impresión a PDF. No toca la configuración ni ninguna bóveda real.
 */
export async function runSelfTest(log: (line: string) => void = console.log): Promise<boolean> {
  const parent = mkdtempSync(join(tmpdir(), 'crm-autoprueba-'))
  const vault = new VaultService()
  try {
    const password = 'autoprueba-' + Date.now()
    const t0 = Date.now()
    const { status } = await vault.create(parent, 'boveda', password)
    log(`ok  bóveda creada (${Date.now() - t0} ms)`)
    vault.setAutoLockMinutes(5)
    vault.lock()
    const files = readdirSync(status.path!)
    if (files.some((f) => f.endsWith('-wal') || f.endsWith('-shm') || f === '.lock')) {
      throw new Error(`quedan archivos sueltos al bloquear: ${files.join(', ')}`)
    }
    log('ok  bloqueada sin -wal, -shm ni .lock')
    const unlocked = await vault.unlock(password)
    if (unlocked.autoLockMinutes !== 5) throw new Error('los datos no se han conservado')
    log('ok  desbloqueada y datos conservados')
    vault.dispose()

    const encoders = execFileSync(ffmpegPath(), ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (!/libx264/.test(encoders)) throw new Error('FFmpeg no tiene el codificador x264')
    log('ok  FFmpeg con x264')
    if (!(await heicWorkerLoads())) throw new Error('no carga el lector de fotos HEIC')
    log('ok  lector de fotos HEIC')
    const svg = lineChartSvg({
      labels: ['01/10', '02/10'],
      values: [1, 2],
      previous: null,
      name: 'prueba',
      previousName: '',
      format: String,
      font: 'Arial',
    })
    if (!svg.startsWith('<svg')) throw new Error('las gráficas no se generan')
    const pdf = await htmlToPdf(`<!doctype html><meta charset="utf-8"><p>Autoprueba ${svg}</p>`)
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('la impresión a PDF falla')
    log(`ok  gráficas e informe en PDF (${pdf.length} bytes)`)
    log('AUTOPRUEBA CORRECTA')
    return true
  } catch (e) {
    log(`MAL ${e instanceof Error ? e.message : String(e)}`)
    log('AUTOPRUEBA FALLIDA')
    return false
  } finally {
    vault.dispose()
    rmSync(parent, { recursive: true, force: true })
  }
}
