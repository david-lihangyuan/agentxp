import { describe, it, expect } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519'
import { delegateAgentKey, generateOperatorKey } from '../src/keys.js'
import { hexToBytes } from '../src/utils.js'

describe('generateOperatorKey (Phase A §A2)', () => {
  it('produces 64-char hex pubkey and 32-byte privkey', async () => {
    const key = await generateOperatorKey()
    expect(key.publicKey).toHaveLength(64)
    expect(key.publicKey).toMatch(/^[0-9a-f]{64}$/)
    expect(key.privateKey).toBeInstanceOf(Uint8Array)
    expect(key.privateKey).toHaveLength(32)
  })

  it('derives a matching Ed25519 public key from the private key', async () => {
    const key = await generateOperatorKey()
    const derived = ed25519.getPublicKey(key.privateKey)
    expect(Array.from(derived)).toEqual(Array.from(hexToBytes(key.publicKey)))
  })

  it('is unique across invocations', async () => {
    const a = await generateOperatorKey()
    const b = await generateOperatorKey()
    expect(a.publicKey).not.toBe(b.publicKey)
  })
})

describe('delegateAgentKey (Phase A §A2)', () => {
  it('returns an AgentKey whose delegatedBy points at the operator', async () => {
    const op = await generateOperatorKey()
    const agent = await delegateAgentKey(op, 'my-agent', 90)
    expect(agent.delegatedBy).toBe(op.publicKey)
    expect(agent.agentId).toBe('my-agent')
    expect(agent.publicKey).not.toBe(op.publicKey)
    expect(agent.privateKey).not.toEqual(op.privateKey)
  })

  it('sets expiresAt ttlDays into the future (unix seconds)', async () => {
    const op = await generateOperatorKey()
    const before = Math.floor(Date.now() / 1000)
    const agent = await delegateAgentKey(op, 'a', 90)
    const after = Math.floor(Date.now() / 1000)
    expect(agent.expiresAt).toBeGreaterThanOrEqual(before + 90 * 86400)
    expect(agent.expiresAt).toBeLessThanOrEqual(after + 90 * 86400)
  })
})
