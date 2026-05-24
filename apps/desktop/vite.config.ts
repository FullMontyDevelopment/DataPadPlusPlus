import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

function desktopManualChunks(id: string) {
  const normalizedId = id.replace(/\\/g, '/')

  if (
    normalizedId.includes('/node_modules/react/') ||
    normalizedId.includes('/node_modules/react-dom/') ||
    normalizedId.includes('/node_modules/scheduler/')
  ) {
    return 'react-vendor'
  }
}

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      '@datapadplusplus/shared-types': fileURLToPath(
        new URL('../../packages/shared-types/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    rolldownOptions: {
      output: {
        manualChunks: desktopManualChunks,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
