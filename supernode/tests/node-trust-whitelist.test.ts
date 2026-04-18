// Node Trust Whitelist
// Verifies that registration with/without the admin-configured trust list
// yields the correct `verified` state, and that /api/v1/sync gates the
// `full` data_scope on isVerified (not mere isRegistered).

import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import {
  generateOperatorKey,
  delegateAgentKey,
  createEvent,
  signEvent,
} from '@serendip/protocol'
import { openDatabase } from '../src/db'
import { NodeRegistry } from '../src/protocol/node-registry'
import { createApp } from '../src/app'

async function signChallenge(
  challenge: string,
  operatorKey: Awaited<ReturnType<typeof generateOperatorKey>>,
): Promise<string> {
  const agentKey = await delegateAgentKey(operatorKey, 'relay-agent', 365)
  const unsigned = createEvent(
    'intent.broadcast',
    { type: 'relay.challenge', data: { challenge } },
    [],
  )
  const signed = await signEvent(unsigned, agentKey)
  return JSON.stringify(signed)
}

async function makeRelayHeaders(
  operatorKey: Awaited<ReturnType<typeof generateOperatorKey>>,
): Promise<Record<string, string>> {
  const agentKey = await delegateAgentKey(operatorKey, 'relay-agent', 365)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const unsigned = createEvent(
    'intent.broadcast',
    { type: 'relay.sync', data: { timestamp } },
    [],
  )
  const signed = await signEvent(unsigned, agentKey)
  return {
    'X-Relay-Pubkey': operatorKey.publicKey,
    'X-Relay-Signature': signed.sig,
    'X-Relay-Timestamp': timestamp,
  }
}

describe('Node Trust Whitelist', () => {
  let db: Database.Database

  beforeEach(() => {
    db = openDatabase(':memory:')
  })

  // ── Registry-level semantics ──────────────────────────────────────────────

  it('registration without trust list → verified=0, isRegistered=true, isVerified=false', async () => {
    const registry = new NodeRegistry(db)
    const operatorKey = await generateOperatorKey()

    const result = await registry.registerWithProof({
      relay_pubkey: operatorKey.publicKey,
      challenge: 'c',
      signature: await signChallenge('c', operatorKey),
      url: 'wss://untrusted.example.com',
    })

    expect(result.ok).toBe(true)
    expect(registry.isRegistered(operatorKey.publicKey)).toBe(true)
    expect(registry.isVerified(operatorKey.publicKey)).toBe(false)
    const node = registry.getNode(operatorKey.publicKey)
    expect(node?.verified).toBe(0)
  })

  it('registration with pubkey on trust list → verified=1, isVerified=true', async () => {
    const operatorKey = await generateOperatorKey()
    const registry = new NodeRegistry(db, [operatorKey.publicKey])

    const result = await registry.registerWithProof({
      relay_pubkey: operatorKey.publicKey,
      challenge: 'c',
      signature: await signChallenge('c', operatorKey),
      url: 'wss://trusted.example.com',
    })

    expect(result.ok).toBe(true)
    expect(registry.isVerified(operatorKey.publicKey)).toBe(true)
    const node = registry.getNode(operatorKey.publicKey)
    expect(node?.verified).toBe(1)
  })

  it('trust list is case-insensitive and ignores whitespace/empties', async () => {
    const operatorKey = await generateOperatorKey()
    const registry = new NodeRegistry(db, [
      '',
      '   ',
      operatorKey.publicKey.toUpperCase(),
    ])
    expect(registry.isTrustedPubkey(operatorKey.publicKey)).toBe(true)
  })

  it('unknown pubkey is not registered and not verified', () => {
    const registry = new NodeRegistry(db, ['a'.repeat(64)])
    expect(registry.isRegistered('b'.repeat(64))).toBe(false)
    expect(registry.isVerified('b'.repeat(64))).toBe(false)
  })

  it('re-registration of an untrusted node stays verified=0', async () => {
    const registry = new NodeRegistry(db)
    const operatorKey = await generateOperatorKey()

    for (let i = 0; i < 2; i++) {
      await registry.registerWithProof({
        relay_pubkey: operatorKey.publicKey,
        challenge: `c${i}`,
        signature: await signChallenge(`c${i}`, operatorKey),
        url: `wss://attempt-${i}.example.com`,
      })
    }

    expect(registry.isVerified(operatorKey.publicKey)).toBe(false)
  })

  // ── HTTP-level: /api/v1/sync data_scope gating ────────────────────────────

  it('GET /api/v1/sync for registered-but-untrusted relay → public_only', async () => {
    const app = createApp({ db, trustedNodePubkeys: [] })
    const registry = new NodeRegistry(db, [])
    const operatorKey = await generateOperatorKey()
    const headers = await makeRelayHeaders(operatorKey)

    await registry.registerWithProof({
      relay_pubkey: operatorKey.publicKey,
      challenge: 'c',
      signature: await signChallenge('c', operatorKey),
      url: 'wss://untrusted.example.com',
    })

    const res = await app.request('/api/v1/sync?since=0', { headers })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body['data_scope']).toBe('public_only')
  })

  it('GET /api/v1/sync for trusted relay → full', async () => {
    const operatorKey = await generateOperatorKey()
    const trustList = [operatorKey.publicKey]
    const app = createApp({ db, trustedNodePubkeys: trustList })
    const registry = new NodeRegistry(db, trustList)

    await registry.registerWithProof({
      relay_pubkey: operatorKey.publicKey,
      challenge: 'c',
      signature: await signChallenge('c', operatorKey),
      url: 'wss://trusted.example.com',
    })

    const headers = await makeRelayHeaders(operatorKey)
    const res = await app.request('/api/v1/sync?since=0', { headers })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body['data_scope']).toBe('full')
  })
})
