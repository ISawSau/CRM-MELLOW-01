// Comprueba que el ejecutable empaquetado tiene los fuses de seguridad esperados.
// Uso: node scripts/verificar-fuses.mjs <ruta al ejecutable de la app>
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses'

const expected = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: false,
}

const exe = process.argv[2]
if (!exe) {
  console.error('Falta la ruta al ejecutable.')
  process.exit(2)
}

const wire = await getCurrentFuseWire(exe)
let ok = true
for (const [name, want] of Object.entries(expected)) {
  const state = wire[FuseV1Options[name]]
  const actual = state === FuseState.ENABLE
  const mark = actual === want ? 'ok ' : 'MAL'
  if (actual !== want) ok = false
  console.log(`${mark} ${name}: ${actual ? 'activado' : 'desactivado'}`)
}
if (!ok) {
  console.error('Los fuses no coinciden con lo esperado.')
  process.exit(1)
}
