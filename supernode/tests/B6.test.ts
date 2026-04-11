// B6 Test Suite: Identity Handling
// TDD: Register operator, delegate agent, revoke key, reject events from revoked keys, bootstrap sync.
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  generateOperatorKey,
  delegateAgentKey,
  revokeAgentKey,
  createDelegateEvent,
  createEvent,
  signEvent,
} from '@serendip/protocol'
import { runMigrations } from '../src/db'
import { IdentityStore } from '../src/protocol/identity-store'
import { EventHandler } from '../src/protocol/event-handler'
import { createApp } from '../src/app'
import type { SerendipEvent } from '@serendip/protocol'

async function makeIdentityRegisterEvent(
  opKey: Awaited<ReturnType<typeof generateOperatorKey>>
): Promise<SerendipEvent> {
  const payload = {
    type: 'identity.register',
    data: { registeredAt: Math.floor(Date.now() / 1000) },
  }
  // Operator signs as their own agent
  const opAsAgent = {
    publicKey: opKey.publicKey,
    privateKey: opKey.privateKey,
    delegatedBy: opKey.publicKey,
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
  }
  const unsigned = createEvent('identity.register', payload, [])
  const withOp = { ...unsigned, operator_pubkey: opKey.publicKey }
  return signEvent(withOp, opAsAgent)
}

describe('B6: Identity Registration', () => {
  let db: Database
  let identityStore: IdentityStore
  let handler: EventHandler

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    identityStore = new IdentityStore(db)
    handler = new EventHandler(db)
  })

  it('identity.register stores operator in identities table', async () => {
    const opKey = await generateOperatorKey()
    const registerEvent = await makeIdentityRegisterEvent(opKey)
    const result = await handler.handleEvent(registerEvent)
    expect(result.ok).toBe(true)

    const identity = identityStore.get(opKey.publicKey)
    expect(identity).toBeDefined()
    expect(identity!.kind).toBe('operator')
    expect(identity!.revoked).toBe(0)
  })

  it('registering same operator twice is idempotent', async () => {
    const opKey = await generateOperatorKey()
    const registerEvent = await makeIdentityRegisterEvent(opKey)
    await handler.handleEvent(registerEvent)

    // Re-registering directly should be fine
    const result = identityStore.handleRegister(registerEvent)
    expect(result.ok).toBe(true)
  })
})

describe('B6: Agent Delegation', () => {
  let db: Database
  let identityStore: IdentityStore
  let handler: EventHandler

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    identityStore = new IdentityStore(db)
    handler = new EventHandler(db)
  })

  it('identity.delegate stores agent under operator', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'test-agent', 90)

    const delegateEvent = await createDelegateEvent(opKey, agentKey)
    const result = await handler.handleEvent(delegateEvent)
    expect(result.ok).toBe(true)

    const agent = identityStore.get(agentKey.publicKey)
    expect(agent).toBeDefined()
    expect(agent!.kind).toBe('agent')
    expect(agent!.delegated_by).toBe(opKey.publicKey)
    expect(agent!.revoked).toBe(0)
  })

  it('delegation records agentId when provided', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'my-special-agent', 90)
    expect(agentKey.agentId).toBe('my-special-agent')

    const delegateEvent = await createDelegateEvent(opKey, agentKey)
    await handler.handleEvent(delegateEvent)

    const agent = identityStore.get(agentKey.publicKey)
    expect(agent).toBeDefined()
    expect(agent!.agent_id).toBe('my-special-agent')
  })

  it('delegation records expires_at', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent', 30)
    const delegateEvent = await createDelegateEvent(opKey, agentKey)
    await handler.handleEvent(delegateEvent)

    const agent = identityStore.get(agentKey.publicKey)
    expect(agent).toBeDefined()
    expect(agent!.expires_at).toBeDefined()
    expect(agent!.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('getAgentsForOperator returns all delegated agents', async () => {
    const opKey = await generateOperatorKey()
    const agent1 = await delegateAgentKey(opKey, 'agent-1', 90)
    const agent2 = await delegateAgentKey(opKey, 'agent-2', 90)

    const d1 = await createDelegateEvent(opKey, agent1)
    const d2 = await createDelegateEvent(opKey, agent2)
    await handler.handleEvent(d1)
    await handler.handleEvent(d2)

    const agents = identityStore.getAgentsForOperator(opKey.publicKey)
    expect(agents.length).toBe(2)
  })
})

