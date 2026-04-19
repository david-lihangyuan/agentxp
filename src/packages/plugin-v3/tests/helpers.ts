// Shared fixtures for @agentxp/openclaw-plugin. Reuses the in-memory M2
// relay (buildApp + :memory: SQLite) used by the Skill test suite so
// plugin tests round-trip a real signed event against a real relay.
import { createEvent, signEvent } from '@serendip/protocol'
import type { AgentKey, OperatorKey } from '@serendip/protocol'
import { ed25519 } from '@noble/curves/ed25519'
import { buildApp } from '../../supernode/src/app.js'
import { openDb } from '../../supernode/src/db.js'

export interface PluginTestServer {
  fetch: typeof globalThis.fetch
  origin: string
}

export function startInMemoryRelay(): PluginTestServer {
  const db = openDb(':memory:')
  const app = buildApp({ db })
  const origin = 'http://relay.test'
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init)
    return app.fetch(req)
  }
  return { fetch: fetchImpl, origin }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function makeOperatorKey(): OperatorKey {
  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = toHex(ed25519.getPublicKey(privateKey))
  return { publicKey, privateKey }
}

export function makeAgentKey(operator: OperatorKey, agentId = 'plugin-test'): AgentKey {
  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = toHex(ed25519.getPublicKey(privateKey))
  return {
    publicKey,
    privateKey,
    delegatedBy: operator.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 86_400,
    agentId,
  }
}

export async function registerOperatorAndAgent(
  server: PluginTestServer,
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
  await expect200(server, reg)

  const delegation: { agent_pubkey: string; expires_at: number; agent_id?: string } = {
    agent_pubkey: agent.publicKey,
    expires_at: agent.expiresAt,
  }
  if (agent.agentId !== undefined) delegation.agent_id = agent.agentId

  const del = await signEvent(
    createEvent('identity.delegate', { type: 'delegation', data: delegation }, []),
    operatorAsAgent,
  )
  await expect200(server, del)
}

async function expect200(
  server: PluginTestServer,
  event: Awaited<ReturnType<typeof signEvent>>,
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
