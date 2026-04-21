// Bundle config for @agentxp/openclaw-plugin.
// @agentxp/protocol is a workspace-internal package not published to
// npm, so we inline it (and its transitive @noble/* deps) into the
// shipped dist/. better-sqlite3 is a native module and MUST stay
// external so host-side npm install can build its prebuilt binary.
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    adapter: 'src/adapter.ts',
  },
  format: ['esm'],
  target: 'node18',
  dts: { resolve: ['@agentxp/protocol'] },
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ['better-sqlite3'],
  noExternal: ['@agentxp/protocol', '@noble/curves', '@noble/hashes'],
})
