import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * electron-vite builds three bundles: main (Node), preload (sandboxed bridge),
 * renderer (browser). `@shared` is aliased in all three so IPC contracts and
 * driver types are defined exactly once (src/shared).
 */
const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    resolve: {
      alias: {
        ...shared,
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        // Lean Monaco imports (features/editor/monacoLean.ts) bypass the package exports map.
        '@monaco-esm': resolve(__dirname, 'node_modules/monaco-editor/esm/vs')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
