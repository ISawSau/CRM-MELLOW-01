import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const alias = { '@shared': resolve(__dirname, 'src/shared') }
/** El JS de better-sqlite3 tiene que ser el de la versión compilada para Android (mobile/). */
const backendAlias = {
  ...alias,
  'better-sqlite3': resolve(__dirname, 'mobile/node_modules/better-sqlite3'),
}

/**
 * Compilación de la app de Android (D-101):
 *   --mode ui       la interfaz → out/mobile/www (la misma que en escritorio)
 *   --mode backend  el motor → out/mobile/backend/main.js, para el Node de nodejs-mobile
 *                   (Node 18), en un solo archivo. El módulo nativo de better-sqlite3 se
 *                   compila aparte para Android (scripts/compilar-sqlite-android.sh).
 */
export default defineConfig(({ mode }) =>
  mode === 'backend'
    ? {
        resolve: { alias: backendAlias },
        build: {
          ssr: resolve(__dirname, 'src/mobile/main.ts'),
          target: 'node18',
          outDir: 'out/mobile/backend',
          emptyOutDir: true,
          minify: false,
          sourcemap: false,
          rollupOptions: { output: { format: 'cjs', entryFileNames: 'main.js' } },
        },
        // Todo dentro del bundle: en el móvil no hay node_modules.
        ssr: { noExternal: true, target: 'node' },
      }
    : {
        root: resolve(__dirname, 'src/renderer'),
        resolve: { alias },
        plugins: [react()],
        base: './',
        build: {
          outDir: resolve(__dirname, 'out/mobile/www'),
          emptyOutDir: true,
          sourcemap: false,
          minify: true,
          assetsInlineLimit: 0,
          modulePreload: { polyfill: false },
        },
      },
)
