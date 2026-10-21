import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
  },
  preload: {
    resolve: { alias },
    build: {
      // Con sandbox, el preload tiene que ser un único archivo CommonJS.
      rollupOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    resolve: { alias },
    plugins: [react()],
    build: {
      // Sin source maps en producción ni módulos inline (CSP sin 'unsafe-inline').
      sourcemap: false,
      minify: true,
      assetsInlineLimit: 0,
      modulePreload: { polyfill: false },
      // La app y el lector de ebooks, que se sirve desde otro origen (D-123).
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          reader: resolve(__dirname, 'src/renderer/reader.html'),
        },
      },
    },
  },
})
