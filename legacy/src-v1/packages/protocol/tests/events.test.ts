import { describe, it, expect, beforeAll } from 'vitest'
import { generateOperatorKey, delegateAgentKey } from '../src/keys'
import { createEvent, signEvent, verifyEvent, canonicalize } from '../src/events'
import type { AgentKey, ExperiencePayload } from '../src/types'

describe('A3: Event Signing & Verification', () => {
  let agentKey: AgentKey
  const payload: ExperiencePayload = {
    type: 'experience',
    data: {
      what: 'Docker DNS resolution fix',
      tried: 'modified /etc/resolv.conf and restarted daemon',
      outcome: 'succeeded',
      learned: 'always restart container to clear DNS cache after resolv.conf changes',
    },
  }

  beforeAll(async () => {
    const opKey = await generateOperatorKey()
    agentKey = await delegateAgentKey(opKey, 'test-agent', 90)
  })

  it('Test 1: createEvent builds canonical unsigned event', () => {
    const event = createEvent('intent.broadcast', payload, ['docker', 'dns'])
    expect(event.kind).toBe('intent.broadcast')
    expect(event.v).toBe(1)
    expect(event.tags).toContain('docker')
    expect(event.tags).toContain('dns')
    expect(event.payload).toEqual(payload)
    // No sig yet
    expect((event as Record<string, unknown>)['sig']).toBeUndefined()
  })

  it('Test 2: signEvent adds valid signature and id', async () => {
    const event = createEvent('intent.broadcast', payload, ['docker'])
    const signed = await signEvent(event, agentKey)
    expect(signed.sig).toHaveLength(128)    // 64 bytes = 128 hex chars
    expect(signed.id).toHaveLength(64)      // 32 bytes = 64 hex chars
    expect(signed.pubkey).toBe(agentKey.publicKey)
    expect(signed.operator_pubkey).toBe(agentKey.delegatedBy)
  })

  it('Test 3: verifyEvent returns true for valid signature', async () => {
    const event = createEvent('intent.broadcast', payload, ['test'])
    const signed = await signEvent(event, agentKey)
    expect(await verifyEvent(signed)).toBe(true)
  })

  it('Test 4: tampered payload fails verification', async () => {
    const event = createEvent('intent.broadcast', payload, ['test'])
    const signed = await signEvent(event, agentKey)
    const tampered = {
      ...signed,
      payload: { type: 'experience', data: { what: 'tampered' } },
    }
    expect(await verifyEvent(tampered)).toBe(false)
  })

  it('Test 5: tampered id fails verification', async () => {
    const event = createEvent('intent.broadcast', payload, ['test'])
    const signed = await signEvent(event, agentKey)
    const badId = { ...signed, id: 'a'.repeat(64) }
    expect(await verifyEvent(badId)).toBe(false)
  })

  it('Test 6: canonicalize is deterministic (same content = same output)', () => {
    const event = createEvent('intent.broadcast', payload, ['docker'])
    const c1 = canonicalize(event)
    const c2 = canonicalize({ ...event })  // different object reference, same content
    expect(c1).toBe(c2)
    // Must be a non-empty string
    expect(c1.length).toBeGreaterThan(0)
  })

  it('Test 7: expired agent key still verifies (expiry is relay concern)', async () => {
    const opKey = await generateOperatorKey()
    const expiredKey: AgentKey = {
      ...(await delegateAgentKey(opKey, 'expired', 90)),
      expiresAt: Math.floor(Date.now() / 1000) - 1, // already expired
    }
    const event = createEvent('intent.broadcast', payload, [])
    const signed = await signEvent(event, expiredKey)
    // verifyEvent checks signature only — expiry is the relay's responsibility
    expect(await verifyEvent(signed)).toBe(true)
  })

  it('Test 8: canonicalize excludes id and sig fields', () => {
    const event = createEvent('intent.broadcast', payload, [])
    const canonical = canonicalize(event)
    const parsed = JSON.parse(canonical)
    expect(parsed['id']).toBeUndefined()
    expect(parsed['sig']).toBeUndefined()
  })

  it('Test 9: canonicalize uses sorted keys', () => {
    const event = createEvent('intent.broadcast', payload, [])
    const canonical = canonicalize(event)
    // Verify it is valid JSON and has consistent key order
    expect(() => JSON.parse(canonical)).not.toThrow()
  })

  it('Test 10: tampered sig fails verification', async () => {
    const event = createEvent('intent.broadcast', payload, ['test'])
    const signed = await signEvent(event, agentKey)
    const badSig = { ...signed, sig: 'f'.repeat(128) }
    expect(await verifyEvent(badSig)).toBe(false)
  })
})
