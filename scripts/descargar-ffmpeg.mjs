// Descarga FFmpeg (para comprimir y convertir vídeo, SPEC §7.11) y comprueba su huella
// SHA-256 con las de este archivo antes de usarlo (D-073). Los scripts de instalación
// de npm están desactivados (.npmrc), así que se ejecuta a mano, en CI y en los scripts
// de instalación: node scripts/descargar-ffmpeg.mjs [win32-x64|linux-x64]
//
// Binarios de la versión b6.1.1 de github.com/eugeneware/ffmpeg-static (FFmpeg 7,
// GPL-3.0; compilaciones de John Van Sickle para Linux y de Gyan Doshi para Windows).
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const RELEASE = 'b6.1.1'
const HASHES = {
  'linux-x64': 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
  'win32-x64': '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
}

const target = process.argv[2] ?? `${process.platform}-${process.arch}`
const expected = HASHES[target]
if (!expected) {
  console.error(`No hay FFmpeg para ${target}. Plataformas: ${Object.keys(HASHES).join(', ')}`)
  process.exit(1)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'vendor', 'ffmpeg')
const exe = join(dir, target.startsWith('win32') ? 'ffmpeg.exe' : 'ffmpeg')
const stamp = join(dir, '.sha256')

if (existsSync(exe) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === expected) {
  console.log(`FFmpeg ya está descargado y verificado (${target}).`)
  process.exit(0)
}

const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}/ffmpeg-${target}.gz`
console.log(`Descargando ${url}`)
const res = await fetch(url, { redirect: 'follow' })
if (!res.ok) {
  console.error(`La descarga falló: HTTP ${res.status}`)
  process.exit(1)
}
const gz = Buffer.from(await res.arrayBuffer())
const hash = createHash('sha256').update(gz).digest('hex')
if (hash !== expected) {
  console.error(`La huella SHA-256 no coincide.\n  esperada: ${expected}\n  obtenida: ${hash}`)
  process.exit(1)
}
mkdirSync(dir, { recursive: true })
writeFileSync(`${exe}.tmp`, gunzipSync(gz))
chmodSync(`${exe}.tmp`, 0o755)
renameSync(`${exe}.tmp`, exe)
writeFileSync(stamp, `${expected}\n`)
console.log(`FFmpeg verificado (SHA-256 ${hash.slice(0, 16)}…) en ${exe}`)
