// E9 Test Suite: Agent Sub-Key Auto-Renewer
// TDD: check expiry, renew when < 14 days, 90-day TTL, silent renewal.
import { describe, it, expect } from 'vitest'
import { generateOperatorKey, delegateAgentKey } from '@serendip/protocol'
import type { AgentKey, OperatorKey } from '@serendip/protocol'
import { checkAndRenew, renewKey } from '../src/key-renewer.js'

describe('E9: Agent Sub-Key Auto-Renewer', () => {
  let operatorKey: OperatorKey

  // Generate a fresh operator key for all tests
  const setup = (async () => {
    operatorKey = await generateOperatorKey()
  })()

  async function ensureSetup() {
    await setup
  }

  it('Key with > 14 days remaining not renewed', async () => {
    await ensureSetup()
    const futureKey: AgentKey = await delegateAgentKey(operatorKey, 'test-agent', 30)
    // expiresAt is ~30 days from now, which is > 14 days
    const result = await checkAndRenew(futureKey, operatorKey)
    expect(result.renewed).toBe(false)
    expect(result.daysRemaining).toBeGreaterThan(14)
  })

  it('Key with < 14 days remaining is renewed', async () => {
    await ensureSetup()
    // Create a key that expires in 10 days
    const soonKey: AgentKey = {
      ...(await delegateAgentKey(operatorKey, 'test-agent', 10)),
      expiresAt: Math.floor(Date.now() / 1000) + 10 * 86400,
    }
    const result = await checkAndRenew(soonKey, operatorKey)
    expect(result.renewed).toBe(true)
    expect(result.newKey).toBeDefined()
  })

  it('New key has 90 day TTL from renewal date', async () => {
    await ensureSetup()
    const soonKey: AgentKey = {
      ...(await delegateAgentKey(operatorKey, 'test-agent', 5)),
      expiresAt: Math.floor(Date.now() / 1000) + 5 * 86400,
    }
    const newKey = await renewKey(soonKey, operatorKey)
    const expectedExpiry = Math.floor(Date.now() / 1000) + 90 * 86400
    // Allow 5 second tolerance for test execution time
    expect(Math.abs(newKey.expiresAt - expectedExpiry)).toBeLessThan(5)
  })

  it('Renewal is silent — no user notification needed', async () => {
    await ensureSetup()
    const soonKey: AgentKey = {
      ...(await delegateAgentKey(operatorKey, 'test-agent', 3)),
      expiresAt: Math.floor(Date.now() / 1000) + 3 * 86400,
    }
    // checkAndRenew returns a result object — no side effects, no prompts
    const result = await checkAndRenew(soonKey, operatorKey)
    expect(result.renewed).toBe(true)
    // The function signature has no callback, no event emitter, no user prompt
    expect(result.newKey?.publicKey).toBeDefined()
    expect(result.newKey?.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('Renewed key inherits agent ID', async () => {
    await ensureSetup()
    const soonKey: AgentKey = {
      ...(await delegateAgentKey(operatorKey, 'my-special-agent', 5)),
      expiresAt: Math.floor(Date.now() / 1000) + 5 * 86400,
    }
    const newKey = await renewKey(soonKey, operatorKey)
    expect(newKey.agentId).toBe('my-special-agent')
  })

  it('Expired key (0 days remaining) is renewed', async () => {
    await ensureSetup()
    const expiredKey: AgentKey = {
      ...(await delegateAgentKey(operatorKey, 'expired-agent', 1)),
      expiresAt: Math.floor(Date.now() / 1000) - 86400, // expired yesterday
    }
    const result = await checkAndRenew(expiredKey, operatorKey)
    expect(result.renewed).toBe(true)
    expect(result.daysRemaining).toBe(0)
  })
})
