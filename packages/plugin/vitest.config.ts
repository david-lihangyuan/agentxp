import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    // Prefer root node_modules (has compiled native bindings for better-sqlite3)
    alias: {
      'better-sqlite3': resolve(__dirname, '../../node_modules/better-sqlite3/lib/index.js'),
    },
  },
  test: {
    environment: 'node',
  },
})
