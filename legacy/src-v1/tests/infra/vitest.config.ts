import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.test.ts'],
    testTimeout: 60000, // allow esbuild bundle step up to 60s
    reporters: ['verbose'],
  },
})
