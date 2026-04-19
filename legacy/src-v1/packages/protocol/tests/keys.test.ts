import { describe, it, expect } from 'vitest'
import { generateOperatorKey, delegateAgentKey, revokeAgentKey } from '../src/keys'

describe('A2: Ed25519 Key Generation', () => {
  it('Test 1: generateOperatorKey produces valid key pair', async () => {
    const key = await generateOperatorKey()
    expect(key.publicKey).toHaveLength(64)      // 32 bytes = 64 hex chars
    expect(key.privateKey).toBeInstanceOf(Uint8Array)
    expect(key.privateKey).toHaveLength(32)
  })

  it('Test 2: delegateAgentKey produces verifiable delegation', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'my-agent', 90)
    expect(agentKey.delegatedBy).toBe(opKey.publicKey)
    expect(agentKey.agentId).toBe('my-agent')
    expect(agentKey.publicKey).toHaveLength(64)
    expect(agentKey.privateKey).toBeInstanceOf(Uint8Array)
    expect(agentKey.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(agentKey.expiresAt).toBeLessThan(Math.floor(Date.now() / 1000) + 91 * 86400)
  })

  it('Test 3: solo developer mode — operator key IS agent key (self-delegate)', async () => {
    const soloKey = await generateOperatorKey()
    const selfDelegate = await delegateAgentKey(soloKey, 'solo-agent', 365)
    expect(selfDelegate.delegatedBy).toBe(soloKey.publicKey)
    expect(selfDelegate.agentId).toBe('solo-agent')
  })

  it('Test 4: revokeAgentKey produces a signed revocation event', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'my-agent', 90)
    const revoke = await revokeAgentKey(opKey, agentKey.publicKey)
    expect(revoke.kind).toBe('identity.revoke')
    expect(revoke.pubkey).toBe(opKey.publicKey)
    expect(revoke.v).toBe(1)
    expect(revoke.sig).toHaveLength(128)   // 64 bytes hex
    expect(revoke.id).toHaveLength(64)     // 32 bytes hex
    const data = revoke.payload.data as { revokedKey: string }
    expect(data.revokedKey).toBe(agentKey.publicKey)
  })

  it('Test 5: different operator keys are unique', async () => {
    const key1 = await generateOperatorKey()
    const key2 = await generateOperatorKey()
    expect(key1.publicKey).not.toBe(key2.publicKey)
    // Private keys should also differ
    expect(Buffer.from(key1.privateKey).toString('hex'))
      .not.toBe(Buffer.from(key2.privateKey).toString('hex'))
  })

  it('Test 6: delegated agent key is different from operator key', async () => {
    const opKey = await generateOperatorKey()
    const agentKey = await delegateAgentKey(opKey, 'agent', 30)
    expect(agentKey.publicKey).not.toBe(opKey.publicKey)
  })
})
