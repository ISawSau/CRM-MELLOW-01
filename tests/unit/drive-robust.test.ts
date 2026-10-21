import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SyncStatus } from '@shared/ipc'
import { DriveRemote, type FetchLike } from '../../src/main/sync/remote'
import { SyncService } from '../../src/main/sync/sync-service'
import { VaultService } from '../../src/main/vault/vault-service'
import { fakeDrive } from '../support/fake-drive'
import { TEST_KDF, tempDir } from './helpers'

/**
 * Sincronización con Drive desde una red de móvil (D-124): nada se queda colgado, los fallos
 * pasajeros se reintentan, lo grande sigue por donde iba y se ve el progreso.
 */
const FAST = { callTimeoutMs: 80, chunkTimeoutMs: 150, idleMs: 80, retryDelaysMs: [1, 1, 1] }
const MB = 1024 * 1024

const remote = (drive: ReturnType<typeof fakeDrive>) =>
  new DriveRemote('CRM Mellow · abcd1234', async () => 'tok', drive.http, undefined, FAST)

const isList = (m: string, u: URL) => m === 'GET' && u.pathname === '/drive/v3/files'
const isSession = (m: string, u: URL) => m === 'PUT' && u.pathname.startsWith('/session/')
const isMedia = (m: string, u: URL) => m === 'GET' && u.searchParams.get('alt') === 'media'

function file(bytes: number): { path: string; data: Buffer } {
  const data = randomBytes(bytes)
  const path = join(tempDir(), 'archivo.bin')
  writeFileSync(path, data)
  return { path, data }
}

describe('Drive en una red que falla (D-124)', () => {
  it('una llamada que no responde se corta y se repite', async () => {
    const drive = fakeDrive()
    const r = remote(drive)
    drive.faults.push({ when: isList, kind: 'hang' })
    const t0 = Date.now()
    expect(await r.list('files')).toEqual([])
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(drive.calls.some((c) => c.endsWith('…'))).toBe(true)
  })

  it('sin red, 503 o límite de uso: se reintenta; un 401 no', async () => {
    const drive = fakeDrive()
    const r = remote(drive)
    drive.faults.push({ when: isList, kind: 'network' }, { when: isList, kind: 503, times: 2 })
    await r.writeText('sync.json', '{}')
    expect(await r.readText('sync.json')).toBe('{}')
    const denied = new DriveRemote('CRM Mellow · x', async () => 'mal', drive.http, undefined, FAST)
    const before = drive.calls.length
    await expect(denied.list('')).rejects.toThrow(/no ha aceptado el acceso/)
    expect(drive.calls.length - before).toBe(1)
  })

  it('si la red no vuelve, falla con un error en lugar de quedarse esperando', async () => {
    const drive = fakeDrive()
    const r = remote(drive)
    drive.faults.push({ when: isList, kind: 'hang', times: 10 })
    await expect(r.list('')).rejects.toThrow()
  })

  it('subida grande: si se pierde la respuesta de un trozo, pregunta a Drive y sigue desde ahí', async () => {
    const drive = fakeDrive()
    const r = remote(drive)
    const { path, data } = file(20 * MB + 123)
    // El segundo trozo llega a Drive pero la respuesta se pierde; el tercero, sin red.
    let chunk = 0
    drive.faults.push({ when: (m, u) => isSession(m, u) && ++chunk === 2, kind: 'lost' })
    drive.faults.push({ when: (m, u) => isSession(m, u) && chunk === 3, kind: 'network' })
    const progress: number[] = []
    await r.put('files/grande.bin', path, (sent) => progress.push(sent))
    const out = join(tempDir(), 'vuelta.bin')
    expect(await r.get('files/grande.bin', out)).toBe(true)
    expect(readFileSync(out).equals(data)).toBe(true)
    // Una sola sesión: no ha vuelto a empezar.
    expect(drive.sessions.size).toBe(1)
    expect(progress.at(-1)).toBe(data.length)
  })

  it('subida grande: si la sesión caduca, empieza otra', async () => {
    const drive = fakeDrive()
    const r = remote(drive)
    const { path, data } = file(10 * MB)
    let chunk = 0
    drive.faults.push({
      when: (m, u) => {
        if (!isSession(m, u) || ++chunk !== 2) return false
        drive.sessions.delete(u.pathname)
        return true
      },
      kind: 'network',
    })
    await r.put('files/caduca.bin', path)
    const out = join(tempDir(), 'vuelta.bin')
    await r.get('files/caduca.bin', out)
    expect(readFileSync(out).equals(data)).toBe(true)
  })

  it('descarga cortada a medias: sigue desde el byte en que iba (Range)', async () => {
    const drive = fakeDrive()
    const r = remote(drive)
    const { path, data } = file(3 * MB)
    await r.put('files/libro.bin', path)
    drive.faults.push({ when: isMedia, kind: 'cut' })
    const out = join(tempDir(), 'libro.bin')
    const seen: number[] = []
    expect(await r.get('files/libro.bin', out, (got) => seen.push(got))).toBe(true)
    expect(readFileSync(out).equals(data)).toBe(true)
    expect(Math.max(...seen)).toBe(data.length)
  })
})

