import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so the app config can use the latest Vite
// while vitest runs its own compatible pipeline.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
  },
})
