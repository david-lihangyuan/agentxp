// Shared test fixtures for @agentxp/skill. Spins an in-memory M2
// relay (buildApp + :memory: SQLite) and exposes a fetch callable
// suitable for injection into the publisher.
import {
  createEvent,
  signEvent,
} from '@serendip/protocol'
import type { AgentKey, OperatorKey } from '@serendip/protocol'
// Intentionally pull the app factory from source so the skill test
// suite runs without a separate supernode build step. The dev-only
// dependency on @serendip/supernode is still declared in package.json
// for typechecking.
import { buildApp } from '../../supernode/src/app.js'
import { openDb } from '../../supernode/src/db.js'

export interface SkillTestServer {
  fetch: typeof globalThis.fetch
  origin: string
}

// Hono's fetch signature differs from the DOM fetch signature: it
// accepts either a Request or a URL/string. Wrap to satisfy the DOM
// shape for publisher usage.
export function startInMemoryRelay(): SkillTestServer {
  const db = openDb(':memory:')
  const app = buildApp({ db })
  const origin = 'http://relay.test'
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init)
    return app.fetch(req)
  }
  return { fetch: fetchImpl, origin }
}

export async function registerOperatorAndAgent(
  server: SkillTestServer,
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
        data: { pubkey: operator.publicKey, registered_at: Math.floor(Date.now() / 1000) },
      },
      [],
    ),
    operatorAsAgent,
  )
  await expect200(server, reg)

  const delegation: { agent_pubkey: string; expires_at: number; agent_id?: string } = {
    agent_pubkey: agent.publicKey,
    expires_at: agent.expiresAt,
  }
  if (agent.agentId !== undefined) delegation.agent_id = agent.agentId

  const del = await signEvent(
    createEvent(
      'identity.delegate',
      { type: 'delegation', data: delegation },
      [],
    ),
    operatorAsAgent,
  )
  await expect200(server, del)
}

async function expect200(
  server: SkillTestServer,
  event: Parameters<typeof signEvent>[0] extends never ? never : Awaited<ReturnType<typeof signEvent>>,
): Promise<void> {
  const res = await server.fetch(`${server.origin}/api/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event }),
  })
  if (res.status !== 200) {
    const body = await res.text()
    throw new Error(`identity publish failed: ${res.status} ${body}`)
  }
}
