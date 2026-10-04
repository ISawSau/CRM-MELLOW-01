// Arranca en el PC el motor de la app de Android para los tests de la interfaz móvil (D-101):
// el mismo servidor local, con una carpeta de datos nueva en cada ejecución.
import { existsSync, mkdtempSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const www = join(root, 'out/mobile-test/www')
if (!existsSync(www)) symlinkSync(join(root, 'out/mobile/www'), www)
const data = mkdtempSync(join(tmpdir(), 'crm-movil-e2e-'))
process.argv = [
  process.argv[0],
  'main.js',
  '--port',
  process.env.CRM_MOBILE_PORT ?? '47200',
  '--token',
  'e2e-secreto',
  '--data',
  data,
  '--cache',
  join(data, 'cache'),
  '--version',
  '0.0.0-e2e',
]
createRequire(import.meta.url)(join(root, 'out/mobile-test/backend/main.js'))
