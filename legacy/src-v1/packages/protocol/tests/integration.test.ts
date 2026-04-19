import { describe, it, expect } from 'vitest'
import { generateOperatorKey, delegateAgentKey, revokeAgentKey } from '../src/keys'
import { createEvent, signEvent, verifyEvent } from '../src/events'
import { buildMerkleRoot, getMerkleProof, verifyMerkleProof } from '../src/merkle'
import type { ExperiencePayload } from '../src/types'

describe('Phase A Integration: full A2 → A3 → A4 chain', () => {
  it('Full chain: generate keys → sign event → verify → Merkle proof → revoke', async () => {
    // Step 1: Generate keys (A2)
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'integration-agent', 90)

    expect(opKey.publicKey).toHaveLength(64)
    expect(agentKey.delegatedBy).toBe(opKey.publicKey)
    expect(agentKey.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))

    // Step 2: Create and sign event (A3)
    const payload: ExperiencePayload = {
      type: 'experience',
      data: {
        what: 'Integration test: full protocol chain',
        tried: 'ran A2 → A3 → A4 in sequence',
        outcome: 'succeeded',
        learned: 'all protocol components integrate correctly',
      },
    }
    const unsignedEvent = createEvent('intent.broadcast', payload, ['integration', 'test'])
    const signedEvent = await signEvent(unsignedEvent, agentKey)

    expect(signedEvent.v).toBe(1)
    expect(signedEvent.id).toHaveLength(64)
    expect(signedEvent.sig).toHaveLength(128)
    expect(signedEvent.pubkey).toBe(agentKey.publicKey)
    expect(signedEvent.operator_pubkey).toBe(opKey.publicKey)

    // Step 3: Verify signature (A3)
    const isValid = await verifyEvent(signedEvent)
    expect(isValid).toBe(true)

    // Tampered event must fail
    const tampered = { ...signedEvent, payload: { type: 'tampered', data: {} } }
    expect(await verifyEvent(tampered)).toBe(false)

    // Step 4: Build Merkle tree and verify inclusion (A4)
    const extraEvent1 = await signEvent(
      createEvent('intent.broadcast', { type: 'test', data: { n: 1 } }, []),
      agentKey
    )
    const extraEvent2 = await signEvent(
      createEvent('intent.broadcast', { type: 'test', data: { n: 2 } }, []),
      agentKey
    )
    const allEvents = [signedEvent, extraEvent1, extraEvent2]

    const root = buildMerkleRoot(allEvents)
    expect(root).toHaveLength(64)

    const proof = getMerkleProof(allEvents, signedEvent.id)
    expect(proof).not.toBeNull()

    expect(verifyMerkleProof(signedEvent.id, proof!, root)).toBe(true)
    // Non-included id fails
    expect(verifyMerkleProof('0'.repeat(64), proof!, root)).toBe(false)

    // Step 5: Revoke agent key (A2) and verify the revocation event (A3)
    const revokeEvent = await revokeAgentKey(opKey, agentKey.publicKey)
    expect(revokeEvent.kind).toBe('identity.revoke')
    expect(revokeEvent.pubkey).toBe(opKey.publicKey)
    expect(await verifyEvent(revokeEvent)).toBe(true)

    const revokeData = revokeEvent.payload.data as { revokedKey: string }
    expect(revokeData.revokedKey).toBe(agentKey.publicKey)
  })

  it('Multiple events: each proves inclusion against shared Merkle root', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'batch-agent', 30)

    // Create 5 signed events
    const events = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        signEvent(
          createEvent(
            'intent.broadcast',
            { type: 'test', data: { index: i } },
            [`tag-${i}`]
          ),
          agentKey
        )
      )
    )

    const root = buildMerkleRoot(events)

    for (const event of events) {
      const proof = getMerkleProof(events, event.id)
      expect(proof).not.toBeNull()
      expect(verifyMerkleProof(event.id, proof!, root)).toBe(true)
    }
  })

  it('Solo developer mode: operator key delegates to itself', async () => {
    const soloKey = await generateOperatorKey()
    // In solo mode, the operator IS the agent — delegate to itself
    const selfDelegated = await delegateAgentKey(soloKey, 'solo', 365)
    expect(selfDelegated.delegatedBy).toBe(soloKey.publicKey)

    const event = await signEvent(
      createEvent('intent.broadcast', { type: 'solo', data: {} }, []),
      selfDelegated
    )
    expect(await verifyEvent(event)).toBe(true)
    expect(event.operator_pubkey).toBe(soloKey.publicKey)
  })
})
