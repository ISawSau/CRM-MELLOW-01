import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Con CRM_SQLITE_MOVIL (carpeta del módulo) se prueba con el SQLite del móvil, más antiguo
// que el del escritorio (D-127).
const movil = process.env['CRM_SQLITE_MOVIL']

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      ...(movil ? { 'better-sqlite3': resolve(movil) } : {}),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
})
