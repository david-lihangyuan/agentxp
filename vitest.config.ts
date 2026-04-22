import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Root-relative 'packages/**' only resolves from the repo root, so
    // `npm test` inside a workspace used to silently match zero files
    // and exit 0. '**' is relative to the current cwd and works from
    // both the repo root and any packages/<name>/ subdir.
    include: ['**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'legacy/**'],
  },
})
