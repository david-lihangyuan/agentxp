// G1: Node Registration & Discovery
// Tests for challenge-response relay registration, node listing, heartbeat, and bootstrap.

import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../src/db'
import type Database from 'better-sqlite3'
import { generateOperatorKey } from '@serendip/protocol'
import { NodeRegistry } from '../src/protocol/node-registry'
import { createApp } from '../src/app'

// Helper: sign a challenge with an operator key to produce a valid challenge proof
async function signChallenge(challenge: string, operatorKey: Awaited<ReturnType<typeof generateOperatorKey>>): Promise<string> {
  const { signEvent, createEvent } = await import('@serendip/protocol')
  const { delegateAgentKey } = await import('@serendip/protocol')
  const agentKey = await delegateAgentKey(operatorKey, 'relay-agent', 365)
  const unsigned = createEvent('intent.broadcast', { type: 'relay.challenge', data: { challenge } }, [])
  const signed = await signEvent(unsigned, agentKey)
  return JSON.stringify(signed)
}

describe('G1: Node Registration & Discovery', () => {
  let db: Database.Database
  let nodeRegistry: NodeRegistry
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    db = openDatabase(':memory:')
    nodeRegistry = new NodeRegistry(db)
    app = createApp({ db })
  })

  // ── Challenge Flow ──────────────────────────────────────────────────────────

  it('GET /api/v1/nodes/challenge returns a challenge with expires_in', async () => {
    const res = await app.request('/api/v1/nodes/challenge')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(typeof body['challenge']).toBe('string')
    expect((body['challenge'] as string).length).toBeGreaterThan(0)
    expect(body['expires_in']).toBe(60)
  })

  it('Challenge is a random hex string', async () => {
    const res1 = await app.request('/api/v1/nodes/challenge')
    const res2 = await app.request('/api/v1/nodes/challenge')
    const b1 = await res1.json() as Record<string, unknown>
    const b2 = await res2.json() as Record<string, unknown>
    // Two challenges should be different (random)
    expect(b1['challenge']).not.toBe(b2['challenge'])
    // Should be hex
    expect(b1['challenge']).toMatch(/^[0-9a-f]+$/i)
  })

  // ── Node Registration ───────────────────────────────────────────────────────

  it('POST /api/v1/nodes/register accepts valid registration', async () => {
    const operatorKey = await generateOperatorKey()
    const challengeSignature = await signChallenge('abc123', operatorKey)

    const res = await app.request('/api/v1/nodes/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relay_pubkey: operatorKey.publicKey,
        challenge: 'abc123',
        signature: challengeSignature,
        url: 'wss://relay2.example.com',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body['success']).toBe(true)
  })

  it('POST /api/v1/nodes/register rejects missing fields', async () => {
    const res = await app.request('/api/v1/nodes/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relay_pubkey: 'abc' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/v1/nodes/register rejects invalid URL scheme', async () => {
    const operatorKey = await generateOperatorKey()
    const challengeSignature = await signChallenge('abc123', operatorKey)

    const res = await app.request('/api/v1/nodes/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relay_pubkey: operatorKey.publicKey,
        challenge: 'abc123',
        signature: challengeSignature,
        url: 'http://relay2.example.com',
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body['error']).toContain('wss://')
  })

  // ── GET /api/v1/nodes — list with last_seen and status ────────────────────

  it('GET /api/v1/nodes returns registered nodes with last_seen and status', async () => {
    const operatorKey = await generateOperatorKey()
    // Register directly via NodeRegistry
    await nodeRegistry.registerWithProof({
      relay_pubkey: operatorKey.publicKey,
      challenge: 'test-challenge',
      signature: await signChallenge('test-challenge', operatorKey),
      url: 'wss://relay2.example.com',
    })

    const res = await app.request('/api/v1/nodes')
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(Array.isArray(body['nodes'])).toBe(true)
    const nodes = body['nodes'] as Array<Record<string, unknown>>
    expect(nodes.length).toBeGreaterThan(0)
    // Must have last_seen and status
    expect(nodes[0]).toHaveProperty('last_seen')
    expect(nodes[0]).toHaveProperty('status')
    expect(nodes[0]['status']).toBe('active')
  })

  // ── Heartbeat ───────────────────────────────────────────────────────────────

  it('POST /api/v1/nodes/:pubkey/heartbeat updates last_seen', async () => {
    const operatorKey = await generateOperatorKey()
    await nodeRegistry.registerWithProof({
      relay_pubkey: operatorKey.publicKey,
      challenge: 'test-challenge',
      signature: await signChallenge('test-challenge', operatorKey),
      url: 'wss://relay2.example.com',
    })

    const before = Math.floor(Date.now() / 1000)
    await new Promise(r => setTimeout(r, 10))

    const res = await app.request(`/api/v1/nodes/${operatorKey.publicKey}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body['ok']).toBe(true)

    // Verify last_seen was updated
    const node = nodeRegistry.getNode(operatorKey.publicKey)
    expect(node).toBeDefined()
    expect(node!.last_seen).toBeGreaterThanOrEqual(before)
  })

  it('POST /api/v1/nodes/:pubkey/heartbeat returns 404 for unknown pubkey', async () => {
    const res = await app.request('/api/v1/nodes/unknownpubkey/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
  })

  // ── Unregistered Relay Rate Limit ──────────────────────────────────────────

  it('NodeRegistry.isRegistered returns false for unknown relay', () => {
    const isRegistered = nodeRegistry.isRegistered('unknown_pubkey')
    expect(isRegistered).toBe(false)
  })

  it('NodeRegistry.isRegistered returns true after registration', async () => {
    const operatorKey = await generateOperatorKey()
    await nodeRegistry.registerWithProof({
      relay_pubkey: operatorKey.publicKey,
      challenge: 'test-challenge',
      signature: await signChallenge('test-challenge', operatorKey),
      url: 'wss://relay2.example.com',
    })
    expect(nodeRegistry.isRegistered(operatorKey.publicKey)).toBe(true)
  })

  // ── Bootstrap: Identity Events Sync ────────────────────────────────────────

  it('GET /api/v1/sync/identity returns all identity events without time filter', async () => {
    // Insert some identity events
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('id1', 'a'.repeat(64), 'a'.repeat(64), 'identity.register', now - 9999, '{}', '[]', 'public', 's'.repeat(128), now)
    db.prepare(`
      INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('id2', 'b'.repeat(64), 'b'.repeat(64), 'identity.delegate', now - 5000, '{}', '[]', 'public', 's'.repeat(128), now)

    const res = await app.request('/api/v1/sync/identity')
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(body.length).toBe(2)
  })

  it('Bootstrap: identity events include old events (no time window restriction)', async () => {
    const now = Math.floor(Date.now() / 1000)
    // Insert a very old identity event (>1 year ago)
    db.prepare(`
      INSERT INTO events (id, pubkey, operator_pubkey, kind, created_at, payload, tags, visibility, sig, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('old-id1', 'c'.repeat(64), 'c'.repeat(64), 'identity.delegate', now - 365 * 86400, '{}', '[]', 'public', 's'.repeat(128), now)

    const res = await app.request('/api/v1/sync/identity')
    expect(res.status).toBe(200)
    const body = await res.json() as Array<Record<string, unknown>>
    const old = body.find(e => e['id'] === 'old-id1')
    expect(old).toBeDefined()
  })
})
