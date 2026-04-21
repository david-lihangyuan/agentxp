// Supernode-side alias for the shared in-memory fixtures. Historical
// tests expect `startTestServer` / `TestServer`; keep those names
// alive while the canonical implementation lives in src/testing.ts.
import type { InMemoryRelay } from '../src/testing.js'

export {
  bootstrapIdentity,
  publish,
  registerOperatorAndAgent,
  startInMemoryRelay as startTestServer,
} from '../src/testing.js'
export type { InMemoryRelay as TestServer } from '../src/testing.js'

// Shared JSON fetch helper. Typed generic so call sites can narrow
// the response body instead of leaking `any` into assertions.
export async function fetchJson<T = unknown>(
  srv: InMemoryRelay,
  path: string,
): Promise<{ status: number; body: T }> {
  const r = await srv.fetch(new Request(`${srv.origin}${path}`))
  return { status: r.status, body: (await r.json()) as T }
}
