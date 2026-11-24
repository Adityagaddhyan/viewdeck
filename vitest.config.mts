import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/** Unit tests run in plain Node (no Electron). Co-locate tests as `*.test.ts`. */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true
  }
})
