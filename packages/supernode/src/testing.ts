// In-memory test fixtures shared across the supernode, skill, and
// openclaw-plugin test suites. Provides a buildApp()+:memory: SQLite
// relay wrapped in a Web-fetch-shaped interface, plus helpers to
// sign and publish identity events.
//
// Intentionally co-located with production src so vitest (and any
// downstream in-repo consumer) can pick it up from source without a
// separate build step. Kept out of src/index.ts so the published
// bundle doesn't carry the test-only wiring.
import { createEvent, delegateAgentKey, generateOperatorKey, signEvent } from '@agentxp/protocol'
import type { AgentKey, OperatorKey, SerendipEvent } from '@agentxp/protocol'
import { buildApp } from './app.js'
import { openDb, type Db } from './db.js'

// Explicit fetch signature — avoids `typeof globalThis.fetch`, which
// pulls in environment-specific extensions (e.g. Bun's `preconnect`)
// that aren't present in tsc's build lib.
export type RelayFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface InMemoryRelay {
  db: Db
  fetch: RelayFetch
  origin: string
}

const DEFAULT_ORIGIN = 'http://relay.test'

export function startInMemoryRelay(origin: string = DEFAULT_ORIGIN): InMemoryRelay {
  const db = openDb(':memory:')
  const app = buildApp({ db })
  const fetchImpl: RelayFetch = async (input, init) => {
    const req =
      input instanceof Request
        ? input
        : new Request(typeof input === 'string' ? input : input.toString(), init)
    return app.fetch(req)
  }
  return { db, fetch: fetchImpl, origin }
}

export async function publish(
  server: InMemoryRelay,
  event: SerendipEvent,
  path = '/api/v1/events',
): Promise<{ status: number; body: unknown }> {
  const res = await server.fetch(`${server.origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event }),
  })
  return { status: res.status, body: await res.json() }
}

// Register a caller-supplied (operator, agent) pair. Used when the
// test has generated its own keys (e.g. to exercise multi-operator
// behavior).
export async function registerOperatorAndAgent(
  server: InMemoryRelay,
  operator: OperatorKey,
  agent: AgentKey,
): Promise<void> {
  const operatorAsAgent: AgentKey = {
    publicKey: operator.publicKey,
    privateKey: operator.privateKey,
    delegatedBy: operator.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 86_400,
    agentId: 'self',
  }

  const reg = await signEvent(
    createEvent(
      'identity.register',
      {
        type: 'operator',
        data: {
          pubkey: operator.publicKey,
          registered_at: Math.floor(Date.now() / 1000),
        },
      },
      [],
    ),
    operatorAsAgent,
  )
  const regRes = await publish(server, reg)
  if (regRes.status !== 200) {
    throw new Error(`identity.register failed: ${regRes.status} ${JSON.stringify(regRes.body)}`)
  }

  const delegation: { agent_pubkey: string; expires_at: number; agent_id?: string } = {
    agent_pubkey: agent.publicKey,
    expires_at: agent.expiresAt,
  }
  if (agent.agentId !== undefined) delegation.agent_id = agent.agentId

  const del = await signEvent(
    createEvent('identity.delegate', { type: 'delegation', data: delegation }, []),
    operatorAsAgent,
  )
  const delRes = await publish(server, del)
  if (delRes.status !== 200) {
    throw new Error(`identity.delegate failed: ${delRes.status} ${JSON.stringify(delRes.body)}`)
  }
}

export interface BootstrapIdentityOptions {
  agentId?: string
  delegationDays?: number
}

// Convenience: generate a fresh (operator, agent) pair, register
// both on the relay, and return the keys. For tests that don't
// care about specific key values.
export async function bootstrapIdentity(
  server: InMemoryRelay,
  opts: BootstrapIdentityOptions = {},
): Promise<{ operator: OperatorKey; agent: AgentKey }> {
  const operator = await generateOperatorKey()
  const agent = await delegateAgentKey(
    operator,
    opts.agentId ?? 'test-agent',
    opts.delegationDays ?? 30,
  )
  await registerOperatorAndAgent(server, operator, agent)
  return { operator, agent }
}