describe('SyncService con Drive (D-124)', () => {
  const vaults: VaultService[] = []
  afterEach(() => {
    for (const v of vaults.splice(0)) v.dispose()
  })
  const client = { clientId: 'cliente.apps.googleusercontent.com', clientSecret: 'secreto' }

  async function setup(drive = fakeDrive()) {
    const http: FetchLike = async (input, init) =>
      String(input) === 'https://oauth2.googleapis.com/token'
        ? new Response(
            JSON.stringify({ access_token: 'tok', refresh_token: 'renovar', expires_in: 3600 }),
          )
        : drive.http(input, init)
    const openBrowser = (u: string) => {
      const url = new URL(u)
      void fetch(
        `${url.searchParams.get('redirect_uri')!}/?code=c&state=${url.searchParams.get('state')!}`,
      )
    }
    const vault = new VaultService({ kdf: TEST_KDF, hostname: 'movil' })
    await vault.create(tempDir(), 'boveda', 'contraseña larga')
    vaults.push(vault)
    const statuses: SyncStatus[] = []
    const holds: string[] = []
    const sync = new SyncService(vault, {
      hostname: 'movil',
      openBrowser,
      http,
      driveTiming: FAST,
      onChange: (s) => statuses.push(s),
      hold: (text) => {
        holds.push(`+${text}`)
        return () => holds.push('-')
      },
    })
    await sync.configureDrive(client)
    return { drive, vault, sync, statuses, holds }
  }

  it('enseña qué sube y cuánto lleva, y mantiene el móvil despierto mientras tanto', async () => {
    const { vault, sync, statuses, holds } = await setup()
    for (let i = 0; i < 3; i++) vault.data.importBuffer(`a${i}.bin`, randomBytes(200_000))
    await sync.sync()
    expect(sync.status()).toMatchObject({ phase: 'idle', progress: null })
    const up = statuses.filter((s) => s.progress?.step === 'subiendo')
    expect(up.length).toBeGreaterThan(0)
    const last = up.at(-1)!.progress!
    expect(last.done).toBe(last.total)
    expect(last.total).toBe(4) // tres archivos y la base de datos
    expect(last.bytes).toBe(last.totalBytes)
    expect(holds).toEqual(['+Sincronizando la bóveda…', '-'])
  })

  it('si Drive deja de responder, acaba en error (no en «sincronizando» para siempre) y suelta el móvil', async () => {
    const { drive, sync, holds } = await setup()
    drive.faults.push({ when: () => true, kind: 'hang', times: 100 })
    await sync.sync()
    expect(sync.status().phase).toBe('error')
    expect(sync.status().progress).toBeNull()
    expect(holds.at(-1)).toBe('-')
  })

  it('un archivo que no baja no impide bajar los demás', async () => {
    const drive = fakeDrive()
    const pc = await setup(drive)
    const a = pc.vault.data.importBuffer('a.bin', randomBytes(1000))
    const b = pc.vault.data.importBuffer('b.bin', randomBytes(2000))
    await pc.sync.sync()
    expect(pc.sync.status().phase).toBe('idle')
    // Otro equipo con la misma bóveda y sin los archivos.
    const { rmSync } = await import('node:fs')
    for (const f of [a, b])
      rmSync(join(pc.vault.currentPath!, 'files', f.id.slice(0, 2), `${f.id}.bin`))
    drive.faults.push({
      when: (m, u) =>
        isMedia(m, u) &&
        [...drive.files.values()].find((x) => u.pathname.endsWith(x.id))?.name === `${a.id}.bin`,
      kind: 'network',
      times: 10,
    })
    await pc.sync.sync()
    expect(pc.sync.status().phase).toBe('error')
    expect(pc.sync.status().error).toMatch(/No se pudo bajar 1 archivo/)
    expect(pc.vault.data.files.exists(b.id)).toBe(true)
    expect(pc.vault.data.files.exists(a.id)).toBe(false)
  })
})
