import { describe, it, expect, beforeAll } from 'vitest'
import { generateOperatorKey, delegateAgentKey } from '../src/keys'
import { createEvent, signEvent } from '../src/events'
import { buildMerkleRoot, getMerkleProof, verifyMerkleProof } from '../src/merkle'
import type { SerendipEvent, AgentKey, ExperiencePayload } from '../src/types'

describe('A4: Merkle Hash Integrity', () => {
  let agentKey: AgentKey
  let event1: SerendipEvent
  let event2: SerendipEvent
  let event3: SerendipEvent

  const makePayload = (what: string): ExperiencePayload => ({
    type: 'experience',
    data: {
      what,
      tried: `tried ${what}`,
      outcome: 'succeeded',
      learned: `learned from ${what}`,
    },
  })

  beforeAll(async () => {
    const opKey = await generateOperatorKey()
    agentKey = await delegateAgentKey(opKey, 'merkle-test-agent', 90)

    event1 = await signEvent(createEvent('intent.broadcast', makePayload('event one'), ['a']), agentKey)
    event2 = await signEvent(createEvent('intent.broadcast', makePayload('event two'), ['b']), agentKey)
    event3 = await signEvent(createEvent('intent.broadcast', makePayload('event three'), ['c']), agentKey)
  })

  it('Test 1: buildMerkleRoot returns consistent hash for same events', () => {
    const root1 = buildMerkleRoot([event1, event2, event3])
    const root2 = buildMerkleRoot([...[ event1, event2, event3]])
    expect(root1).toBe(root2)
    expect(root1).toHaveLength(64)  // SHA-256 = 32 bytes = 64 hex chars
  })

  it('Test 2: different set of events produces different root', () => {
    const root3items = buildMerkleRoot([event1, event2, event3])
    const root2items = buildMerkleRoot([event1, event2])
    expect(root3items).not.toBe(root2items)
  })

  it('Test 3: getMerkleProof returns valid proof array for included event', () => {
    const events = [event1, event2, event3]
    const proof = getMerkleProof(events, event1.id)
    expect(proof).not.toBeNull()
    expect(Array.isArray(proof)).toBe(true)
  })

  it('Test 4: verifyMerkleProof confirms included event', () => {
    const events = [event1, event2, event3]
    const root = buildMerkleRoot(events)
    const proof = getMerkleProof(events, event1.id)
    expect(proof).not.toBeNull()
    expect(verifyMerkleProof(event1.id, proof!, root)).toBe(true)
  })

  it('Test 5: verifyMerkleProof rejects non-included event', () => {
    const events = [event1, event2, event3]
    const root = buildMerkleRoot(events)
    const proof = getMerkleProof(events, event1.id)!
    const fakeId = 'fake' + 'a'.repeat(60)
    expect(verifyMerkleProof(fakeId, proof, root)).toBe(false)
  })

  it('Test 6: single event tree works end-to-end', () => {
    const singleRoot = buildMerkleRoot([event1])
    const singleProof = getMerkleProof([event1], event1.id)
    expect(singleProof).not.toBeNull()
    expect(verifyMerkleProof(event1.id, singleProof!, singleRoot)).toBe(true)
  })

  it('Test 7: getMerkleProof returns null for event not in tree', () => {
    const events = [event1, event2, event3]
    expect(getMerkleProof(events, 'not-in-tree')).toBeNull()
  })

  it('Test 8: all 3 events verify against the same root', () => {
    const events = [event1, event2, event3]
    const root = buildMerkleRoot(events)
    for (const event of events) {
      const proof = getMerkleProof(events, event.id)
      expect(proof).not.toBeNull()
      expect(verifyMerkleProof(event.id, proof!, root)).toBe(true)
    }
  })

  it('Test 9: even-length event list works', () => {
    const events = [event1, event2]
    const root = buildMerkleRoot(events)
    expect(root).toHaveLength(64)
    const proof = getMerkleProof(events, event2.id)
    expect(proof).not.toBeNull()
    expect(verifyMerkleProof(event2.id, proof!, root)).toBe(true)
  })

  it('Test 10: proof from different root fails verification', () => {
    const events1 = [event1, event2, event3]
    const events2 = [event1, event2]
    const root1 = buildMerkleRoot(events1)
    const root2 = buildMerkleRoot(events2)
    const proof1 = getMerkleProof(events1, event1.id)!
    // Proof from root1 should not verify against root2
    expect(verifyMerkleProof(event1.id, proof1, root2)).toBe(false)
  })
})
