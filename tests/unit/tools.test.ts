import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FileRef } from '../../src/shared/data/fields'
import {
  fitWithin,
  parseProbe,
  videoArgs,
  videoFilter,
  videoOutputName,
} from '../../src/shared/tools'
import { TOOLS_TMP, ToolsService } from '../../src/main/tools/tools-service'
import { VaultService } from '../../src/main/vault/vault-service'
import { TEST_KDF, tempDir } from './helpers'

const FFMPEG = join(
  __dirname,
  '..',
  '..',
  'vendor',
  'ffmpeg',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
)
const hasFfmpeg = existsSync(FFMPEG)

const PROBE = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mov':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 2000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 1900 kb/s, 30 fps
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s
At least one output file must be specified`

describe('vídeo: presets y argumentos de FFmpeg', () => {
  it('lee duración, dimensiones (con rotación) y audio', () => {
    expect(parseProbe(PROBE)).toEqual({ duration: 62.5, width: 1080, height: 1920, audio: true })
    expect(parseProbe('nada')).toEqual({ duration: null, width: null, height: null, audio: false })
  })

  it('ajusta al lado mayor con dimensiones pares', () => {
    expect(fitWithin(3840, 2160)).toEqual([1920, 1080])
    expect(fitWithin(1279, 719)).toEqual([1280, 720])
    expect(fitWithin(101, 51, 50)).toEqual([50, 26])
  })

  it('recorta o añade bandas para los formatos de Meta', () => {
    expect(videoFilter('vertical', 'recortar', { width: 1920, height: 1080 })).toBe(
      'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1',
    )
    expect(videoFilter('feed', 'bandas', { width: 1920, height: 1080 })).toContain(
      'pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black',
    )
    expect(videoFilter('comprimir', 'recortar', { width: 3840, height: 2160 })).toBe(
      'scale=1920:1080,setsar=1',
    )
    const args = videoArgs(
      '/v/a b.mov',
      '/o/x.mp4',
      { preset: 'cuadrado', fit: 'recortar', quality: 'baja', mute: true },
      { width: 100, height: 100 },
    )
    expect(args).toContain('/v/a b.mov')
    expect(args[args.indexOf('-crf') + 1]).toBe('28')
    expect(args).toContain('-an')
    expect(args.at(-1)).toBe('/o/x.mp4')
    expect(videoOutputName('anuncio final.mov', 'vertical')).toBe('anuncio final-9x16.mp4')
  })
})

describe('servicio de herramientas', () => {
  const vaults: VaultService[] = []
  afterEach(() => {
    for (const v of vaults.splice(0)) v.dispose()
  })

  async function setup() {
    const vault = new VaultService({ kdf: TEST_KDF, hostname: 'equipo' })
    await vault.create(tempDir(), 'Boveda', 'contraseña de prueba')
    vaults.push(vault)
    const progress: number[] = []
    let exportTo: string | null = null
    const tools = new ToolsService(vault, {
      ffmpeg: () => FFMPEG,
      savePath: async () => exportTo,
      onProgress: (p) => progress.push(p.ratio),
      now: () => new Date('2026-10-03T10:00:00Z'),
    })
    return { vault, tools, progress, exportTo: (p: string | null) => (exportTo = p) }
  }

  const docs = (vault: VaultService) => {
    const d = vault.data
    const f = (k: string) => d.listFields('documento').find((x) => x.key === k)!.id
    return d.query('documento').map((r) => ({
      title: r.title,
      tipo: r.values[f('tipo')],
      fecha: r.values[f('fecha')],
      archivos: r.values[f('archivos')] as FileRef[],
      cliente: (r.values[f('cliente')] as { title: string }[] | undefined)?.[0]?.title,
    }))
  }

  it('guarda un resultado en la bóveda como documento del cliente, o lo exporta', async () => {
    const { vault, tools, exportTo } = await setup()
    const nombre = vault.data.listFields('cliente').find((f) => f.key === 'nombre')!.id
    const acme = vault.data.create('cliente', { [nombre]: 'Acme' })
    const bytes = new TextEncoder().encode('%PDF-1.7 prueba')
    const r = await tools.saveResult({
      name: 'unido.pdf',
      data: bytes,
      target: 'boveda',
      clientId: acme.id,
      tipo: 'herramienta',
    })
    expect(r?.recordId).toBeTruthy()
    const [doc] = docs(vault)
    expect(doc).toMatchObject({ title: 'unido.pdf', tipo: 'herramienta', fecha: '2026-10-03' })
    expect(doc!.cliente).toBe('Acme')
    expect(doc!.archivos[0]).toMatchObject({ name: 'unido.pdf', mime: 'application/pdf' })
    expect(vault.data.files.read(doc!.archivos[0]!.id).toString()).toBe('%PDF-1.7 prueba')

    // Exportar: se cancela el diálogo y luego se elige un destino.
    expect(
      await tools.saveResult({
        name: 'x.pdf',
        data: bytes,
        target: 'exportar',
        clientId: null,
        tipo: 'herramienta',
      }),
    ).toBeNull()
    const out = join(tempDir(), 'x.pdf')
    exportTo(out)
    const e = await tools.saveResult({
      name: 'x.pdf',
      data: bytes,
      target: 'exportar',
      clientId: null,
      tipo: 'herramienta',
    })
    expect(e).toEqual({ name: 'x.pdf', recordId: null, path: out })
    expect(readFileSync(out, 'utf8')).toBe('%PDF-1.7 prueba')
    expect(docs(vault)).toHaveLength(1)
  })

  it('rechaza rutas que no son vídeos', async () => {
    const { tools } = await setup()
    await expect(tools.openVideo('relativo.mp4')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(tools.openVideo(join(tempDir(), 'datos.db'))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(tools.openVideo(join(tempDir(), 'no-existe.mp4'))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it.skipIf(!hasFfmpeg)(
    'convierte un vídeo a 9:16 dentro de la bóveda y a 1:1 exportado',
    async () => {
      const { vault, tools, progress, exportTo } = await setup()
      const src = join(tempDir(), 'anuncio.mp4')
      execFileSync(FFMPEG, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=2:size=320x180:rate=15',
        '-f',
        'lavfi',
        '-i',
        'sine=duration=2',
        '-shortest',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        src,
      ])
      const info = await tools.openVideo(src)
      expect(info).toMatchObject({ name: 'anuncio.mp4', width: 320, height: 180 })
      expect(info.duration).toBeCloseTo(2, 0)

      const r = await tools.convertVideo({
        token: info.token,
        preset: 'vertical',
        fit: 'recortar',
        quality: 'baja',
        mute: false,
        target: 'boveda',
        clientId: null,
      })
      expect(r?.recordId).toBeTruthy()
      expect(progress.at(-1)).toBe(1)
      const [doc] = docs(vault)
      expect(doc!.title).toBe('anuncio-9x16.mp4')
      expect(doc!.archivos[0]).toMatchObject({ name: 'anuncio-9x16.mp4', mime: 'video/mp4' })
      // Nada en claro se queda en la carpeta temporal de la bóveda.
      expect(readdirSync(join(vault.currentPath!, TOOLS_TMP))).toEqual([])

      const out = join(tempDir(), 'cuadrado.mp4')
      exportTo(out)
      const e = await tools.convertVideo({
        token: info.token,
        preset: 'cuadrado',
        fit: 'bandas',
        quality: 'media',
        mute: true,
        target: 'exportar',
        clientId: null,
      })
      expect(e).toEqual({ name: 'anuncio-1x1.mp4', recordId: null, path: out })
      const probe = parseProbe(
        (() => {
          try {
            execFileSync(FFMPEG, ['-hide_banner', '-i', out], { stdio: 'pipe' })
            return ''
          } catch (err) {
            return String((err as { stderr: Buffer }).stderr)
          }
        })(),
      )
      expect(probe).toMatchObject({ width: 1080, height: 1080, audio: false })
      tools.dispose()
      expect(existsSync(join(vault.currentPath!, TOOLS_TMP))).toBe(false)
    },
    60_000,
  )
})

describe('rangos de páginas para dividir un PDF', () => {
  it('admite rangos, páginas sueltas y rangos abiertos', async () => {
    const { parseRanges } = await import('../../src/shared/tools')
    expect(parseRanges('1-3, 5, 8-', 9)).toEqual([[0, 1, 2], [4], [7, 8]])
    expect(parseRanges('-2', 4)).toEqual([[0, 1]])
    expect(parseRanges('', 3)).toEqual([[0], [1], [2]])
    expect(parseRanges('cada', 2)).toEqual([[0], [1]])
    expect(parseRanges('2-12', 5)).toContain('5 páginas')
    expect(parseRanges('3-1', 5)).toContain('no cabe')
    expect(parseRanges('a', 5)).toContain('no es un rango')
    expect(parseRanges(' , ', 5)).toBe('Indica al menos un rango.')
  })
})
