// Shared fixtures for supernode integration tests.
import {
  createEvent,
  delegateAgentKey,
  generateOperatorKey,
  signEvent,
} from '@agentxp/protocol'
import type { AgentKey, OperatorKey, SerendipEvent } from '@agentxp/protocol'
import { buildApp } from '../src/app.js'
import { openDb, type Db } from '../src/db.js'

export interface TestServer {
  db: Db
  fetch: (input: Request) => Promise<Response>
}

export function startTestServer(): TestServer {
  const db = openDb(':memory:')
  const app = buildApp({ db })
  return { db, fetch: async (req: Request) => app.fetch(req) }
}

async function publish(
  server: TestServer,
  event: SerendipEvent,
  path = '/api/v1/events',
): Promise<{ status: number; body: unknown }> {
  const res = await server.fetch(
    new Request(`http://t${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event }),
    }),
  )
  return { status: res.status, body: await res.json() }
}

export async function bootstrapIdentity(
  server: TestServer,
): Promise<{ operator: OperatorKey; agent: AgentKey }> {
  const operator = await generateOperatorKey()
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
      { type: 'operator', data: { pubkey: operator.publicKey, registered_at: Math.floor(Date.now() / 1000) } },
      [],
    ),
    operatorAsAgent,
  )
  const regRes = await publish(server, reg)
  if (regRes.status !== 200) {
    throw new Error(`identity.register failed: ${regRes.status} ${JSON.stringify(regRes.body)}`)
  }

  const agent = await delegateAgentKey(operator, 'test-agent', 30)
  const del = await signEvent(
    createEvent(
      'identity.delegate',
      {
        type: 'delegation',
        data: {
          agent_pubkey: agent.publicKey,
          expires_at: agent.expiresAt,
          agent_id: agent.agentId,
        },
      },
      [],
    ),
    operatorAsAgent,
  )
  const delRes = await publish(server, del)
  if (delRes.status !== 200) {
    throw new Error(`identity.delegate failed: ${delRes.status} ${JSON.stringify(delRes.body)}`)
  }
  return { operator, agent }
}

export { publish }
