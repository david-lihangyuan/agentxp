// Supernode-side alias for the shared in-memory fixtures. Historical
// tests expect `startTestServer` / `TestServer`; keep those names
// alive while the canonical implementation lives in src/testing.ts.
export {
  bootstrapIdentity,
  publish,
  registerOperatorAndAgent,
  startInMemoryRelay as startTestServer,
} from '../src/testing.js'
export type { InMemoryRelay as TestServer } from '../src/testing.js'