describe('B6: Key Revocation', () => {
  let db: Database
  let identityStore: IdentityStore
  let handler: EventHandler

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    identityStore = new IdentityStore(db)
    handler = new EventHandler(db)
  })

  it('identity.revoke marks agent as revoked', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent', 90)

    // First delegate
    const delegateEvent = await createDelegateEvent(opKey, agentKey)
    await handler.handleEvent(delegateEvent)

    // Then revoke
    const revokeEvent = await revokeAgentKey(opKey, agentKey.publicKey)
    const result = await handler.handleEvent(revokeEvent)
    expect(result.ok).toBe(true)

    const revoked = identityStore.get(agentKey.publicKey)
    expect(revoked!.revoked).toBe(1)
  })

  it('isRevoked returns true for revoked key', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent', 90)

    const delegateEvent = await createDelegateEvent(opKey, agentKey)
    await handler.handleEvent(delegateEvent)

    const revokeEvent = await revokeAgentKey(opKey, agentKey.publicKey)
    await handler.handleEvent(revokeEvent)

    expect(identityStore.isRevoked(agentKey.publicKey)).toBe(true)
  })

  it('event from revoked key is rejected', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent', 90)

    // Delegate and then revoke
    const delegateEvent = await createDelegateEvent(opKey, agentKey)
    await handler.handleEvent(delegateEvent)

    const revokeEvent = await revokeAgentKey(opKey, agentKey.publicKey)
    await handler.handleEvent(revokeEvent)

    // Now try to publish with the revoked key
    const expPayload = {
      type: 'experience',
      data: {
        what: 'Post-revocation experience',
        tried: 'Publishing after revocation',
        outcome: 'failed',
        learned: 'This should be rejected',
      },
    }
    const unsigned = createEvent('intent.broadcast', expPayload, [])
    const withOp = { ...unsigned, operator_pubkey: opKey.publicKey }
    const event = await signEvent(withOp, agentKey)

    const result = await handler.handleEvent(event)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('revoked')
  })

  it('cannot revoke key belonging to different operator', async () => {
    const opA = await generateOperatorKey()
    const opB = await generateOperatorKey()
    const agentA = await delegateAgentKey(opA, 'agent-a', 90)

    // Delegate agent under operator A
    const delegateEvent = await createDelegateEvent(opA, agentA)
    await handler.handleEvent(delegateEvent)

    // Operator B tries to revoke operator A's agent directly
    const result = identityStore.handleRevoke({
      v: 1,
      id: 'fake-id',
      pubkey: opB.publicKey, // operator B
      operator_pubkey: opB.publicKey,
      kind: 'identity.revoke',
      created_at: Math.floor(Date.now() / 1000),
      payload: { type: 'identity.revoke', data: { revokedKey: agentA.publicKey } },
      tags: [],
      visibility: 'public',
      sig: 'fake-sig',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('can only revoke')
  })
})

describe('B6: Relay Bootstrap — Identity Sync', () => {
  let mainDb: Database
  let handler: EventHandler

  beforeEach(async () => {
    mainDb = new Database(':memory:')
    runMigrations(mainDb)
    handler = new EventHandler(mainDb)
  })

  it('getAllIdentityEvents returns all identity events for sync', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent', 90)

    const registerEvent = await makeIdentityRegisterEvent(opKey)
    const delegateEvent = await createDelegateEvent(opKey, agentKey)
    await handler.handleEvent(registerEvent)
    await handler.handleEvent(delegateEvent)

    const identityStore = new IdentityStore(mainDb)
    const events = identityStore.getAllIdentityEvents(mainDb)
    expect(events.length).toBeGreaterThanOrEqual(2)

    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('identity.register')
    expect(kinds).toContain('identity.delegate')
  })

  it('new relay can bootstrap identity events via /api/v1/sync/identity', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/api/v1/sync/identity')
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('B6: Node Registry', () => {
  it('GET /api/v1/nodes returns registered nodes', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const res = await app.request('/api/v1/nodes')
    expect(res.status).toBe(200)
    const body = await res.json() as { nodes: unknown[] }
    expect(Array.isArray(body.nodes)).toBe(true)
  })

  it('POST /api/v1/nodes/register with valid challenge registers node', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const opKey = await generateOperatorKey()

    // Create a signed challenge event
    const opAsAgent = {
      publicKey: opKey.publicKey,
      privateKey: opKey.privateKey,
      delegatedBy: opKey.publicKey,
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
    }
    const challengeEvent = await signEvent(
      { ...createEvent('identity.register', { type: 'relay.register', data: { url: 'wss://test.relay.io' } }, []), operator_pubkey: opKey.publicKey },
      opAsAgent
    )

    const res = await app.request('/api/v1/nodes/register', {
      method: 'POST',
      body: JSON.stringify({
        pubkey: opKey.publicKey,
        url: 'wss://test.relay.io',
        challengeSignature: JSON.stringify(challengeEvent),
      }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(201)
  })

  it('POST /api/v1/nodes/register with invalid challenge returns 400', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const opKey = await generateOperatorKey()

    const res = await app.request('/api/v1/nodes/register', {
      method: 'POST',
      body: JSON.stringify({
        pubkey: opKey.publicKey,
        url: 'wss://test.relay.io',
        challengeSignature: 'not-valid-json',
      }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })
})

describe('B6: Identity API Routes', () => {
  it('GET /api/v1/identities/:pubkey returns identity', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const opKey = await generateOperatorKey()
    const opAsAgent = {
      publicKey: opKey.publicKey,
      privateKey: opKey.privateKey,
      delegatedBy: opKey.publicKey,
      expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400,
    }
    const registerEvent = await signEvent(
      { ...createEvent('identity.register', { type: 'identity.register', data: {} }, []), operator_pubkey: opKey.publicKey },
      opAsAgent
    )
    await app.request('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(registerEvent),
      headers: { 'content-type': 'application/json' },
    })

    const res = await app.request(`/api/v1/identities/${opKey.publicKey}`)
    expect(res.status).toBe(200)
    const body = await res.json() as { pubkey: string; kind: string }
    expect(body.pubkey).toBe(opKey.publicKey)
    expect(body.kind).toBe('operator')
  })

  it('GET /api/v1/identities/:pubkey returns 404 for unknown pubkey', async () => {
    const app = createApp({ dbPath: ':memory:' })
    const unknownPubkey = '0'.repeat(64)
    const res = await app.request(`/api/v1/identities/${unknownPubkey}`)
    expect(res.status).toBe(404)
  })
})
